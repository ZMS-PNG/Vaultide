import { createHash, randomUUID } from 'node:crypto';
import { loadPairingConfig } from '@/lib/learning/config';
import {
  compileLearningContextPack,
  type LearningSourceReference,
} from '@/lib/learning/domain/learning-context-pack';
import { NeonKnowledgeSnapshotRepository } from '@/lib/learning/adapters/neon/knowledge-snapshot-repository';
import { assessOutlineQuality, assessV3OutlineQuality } from '@/lib/generation/course-quality';
import {
  describeOutlineReleaseViolation,
  describeV3OutlineReleaseViolation,
  isV3OutlineSet,
} from '@/lib/generation/outline-release-contract';
import { NeonCourseGenerationRepository } from './repository';
import { courseQueueConfigured, publishCourseGenerationStep } from './queue';
import { freezeCourseGenerationPolicy } from './model-policy';
import { convergeCourseInputOutlines } from './input-outline-convergence';
import { OUTLINE_QUALITY_RELEASE_FLOOR } from '@/lib/generation/outline-quality-repair';
import { createLogger } from '@/lib/logger';
import { getCoursePlanningService } from '@/lib/generation/planning/service';
import type {
  CourseGenerationJobInput,
  CourseGenerationJobRecord,
  CourseGenerationJobView,
  CourseReleaseRecord,
} from './types';

const JOB_ID = /^cgj_[a-f0-9]{32}$/;
const IDEMPOTENCY_KEY = /^[a-zA-Z0-9:_-]{16,160}$/;
const PUBLISHED_DISPATCH_RECOVERY_MS = 11 * 60 * 1_000;
const log = createLogger('CourseGenerationService');

function stableIdempotencyKey(
  input: CourseGenerationJobInput,
  inheritedKnowledgeSnapshotId?: string,
): string {
  return `course:${createHash('sha256')
    .update(
      JSON.stringify({
        classroomId: input.stage.id,
        outlines: input.outlines,
        sourceContext: createHash('sha256').update(input.sourceContext).digest('hex'),
        generationPolicy: input.generationPolicy,
        inheritedKnowledgeSnapshotId: inheritedKnowledgeSnapshotId ?? null,
      }),
      'utf8',
    )
    .digest('hex')}`;
}

function sourceReferences(input: CourseGenerationJobInput): LearningSourceReference[] {
  if (input.sourceReferences.length > 0) return input.sourceReferences;
  return [
    {
      kind: input.sourceMode === 'external' ? 'public-source' : 'uploaded-document',
      id: `context_${createHash('sha256').update(input.sourceContext).digest('hex').slice(0, 24)}`,
      authority: input.sourceMode === 'external' ? 'authoritative' : 'private-original',
      included: true,
      reason: 'Canonical context supplied to the frozen generation request.',
    },
  ];
}

function validateInput(input: CourseGenerationJobInput): void {
  if (!input.stage?.id || input.stage.id.length > 128) throw new Error('invalid_classroom_id');
  if (!input.requirements?.requirement?.trim()) throw new Error('learning_goal_required');
  if (!input.sourceContext?.trim()) throw new Error('learning_context_source_required');
  const v3 = isV3OutlineSet(input.outlines);
  const releaseViolation = v3
    ? describeV3OutlineReleaseViolation(input.outlines)
    : describeOutlineReleaseViolation(input.outlines, input.stage.taskEngineMode === true);
  if (releaseViolation) throw new Error(`outline_release_rejected: ${releaseViolation}`);
  const outlineQuality = v3 ? assessV3OutlineQuality(input.outlines) : assessOutlineQuality(input.outlines);
  if (!outlineQuality.passed || outlineQuality.score < OUTLINE_QUALITY_RELEASE_FLOOR) {
    throw new Error(`outline_quality_rejected: ${outlineQuality.issues[0]?.message ?? 'unknown'}`);
  }
  const serializedBytes = Buffer.byteLength(JSON.stringify(input), 'utf8');
  if (serializedBytes > 12 * 1024 * 1024) throw new Error('course_generation_input_too_large');
}

