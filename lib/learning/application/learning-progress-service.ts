import {
  LEARNING_PROTOCOL_VERSION,
  stampLearningEvent,
  stampWritebackCommand,
  validateLearningEvent,
  validateWritebackCommand,
  type ApiErrorCode,
  type JsonObject,
  type LearningEvent,
  type LearningEventType,
  type SourceArchive,
  type WritebackCommand,
  type WritebackOperation,
  type WritebackReceipt,
} from '@openmaic/learning-protocol';
import { createHash, randomUUID } from 'crypto';
import type { DeviceTokenPrincipal } from '../domain/device-token';
import type { KnowledgeGraphRefreshChange } from '../domain/knowledge-graph-refresh';
import {
  externalKnowledgeAssetCandidate,
  renderExternalKnowledgeCard,
  type KnowledgeAssetVersionRecord,
} from '../domain/knowledge-asset';
import type {
  AppendLearningEventsResult,
  ClassroomLearningSnapshot,
  LearningProgressSnapshot,
  LearningCompanionRecord,
  LearningSprintRecord,
  LeasedWritebackCommands,
  ManagedBlockDraft,
  ManagedBlockState,
  ReviewQueueItemRecord,
  StoredLearningEvent,
  WritebackDraftRecord,
  WritebackDraftView,
} from '../domain/learning-progress';
import { renderLearningCompanion } from '../domain/learning-companion';
import { renderLearningSummary } from '../domain/learning-summary';
import {
  projectIndexDraftBlocks,
  renderProjectLearningIndex,
  type ProjectLearningIndexRecord,
} from '../domain/project-learning';
import {
  buildMasteryProjections,
  classroomCompletionSummary,
  CLASSROOM_MASTERY_CONCEPT_ID,
  MASTERY_PROJECTOR_VERSION,
} from '../domain/mastery-evidence';
import type { LearningProgressRepository } from '../ports/learning-progress-repository';
import type { KnowledgeAssetRepository } from '../ports/knowledge-asset-repository';
import type { ProjectLearningIndexRepository } from '../ports/project-learning-index-repository';
import type { KnowledgeSnapshotRepository } from '../ports/knowledge-snapshot-repository';
import {
  projectKnowledgeSnapshot,
  type KnowledgeSnapshotRecord,
} from '../domain/knowledge-snapshot';
import {
  learningEvaluationPayload,
  ServerLearningEvidenceEvaluator,
  type LearningEvidenceEvaluator,
  type LearningEvidenceSourceMaterial,
} from './learning-evidence-evaluation';

const WEB_DEVICE_ID = 'web_openmaic_admin';
const COMMAND_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const COMMAND_LEASE_MS = 5 * 60 * 1000;
const MAX_EVENT_BATCH = 100;
const SYSTEM_EVALUATOR_DEVICE_ID = 'system_learning_evaluator';
const ACTIVE_EVIDENCE_TYPES = new Set<LearningEventType>([
  'retrievalAttempted',
  'explanationSubmitted',
  'practiceSubmitted',
  'transferTaskCompleted',
]);

function identifier(
  prefix: 'spr' | 'lev' | 'wbd' | 'wbc' | 'cmp' | 'pdx' | 'sdx' | 'dpr' | 'dpi' | 'kas' | 'kav',
): string {
  return `${prefix}_${randomUUID().replaceAll('-', '')}`;
}

export interface ObsidianCompanionSource {
  sourceId: string;
  snapshotId: string;
  relativePath: string;
}

export function selectObsidianCompanionSource(
  candidates: readonly ObsidianCompanionSource[],
  isProject: boolean,
): ObsidianCompanionSource | null {
  if (candidates.length === 1) return candidates[0] ?? null;
  if (!isProject || candidates.length === 0) return null;

  // A project folder gets one durable companion anchored to its most
  // representative original note. Prefer the shallowest README so a large
  // folder does not fall back to an unrelated generic learning summary.
  return (
    [...candidates].sort((left, right) => {
      const leftPath = left.relativePath.replaceAll('\\', '/');
      const rightPath = right.relativePath.replaceAll('\\', '/');
      const leftReadme = /(^|\/)readme\.md$/i.test(leftPath) ? 0 : 1;
      const rightReadme = /(^|\/)readme\.md$/i.test(rightPath) ? 0 : 1;
      if (leftReadme !== rightReadme) return leftReadme - rightReadme;
      const depth = leftPath.split('/').length - rightPath.split('/').length;
      return depth || leftPath.localeCompare(rightPath);
    })[0] ?? null
  );
}

export class LearningProgressServiceError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    readonly status: number,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'LearningProgressServiceError';
  }
}

export interface WebLearningEventInput {
  eventType: LearningEventType;
  clientEventId: string;
  occurredAt: string;
  payload: JsonObject;
  causationId?: string;
  correlationId?: string;
}

export interface ClassroomLearningUpdate extends AppendLearningEventsResult {
  sprintId: string;
  completion: {
    completedSceneIds: string[];
    totalSceneCount: number;
    completed: boolean;
  };
  mastery: {
    estimate: number | null;
    confidence: number;
    evidenceCount: number;
    nextReviewAt?: string;
  };
  verification: ClassroomLearningVerification;
}

export interface ClassroomLearningEvaluationFeedback {
  targetEventId: string;
  targetEventType: LearningEventType;
  verdict: 'passed' | 'revise' | 'failed';
  score: number;
  confidence: number;
  sceneId?: string;
  openQuestions: string[];
  corrections: Array<{
    misconception: string;
    correction: string;
  }>;
}

export interface ClassroomLearningVerification {
  learningVerified: boolean;
  passedEvaluationCount: number;
  requiredEvaluationCount: 3;
  transferPassed: boolean;
  authoritativeMastery: number;
  authoritativeConfidence: number;
  latestEvaluation?: ClassroomLearningEvaluationFeedback;
}

export interface ClassroomLearningStatus {
  sprintId: string;
  sprintStatus: LearningSprintRecord['status'];
  completion: {
    completedSceneIds: string[];
    totalSceneCount: number;
    completed: boolean;
  };
  mastery: {
    estimate: number | null;
    confidence: number;
    evidenceCount: number;
    nextReviewAt?: string;
  };
  verification: ClassroomLearningVerification;
}

export interface LearningProgressServiceOptions {
  ownerId: string;
  repository: LearningProgressRepository;
  /** Optional while migrating legacy deployments; production wires this dependency. */
  knowledgeSnapshots?: KnowledgeSnapshotRepository;
  evidenceEvaluator?: LearningEvidenceEvaluator;
  knowledgeAssets?: KnowledgeAssetRepository;
  projectLearningIndexes?: ProjectLearningIndexRepository;
  readClassroom: (classroomId: string) => Promise<ClassroomLearningSnapshot | null>;
  readSourceArchive?: (ownerId: string, bundleId: string) => Promise<SourceArchive | null>;
  onKnowledgeChanged?: (change: KnowledgeGraphRefreshChange) => Promise<void>;
  now?: () => Date;
}

export class LearningProgressService {
  private readonly now: () => Date;

  constructor(private readonly options: LearningProgressServiceOptions) {
    this.now = options.now ?? (() => new Date());
  }

  async ensureSprint(classroomId: string): Promise<{
    sprint: LearningSprintRecord;
    classroom: ClassroomLearningSnapshot;
  }> {
    const classroom = await this.options.readClassroom(classroomId);
    if (!classroom || classroom.id !== classroomId || classroom.stage.id !== classroomId) {
      throw new LearningProgressServiceError('invalid_request', 404, 'Classroom was not found.');
    }
    const context = classroom.stage.learningContext;
    const sourceBundleId =
      typeof context?.sourceBundleId === 'string' &&
      /^src_[a-f0-9]{32}$/.test(context.sourceBundleId)
        ? context.sourceBundleId
        : undefined;
    const projectId =
      typeof context?.projectId === 'string' && /^prj_[a-f0-9]{32}$/.test(context.projectId)
        ? context.projectId
        : undefined;
    const projectRevision =
      projectId &&
      typeof context?.projectRevision === 'number' &&
      Number.isInteger(context.projectRevision) &&
      context.projectRevision > 0
        ? context.projectRevision
        : undefined;
    const goal = typeof context?.goal === 'string' ? context.goal.trim().slice(0, 8000) : '';
    const researchRunId =
      typeof context?.researchRunId === 'string' && /^rrn_[a-f0-9]{32}$/.test(context.researchRunId)
        ? context.researchRunId
        : undefined;
    const retrievalRunId =
      typeof context?.retrievalRunId === 'string' &&
      /^prr_[a-f0-9]{32}$/.test(context.retrievalRunId)
        ? context.retrievalRunId
        : undefined;
    const sprint = await this.options.repository.ensureSprint({
      id: identifier('spr'),
      ownerId: this.options.ownerId,
      classroomId,
      sourceBundleId,
      ...(projectId ? { projectId } : {}),
      ...(projectRevision ? { projectRevision } : {}),
      ...(retrievalRunId ? { retrievalRunId } : {}),
      ...(researchRunId ? { researchRunId } : {}),
      goal,
      now: this.now(),
    });
    return { sprint, classroom };
  }

