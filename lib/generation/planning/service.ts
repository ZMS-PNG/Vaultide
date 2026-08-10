import { createHash } from 'node:crypto';
import { loadPairingConfig } from '@/lib/learning/config';
import { NeonKnowledgeSnapshotRepository } from '@/lib/learning/adapters/neon/knowledge-snapshot-repository';
import {
  attachFrozenEvidenceToContextPack,
  compileLearningContextPack,
  type CompiledLearningContextPack,
} from '@/lib/learning/domain/learning-context-pack';
import {
  createLearningContract,
  parseLearningContract,
  type LearningObjectType,
} from '@/lib/learning/domain/v3/learning-contract';
import { isContentEngineV3Enabled } from '@/lib/config/feature-flags';
import { createLogger } from '@/lib/logger';
import { assessCoursePlanningPreflight, type CoursePlanningPreflight } from './preflight';
import { NeonCoursePlanningRepository } from './repository';
import type {
  CoursePlanningInput,
  CoursePlanningLease,
  CoursePlanningRunRecord,
  CoursePlanningRunView,
} from './types';
import type { SceneOutline } from '@/lib/types/generation';
import { normalizeCourseSourceReferences } from './source-reference-normalization';

const PLAN_ID = /^cpl_[a-f0-9]{32}$/;
const CLIENT_SESSION_ID = /^[a-zA-Z0-9:_-]{6,160}$/;
const OUTLINE_LEASE_MS = 6 * 60 * 1_000;
const log = createLogger('CoursePlanningService');

function stableIdempotencyKey(
  ownerId: string,
  input: CoursePlanningInput,
  inheritedKnowledgeSnapshotId?: string,
): string {
  return `plan:${createHash('sha256')
    .update(
      JSON.stringify({
        ownerId,
        clientSessionId: input.clientSessionId,
        goal: input.requirements.requirement,
        sourceMode: input.sourceMode,
        documentSha256: createHash('sha256').update(input.documentText).digest('hex'),
        researchSha256: createHash('sha256').update(input.researchText).digest('hex'),
        references: input.sourceReferences,
        learningContractId: input.requirements.learningContract?.contractId,
        generationModel: input.generationModel
          ? {
              modelString: input.generationModel.modelString,
              thinkingConfig: input.generationModel.thinkingConfig,
            }
          : null,
        inheritedKnowledgeSnapshotId: inheritedKnowledgeSnapshotId ?? null,
      }),
      'utf8',
    )
    .digest('hex')}`;
}

function compileContext(
  input: CoursePlanningInput,
  priorKnowledge?: Parameters<typeof compileLearningContextPack>[0]['priorKnowledge'],
  allowPendingExternalResearch = false,
): CompiledLearningContextPack {
  const context = compileLearningContextPack({
    sourceMode: input.sourceMode,
    goal: input.requirements.requirement,
    documentText: input.documentText,
    researchText: input.researchText,
    references: input.sourceReferences,
    ...(allowPendingExternalResearch ? { allowPendingExternalResearch: true } : {}),
    ...(priorKnowledge ? { priorKnowledge } : {}),
  });
  return isContentEngineV3Enabled() ? attachFrozenEvidenceToContextPack(context) : context;
}

export function inferLearningObjectType(input: CoursePlanningInput): LearningObjectType {
  const descriptor = [
    input.requirements.requirement,
    ...input.sourceReferences.map((reference) => `${reference.locator ?? ''} ${reference.id}`),
  ]
    .join(' ')
    .toLocaleLowerCase();
  if (/github(?:\.com)?|gitlab(?:\.com)?|repository|repo|仓库|代码库/u.test(descriptor)) {
    return 'repository';
  }
  if (/arxiv|doi\.org|paper|论文|研究/u.test(descriptor)) return 'paper';
  if (/patent|专利/u.test(descriptor)) return 'patent';
  if (input.sourceMode === 'obsidian') return 'knowledge-project';
  return 'mixed';
}

function canResolveWithResearch(preflight: CoursePlanningPreflight): boolean {
  if (preflight.externalEvidenceMode === 'off') return false;
  return preflight.issues
    .filter((entry) => entry.severity === 'blocker')
    .every((entry) =>
      [
        'SOURCE_MATERIAL_TOO_SHALLOW',
        'EXTERNAL_EVIDENCE_REQUIRED',
        'EXTERNAL_EVIDENCE_UNAVAILABLE',
      ].includes(entry.code),
    );
}