function message(job: CourseGenerationJobRecord): string {
  if (job.status === 'queued') return '课程任务已进入持久化队列';
  if (job.status === 'ready') return '全部场景已通过质量验证，课堂已正式发布';
  if (job.status === 'failed') return '课程未通过发布闸门，已保留失败证据';
  if (job.currentPhase === 'release') return '正在进行整课质量验证与正式发布';
  const scene = job.currentSceneOrder
    ? `第 ${job.currentSceneOrder}/${job.outlineCount} 个场景`
    : '';
  return job.currentPhase === 'actions'
    ? `正在构建${scene}的讲解与课堂交互`
    : `正在生成${scene}的教学内容`;
}

export class CourseGenerationService {
  constructor(
    private readonly repository = new NeonCourseGenerationRepository(),
    private readonly now: () => Date = () => new Date(),
    private readonly knowledgeSnapshots = new NeonKnowledgeSnapshotRepository(),
  ) {}

  async create(input: {
    jobInput: CourseGenerationJobInput;
    idempotencyKey?: string;
  }): Promise<{ job: CourseGenerationJobRecord; queueMode: 'qstash' | 'client-resume' }> {
    const ownerId = loadPairingConfig().ownerId;
    const planningService = getCoursePlanningService();
    const planningRun = input.jobInput.planningRunId
      ? await planningService.find(input.jobInput.planningRunId)
      : null;
    if (input.jobInput.planningRunId && !planningRun) {
      throw new Error('course_planning_run_not_found');
    }
    if (planningRun && planningRun.status !== 'ready' && planningRun.status !== 'consumed') {
      throw new Error(`course_planning_run_not_ready:${planningRun.status}`);
    }
    if (planningRun?.status === 'consumed') {
      const existing = await this.repository.findByPlanningRunId(ownerId, planningRun.id);
      if (!existing) throw new Error('course_planning_run_consumed_without_job');
      if (
        existing.status !== 'ready' &&
        existing.status !== 'failed' &&
        existing.status !== 'cancelled'
      ) {
        return { job: existing, queueMode: await this.dispatchNext(existing) };
      }
      return {
        job: existing,
        queueMode: courseQueueConfigured() ? 'qstash' : 'client-resume',
      };
    }
    const frozenPlanningContext = planningRun
      ? await planningService.compileContext(planningRun)
      : undefined;
    const useV3OutlineContract = isV3OutlineSet(input.jobInput.outlines);
    const outlineConvergence = useV3OutlineContract
      ? undefined
      : convergeCourseInputOutlines(input.jobInput.outlines);
    const canonicalJobInput: CourseGenerationJobInput = {
      ...input.jobInput,
      ...(planningRun
        ? {
            planningRunId: planningRun.id,
            requirements: planningRun.input.requirements,
            sourceContext: frozenPlanningContext!.sourceText,
            sourceMode: planningRun.input.sourceMode,
            sourceReferences: planningRun.input.sourceReferences,
          }
        : {}),
      outlines: outlineConvergence?.outlines ?? input.jobInput.outlines,
    };
    if (outlineConvergence?.changed) {
      log.info('Canonicalized reviewed outlines before durable job creation.', {
        repairedIssueCodes: outlineConvergence.repairedIssueCodes,
        score: outlineConvergence.assessment.score,
        scenes: outlineConvergence.outlines.length,
      });
    }
    validateInput(canonicalJobInput);
    const projectId = canonicalJobInput.stage.learningContext?.projectId;
    const inheritedKnowledgeSnapshot =
      !planningRun && typeof projectId === 'string' && /^prj_[a-f0-9]{32}$/.test(projectId)
        ? await this.knowledgeSnapshots.findLatestForScope(ownerId, 'project', projectId)
        : undefined;
    const inheritedKnowledgeSnapshotId =
      frozenPlanningContext?.sourceManifest.inheritedKnowledgeSnapshotId ??
      inheritedKnowledgeSnapshot?.id;
    let jobInput: CourseGenerationJobInput = {
      ...canonicalJobInput,
      generationPolicy: await freezeCourseGenerationPolicy(
        canonicalJobInput.outlines,
        planningRun?.input.generationModel,
      ),
      stage: {
        ...canonicalJobInput.stage,
        learningContext: {
          ...canonicalJobInput.stage.learningContext,
          ...(inheritedKnowledgeSnapshotId
            ? { knowledgeSnapshotId: inheritedKnowledgeSnapshotId }
            : {}),
        },
      },
    };
    const idempotencyKey =
      input.idempotencyKey?.trim() ||
      stableIdempotencyKey(jobInput, inheritedKnowledgeSnapshot?.id);
    if (!IDEMPOTENCY_KEY.test(idempotencyKey)) throw new Error('invalid_idempotency_key');

    const frozenReferences = sourceReferences(jobInput);
    const canonicalContext =
      jobInput.sourceMode === 'external'
        ? { researchText: jobInput.sourceContext }
        : { documentText: jobInput.sourceContext };
    const context =
      frozenPlanningContext ??
      compileLearningContextPack({
        sourceMode: jobInput.sourceMode,
        goal: jobInput.requirements.requirement,
        ...canonicalContext,
        references: frozenReferences,
        ...(inheritedKnowledgeSnapshot ? { priorKnowledge: inheritedKnowledgeSnapshot } : {}),
      });
    if (context.learnerKnowledgeText) {
      jobInput = {
        ...jobInput,
        learnerKnowledgeContext: context.learnerKnowledgeText,
      };
    }
    const job = await this.repository.create({
      ownerId,
      idempotencyKey,
      context,
      jobInput,
      ...(inheritedKnowledgeSnapshotId
        ? { knowledgeSnapshotId: inheritedKnowledgeSnapshotId }
        : {}),
      ...(planningRun
        ? {
            planning: {
              id: planningRun.id,
              sessionId: planningRun.sessionId,
              contextPackId: planningRun.contextPackId,
            },
          }
        : {}),
      now: this.now(),
    });
    if (job.status === 'ready' || job.status === 'failed' || job.status === 'cancelled') {
      return { job, queueMode: courseQueueConfigured() ? 'qstash' : 'client-resume' };
    }
    return { job, queueMode: await this.dispatchNext(job) };
  }