  async appendWebEvents(
    classroomId: string,
    inputs: readonly WebLearningEventInput[],
    options: { deferEvidenceEvaluation?: boolean } = {},
  ): Promise<ClassroomLearningUpdate> {
    if (inputs.length === 0 || inputs.length > MAX_EVENT_BATCH) {
      throw new LearningProgressServiceError(
        'invalid_request',
        400,
        `Learning event batches must contain between 1 and ${MAX_EVENT_BATCH} events.`,
      );
    }
    const { sprint, classroom } = await this.ensureSprint(classroomId);
    this.validateWebEventScope(classroom, inputs);
    const learnerEvents = inputs.map((input) =>
      this.webEvent(
        sprint.id,
        input.eventType,
        input.clientEventId,
        input.occurredAt,
        this.sanitizedLearnerPayload(input.eventType, input.payload),
        {
          causationId: input.causationId,
          correlationId: input.correlationId,
        },
      ),
    );
    const systemEvents: LearningEvent[] = [];
    if (!options.deferEvidenceEvaluation) {
      systemEvents.push(...(await this.evaluationEventsFor(sprint, classroom, learnerEvents)));
    }
    const events = [...learnerEvents, ...systemEvents];
    const result = await this.options.repository.appendEvents(events, this.now());
    const storedEvents = await this.options.repository.listEvents(
      this.options.ownerId,
      sprint.id,
      2000,
    );
    const projections = buildMasteryProjections(classroom, storedEvents);
    await this.options.repository.replaceMasteryProjections(
      this.options.ownerId,
      sprint.id,
      projections,
      this.now(),
    );
    if (result.accepted > 0) {
      await this.notifyKnowledgeChanged({
        triggerKind: 'learning-event',
        triggerId: createHash('sha256')
          .update(
            inputs
              .map((input) => input.clientEventId)
              .sort()
              .join('\u0000'),
            'utf8',
          )
          .digest('hex'),
        classroomId: sprint.classroomId,
        ...(sprint.projectId ? { projectId: sprint.projectId } : {}),
      });
    }
    const completion = classroomCompletionSummary(classroom, storedEvents);
    const knowledgeSnapshot = await this.persistVerifiedKnowledgeSnapshot(
      sprint,
      classroom,
      storedEvents,
    );
    const verification = this.learningVerificationSummary(
      classroom,
      storedEvents,
      knowledgeSnapshot,
    );
    if (verification.learningVerified) {
      await this.options.repository.markSprintCompleted(
        this.options.ownerId,
        sprint.id,
        this.now(),
      );
      await this.maybeQueueAutomaticCompanionUpdate(sprint, classroom, storedEvents).catch(
        (error) => {
          // Completing a lesson is durable even if a later automation task needs
          // recovery. The run state captures the operational error separately.
          console.warn('Vaultide automatic deposition did not queue.', error);
        },
      );
    }
    const classroomMastery = projections.find(
      (projection) => projection.conceptId === CLASSROOM_MASTERY_CONCEPT_ID,
    );
    return {
      ...result,
      sprintId: sprint.id,
      completion,
      mastery: {
        estimate: classroomMastery?.estimate ?? null,
        confidence: classroomMastery?.confidence ?? 0,
        evidenceCount: classroomMastery?.evidenceCount ?? 0,
        ...(classroomMastery?.nextReviewAt ? { nextReviewAt: classroomMastery.nextReviewAt } : {}),
      },
      verification,
    };
  }

  /**
   * Evaluates evidence after the browser has received its durable 202 receipt.
   * The input ids, rather than transient request state, select the persisted
   * events so retries are idempotent and a slow model can never hold the
   * classroom UI hostage.
   */
  async evaluateDeferredWebEvidence(
    classroomId: string,
    clientEventIds: readonly string[],
  ): Promise<void> {
    const requestedIds = new Set(clientEventIds);
    if (requestedIds.size === 0) return;
    const { sprint, classroom } = await this.ensureSprint(classroomId);
    const stored = await this.options.repository.listEvents(this.options.ownerId, sprint.id, 2000);
    const evaluatedTargetIds = new Set(
      stored
        .filter((event) => event.eventType === 'evidenceEvaluated')
        .map((event) => (event.payload as unknown as Record<string, unknown>).targetEventId)
        .filter((id): id is string => typeof id === 'string'),
    );
    const targets = stored.filter(
      (event) =>
        event.source === 'web' &&
        ACTIVE_EVIDENCE_TYPES.has(event.eventType) &&
        requestedIds.has(event.clientEventId) &&
        !evaluatedTargetIds.has(event.id),
    );
    if (targets.length === 0) return;

    const result = await this.options.repository.appendEvents(
      await this.evaluationEventsFor(sprint, classroom, targets),
      this.now(),
    );
    if (result.accepted === 0) return;

    const refreshed = await this.options.repository.listEvents(this.options.ownerId, sprint.id, 2000);
    const projections = buildMasteryProjections(classroom, refreshed);
    await this.options.repository.replaceMasteryProjections(
      this.options.ownerId,
      sprint.id,
      projections,
      this.now(),
    );
    await this.notifyKnowledgeChanged({
      triggerKind: 'learning-event',
      triggerId: createHash('sha256').update([...requestedIds].sort().join('\u0000'), 'utf8').digest('hex'),
      classroomId: sprint.classroomId,
      ...(sprint.projectId ? { projectId: sprint.projectId } : {}),
    });
    const knowledgeSnapshot = await this.persistVerifiedKnowledgeSnapshot(sprint, classroom, refreshed);
    const verification = this.learningVerificationSummary(classroom, refreshed, knowledgeSnapshot);
    if (verification.learningVerified) {
      await this.options.repository.markSprintCompleted(this.options.ownerId, sprint.id, this.now());
      await this.maybeQueueAutomaticCompanionUpdate(sprint, classroom, refreshed).catch((error) => {
        console.warn('Vaultide automatic deposition did not queue.', error);
      });
    }
  }

  private async evaluationEventsFor(
    sprint: LearningSprintRecord,
    classroom: ClassroomLearningSnapshot,
    learnerEvents: readonly LearningEvent[],
  ): Promise<LearningEvent[]> {
    const candidates = learnerEvents.filter((event) => ACTIVE_EVIDENCE_TYPES.has(event.eventType));
    if (candidates.length === 0) return [];
    const canonicalSources = await this.canonicalSourceMaterial(sprint, classroom);
    const evaluator = this.options.evidenceEvaluator ?? new ServerLearningEvidenceEvaluator();
    const evaluations = await Promise.all(
      candidates.map(async (event) => {
        const evaluation = await evaluator.evaluate({ classroom, sprint, event, canonicalSources });
        const sceneId = this.eventSceneId(event, classroom);
        return this.systemEvent(
          sprint.id,
          'evidenceEvaluated',
          `system-evaluate:${createHash('sha256')
            .update(`${sprint.id}\u0000${event.clientEventId}`, 'utf8')
            .digest('hex')}`,
          this.now().toISOString(),
          learningEvaluationPayload({ targetEventId: event.id, evaluation, ...(sceneId ? { sceneId } : {}) }),
          { causationId: event.id, correlationId: event.id },
        );
      }),
    );
    return evaluations;
  }

  async completeSprint(
    _sprintId: string,
    _input: { completionVersion: 1; completedSceneIds: string[] },
  ): Promise<never> {
    // This endpoint used to manufacture sceneCompleted events. Completion is
    // now derived from server-verified evidence in appendWebEvents only.
    throw new LearningProgressServiceError(
      'scope_denied',
      403,
      'Manual sprint completion is disabled. Record scene views and submit active learning evidence instead.',
    );
  }

  async rebuildMasteryForClassroom(classroomId: string): Promise<{
    sprintId: string;
    projections: Awaited<ReturnType<LearningProgressRepository['listMasteryProjections']>>;
  }> {
    const { sprint, classroom } = await this.ensureSprint(classroomId);
    const events = await this.options.repository.listEvents(this.options.ownerId, sprint.id, 2000);
    const projections = buildMasteryProjections(classroom, events);
    await this.options.repository.replaceMasteryProjections(
      this.options.ownerId,
      sprint.id,
      projections,
      this.now(),
    );
    return {
      sprintId: sprint.id,
      projections: await this.options.repository.listMasteryProjections(this.options.ownerId, {
        sprintId: sprint.id,
      }),
    };
  }

  async listMastery(options: {
    sprintId?: string;
    projectId?: string;
    conceptId?: string;
  }): ReturnType<LearningProgressRepository['listMasteryProjections']> {
    return this.options.repository.listMasteryProjections(this.options.ownerId, options);
  }

  async classroomLearningStatus(classroomId: string): Promise<ClassroomLearningStatus> {
    const { sprint, classroom } = await this.ensureSprint(classroomId);
    const events = await this.options.repository.listEvents(this.options.ownerId, sprint.id, 2000);
    const projections = buildMasteryProjections(classroom, events);
    const classroomMastery = projections.find(
      (projection) => projection.conceptId === CLASSROOM_MASTERY_CONCEPT_ID,
    );
    const knowledgeSnapshot = this.options.knowledgeSnapshots
      ? await this.options.knowledgeSnapshots.findLatestForScope(
          this.options.ownerId,
          sprint.projectId ? 'project' : 'session',
          sprint.projectId ?? sprint.id,
        )
      : null;
    const verification = this.learningVerificationSummary(
      classroom,
      events,
      knowledgeSnapshot,
    );
    return {
      sprintId: sprint.id,
      sprintStatus: verification.learningVerified ? 'completed' : sprint.status,
      completion: classroomCompletionSummary(classroom, events),
      mastery: {
        estimate: classroomMastery?.estimate ?? null,
        confidence: classroomMastery?.confidence ?? 0,
        evidenceCount: classroomMastery?.evidenceCount ?? 0,
        ...(classroomMastery?.nextReviewAt
          ? { nextReviewAt: classroomMastery.nextReviewAt }
          : {}),
      },
      verification,
    };
  }

  async projectLearningIndex(projectId: string): Promise<ProjectLearningIndexRecord> {
    if (!/^prj_[a-f0-9]{32}$/.test(projectId)) {
      throw new LearningProgressServiceError('invalid_request', 400, 'Project id is invalid.');
    }
    if (!this.options.projectLearningIndexes) {
      throw new LearningProgressServiceError(
        'dependency_unavailable',
        503,
        'Project learning indexes are not configured.',
      );
    }
    const index = await this.options.projectLearningIndexes.findProjectLearningIndex(
      this.options.ownerId,
      projectId,
      this.now(),
    );
    if (!index) {
      throw new LearningProgressServiceError('invalid_request', 404, 'Project was not found.');
    }
    return index;
  }