function phase(
  status: CoursePlanningRunRecord['status'],
  workflowStatus: CoursePlanningRunRecord['workflowStatus'],
  workflowPhase: CoursePlanningRunRecord['workflowPhase'],
  courseJob?: Awaited<ReturnType<NeonCoursePlanningRepository['findCourseJob']>>,
): CoursePlanningRunView['phase'] {
  if (courseJob?.status === 'ready') return 'ready';
  if (courseJob?.status === 'failed' || courseJob?.status === 'cancelled') return 'failed';
  if (courseJob?.phase === 'content') return 'content';
  if (courseJob?.phase === 'actions') return 'actions';
  if (courseJob?.phase === 'release') return 'release';
  if (workflowStatus === 'failed' || workflowPhase === 'failed') return 'failed';
  if (workflowStatus === 'running' || workflowStatus === 'pending') {
    if (workflowPhase === 'research') return 'research';
    if (workflowPhase === 'outline') return 'outline';
    if (workflowPhase === 'content') return 'content';
    if (workflowPhase === 'actions') return 'actions';
    if (workflowPhase === 'release') return 'release';
  }
  if (status === 'consumed') return 'consumed';
  if (status === 'ready') return 'ready';
  if (status === 'failed' || status === 'cancelled') return 'failed';
  if (status === 'outlining') return 'outline';
  if (workflowPhase === 'research') return 'research';
  return 'preflight';
}

export class CoursePlanningService {
  constructor(
    private readonly repository = new NeonCoursePlanningRepository(),
    private readonly now: () => Date = () => new Date(),
    private readonly knowledgeSnapshots = new NeonKnowledgeSnapshotRepository(),
  ) {}

  async create(input: CoursePlanningInput): Promise<CoursePlanningRunRecord> {
    if (!CLIENT_SESSION_ID.test(input.clientSessionId)) {
      throw new Error('invalid_planning_client_session_id');
    }
    const requestedContract = input.requirements.learningContract
      ? parseLearningContract(input.requirements.learningContract)
      : createLearningContract({
          projectId: input.projectId ?? input.sourceBundleId ?? input.clientSessionId,
          sourceMode: input.sourceMode,
          objectType: inferLearningObjectType(input),
          goal: input.requirements.requirement,
        });
    if (input.projectId && requestedContract.projectId !== input.projectId) {
      throw new Error('learning_contract_project_mismatch');
    }
    const normalizedInput: CoursePlanningInput = {
      ...input,
      requirements: {
        ...input.requirements,
        learningContract: requestedContract,
      },
      sourceReferences: normalizeCourseSourceReferences(input.sourceReferences),
    };
    const preflight = assessCoursePlanningPreflight({
      requirements: normalizedInput.requirements,
      documentText: normalizedInput.documentText,
      researchText: normalizedInput.researchText,
      sourceContextExpectedChars: normalizedInput.sourceContextExpectedChars,
    });
    const deferredResearch = !preflight.ready && canResolveWithResearch(preflight);
    const blocker = preflight.issues.find(
      (entry) => entry.severity === 'blocker' && !deferredResearch,
    );
    if (blocker) {
      throw new Error(`planning_preflight_rejected:${blocker.code}:${blocker.detail}`);
    }

    const ownerId = loadPairingConfig().ownerId;
    const projectId = normalizedInput.projectId;
    const inheritedKnowledgeSnapshot =
      typeof projectId === 'string' && /^prj_[a-f0-9]{32}$/.test(projectId)
        ? await this.knowledgeSnapshots.findLatestForScope(ownerId, 'project', projectId)
        : undefined;
    const context = compileContext(
      normalizedInput,
      inheritedKnowledgeSnapshot ?? undefined,
      deferredResearch,
    );
    const run = await this.repository.create({
      ownerId,
      idempotencyKey: stableIdempotencyKey(
        ownerId,
        normalizedInput,
        inheritedKnowledgeSnapshot?.id,
      ),
      planningInput: normalizedInput,
      context,
      preflight,
      ...(inheritedKnowledgeSnapshot ? { knowledgeSnapshotId: inheritedKnowledgeSnapshot.id } : {}),
      now: this.now(),
    });
    log.info('Frozen course planning run before outline generation.', {
      planningRunId: run.id,
      sourceMode: run.input.sourceMode,
      sourceChars: run.preflight.metrics.suppliedChars,
      deferredResearch,
    });
    return run;
  }

  async find(planningRunId: string): Promise<CoursePlanningRunRecord | null> {
    if (!PLAN_ID.test(planningRunId)) return null;
    return this.repository.find(loadPairingConfig().ownerId, planningRunId);
  }