  async find(jobId: string): Promise<CourseGenerationJobRecord | null> {
    if (!JOB_ID.test(jobId)) return null;
    return this.repository.find(loadPairingConfig().ownerId, jobId);
  }

  async view(jobId: string): Promise<CourseGenerationJobView | null> {
    const job = await this.find(jobId);
    if (!job) return null;
    const release = await this.repository.findRelease(job.ownerId, job.id);
    return {
      id: job.id,
      classroomId: job.classroomId,
      status: job.status,
      phase: job.currentPhase,
      progress: job.progress,
      scenesGenerated: job.scenesGenerated,
      outlineCount: job.outlineCount,
      ...(job.currentSceneOrder ? { currentSceneOrder: job.currentSceneOrder } : {}),
      message: message(job),
      ...(job.qualitySummary ? { quality: job.qualitySummary } : {}),
      ...(release
        ? {
            release: {
              classroomId: release.classroomId,
              url: `${job.input.baseUrl}/classroom/${encodeURIComponent(release.classroomId)}`,
              sceneCount: release.sceneCount,
              qualityScore: release.qualityScore,
            },
          }
        : {}),
      ...(job.status === 'failed'
        ? {
            error: {
              code: job.lastErrorCode ?? 'generation_failed',
              detail: job.lastErrorDetail ?? 'Course generation did not pass the release gate.',
              retryable:
                job.lastErrorCode === 'QUALITY_GATE_FAILED' ||
                job.lastErrorCode === 'GENERATION_FAILED' ||
                job.lastErrorCode === 'generation_step_failed' ||
                job.lastErrorCode === 'GENERATION_DEADLINE_EXCEEDED' ||
                job.lastErrorCode === 'WORKER_LEASE_EXHAUSTED' ||
                job.lastErrorCode?.startsWith('generation_http_') === true,
            },
          }
        : {}),
      updatedAt: job.updatedAt.toISOString(),
    };
  }