  async listReviewQueue(options: {
    projectId?: string;
    dueOnly?: boolean;
    limit?: number;
  }): Promise<ReviewQueueItemRecord[]> {
    if (options.projectId && !/^prj_[a-f0-9]{32}$/.test(options.projectId)) {
      throw new LearningProgressServiceError('invalid_request', 400, 'Project id is invalid.');
    }
    return this.options.repository.listReviewQueue(
      this.options.ownerId,
      {
        ...(options.projectId ? { projectId: options.projectId } : {}),
        ...(options.dueOnly ? { dueOnly: true } : {}),
        limit: Math.max(1, Math.min(200, Math.trunc(options.limit ?? 50))),
      },
      this.now(),
    );
  }

  async completeReview(
    reviewItemId: string,
    completion: {
      attemptId: string;
      response: string;
      rating: 'again' | 'hard' | 'good' | 'easy';
      durationMs?: number;
    },
  ): Promise<{
    review: ReviewQueueItemRecord | null;
    mastery: {
      estimate: number | null;
      confidence: number;
      evidenceCount: number;
      nextReviewAt?: string;
    };
  }> {
    if (!/^rvi_[a-f0-9]{32}$/.test(reviewItemId)) {
      throw new LearningProgressServiceError('invalid_request', 400, 'Review item id is invalid.');
    }
    if (
      !/^[A-Za-z0-9:_-]{8,120}$/.test(completion.attemptId) ||
      completion.response.trim().length < 20 ||
      completion.response.trim().length > 4_000 ||
      !['again', 'hard', 'good', 'easy'].includes(completion.rating) ||
      (completion.durationMs !== undefined &&
        (!Number.isInteger(completion.durationMs) ||
          completion.durationMs < 0 ||
          completion.durationMs > 86_400_000))
    ) {
      throw new LearningProgressServiceError('invalid_request', 400, 'Review rating is invalid.');
    }
    const now = this.now();
    const review = await this.options.repository.findReviewQueueItem(
      this.options.ownerId,
      reviewItemId,
      now,
    );
    if (!review) {
      throw new LearningProgressServiceError(
        'invalid_request',
        404,
        'Review item was not found or is no longer available.',
      );
    }
    const sprint = await this.options.repository.findSprint(this.options.ownerId, review.sprintId);
    if (!sprint || sprint.classroomId !== review.classroomId) {
      throw new LearningProgressServiceError(
        'invalid_request',
        404,
        'Review classroom was not found.',
      );
    }
    const classroom = await this.options.readClassroom(sprint.classroomId);
    if (
      !classroom ||
      classroom.id !== sprint.classroomId ||
      classroom.stage.id !== sprint.classroomId
    ) {
      throw new LearningProgressServiceError(
        'invalid_request',
        404,
        'Review classroom was not found.',
      );
    }
    const sceneId = review.conceptId.startsWith('scene:')
      ? review.conceptId.slice('scene:'.length)
      : undefined;
    const promptId =
      `review:${review.id}:${review.dueAt.toISOString().slice(0, 10)}`.slice(0, 160);
    const occurredAt = now.toISOString();
    const retrievalEvent = this.webEvent(
      sprint.id,
      'retrievalAttempted',
      `review-recall:${completion.attemptId}`,
      occurredAt,
      {
        promptId,
        response: completion.response.trim(),
        ...(sceneId ? { sceneId } : {}),
        ...(completion.durationMs !== undefined ? { durationMs: completion.durationMs } : {}),
      },
    );
    const reviewEvent = this.webEvent(
      sprint.id,
      'reviewCompleted',
      `review-completed:${completion.attemptId}`,
      occurredAt,
      {
        reviewItemId: review.id,
        rating: completion.rating,
        conceptId: review.conceptId,
        dueAt: review.dueAt.toISOString(),
        ...(completion.durationMs !== undefined ? { durationMs: completion.durationMs } : {}),
      },
      { causationId: retrievalEvent.id, correlationId: completion.attemptId },
    );
    await this.options.repository.appendEvents([retrievalEvent, reviewEvent], now);
    const events = await this.options.repository.listEvents(this.options.ownerId, sprint.id, 2000);
    const projections = buildMasteryProjections(classroom, events);
    await this.options.repository.replaceMasteryProjections(
      this.options.ownerId,
      sprint.id,
      projections,
      now,
    );
    const classroomMastery = projections.find(
      (projection) => projection.conceptId === CLASSROOM_MASTERY_CONCEPT_ID,
    );
    return {
      review: await this.options.repository.findReviewQueueItem(
        this.options.ownerId,
        review.id,
        now,
      ),
      mastery: {
        estimate: classroomMastery?.estimate ?? null,
        confidence: classroomMastery?.confidence ?? 0,
        evidenceCount: classroomMastery?.evidenceCount ?? 0,
        ...(classroomMastery?.nextReviewAt ? { nextReviewAt: classroomMastery.nextReviewAt } : {}),
      },
    };
  }

  async createProjectLearningIndexDraft(projectId: string): Promise<WritebackDraftView> {
    const index = await this.projectLearningIndex(projectId);
    const target = await this.options.repository.findWritebackTarget(this.options.ownerId);
    if (!target) {
      throw new LearningProgressServiceError(
        'conflict',
        409,
        'No active paired Obsidian Vault is available for project index writeback.',
      );
    }
    if (target.vaultBindingId !== index.project.vaultBindingId) {
      throw new LearningProgressServiceError(
        'conflict',
        409,
        'The active paired Vault does not own this project. Re-pair the project Vault first.',
      );
    }
    const now = this.now();
    const projectIndexId = identifier('pdx');
    const provisional = renderProjectLearningIndex({
      projectIndexId,
      index,
      now,
    });
    const document = await this.options.repository.findOrCreateProjectLearningIndex({
      id: projectIndexId,
      ownerId: this.options.ownerId,
      projectId: index.project.id,
      vaultBindingId: target.vaultBindingId,
      relativePath: provisional.relativePath,
      initialManagedBlocks: provisional.managedBlocks,
      now,
    });
    const rendered = renderProjectLearningIndex({ projectIndexId: document.id, index, now });
    let managedBlocks: ManagedBlockDraft[];
    try {
      managedBlocks = projectIndexDraftBlocks(rendered.managedBlocks, document);
    } catch (error) {
      throw new LearningProgressServiceError(
        'conflict',
        409,
        error instanceof Error ? error.message : 'Project index needs manual review.',
      );
    }
    const existing = await this.options.repository.findOpenDraftByProjectIndex(
      this.options.ownerId,
      document.id,
    );
    if (existing) return this.draftView(existing, target.vaultName);
    const created = await this.options.repository.createDraft({
      id: identifier('wbd'),
      ownerId: this.options.ownerId,
      draftKind: 'project-index',
      projectIndexId: document.id,
      targetDeviceId: target.deviceId,
      targetVaultBindingId: target.vaultBindingId,
      operation: document.lastContentHash ? 'replaceProjectIndexBlocks' : 'createManagedNote',
      managedBlocks,
      relativePath: document.relativePath,
      content: rendered.content,
      frontmatter: rendered.frontmatter,
      now,
    });
    return this.draftView(created, target.vaultName);
  }

  async getDepositionPolicy() {
    return this.options.repository.getDepositionPolicy(this.options.ownerId);
  }

  async updateDepositionPolicy(input: {
    mode: 'manual' | 'batch' | 'managed-auto';
    managedAutoEnabled: boolean;
    allowCompanionUpdates: boolean;
    allowSynthesisIndexUpdates?: boolean;
    allowExternalCards?: boolean;
  }) {
    const invalidAutoPolicy =
      input.mode === 'managed-auto' && (!input.managedAutoEnabled || !input.allowCompanionUpdates);
    if (invalidAutoPolicy) {
      throw new LearningProgressServiceError(
        'invalid_request',
        400,
        'Managed automation requires an explicit local companion-update consent.',
      );
    }
    if (input.mode !== 'managed-auto' && input.managedAutoEnabled) {
      throw new LearningProgressServiceError(
        'invalid_request',
        400,
        'Managed automation consent requires managed-auto mode.',
      );
    }
    return this.options.repository.updateDepositionPolicy({
      ownerId: this.options.ownerId,
      mode: input.mode,
      managedAutoEnabled: input.managedAutoEnabled,
      allowCompanionUpdates: input.allowCompanionUpdates,
      allowSynthesisIndexUpdates: input.allowSynthesisIndexUpdates ?? false,
      allowExternalCards: input.allowExternalCards ?? false,
      now: this.now(),
    });
  }