  async view(planningRunId: string): Promise<CoursePlanningRunView | null> {
    const run = await this.find(planningRunId);
    if (!run) return null;
    const courseJob = await this.repository.findCourseJob(run.ownerId, run.id);
    return {
      id: run.id,
      status: run.status,
      phase: phase(run.status, run.workflowStatus, run.workflowPhase, courseJob),
      attemptCount: run.attemptCount,
      maxAttempts: run.maxAttempts,
      preflight: run.preflight,
      input: run.input,
      ...(run.outlines ? { outlines: run.outlines } : {}),
      ...(run.languageDirective ? { languageDirective: run.languageDirective } : {}),
      ...(run.courseTitle ? { courseTitle: run.courseTitle } : {}),
      taskEngineMode: run.taskEngineMode,
      executionMode: run.workflowRunId ? 'workflow' : 'legacy',
      workflow: {
        ...(run.workflowRunId ? { runId: run.workflowRunId } : {}),
        status: run.workflowStatus,
        phase: run.workflowPhase,
        ...(run.workflowStartedAt ? { startedAt: run.workflowStartedAt.toISOString() } : {}),
        ...(run.workflowCompletedAt ? { completedAt: run.workflowCompletedAt.toISOString() } : {}),
      },
      ...(courseJob
        ? {
            courseJob: {
              id: courseJob.id,
              classroomId: courseJob.classroomId,
              status: courseJob.status,
              phase: courseJob.phase,
              progress: courseJob.progress,
              updatedAt: courseJob.updatedAt.toISOString(),
            },
          }
        : {}),
      ...(run.status === 'failed' || run.status === 'cancelled' || run.workflowStatus === 'failed'
        ? {
            error: {
              code: run.lastErrorCode ?? 'COURSE_WORKFLOW_FAILED',
              detail: run.lastErrorDetail ?? 'The durable course workflow did not complete.',
              retryable:
                run.status !== 'cancelled' &&
                courseJob?.status !== 'cancelled' &&
                run.attemptCount < run.maxAttempts,
            },
          }
        : {}),
      updatedAt: run.updatedAt.toISOString(),
    };
  }

  async attachWorkflow(
    planningRunId: string,
    workflowRunId: string,
  ): Promise<CoursePlanningRunRecord> {
    if (!PLAN_ID.test(planningRunId)) throw new Error('invalid_course_planning_run_id');
    if (!workflowRunId.trim() || workflowRunId.length > 240) {
      throw new Error('invalid_course_workflow_run_id');
    }
    const attached = await this.repository.attachWorkflow({
      ownerId: loadPairingConfig().ownerId,
      planningRunId,
      workflowRunId,
      now: this.now(),
    });
    if (!attached) throw new Error('course_workflow_attachment_failed');
    return attached;
  }

  async claimWorkflowStart(
    planningRunId: string,
  ): Promise<{ run: CoursePlanningRunRecord; claimToken: string } | null> {
    if (!PLAN_ID.test(planningRunId)) return null;
    return this.repository.claimWorkflowStart({
      ownerId: loadPairingConfig().ownerId,
      planningRunId,
      now: this.now(),
    });
  }

  async claimWorkflowResume(
    planningRunId: string,
  ): Promise<{ run: CoursePlanningRunRecord; claimToken: string } | null> {
    if (!PLAN_ID.test(planningRunId)) return null;
    return this.repository.claimWorkflowResume({
      ownerId: loadPairingConfig().ownerId,
      planningRunId,
      now: this.now(),
    });
  }

  async attachResumedWorkflow(
    planningRunId: string,
    claimToken: string,
    workflowRunId: string,
  ): Promise<CoursePlanningRunRecord> {
    if (!PLAN_ID.test(planningRunId)) throw new Error('invalid_course_planning_run_id');
    if (!claimToken.startsWith('wclaim_') || claimToken.length > 120) {
      throw new Error('invalid_course_workflow_resume_claim');
    }
    if (!workflowRunId.trim() || workflowRunId.length > 240) {
      throw new Error('invalid_course_workflow_run_id');
    }
    const attached = await this.repository.attachResumedWorkflow({
      ownerId: loadPairingConfig().ownerId,
      planningRunId,
      claimToken,
      workflowRunId,
      now: this.now(),
    });
    if (!attached) throw new Error('course_workflow_resume_attachment_failed');
    return attached;
  }

  async failWorkflowResumeClaim(
    planningRunId: string,
    claimToken: string,
    errorDetail: string,
  ): Promise<void> {
    if (!PLAN_ID.test(planningRunId)) return;
    await this.repository.failWorkflowResumeClaim({
      ownerId: loadPairingConfig().ownerId,
      planningRunId,
      claimToken,
      errorDetail,
      now: this.now(),
    });
  }