  async publishedRelease(jobId: string): Promise<CourseReleaseRecord | null> {
    const job = await this.find(jobId);
    if (!job || job.status !== 'ready') return null;
    const release = await this.repository.findRelease(job.ownerId, job.id);
    if (
      !release ||
      release.classroomId !== job.classroomId ||
      release.sceneCount !== job.outlineCount
    ) {
      return null;
    }
    return release;
  }

  async publishNext(job: CourseGenerationJobRecord): Promise<void> {
    if (job.status === 'ready' || job.status === 'failed' || job.status === 'cancelled') return;
    await this.dispatchNext(job);
  }

  async resumeFailed(jobId: string): Promise<{
    job: CourseGenerationJobRecord;
    queueMode: 'qstash' | 'client-resume';
  } | null> {
    if (!JOB_ID.test(jobId)) return null;
    const job = await this.repository.reopenFailedJobForRepair({
      ownerId: loadPairingConfig().ownerId,
      jobId,
      now: this.now(),
    });
    if (!job) return null;
    return { job, queueMode: await this.dispatchNext(job) };
  }

  private async dispatchNext(job: CourseGenerationJobRecord): Promise<'qstash' | 'client-resume'> {
    const now = this.now();
    await this.repository.ensureDispatch(job.ownerId, job.id, now);
    if (!courseQueueConfigured()) return 'client-resume';
    const dispatch = await this.repository.claimPendingDispatch({
      ownerId: job.ownerId,
      jobId: job.id,
      leaseToken: randomUUID(),
      now,
      leaseExpiresAt: new Date(now.getTime() + 2 * 60 * 1_000),
      publishedRecoveryBefore: new Date(now.getTime() - PUBLISHED_DISPATCH_RECOVERY_MS),
    });
    if (!dispatch) return 'qstash';
    try {
      const published = await publishCourseGenerationStep({
        jobId: job.id,
        baseUrl: job.input.baseUrl,
        deduplicationId: `course-dispatch:${job.id}:${dispatch.dispatchSeq}`,
      });
      if (published.mode !== 'qstash') {
        await this.repository.releaseDispatch({
          ownerId: job.ownerId,
          dispatch,
          error: 'course_queue_became_unavailable',
          retryAt: new Date(this.now().getTime() + 30_000),
          now: this.now(),
        });
        return 'client-resume';
      }
      await this.repository.markDispatchPublished({
        ownerId: job.ownerId,
        dispatch,
        ...(published.messageId ? { queueMessageId: published.messageId } : {}),
        now: this.now(),
      });
      return published.mode;
    } catch (error) {
      await this.repository.releaseDispatch({
        ownerId: job.ownerId,
        dispatch,
        error: error instanceof Error ? error.message : String(error),
        retryAt: new Date(this.now().getTime() + 30_000),
        now: this.now(),
      });
      // The durable outbox retains ownership. The authenticated browser resume
      // path can make progress while a maintenance dispatcher retries QStash.
      return 'client-resume';
    }
  }

  async recoverDispatches(limit = 25): Promise<{ attempted: number; dispatched: number }> {
    const ownerId = loadPairingConfig().ownerId;
    const now = this.now();
    const jobIds = await this.repository.listDispatchRecoveryJobIds(
      ownerId,
      now,
      new Date(now.getTime() - PUBLISHED_DISPATCH_RECOVERY_MS),
      limit,
    );
    let dispatched = 0;
    for (const jobId of jobIds) {
      const job = await this.repository.find(ownerId, jobId);
      if (!job) continue;
      if ((await this.dispatchNext(job)) === 'qstash') dispatched += 1;
    }
    return { attempted: jobIds.length, dispatched };
  }

  ownerId(): string {
    return loadPairingConfig().ownerId;
  }

  repositoryForWorker(): NeonCourseGenerationRepository {
    return this.repository;
  }

  newLeaseToken(): string {
    return randomUUID();
  }
}

let service: CourseGenerationService | undefined;

export function getCourseGenerationService(): CourseGenerationService {
  service ??= new CourseGenerationService();
  return service;
}