  private async maybeQueueAutomaticCompanionUpdate(
    sprint: LearningSprintRecord,
    classroom: ClassroomLearningSnapshot,
    events: readonly import('../domain/learning-progress').StoredLearningEvent[],
  ): Promise<void> {
    const policy = await this.options.repository.getDepositionPolicy(this.options.ownerId);
    if (
      policy.mode !== 'managed-auto' ||
      !policy.managedAutoEnabled ||
      !policy.allowCompanionUpdates
    ) {
      return;
    }

    const idempotencyKey = [
      this.options.ownerId,
      'learning-companion',
      sprint.sourceBundleId ?? 'no-source-bundle',
      sprint.id,
      MASTERY_PROJECTOR_VERSION,
    ].join(':');
    const run = await this.options.repository.findOrCreateDepositionRun({
      id: identifier('dpr'),
      ownerId: this.options.ownerId,
      sprintId: sprint.id,
      assetType: 'learning-companion',
      idempotencyKey,
      projectorVersion: MASTERY_PROJECTOR_VERSION,
      riskLevel: 'low',
      now: this.now(),
    });
    if (
      [
        'collecting',
        'generated',
        'policy_checked',
        'queued',
        'leased',
        'locally_validated',
        'applied',
        'receipted',
        'blocked_policy',
        'cancelled',
      ].includes(run.state)
    ) {
      return;
    }
    const now = this.now();
    await this.options.repository.updateDepositionRun({
      ownerId: this.options.ownerId,
      runId: run.id,
      state: 'collecting',
      now,
    });
    try {
      const draft = await this.createWritebackDraft(
        classroom.id,
        this.progressFromEvents(classroom, events),
      );
      await this.options.repository.updateDepositionRun({
        ownerId: this.options.ownerId,
        runId: run.id,
        state: 'generated',
        now: this.now(),
      });
      // Creation of a new local file remains a manual action. Managed-auto
      // begins only after a companion was explicitly created and receipted.
      if (draft.operation !== 'replaceManagedBlocks' || !draft.companionId) {
        await this.options.repository.createDepositionItem({
          id: identifier('dpi'),
          ownerId: this.options.ownerId,
          runId: run.id,
          targetKind: draft.companionId ? 'companion' : 'managed-note',
          targetId: draft.companionId ?? draft.id,
          writebackDraftId: draft.id,
          state: 'skipped',
          commandRiskLevel: 'medium',
          now: this.now(),
        });
        await this.options.repository.updateDepositionRun({
          ownerId: this.options.ownerId,
          runId: run.id,
          state: 'blocked_policy',
          errorCode: 'initial_companion_requires_confirmation',
          errorDetail: 'The first companion creation remains a local manual confirmation.',
          now: this.now(),
        });
        return;
      }
      await this.options.repository.updateDepositionRun({
        ownerId: this.options.ownerId,
        runId: run.id,
        state: 'policy_checked',
        now: this.now(),
      });
      const command = await this.approveWritebackDraft(draft.id, draft.revision);
      await this.options.repository.createDepositionItem({
        id: identifier('dpi'),
        ownerId: this.options.ownerId,
        runId: run.id,
        targetKind: 'companion',
        targetId: draft.companionId,
        writebackDraftId: draft.id,
        writebackCommandId: command.id,
        state: 'queued',
        commandRiskLevel: 'low',
        now: this.now(),
      });
      await this.options.repository.updateDepositionRun({
        ownerId: this.options.ownerId,
        runId: run.id,
        state: 'queued',
        now: this.now(),
      });
    } catch (error) {
      await this.options.repository.updateDepositionRun({
        ownerId: this.options.ownerId,
        runId: run.id,
        state: 'failed_retryable',
        errorCode: 'automatic_draft_failed',
        errorDetail: (error instanceof Error
          ? error.message
          : 'Automatic deposition failed.'
        ).slice(0, 2000),
        now: this.now(),
      });
      throw error;
    }
  }