  async completeResearch(input: {
    planningRunId: string;
    requirements: CoursePlanningInput['requirements'];
    researchText: string;
    sourceReferences: CoursePlanningInput['sourceReferences'];
  }): Promise<CoursePlanningRunRecord> {
    const run = await this.find(input.planningRunId);
    if (!run) throw new Error('course_planning_run_not_found');
    const planningInput: CoursePlanningInput = {
      ...run.input,
      requirements: input.requirements,
      researchText: input.researchText,
      sourceReferences: input.sourceReferences,
    };
    const preflight = assessCoursePlanningPreflight({
      requirements: planningInput.requirements,
      documentText: planningInput.documentText,
      researchText: planningInput.researchText,
      sourceContextExpectedChars: planningInput.sourceContextExpectedChars,
    });
    const blocker = preflight.issues.find((entry) => entry.severity === 'blocker');
    if (blocker) {
      throw new Error(`planning_preflight_rejected:${blocker.code}:${blocker.detail}`);
    }
    const snapshotId = await this.repository.findContextKnowledgeSnapshotId(
      run.ownerId,
      run.contextPackId,
    );
    const priorKnowledge = snapshotId
      ? await this.knowledgeSnapshots.findById(run.ownerId, snapshotId)
      : null;
    const context = compileContext(planningInput, priorKnowledge ?? undefined);
    const updated = await this.repository.updateResearch({
      ownerId: run.ownerId,
      planningRunId: run.id,
      planningInput,
      context,
      preflight,
      now: this.now(),
    });
    if (!updated) throw new Error('course_research_persistence_failed');
    return updated;
  }

  async updateWorkflowPhase(
    planningRunId: string,
    workflowPhase: CoursePlanningRunRecord['workflowPhase'],
    workflowStatus?: CoursePlanningRunRecord['workflowStatus'],
  ): Promise<void> {
    if (!PLAN_ID.test(planningRunId)) throw new Error('invalid_course_planning_run_id');
    await this.repository.updateWorkflowPhase({
      ownerId: loadPairingConfig().ownerId,
      planningRunId,
      phase: workflowPhase,
      ...(workflowStatus ? { status: workflowStatus } : {}),
      now: this.now(),
    });
  }

  async failWorkflow(input: {
    planningRunId: string;
    errorCode: string;
    errorDetail: string;
  }): Promise<void> {
    if (!PLAN_ID.test(input.planningRunId)) throw new Error('invalid_course_planning_run_id');
    await this.repository.failWorkflow({
      ownerId: loadPairingConfig().ownerId,
      ...input,
      now: this.now(),
    });
  }

  async beginOutline(planningRunId: string): Promise<CoursePlanningLease | null> {
    if (!PLAN_ID.test(planningRunId)) return null;
    const now = this.now();
    return this.repository.beginOutline({
      ownerId: loadPairingConfig().ownerId,
      planningRunId,
      now,
      leaseExpiresAt: new Date(now.getTime() + OUTLINE_LEASE_MS),
    });
  }

  async completeOutline(input: {
    planningRunId: string;
    leaseToken: string;
    outlines: SceneOutline[];
    languageDirective?: string;
    courseTitle?: string;
    taskEngineMode: boolean;
  }): Promise<CoursePlanningRunRecord | null> {
    if (!PLAN_ID.test(input.planningRunId)) return null;
    return this.repository.completeOutline({
      ownerId: loadPairingConfig().ownerId,
      ...input,
      now: this.now(),
    });
  }

  async failOutline(input: {
    planningRunId: string;
    leaseToken: string;
    errorCode: string;
    errorDetail: string;
  }): Promise<boolean> {
    if (!PLAN_ID.test(input.planningRunId)) return false;
    return this.repository.failOutline({
      ownerId: loadPairingConfig().ownerId,
      ...input,
      now: this.now(),
    });
  }

  async markConsumed(planningRunId: string): Promise<void> {
    if (!PLAN_ID.test(planningRunId)) throw new Error('invalid_course_planning_run_id');
    await this.repository.markConsumed({
      ownerId: loadPairingConfig().ownerId,
      planningRunId,
      now: this.now(),
    });
  }

  async compileContext(run: CoursePlanningRunRecord): Promise<CompiledLearningContextPack> {
    const snapshotId = await this.repository.findContextKnowledgeSnapshotId(
      run.ownerId,
      run.contextPackId,
    );
    const priorKnowledge = snapshotId
      ? await this.knowledgeSnapshots.findById(run.ownerId, snapshotId)
      : null;
    return compileContext(run.input, priorKnowledge ?? undefined);
  }

  repositoryForCourseCreation(): NeonCoursePlanningRepository {
    return this.repository;
  }
}

let service: CoursePlanningService | undefined;

export function getCoursePlanningService(): CoursePlanningService {
  service ??= new CoursePlanningService();
  return service;
}