  private progressFromEvents(
    classroom: ClassroomLearningSnapshot,
    events: readonly import('../domain/learning-progress').StoredLearningEvent[],
  ): LearningProgressSnapshot {
    const sceneById = new Map(classroom.scenes.map((scene) => [scene.id, scene]));
    let currentSceneId: string | undefined;
    const quizzes = new Map<string, LearningProgressSnapshot['quizSummaries'][number]>();
    for (const event of events) {
      const payload = event.payload as unknown as Record<string, unknown>;
      const sceneId = typeof payload.sceneId === 'string' ? payload.sceneId : undefined;
      if (sceneId && sceneById.has(sceneId)) currentSceneId = sceneId;
      if (event.eventType !== 'practiceSubmitted') continue;
      const taskId = typeof payload.taskId === 'string' ? payload.taskId : undefined;
      const quizSceneId = sceneId && sceneById.get(sceneId)?.type === 'quiz' ? sceneId : taskId;
      const scene = quizSceneId ? sceneById.get(quizSceneId) : undefined;
      if (!scene || scene.type !== 'quiz') continue;
      let answered = 0;
      let total = 0;
      let earned: number | undefined;
      let possible: number | undefined;
      if (typeof payload.response === 'string') {
        try {
          const parsed: unknown = JSON.parse(payload.response);
          if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
            const record = parsed as Record<string, unknown>;
            answered = Number.isInteger(record.answered) ? Number(record.answered) : 0;
            total = Number.isInteger(record.total) ? Number(record.total) : 0;
            earned = typeof record.earned === 'number' ? record.earned : undefined;
            possible = typeof record.possible === 'number' ? record.possible : undefined;
          }
        } catch {
          // Aggregate response data is optional; mastery retains the normalized score separately.
        }
      }
      quizzes.set(scene.id, {
        sceneId: scene.id,
        title: scene.title,
        answered: Math.max(0, answered),
        total: Math.max(0, total),
        ...(earned !== undefined ? { earned } : {}),
        ...(possible !== undefined ? { possible } : {}),
      });
    }
    return {
      ...(currentSceneId ? { currentSceneId } : {}),
      quizSummaries: [...quizzes.values()],
    };
  }

  private sanitizedLearnerPayload(eventType: LearningEventType, payload: JsonObject): JsonObject {
    if (!ACTIVE_EVIDENCE_TYPES.has(eventType)) return payload;
    // Scores supplied by a browser are self-reports. Preserve the actual answer
    // but strip the score before immutable storage and before mastery projection.
    const { score: _selfReportedScore, ...rest } = payload as Record<string, unknown>;
    return rest as JsonObject;
  }

  private eventSceneId(
    event: LearningEvent,
    classroom: ClassroomLearningSnapshot,
  ): string | undefined {
    const sceneId = (event.payload as unknown as Record<string, unknown>).sceneId;
    return typeof sceneId === 'string' && classroom.scenes.some((scene) => scene.id === sceneId)
      ? sceneId
      : undefined;
  }

  private async canonicalSourceMaterial(
    sprint: LearningSprintRecord,
    classroom: ClassroomLearningSnapshot,
  ): Promise<LearningEvidenceSourceMaterial[]> {
    const result: LearningEvidenceSourceMaterial[] = [];
    const context = classroom.stage.learningContext;
    for (const citation of context?.retrievalCitations ?? []) {
      result.push({
        reference: {
          referenceId: citation.citationId,
          kind: 'canonical-source',
          citationId: citation.citationId,
          sourceId: citation.sourceId,
          sourceVersionId: citation.sourceVersionId,
          locator: `${citation.relativePath}${citation.headingPath.length ? `#${citation.headingPath.join('/')}` : ''}`,
          contentHash: citation.contentHash,
        },
        text: '',
      });
    }
    for (const source of context?.researchSources ?? []) {
      result.push({
        reference: {
          referenceId: source.citationId ?? `web:${source.url}`,
          kind: 'canonical-source',
          ...(source.citationId ? { citationId: source.citationId } : {}),
          locator: source.url,
        },
        text: `${source.title}\n${source.url}`,
      });
    }
    if (sprint.sourceBundleId && this.options.readSourceArchive) {
      try {
        const archive = await this.options.readSourceArchive(this.options.ownerId, sprint.sourceBundleId);
        if (archive) {
          const contentBySnapshot = new Map(
            archive.contents.map((content) => [content.snapshotId, content.utf8Content]),
          );
          for (const snapshot of archive.bundle.snapshots) {
            const content = contentBySnapshot.get(snapshot.id);
            if (!content) continue;
            const locator =
              snapshot.locator.kind === 'obsidian'
                ? snapshot.locator.relativePath
                : snapshot.locator.kind === 'web'
                  ? snapshot.locator.canonicalUrl
                  : snapshot.locator.kind === 'github'
                    ? `${snapshot.locator.repositoryUrl}@${snapshot.locator.commit}/${snapshot.locator.path}`
                    : snapshot.locator.kind === 'arxiv'
                      ? snapshot.locator.canonicalUrl
                      : snapshot.title;
            result.push({
              reference: {
                referenceId: snapshot.id,
                kind: 'canonical-source',
                ...(snapshot.locator.kind === 'obsidian' && snapshot.locator.sourceId
                  ? { sourceId: snapshot.locator.sourceId }
                  : {}),
                locator,
                contentHash: snapshot.contentHash,
              },
              // Evidence evaluation selects relevant excerpts per learner answer.
              // Keep enough of long project documents for later sections (state
              // machines, risks, verification matrices) to remain discoverable.
              text: content.slice(0, 120_000),
            });
          }
        }
      } catch (error) {
        console.warn('Canonical source archive was unavailable for learning evaluation.', {
          classroomId: classroom.id,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }
    const seen = new Set<string>();
    return result.filter((item) => {
      const key = `${item.reference.referenceId}\u0000${item.reference.contentHash ?? ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  private async persistVerifiedKnowledgeSnapshot(
    sprint: LearningSprintRecord,
    classroom: ClassroomLearningSnapshot,
    events: readonly StoredLearningEvent[],
  ): Promise<KnowledgeSnapshotRecord | null> {
    if (!this.options.knowledgeSnapshots) return null;
    const scopeKind = sprint.projectId ? 'project' : 'session';
    const scopeId = sprint.projectId ?? sprint.id;
    const parent = await this.options.knowledgeSnapshots.findLatestForScope(
      this.options.ownerId,
      scopeKind,
      scopeId,
    );
    const canonicalSources = await this.canonicalSourceMaterial(sprint, classroom);
    const projection = projectKnowledgeSnapshot({
      events,
      ...(parent ? { parentSnapshot: parent } : {}),
      sourceReferences: canonicalSources.map((item) => item.reference),
    });
    const accepted = projection.evidenceSummary.acceptedEvaluationEventIds;
    const known = new Set(parent?.evidenceSummary.acceptedEvaluationEventIds ?? []);
    if (!projection.eligibleForPersistence || accepted.every((id) => known.has(id))) return parent ?? null;
    return this.options.knowledgeSnapshots.append({
      ownerId: this.options.ownerId,
      sessionId: sprint.id,
      projection,
      ...(parent ? { expectedParentSnapshotId: parent.id } : {}),
      now: this.now(),
    });
  }

  private learningVerificationSummary(
    classroom: ClassroomLearningSnapshot,
    events: readonly StoredLearningEvent[],
    snapshot: KnowledgeSnapshotRecord | null,
  ): ClassroomLearningVerification {
    const sceneIds = new Set(classroom.scenes.map((scene) => scene.id));
    const finalSceneId = [...classroom.scenes]
      .sort((left, right) => left.order - right.order)
      .at(-1)?.id;
    const viewed = new Set<string>();
    const passedDimensions = new Map<
      'recall' | 'explanation' | 'final-transfer',
      { score: number; confidence: number }
    >();
    let transferPassed = false;
    let latestEvaluation: ClassroomLearningEvaluationFeedback | undefined;
    for (const event of events) {
      const payload = event.payload as unknown as Record<string, unknown>;
      if (
        (event.eventType === 'sceneViewed' || event.eventType === 'sceneCompleted') &&
        typeof payload.sceneId === 'string'
      ) {
        viewed.add(payload.sceneId);
      }
      if (
        event.source === 'system' &&
        event.eventType === 'evidenceEvaluated' &&
        typeof payload.targetEventId === 'string'
      ) {
        const target = events.find((candidate) => candidate.id === payload.targetEventId);
        const knowledgeEvaluation =
          payload.knowledgeEvaluation &&
          typeof payload.knowledgeEvaluation === 'object' &&
          !Array.isArray(payload.knowledgeEvaluation)
            ? (payload.knowledgeEvaluation as Record<string, unknown>)
            : {};
        const verdict =
          payload.verdict === 'passed' ||
          payload.verdict === 'revise' ||
          payload.verdict === 'failed'
            ? payload.verdict
            : 'failed';
        const score =
          typeof payload.score === 'number' && Number.isFinite(payload.score)
            ? Math.max(0, Math.min(1, payload.score))
            : 0;
        const confidence =
          typeof knowledgeEvaluation.confidence === 'number' &&
          Number.isFinite(knowledgeEvaluation.confidence)
            ? Math.max(0, Math.min(1, knowledgeEvaluation.confidence))
            : 0;
        const openQuestions = Array.isArray(knowledgeEvaluation.openQuestions)
          ? knowledgeEvaluation.openQuestions
              .flatMap((item) => {
                const question =
                  item &&
                  typeof item === 'object' &&
                  !Array.isArray(item) &&
                  typeof (item as Record<string, unknown>).question === 'string'
                    ? String((item as Record<string, unknown>).question).trim()
                    : '';
                return question ? [question.slice(0, 500)] : [];
              })
              .slice(0, 6)
          : [];
        const corrections = Array.isArray(knowledgeEvaluation.misconceptionCorrections)
          ? knowledgeEvaluation.misconceptionCorrections
              .flatMap((item) => {
                if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
                const record = item as Record<string, unknown>;
                const misconception =
                  typeof record.misconception === 'string' ? record.misconception.trim() : '';
                const correction =
                  typeof record.correction === 'string' ? record.correction.trim() : '';
                return misconception && correction
                  ? [
                      {
                        misconception: misconception.slice(0, 500),
                        correction: correction.slice(0, 800),
                      },
                    ]
                  : [];
              })
              .slice(0, 4)
          : [];
        if (target && ACTIVE_EVIDENCE_TYPES.has(target.eventType)) {
          latestEvaluation = {
            targetEventId: target.id,
            targetEventType: target.eventType,
            verdict,
            score,
            confidence,
            ...(typeof payload.sceneId === 'string' ? { sceneId: payload.sceneId } : {}),
            openQuestions,
            corrections,
          };
        }
        if (verdict !== 'passed' || !target || !ACTIVE_EVIDENCE_TYPES.has(target.eventType)) {
          continue;
        }
        const targetPayload = target.payload as unknown as Record<string, unknown>;
        const dimension =
          target.eventType === 'retrievalAttempted'
            ? 'recall'
            : target.eventType === 'explanationSubmitted'
              ? 'explanation'
              : target.eventType === 'transferTaskCompleted' &&
                  typeof targetPayload.sceneId === 'string' &&
                  targetPayload.sceneId === finalSceneId
                ? 'final-transfer'
                : undefined;
        if (!dimension) continue;
        const previous = passedDimensions.get(dimension);
        if (!previous || score > previous.score || confidence > previous.confidence) {
          passedDimensions.set(dimension, { score, confidence });
        }
        if (dimension === 'final-transfer' && score >= 0.85) {
          transferPassed = true;
        }
      }
    }
    const verifiedScores = [...passedDimensions.values()].map((item) => item.score);
    const verifiedConfidences = [...passedDimensions.values()].map((item) => item.confidence);
    const authoritativeMastery =
      verifiedScores.length > 0
        ? verifiedScores.reduce((sum, score) => sum + score, 0) / verifiedScores.length
        : 0;
    const authoritativeConfidence =
      verifiedConfidences.length > 0
        ? verifiedConfidences.reduce((sum, confidence) => sum + confidence, 0) /
          verifiedConfidences.length
        : 0;
    const learningVerified =
      sceneIds.size > 0 &&
      viewed.size === sceneIds.size &&
      [...viewed].every((sceneId) => sceneIds.has(sceneId)) &&
      passedDimensions.size === 3 &&
      transferPassed &&
      verifiedScores.every((score) => score >= 0.8) &&
      authoritativeMastery >= 0.8 &&
      authoritativeConfidence >= 0.5 &&
      Boolean(snapshot?.eligibleForPersistence);
    return {
      learningVerified,
      passedEvaluationCount: passedDimensions.size,
      requiredEvaluationCount: 3,
      transferPassed,
      authoritativeMastery,
      authoritativeConfidence,
      ...(latestEvaluation ? { latestEvaluation } : {}),
    };
  }

  private isVerifiedLearningState(
    classroom: ClassroomLearningSnapshot,
    events: readonly StoredLearningEvent[],
    _projections: readonly import('../domain/mastery-evidence').MasteryProjection[],
    snapshot: KnowledgeSnapshotRecord | null,
  ): boolean {
    return this.learningVerificationSummary(classroom, events, snapshot).learningVerified;
  }

  private validateWebEventScope(
    classroom: ClassroomLearningSnapshot,
    inputs: readonly WebLearningEventInput[],
  ): void {
    const sceneIds = new Set(classroom.scenes.map((scene) => scene.id));
    for (const input of inputs) {
      const payload = input.payload as Record<string, unknown>;
      if (
        input.eventType === 'sprintCompleted' ||
        input.eventType === 'evidenceEvaluated' ||
        input.eventType === 'feedbackReceived' ||
        input.eventType === 'writebackApproved' ||
        input.eventType === 'writebackApplied'
      ) {
        throw new LearningProgressServiceError(
          'scope_denied',
          403,
          `${input.eventType} is a server-owned event and cannot be submitted by a browser.`,
        );
      }
      const scopedSceneId =
        input.eventType === 'sceneViewed' ||
        input.eventType === 'sceneCompleted' ||
        input.eventType === 'whiteboardNoteAdded'
          ? payload.sceneId
          : undefined;
      if (
        scopedSceneId !== undefined &&
        (!sceneIds.has(String(scopedSceneId)) || typeof scopedSceneId !== 'string')
      ) {
        throw new LearningProgressServiceError(
          'invalid_request',
          400,
          'Learning event references a scene outside this classroom.',
        );
      }
      if (ACTIVE_EVIDENCE_TYPES.has(input.eventType) && payload.sceneId !== undefined) {
        if (typeof payload.sceneId !== 'string' || !sceneIds.has(payload.sceneId)) {
          throw new LearningProgressServiceError(
            'invalid_request',
            400,
            'Active learning evidence references a scene outside this classroom.',
          );
        }
      }
      if (ACTIVE_EVIDENCE_TYPES.has(input.eventType)) {
        const response = payload.response ?? payload.outcome;
        if (typeof response !== 'string' || response.trim().length < 20 || response.length > 4_000) {
          throw new LearningProgressServiceError(
            'invalid_request',
            400,
            'Active learning evidence must contain a response between 20 and 4,000 characters.',
          );
        }
        if (
          payload.promptText !== undefined &&
          (typeof payload.promptText !== 'string' ||
            payload.promptText.trim().length === 0 ||
            payload.promptText.length > 2_000)
        ) {
          throw new LearningProgressServiceError(
            'invalid_request',
            400,
            'Active learning prompt text must contain between 1 and 2,000 characters.',
          );
        }
      }
      if (input.eventType === 'transferTaskCompleted' && typeof payload.taskId !== 'string') {
        throw new LearningProgressServiceError(
          'invalid_request',
          400,
          'Transfer evidence must identify its task.',
        );
      }
    }
  }

  async appendDeviceEvents(
    principal: DeviceTokenPrincipal,
    events: readonly LearningEvent[],
  ): Promise<AppendLearningEventsResult> {
    if (events.length === 0 || events.length > MAX_EVENT_BATCH) {
      throw new LearningProgressServiceError(
        'invalid_request',
        400,
        `Learning event batches must contain between 1 and ${MAX_EVENT_BATCH} events.`,
      );
    }
    const sprintIds = new Set<string>();
    for (const event of events) {
      const validation = validateLearningEvent(event);
      if (!validation.valid) {
        throw new LearningProgressServiceError(
          'learning_contract_invalid',
          422,
          `LearningEvent is invalid: ${validation.errors[0]?.path ?? '/'}.`,
        );
      }
      if (
        event.ownerId !== principal.ownerId ||
        event.deviceId !== principal.deviceId ||
        event.source !== 'obsidian-plugin'
      ) {
        throw new LearningProgressServiceError(
          'scope_denied',
          403,
          'LearningEvent identity does not match the paired device.',
        );
      }
      sprintIds.add(event.sprintId);
    }
    const sprints: LearningSprintRecord[] = [];
    for (const sprintId of sprintIds) {
      const sprint = await this.options.repository.findSprint(principal.ownerId, sprintId);
      if (!sprint) {
        throw new LearningProgressServiceError(
          'invalid_request',
          404,
          'Learning sprint was not found.',
        );
      }
      sprints.push(sprint);
    }
    const result = await this.options.repository.appendEvents(events, this.now());
    if (result.accepted > 0) {
      for (const sprint of sprints) {
        try {
          const classroom = await this.options.readClassroom(sprint.classroomId);
          if (!classroom) throw new Error('classroom_not_found_for_mastery_refresh');
          const storedEvents = await this.options.repository.listEvents(
            this.options.ownerId,
            sprint.id,
            2000,
          );
          await this.options.repository.replaceMasteryProjections(
            this.options.ownerId,
            sprint.id,
            buildMasteryProjections(classroom, storedEvents),
            this.now(),
          );
          await this.notifyKnowledgeChanged({
            triggerKind: 'learning-event',
            triggerId: createHash('sha256')
              .update(
                events
                  .filter((event) => event.sprintId === sprint.id)
                  .map((event) => event.id)
                  .sort()
                  .join('\u0000'),
                'utf8',
              )
              .digest('hex'),
            classroomId: sprint.classroomId,
            ...(sprint.projectId ? { projectId: sprint.projectId } : {}),
          });
        } catch (error) {
          console.warn(
            'Device learning evidence was saved but its projection refresh did not complete.',
            {
              sprintId: sprint.id,
              reason: error instanceof Error ? error.message : String(error),
            },
          );
        }
      }
    }
    return result;
  }

  async createWritebackDraft(
    classroomId: string,
    progress: LearningProgressSnapshot,
  ): Promise<WritebackDraftView> {
    const { sprint, classroom } = await this.ensureSprint(classroomId);
    const target = await this.options.repository.findWritebackTarget(
      this.options.ownerId,
      sprint.sourceBundleId,
    );
    if (!target) {
      throw new LearningProgressServiceError(
        'conflict',
        409,
        'No active paired Obsidian Vault is available for writeback.',
      );
    }
    const events = await this.options.repository.listEvents(this.options.ownerId, sprint.id, 2000);
    const mastery = buildMasteryProjections(classroom, events);
    if (!this.options.knowledgeSnapshots) {
      throw new LearningProgressServiceError(
        'dependency_unavailable',
        503,
        'Verified knowledge snapshots are not configured; writeback is unavailable.',
      );
    }
    const knowledgeSnapshot = await this.options.knowledgeSnapshots.findLatestForScope(
      this.options.ownerId,
      sprint.projectId ? 'project' : 'session',
      sprint.projectId ?? sprint.id,
    );
    if (!this.isVerifiedLearningState(classroom, events, mastery, knowledgeSnapshot)) {
      throw new LearningProgressServiceError(
        'conflict',
        409,
        'Writeback is unlocked only after all scenes are viewed and three system-verified evidence items including transfer pass.',
      );
    }
    const existing = await this.options.repository.findOpenDraftBySprint?.(
      this.options.ownerId,
      sprint.id,
      'learning-summary',
    );
    if (existing) return this.draftView(existing, target.vaultName);
    const now = this.now();
    const companionSource = await this.singleObsidianCompanionSource(sprint, target.vaultBindingId);
    if (companionSource) {
      const initialCompanionId = identifier('cmp');
      const initialRendered = renderLearningCompanion({
        companionId: initialCompanionId,
        sourceId: companionSource.sourceId,
        sourceSnapshotId: companionSource.snapshotId,
        originalRelativePath: companionSource.relativePath,
        classroom,
        sprint,
        progress,
        events,
        mastery,
        ...(knowledgeSnapshot ? { knowledgeSnapshot } : {}),
        now,
      });
      const companion = await this.options.repository.findOrCreateCompanion({
        id: initialCompanionId,
        ownerId: this.options.ownerId,
        vaultBindingId: target.vaultBindingId,
        sourceId: companionSource.sourceId,
        ...(sprint.sourceBundleId ? { sourceBundleId: sprint.sourceBundleId } : {}),
        sourceSnapshotId: companionSource.snapshotId,
        ...(sprint.projectId ? { projectId: sprint.projectId } : {}),
        originalRelativePath: companionSource.relativePath,
        relativePath: initialRendered.relativePath,
        initialManagedBlocks: initialRendered.managedBlocks,
        now,
      });
      const rendered = renderLearningCompanion({
        companionId: companion.id,
        sourceId: companion.sourceId,
        sourceSnapshotId: companion.sourceSnapshotId ?? companionSource.snapshotId,
        originalRelativePath: companion.originalRelativePath,
        classroom,
        sprint,
        progress,
        events,
        mastery,
        ...(knowledgeSnapshot ? { knowledgeSnapshot } : {}),
        now,
        ...(companion.lastContentHash ? { previousManagedBlocks: companion.managedBlocks } : {}),
      });
      const managedBlocks = this.companionDraftBlocks(rendered.managedBlocks, companion);
      const operation = companion.lastContentHash ? 'replaceManagedBlocks' : 'createManagedNote';
      const created = await this.options.repository.createDraft({
        id: identifier('wbd'),
        ownerId: this.options.ownerId,
        sprintId: sprint.id,
        targetDeviceId: target.deviceId,
        targetVaultBindingId: target.vaultBindingId,
        operation,
        companionId: companion.id,
        managedBlocks,
        relativePath: companion.relativePath,
        content: rendered.content,
        frontmatter: rendered.frontmatter,
        now,
      });
      return this.draftView(created, target.vaultName);
    }

    const rendered = renderLearningSummary({
      classroom,
      sprint,
      progress,
      events,
      mastery,
      ...(knowledgeSnapshot ? { knowledgeSnapshot } : {}),
      now,
    });
    const created = await this.options.repository.createDraft({
      id: identifier('wbd'),
      ownerId: this.options.ownerId,
      sprintId: sprint.id,
      targetDeviceId: target.deviceId,
      targetVaultBindingId: target.vaultBindingId,
      relativePath: rendered.relativePath,
      content: rendered.content,
      frontmatter: rendered.frontmatter,
      now,
    });
    return this.draftView(created, target.vaultName);
  }

  async createExternalKnowledgeCardDraft(classroomId: string): Promise<WritebackDraftView> {
    const { sprint, classroom } = await this.ensureSprint(classroomId);
    const target = await this.options.repository.findWritebackTarget(
      this.options.ownerId,
      sprint.sourceBundleId,
    );
    if (!target) {
      throw new LearningProgressServiceError(
        'conflict',
        409,
        'No active paired Obsidian Vault is available for writeback.',
      );
    }
    const events = await this.options.repository.listEvents(this.options.ownerId, sprint.id, 2000);
    const draft = await this.createExternalKnowledgeCardDraftForSprint({
      sprint,
      classroom,
      target,
      mastery: buildMasteryProjections(classroom, events),
      now: this.now(),
    });
    if (!draft) {
      throw new LearningProgressServiceError(
        'invalid_request',
        404,
        'This classroom does not have an external source that can become a knowledge card.',
      );
    }
    return draft;
  }

  private draftView(draft: WritebackDraftRecord, targetVaultName: string): WritebackDraftView {
    return {
      id: draft.id,
      revision: draft.revision,
      ...(draft.sprintId ? { sprintId: draft.sprintId } : {}),
      ...(draft.synthesisRunId ? { synthesisRunId: draft.synthesisRunId } : {}),
      draftKind: draft.draftKind,
      ...(draft.assetId ? { assetId: draft.assetId } : {}),
      ...(draft.assetVersionId ? { assetVersionId: draft.assetVersionId } : {}),
      ...(draft.projectIndexId ? { projectIndexId: draft.projectIndexId } : {}),
      ...(draft.synthesisIndexId ? { synthesisIndexId: draft.synthesisIndexId } : {}),
      ...(draft.vaultOverviewId ? { vaultOverviewId: draft.vaultOverviewId } : {}),
      targetVaultName,
      operation: draft.operation,
      ...(draft.companionId ? { companionId: draft.companionId } : {}),
      relativePath: draft.relativePath,
      content: draft.content,
      status: draft.status,
    };
  }

  private async createExternalKnowledgeCardDraftForSprint(input: {
    sprint: LearningSprintRecord;
    classroom: ClassroomLearningSnapshot;
    target: import('../domain/learning-progress').WritebackTarget;
    mastery: readonly import('../domain/mastery-evidence').MasteryProjection[];
    now: Date;
  }): Promise<WritebackDraftView | null> {
    if (input.sprint.sourceBundleId || !this.options.knowledgeAssets) return null;
    const candidate = externalKnowledgeAssetCandidate({
      researchRunId: input.sprint.researchRunId,
      sources: input.classroom.stage.learningContext?.researchSources,
    });
    if (!candidate) return null;

    const asset = await this.options.knowledgeAssets.findOrCreateExternalAsset({
      id: identifier('kas'),
      ownerId: this.options.ownerId,
      sourceKind: candidate.sourceKind,
      canonicalKey: candidate.canonicalKey,
      canonicalUrl: candidate.canonicalUrl,
      title: candidate.title,
      now: input.now,
    });
    const sourceFingerprint = createHash('sha256')
      .update(
        JSON.stringify({
          canonicalKey: candidate.canonicalKey,
          sources: candidate.sources.map((source) => ({
            citationId: source.citationId ?? null,
            title: source.title,
            url: source.url,
            authority: source.authority ?? null,
          })),
        }),
        'utf8',
      )
      .digest('hex');
    const provisional: KnowledgeAssetVersionRecord = {
      id: identifier('kav'),
      ownerId: this.options.ownerId,
      assetId: asset.id,
      researchRunId: candidate.researchRunId,
      sourceFingerprint,
      sourceRefs: candidate.sources,
      cardMarkdown: '',
      contentHash: '',
      capturedAt: input.now,
      createdAt: input.now,
    };
    const initialRendered = renderExternalKnowledgeCard({
      asset,
      version: provisional,
      classroom: input.classroom,
      sprint: input.sprint,
      mastery: input.mastery,
      now: input.now,
    });
    const version = await this.options.knowledgeAssets.findOrCreateVersion({
      ...provisional,
      cardMarkdown: initialRendered.content,
      contentHash: createHash('sha256').update(initialRendered.content, 'utf8').digest('hex'),
      now: input.now,
    });
    const existing = await this.options.repository.findOpenDraftByAssetVersion(
      this.options.ownerId,
      version.id,
    );
    if (existing) return this.draftView(existing, input.target.vaultName);

    const rendered = renderExternalKnowledgeCard({
      asset,
      version,
      classroom: input.classroom,
      sprint: input.sprint,
      mastery: input.mastery,
      now: input.now,
    });
    const created = await this.options.repository.createDraft({
      id: identifier('wbd'),
      ownerId: this.options.ownerId,
      sprintId: input.sprint.id,
      draftKind: 'external-card',
      assetId: asset.id,
      assetVersionId: version.id,
      targetDeviceId: input.target.deviceId,
      targetVaultBindingId: input.target.vaultBindingId,
      relativePath: rendered.relativePath,
      // Existing source versions retain their original immutable card body.
      content: version.cardMarkdown || rendered.content,
      frontmatter: rendered.frontmatter,
      now: input.now,
    });
    return this.draftView(created, input.target.vaultName);
  }

  private companionDraftBlocks(
    desired: readonly ManagedBlockState[],
    companion: LearningCompanionRecord,
  ): ManagedBlockDraft[] {
    if (!companion.lastContentHash) return desired.map((block) => ({ ...block }));
    const previousById = new Map(companion.managedBlocks.map((block) => [block.id, block]));
    return desired.map((block) => {
      const previous = previousById.get(block.id);
      if (!previous) {
        throw new LearningProgressServiceError(
          'conflict',
          409,
          'The existing learning companion uses an older block layout and needs manual review.',
        );
      }
      return { ...block, expectedHash: previous.contentHash };
    });
  }

  private async singleObsidianCompanionSource(
    sprint: LearningSprintRecord,
    vaultBindingId: string,
  ): Promise<ObsidianCompanionSource | null> {
    if (!sprint.sourceBundleId) return null;
    if (this.options.readSourceArchive) {
      try {
        const archive = await this.options.readSourceArchive(
          this.options.ownerId,
          sprint.sourceBundleId,
        );
        if (archive) {
          const candidates = archive.bundle.snapshots.flatMap((snapshot) => {
            if (
              snapshot.origin !== 'obsidian' ||
              snapshot.locator.vaultBindingId !== vaultBindingId
            ) {
              return [];
            }
            const sourceId = snapshot.locator.sourceId;
            if (!sourceId || !/^sou_[a-f0-9]{32}$/.test(sourceId)) return [];
            return [
              {
                sourceId,
                snapshotId: snapshot.id,
                relativePath: snapshot.locator.relativePath,
              },
            ];
          });
          const selected = selectObsidianCompanionSource(candidates, Boolean(sprint.projectId));
          if (selected) return selected;
        }
      } catch {
        // The immutable text archive is retention-bound. Project identity
        // records below remain available after its private Blob is purged.
      }
    }
    if (!sprint.projectId || !this.options.projectLearningIndexes) return null;
    try {
      const candidates =
        await this.options.projectLearningIndexes.listProjectBundleCompanionSources(
          this.options.ownerId,
          sprint.projectId,
          sprint.sourceBundleId,
          vaultBindingId,
        );
      return selectObsidianCompanionSource(candidates, true);
    } catch {
      return null;
    }
  }

  async approveWritebackDraft(draftId: string, draftRevision: number): Promise<WritebackCommand> {
    const draft = await this.options.repository.findDraft(this.options.ownerId, draftId);
    if (!draft) {
      throw new LearningProgressServiceError(
        'invalid_request',
        404,
        'Writeback draft was not found.',
      );
    }
    if (
      draft.revision !== draftRevision ||
      !['generated', 'edited', 'approved'].includes(draft.status)
    ) {
      throw new LearningProgressServiceError(
        'conflict',
        409,
        'Writeback draft revision is stale or no longer approvable.',
      );
    }
    const now = this.now();
    const commandBase = {
      id: identifier('wbc'),
      draftId: draft.id,
      draftRevision: draft.revision,
      ownerId: draft.ownerId,
      deviceId: draft.targetDeviceId,
      vaultBindingId: draft.targetVaultBindingId,
      issuedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + COMMAND_TTL_MS).toISOString(),
    };
    const command =
      draft.operation === 'replaceManagedBlocks'
        ? this.managedBlockCommand(commandBase, draft)
        : draft.operation === 'replaceProjectIndexBlocks'
          ? this.projectIndexBlockCommand(commandBase, draft)
          : draft.operation === 'replaceSynthesisIndexBlocks'
            ? this.synthesisIndexBlockCommand(commandBase, draft)
            : draft.operation === 'replaceVaultOverviewBlocks'
              ? this.vaultOverviewBlockCommand(commandBase, draft)
              : stampWritebackCommand({
                  ...commandBase,
                  operation: 'createManagedNote',
                  arguments: {
                    relativePath: draft.relativePath,
                    content: draft.content,
                    frontmatter: draft.frontmatter,
                    expectedAbsent: true,
                  },
                });
    const validation = validateWritebackCommand(command);
    if (!validation.valid) {
      throw new LearningProgressServiceError(
        'learning_contract_invalid',
        500,
        `Generated writeback command failed its safety contract at ${validation.errors[0]?.path ?? '/'}.`,
      );
    }
    const approved = await this.options.repository.approveDraft({
      ownerId: this.options.ownerId,
      draftId,
      draftRevision,
      command,
      now,
    });
    if (!approved) {
      throw new LearningProgressServiceError(
        'conflict',
        409,
        'Writeback draft could not be approved.',
      );
    }
    if (draft.sprintId) {
      const event = this.webEvent(
        draft.sprintId,
        'writebackApproved',
        `writeback-approved:${draft.id}:${draft.revision}`,
        now.toISOString(),
        { draftId: draft.id, draftRevision: draft.revision },
      );
      await this.options.repository.appendEvents([event], now);
    }
    return approved;
  }

  private managedBlockCommand(
    commandBase: {
      id: string;
      draftId: string;
      draftRevision: number;
      ownerId: string;
      deviceId: string;
      vaultBindingId: string;
      issuedAt: string;
      expiresAt: string;
    },
    draft: WritebackDraftRecord,
  ): WritebackCommand {
    if (!draft.companionId || !/^cmp_[a-f0-9]{32}$/.test(draft.companionId)) {
      throw new LearningProgressServiceError(
        'learning_contract_invalid',
        500,
        'Managed companion draft is missing its stable companion identity.',
      );
    }
    if (draft.managedBlocks.length === 0) {
      throw new LearningProgressServiceError(
        'learning_contract_invalid',
        500,
        'Managed companion draft is missing its replacement blocks.',
      );
    }
    const blocks = draft.managedBlocks.map((block) => {
      if (!block.expectedHash || !/^[a-f0-9]{64}$/.test(block.expectedHash)) {
        throw new LearningProgressServiceError(
          'learning_contract_invalid',
          500,
          'Managed companion draft is missing an expected block hash.',
        );
      }
      return { id: block.id, expectedHash: block.expectedHash, content: block.content };
    });
    return stampWritebackCommand({
      ...commandBase,
      operation: 'replaceManagedBlocks',
      arguments: {
        relativePath: draft.relativePath,
        companionId: draft.companionId,
        blocks,
      },
    });
  }

  private projectIndexBlockCommand(
    commandBase: {
      id: string;
      draftId: string;
      draftRevision: number;
      ownerId: string;
      deviceId: string;
      vaultBindingId: string;
      issuedAt: string;
      expiresAt: string;
    },
    draft: WritebackDraftRecord,
  ): WritebackCommand {
    if (!draft.projectIndexId || !/^pdx_[a-f0-9]{32}$/.test(draft.projectIndexId)) {
      throw new LearningProgressServiceError(
        'learning_contract_invalid',
        500,
        'Project index draft is missing its stable index identity.',
      );
    }
    const projectId = draft.frontmatter.maic_project_id;
    if (typeof projectId !== 'string' || !/^prj_[a-f0-9]{32}$/.test(projectId)) {
      throw new LearningProgressServiceError(
        'learning_contract_invalid',
        500,
        'Project index draft is missing its project identity.',
      );
    }
    if (draft.managedBlocks.length === 0) {
      throw new LearningProgressServiceError(
        'learning_contract_invalid',
        500,
        'Project index draft is missing its replacement blocks.',
      );
    }
    const blocks = draft.managedBlocks.map((block) => {
      if (!block.expectedHash || !/^[a-f0-9]{64}$/.test(block.expectedHash)) {
        throw new LearningProgressServiceError(
          'learning_contract_invalid',
          500,
          'Project index draft is missing an expected block hash.',
        );
      }
      return { id: block.id, expectedHash: block.expectedHash, content: block.content };
    });
    return stampWritebackCommand({
      ...commandBase,
      operation: 'replaceProjectIndexBlocks',
      arguments: {
        relativePath: draft.relativePath,
        projectId,
        projectIndexId: draft.projectIndexId,
        blocks,
      },
    });
  }

  private synthesisIndexBlockCommand(
    commandBase: {
      id: string;
      draftId: string;
      draftRevision: number;
      ownerId: string;
      deviceId: string;
      vaultBindingId: string;
      issuedAt: string;
      expiresAt: string;
    },
    draft: WritebackDraftRecord,
  ): WritebackCommand {
    if (!draft.synthesisIndexId || !/^sdx_[a-f0-9]{32}$/.test(draft.synthesisIndexId)) {
      throw new LearningProgressServiceError(
        'learning_contract_invalid',
        500,
        'Synthesis index draft is missing its stable index identity.',
      );
    }
    const scheduleId = draft.frontmatter.maic_synthesis_schedule_id;
    if (typeof scheduleId !== 'string' || !/^sch_[a-f0-9]{32}$/.test(scheduleId)) {
      throw new LearningProgressServiceError(
        'learning_contract_invalid',
        500,
        'Synthesis index draft is missing its schedule identity.',
      );
    }
    if (draft.managedBlocks.length === 0) {
      throw new LearningProgressServiceError(
        'learning_contract_invalid',
        500,
        'Synthesis index draft is missing its replacement blocks.',
      );
    }
    const blocks = draft.managedBlocks.map((block) => {
      if (!block.expectedHash || !/^[a-f0-9]{64}$/.test(block.expectedHash)) {
        throw new LearningProgressServiceError(
          'learning_contract_invalid',
          500,
          'Synthesis index draft is missing an expected block hash.',
        );
      }
      return { id: block.id, expectedHash: block.expectedHash, content: block.content };
    });
    return stampWritebackCommand({
      ...commandBase,
      operation: 'replaceSynthesisIndexBlocks',
      arguments: {
        relativePath: draft.relativePath,
        scheduleId,
        synthesisIndexId: draft.synthesisIndexId,
        blocks,
      },
    });
  }

  private vaultOverviewBlockCommand(
    commandBase: {
      id: string;
      draftId: string;
      draftRevision: number;
      ownerId: string;
      deviceId: string;
      vaultBindingId: string;
      issuedAt: string;
      expiresAt: string;
    },
    draft: WritebackDraftRecord,
  ): WritebackCommand {
    if (!draft.vaultOverviewId || !/^vdx_[a-f0-9]{32}$/.test(draft.vaultOverviewId)) {
      throw new LearningProgressServiceError(
        'learning_contract_invalid',
        500,
        'Vault overview draft is missing its stable identity.',
      );
    }
    if (draft.managedBlocks.length === 0) {
      throw new LearningProgressServiceError(
        'learning_contract_invalid',
        500,
        'Vault overview draft is missing its replacement blocks.',
      );
    }
    const blocks = draft.managedBlocks.map((block) => {
      if (!block.expectedHash || !/^[a-f0-9]{64}$/.test(block.expectedHash)) {
        throw new LearningProgressServiceError(
          'learning_contract_invalid',
          500,
          'Vault overview draft is missing an expected block hash.',
        );
      }
      return { id: block.id, expectedHash: block.expectedHash, content: block.content };
    });
    return stampWritebackCommand({
      ...commandBase,
      operation: 'replaceVaultOverviewBlocks',
      arguments: {
        relativePath: draft.relativePath,
        vaultOverviewId: draft.vaultOverviewId,
        blocks,
      },
    });
  }

  async leaseWritebackCommands(
    principal: DeviceTokenPrincipal,
    limit: number,
    options: { operations?: readonly WritebackOperation[] } = {},
  ): Promise<LeasedWritebackCommands> {
    const boundedLimit = Math.max(1, Math.min(20, Math.trunc(limit)));
    const now = this.now();
    const leaseUntil = new Date(now.getTime() + COMMAND_LEASE_MS);
    const commands = await this.options.repository.leaseCommands(
      principal.ownerId,
      principal.deviceId,
      principal.vaultBindingId,
      now,
      leaseUntil,
      boundedLimit,
      options.operations,
    );
    return {
      commands,
      ...(commands.length > 0 ? { leaseExpiresAt: leaseUntil.toISOString() } : {}),
    };
  }

  async markWritebackCommandLocallyValidated(
    principal: DeviceTokenPrincipal,
    commandId: string,
  ): Promise<{ updated: boolean }> {
    if (!/^wbc_[a-f0-9]{32}$/.test(commandId)) {
      throw new LearningProgressServiceError(
        'invalid_request',
        400,
        'Writeback command id is invalid.',
      );
    }
    return {
      updated: await this.options.repository.markCommandLocallyValidated(
        principal.ownerId,
        principal.deviceId,
        principal.vaultBindingId,
        commandId,
        this.now(),
      ),
    };
  }

  async recordWritebackReceipt(
    principal: DeviceTokenPrincipal,
    receipt: WritebackReceipt,
  ): Promise<{ accepted: true; duplicate: boolean }> {
    this.validateReceipt(principal, receipt);
    const now = this.now();
    const result = await this.options.repository.recordReceipt(
      principal.ownerId,
      principal.deviceId,
      receipt,
      now,
    );
    if (result.state === 'not_found') {
      throw new LearningProgressServiceError(
        'invalid_request',
        404,
        'Writeback command was not found.',
      );
    }
    if (result.state === 'mismatch') {
      throw new LearningProgressServiceError(
        'conflict',
        409,
        'A different receipt was already recorded for this command.',
      );
    }
    if (receipt.outcome === 'applied' && result.sprintId) {
      const event = stampLearningEvent({
        id: identifier('lev'),
        ownerId: principal.ownerId,
        sprintId: result.sprintId,
        eventType: 'writebackApplied',
        clientEventId: `writeback-receipt:${receipt.id}`,
        deviceId: principal.deviceId,
        occurredAt: receipt.appliedAt ?? receipt.reportedAt,
        source: 'obsidian-plugin',
        payload: { commandId: receipt.commandId, receiptId: receipt.id, outcome: 'applied' },
      });
      await this.options.repository.appendEvents([event], now);
      if (result.state !== 'duplicate') {
        const sprint = await this.options.repository.findSprint(principal.ownerId, result.sprintId);
        if (sprint) {
          await this.notifyKnowledgeChanged({
            triggerKind: 'writeback-receipt',
            triggerId: receipt.id,
            classroomId: sprint.classroomId,
            ...(sprint.projectId ? { projectId: sprint.projectId } : {}),
          });
        }
      }
    }
    return { accepted: true, duplicate: result.state === 'duplicate' };
  }

  private webEvent(
    sprintId: string,
    eventType: LearningEventType,
    clientEventId: string,
    occurredAt: string,
    payload: JsonObject,
    links: { causationId?: string; correlationId?: string } = {},
  ): LearningEvent {
    const event = {
      protocolVersion: LEARNING_PROTOCOL_VERSION,
      schemaVersion: 'learning-event/1',
      id: identifier('lev'),
      ownerId: this.options.ownerId,
      sprintId,
      eventType,
      clientEventId,
      deviceId: WEB_DEVICE_ID,
      occurredAt,
      source: 'web',
      ...(links.causationId ? { causationId: links.causationId } : {}),
      ...(links.correlationId ? { correlationId: links.correlationId } : {}),
      payload,
    } as unknown as LearningEvent;
    const validation = validateLearningEvent(event);
    if (!validation.valid) {
      throw new LearningProgressServiceError(
        'learning_contract_invalid',
        422,
        `LearningEvent is invalid: ${validation.errors[0]?.path ?? '/'}.`,
      );
    }
    return event;
  }

  private systemEvent(
    sprintId: string,
    eventType: LearningEventType,
    clientEventId: string,
    occurredAt: string,
    payload: JsonObject,
    links: { causationId?: string; correlationId?: string } = {},
  ): LearningEvent {
    const event = {
      protocolVersion: LEARNING_PROTOCOL_VERSION,
      schemaVersion: 'learning-event/1',
      id: identifier('lev'),
      ownerId: this.options.ownerId,
      sprintId,
      eventType,
      clientEventId,
      deviceId: SYSTEM_EVALUATOR_DEVICE_ID,
      occurredAt,
      source: 'system',
      ...(links.causationId ? { causationId: links.causationId } : {}),
      ...(links.correlationId ? { correlationId: links.correlationId } : {}),
      payload,
    } as unknown as LearningEvent;
    const validation = validateLearningEvent(event);
    if (!validation.valid) {
      throw new LearningProgressServiceError(
        'learning_contract_invalid',
        422,
        `System LearningEvent is invalid: ${validation.errors[0]?.path ?? '/'}.`,
      );
    }
    return event;
  }

  private async notifyKnowledgeChanged(change: KnowledgeGraphRefreshChange): Promise<void> {
    if (!this.options.onKnowledgeChanged) return;
    try {
      await this.options.onKnowledgeChanged(change);
    } catch (error) {
      console.warn(
        'Knowledge graph refresh did not complete synchronously; durable learning data remains saved.',
        {
          triggerKind: change.triggerKind,
          triggerId: change.triggerId,
          reason: error instanceof Error ? error.message : String(error),
        },
      );
    }
  }

  private validateReceipt(principal: DeviceTokenPrincipal, receipt: WritebackReceipt): void {
    const invalid =
      receipt.protocolVersion !== LEARNING_PROTOCOL_VERSION ||
      !/^wbr_[a-f0-9]{32}$/.test(receipt.id) ||
      !/^wbc_[a-f0-9]{32}$/.test(receipt.commandId) ||
      receipt.deviceId !== principal.deviceId ||
      !['applied', 'conflicted', 'failed', 'expired', 'rejected'].includes(receipt.outcome) ||
      Number.isNaN(Date.parse(receipt.reportedAt)) ||
      (receipt.appliedAt !== undefined && Number.isNaN(Date.parse(receipt.appliedAt))) ||
      (receipt.resultingContentHash !== undefined &&
        !/^[a-f0-9]{64}$/.test(receipt.resultingContentHash)) ||
      (receipt.resultingPath !== undefined && receipt.resultingPath.length > 512) ||
      (receipt.conflictDetail !== undefined && receipt.conflictDetail.length > 2000);
    if (invalid) {
      throw new LearningProgressServiceError(
        'learning_contract_invalid',
        422,
        'WritebackReceipt failed the integration contract.',
      );
    }
  }
}
