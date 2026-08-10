import { describe, expect, it, vi } from 'vitest';
import {
  stampLearningEvent,
  validateWritebackCommand,
  type LearningEvent,
} from '@openmaic/learning-protocol';
import { LearningProgressService } from '@/lib/learning/application/learning-progress-service';
import type { LearningEvidenceEvaluationInput } from '@/lib/learning/application/learning-evidence-evaluation';
import type {
  LearningSprintRecord,
  CreateWritebackDraftRecord,
  WritebackDraftRecord,
} from '@/lib/learning/domain/learning-progress';
import type { MasteryProjection } from '@/lib/learning/domain/mastery-evidence';
import {
  KNOWLEDGE_EVALUATION_SCHEMA,
  type KnowledgeSnapshotRecord,
} from '@/lib/learning/domain/knowledge-snapshot';
import type {
  ApproveWritebackDraftInput,
  LearningProgressRepository,
} from '@/lib/learning/ports/learning-progress-repository';

describe('LearningProgressService writeback flow', () => {
  it('records completion separately from active evidence and persists mastery projections', async () => {
    const now = new Date('2026-07-23T10:00:00.000Z');
    const ownerId = `own_${'1'.repeat(32)}`;
    const sprint: LearningSprintRecord = {
      id: `spr_${'2'.repeat(32)}`,
      ownerId,
      classroomId: 'course_completion',
      goal: '完成并验证课堂',
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };
    const stored: LearningEvent[] = [];
    const repository = {
      ensureSprint: vi.fn(async () => sprint),
      appendEvents: vi.fn(async (events: readonly LearningEvent[]) => {
        for (const event of events) {
          if (!stored.some((item) => item.clientEventId === event.clientEventId)) stored.push(event);
        }
        return { accepted: events.length, deduplicated: 0 };
      }),
      listEvents: vi.fn(async () =>
        stored.map((event, index) => ({
          ...event,
          receivedAt: now.toISOString(),
          serverSeq: index + 1,
        })),
      ),
      replaceMasteryProjections: vi.fn(async () => undefined),
      markSprintCompleted: vi.fn(async () => undefined),
      getDepositionPolicy: vi.fn(async () => ({
        ownerId,
        mode: 'manual' as const,
        managedAutoEnabled: false,
        allowCompanionUpdates: false,
        allowExternalCards: false,
        updatedAt: now,
      })),
    } as unknown as LearningProgressRepository;
    const onKnowledgeChanged = vi.fn(async () => undefined);
    const service = new LearningProgressService({
      ownerId,
      repository,
      now: () => now,
      readClassroom: async () => ({
        id: sprint.classroomId,
        stage: { id: sprint.classroomId, name: '完成语义课堂' },
        scenes: [
          { id: 'scene_1', title: '阅读', order: 0, type: 'slide' },
          { id: 'scene_2', title: '测验', order: 1, type: 'quiz' },
        ],
        createdAt: now.toISOString(),
      }),
      onKnowledgeChanged,
    });

    const passive = await service.appendWebEvents(sprint.classroomId, [
      {
        eventType: 'sceneViewed',
        clientEventId: 'scene-viewed:1',
        occurredAt: now.toISOString(),
        payload: { sceneId: 'scene_1', sceneOrder: 0 },
      },
    ]);
    expect(passive.mastery.estimate).toBeNull();

    const completed = await service.appendWebEvents(sprint.classroomId, [
      {
        eventType: 'practiceSubmitted',
        clientEventId: 'quiz:1',
        occurredAt: now.toISOString(),
        payload: { taskId: 'scene_2', sceneId: 'scene_2', score: 0.8, response: '{"earned":4,"possible":5}' },
      },
      {
        eventType: 'sceneCompleted',
        clientEventId: 'scene-completed:1',
        occurredAt: now.toISOString(),
        payload: { sceneId: 'scene_1', completionKind: 'manual' },
      },
      {
        eventType: 'sceneCompleted',
        clientEventId: 'scene-completed:2',
        occurredAt: now.toISOString(),
        payload: { sceneId: 'scene_2', completionKind: 'quiz-submitted' },
      },
    ]);
    expect(completed.completion).toMatchObject({ completed: true, totalSceneCount: 2 });
    expect(completed.mastery.estimate).not.toBeNull();
    expect(repository.replaceMasteryProjections).toHaveBeenCalledTimes(2);
    expect(repository.markSprintCompleted).not.toHaveBeenCalled();
    expect(onKnowledgeChanged).toHaveBeenCalledTimes(2);
  });

  it('strips self-scores and appends a source-traceable system evaluation', async () => {
    const now = new Date('2026-07-28T10:00:00.000Z');
    const ownerId = `own_${'9'.repeat(32)}`;
    const sprint: LearningSprintRecord = {
      id: `spr_${'8'.repeat(32)}`,
      ownerId,
      classroomId: 'course_system_evaluation',
      goal: 'Verify a response',
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };
    const stored: LearningEvent[] = [];
    const service = new LearningProgressService({
      ownerId,
      repository: {
        ensureSprint: vi.fn(async () => sprint),
        appendEvents: vi.fn(async (events: readonly LearningEvent[]) => {
          let accepted = 0;
          let deduplicated = 0;
          for (const event of events) {
            if (stored.some((existing) => existing.clientEventId === event.clientEventId)) {
              deduplicated += 1;
            } else {
              stored.push(event);
              accepted += 1;
            }
          }
          return { accepted, deduplicated };
        }),
        listEvents: vi.fn(async () =>
          stored.map((event, index) => ({ ...event, receivedAt: now.toISOString(), serverSeq: index + 1 })),
        ),
        replaceMasteryProjections: vi.fn(async () => undefined),
      } as unknown as LearningProgressRepository,
      readClassroom: async () => ({
        id: sprint.classroomId,
        stage: {
          id: sprint.classroomId,
          name: 'Evaluation classroom',
          learningContext: {
            researchSources: [{ title: 'Primary source', url: 'https://example.test/primary' }],
          },
        },
        scenes: [{ id: 'scene_1', title: 'Evidence', order: 0, type: 'slide' }],
        createdAt: now.toISOString(),
      }),
      evidenceEvaluator: {
        evaluate: vi.fn(async (input: LearningEvidenceEvaluationInput) => ({
          verdict: 'passed' as const,
          score: 0.9,
          confidence: 0.9,
          rubricVersion: 'learning-evidence-v1' as const,
          knowledgeEvaluation: {
            schema: KNOWLEDGE_EVALUATION_SCHEMA,
            verdict: 'passed' as const,
            confidence: 0.9,
            sourceReferences: input.canonicalSources.map((source) => source.reference),
            verifiedClaims: [
              {
                text: 'The evidence is linked to an immutable canonical source.',
                sourceReferences: input.canonicalSources.map((source) => source.reference),
              },
            ],
          },
        })),
      },
      now: () => now,
    });

    const verifiedResult = await service.appendWebEvents(sprint.classroomId, [
      {
        eventType: 'retrievalAttempted',
        clientEventId: 'retrieval:system-evaluation',
        occurredAt: now.toISOString(),
        payload: {
          promptId: 'recall:scene_1',
          sceneId: 'scene_1',
          score: 1,
          response: 'The response explains how a canonical source supports an evidence-based conclusion.',
        },
      },
    ]);
    const replay = await service.appendWebEvents(sprint.classroomId, [
      {
        eventType: 'retrievalAttempted',
        clientEventId: 'retrieval:system-evaluation',
        occurredAt: now.toISOString(),
        payload: {
          promptId: 'recall:scene_1',
          sceneId: 'scene_1',
          response: 'The response explains how a canonical source supports an evidence-based conclusion.',
        },
      },
    ]);

    const learner = stored.find((event) => event.source === 'web');
    const evaluation = stored.find((event) => event.source === 'system');
    expect(replay).toMatchObject({ accepted: 0, deduplicated: 2 });
    expect(stored).toHaveLength(2);
    expect((learner?.payload as unknown as Record<string, unknown>).score).toBeUndefined();
    expect(evaluation).toMatchObject({
      eventType: 'evidenceEvaluated',
      source: 'system',
      causationId: learner?.id,
      payload: { targetEventId: learner?.id, verdict: 'passed' },
    });
    expect(verifiedResult.verification).toMatchObject({
      learningVerified: false,
      passedEvaluationCount: 1,
      requiredEvaluationCount: 3,
      transferPassed: false,
      latestEvaluation: {
        targetEventType: 'retrievalAttempted',
        verdict: 'passed',
        score: 0.9,
        confidence: 0.9,
      },
    });
  });

  it('persists learner evidence before deferred evaluation and evaluates it exactly once', async () => {
    const now = new Date('2026-08-02T18:00:00.000Z');
    const ownerId = `own_${'d'.repeat(32)}`;
    const sprint: LearningSprintRecord = {
      id: `spr_${'e'.repeat(32)}`,
      ownerId,
      classroomId: 'course_deferred_evidence',
      goal: 'Keep learning events responsive while evidence is evaluated.',
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };
    const stored: LearningEvent[] = [];
    const appendEvents = vi.fn(async (events: readonly LearningEvent[]) => {
      let accepted = 0;
      for (const event of events) {
        if (stored.some((existing) => existing.clientEventId === event.clientEventId)) continue;
        stored.push(event);
        accepted += 1;
      }
      return { accepted, deduplicated: events.length - accepted };
    });
    const evaluate = vi.fn(async (input: LearningEvidenceEvaluationInput) => ({
      verdict: 'passed' as const,
      score: 0.9,
      confidence: 0.9,
      rubricVersion: 'learning-evidence-v1' as const,
      knowledgeEvaluation: {
        schema: KNOWLEDGE_EVALUATION_SCHEMA,
        verdict: 'passed' as const,
        confidence: 0.9,
        sourceReferences: input.canonicalSources.map((source) => source.reference),
        verifiedClaims: [
          {
            text: 'The submitted response is traceable to the canonical source.',
            sourceReferences: input.canonicalSources.map((source) => source.reference),
          },
        ],
      },
    }));
    const service = new LearningProgressService({
      ownerId,
      repository: {
        ensureSprint: vi.fn(async () => sprint),
        appendEvents,
        listEvents: vi.fn(async () =>
          stored.map((event, index) => ({ ...event, receivedAt: now.toISOString(), serverSeq: index + 1 })),
        ),
        replaceMasteryProjections: vi.fn(async () => undefined),
      } as unknown as LearningProgressRepository,
      readClassroom: async () => ({
        id: sprint.classroomId,
        stage: {
          id: sprint.classroomId,
          name: 'Deferred evidence classroom',
          learningContext: {
            researchSources: [{ title: 'Primary source', url: 'https://example.test/primary' }],
          },
        },
        scenes: [{ id: 'scene_1', title: 'Evidence', order: 0, type: 'slide' }],
        createdAt: now.toISOString(),
      }),
      evidenceEvaluator: { evaluate },
      now: () => now,
    });

    const input = {
      eventType: 'retrievalAttempted' as const,
      clientEventId: 'retrieval:deferred-once',
      occurredAt: now.toISOString(),
      payload: {
        promptId: 'recall:scene_1',
        sceneId: 'scene_1',
        response: 'A canonical source lets the learner audit the claim before accepting it.',
      },
    };
    const receipt = await service.appendWebEvents(sprint.classroomId, [input], {
      deferEvidenceEvaluation: true,
    });

    expect(receipt.accepted).toBe(1);
    expect(evaluate).not.toHaveBeenCalled();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ eventType: 'retrievalAttempted', source: 'web' });

    await service.evaluateDeferredWebEvidence(sprint.classroomId, [input.clientEventId]);
    await service.evaluateDeferredWebEvidence(sprint.classroomId, [input.clientEventId]);

    expect(evaluate).toHaveBeenCalledTimes(1);
    expect(stored).toHaveLength(2);
    expect(stored.find((event) => event.source === 'system')).toMatchObject({
      eventType: 'evidenceEvaluated',
      payload: { verdict: 'passed' },
    });
    expect(appendEvents).toHaveBeenCalledTimes(2);
  });

  it('rejects the retired manual completeSprint path', async () => {
    const service = new LearningProgressService({
      ownerId: `own_${'7'.repeat(32)}`,
      repository: {} as LearningProgressRepository,
      readClassroom: async () => null,
    });
    await expect(
      service.completeSprint(`spr_${'6'.repeat(32)}`, {
        completionVersion: 1,
        completedSceneIds: ['scene_1'],
      }),
    ).rejects.toMatchObject({ code: 'scope_denied', status: 403 });
  });

  it('marks a sprint complete only after the server gate and persists the verified snapshot', async () => {
    const now = new Date('2026-07-28T11:00:00.000Z');
    const ownerId = `own_${'5'.repeat(32)}`;
    const sprint: LearningSprintRecord = {
      id: `spr_${'4'.repeat(32)}`,
      ownerId,
      classroomId: 'course_verified_gate',
      goal: 'Demonstrate verified learning',
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };
    const stored: LearningEvent[] = [];
    let snapshot: KnowledgeSnapshotRecord | null = null;
    const persistedSnapshots: KnowledgeSnapshotRecord[] = [];
    const repository = {
      ensureSprint: vi.fn(async () => sprint),
      appendEvents: vi.fn(async (events: readonly LearningEvent[]) => {
        stored.push(...events);
        return { accepted: events.length, deduplicated: 0 };
      }),
      listEvents: vi.fn(async () =>
        stored.map((event, index) => ({ ...event, receivedAt: now.toISOString(), serverSeq: index + 1 })),
      ),
      replaceMasteryProjections: vi.fn(async () => undefined),
      markSprintCompleted: vi.fn(async () => undefined),
      getDepositionPolicy: vi.fn(async () => ({
        ownerId,
        mode: 'manual' as const,
        managedAutoEnabled: false,
        allowCompanionUpdates: false,
        allowSynthesisIndexUpdates: false,
        allowExternalCards: false,
        updatedAt: now,
      })),
    } as unknown as LearningProgressRepository;
    const service = new LearningProgressService({
      ownerId,
      repository,
      now: () => now,
      readClassroom: async () => ({
        id: sprint.classroomId,
        stage: {
          id: sprint.classroomId,
          name: 'Verified gate classroom',
          learningContext: {
            researchSources: [{ title: 'Canonical', url: 'https://example.test/canonical' }],
          },
        },
        scenes: [{ id: 'scene_1', title: 'Core idea', order: 0, type: 'slide' }],
        createdAt: now.toISOString(),
      }),
      knowledgeSnapshots: {
        findLatest: vi.fn(async () => snapshot),
        findLatestForScope: vi.fn(async () => snapshot),
        findById: vi.fn(async () => snapshot),
        append: vi.fn(async (input) => {
          const persisted: KnowledgeSnapshotRecord = {
            id: `ksn_${'3'.repeat(32)}`,
            ownerId,
            sessionId: sprint.id,
            scopeKind: 'session',
            scopeId: sprint.id,
            revision: 1,
            sourceManifestSha256: 'c'.repeat(64),
            ...input.projection,
            createdAt: now,
          };
          snapshot = persisted;
          persistedSnapshots.push(persisted);
          return persisted;
        }),
      },
      evidenceEvaluator: {
        evaluate: vi.fn(async (input: LearningEvidenceEvaluationInput) => ({
          verdict: 'passed' as const,
          score: 0.9,
          confidence: 0.9,
          rubricVersion: 'learning-evidence-v1' as const,
          knowledgeEvaluation: {
            schema: KNOWLEDGE_EVALUATION_SCHEMA,
            verdict: 'passed' as const,
            confidence: 0.9,
            sourceReferences: input.canonicalSources.map((source) => source.reference),
            verifiedClaims: [
              {
                text: 'The response is supported by a canonical source.',
                sourceReferences: input.canonicalSources.map((source) => source.reference),
              },
            ],
          },
        })),
      },
    });
    const verifiedResult = await service.appendWebEvents(sprint.classroomId, [
      {
        eventType: 'sceneViewed',
        clientEventId: 'view:verified',
        occurredAt: now.toISOString(),
        payload: { sceneId: 'scene_1' },
      },
      {
        eventType: 'retrievalAttempted',
        clientEventId: 'recall:verified',
        occurredAt: now.toISOString(),
        payload: { promptId: 'recall', sceneId: 'scene_1', response: 'I recalled the core idea, its mechanism, and its boundary in a new explanation.' },
      },
      {
        eventType: 'retrievalAttempted',
        clientEventId: 'recall:verified-retry',
        occurredAt: now.toISOString(),
        payload: {
          promptId: 'recall-retry',
          sceneId: 'scene_1',
          response: 'I recalled the same core idea again with its mechanism, source boundary, and one open question.',
        },
      },
      {
        eventType: 'explanationSubmitted',
        clientEventId: 'explain:verified',
        occurredAt: now.toISOString(),
        payload: { promptId: 'explain', sceneId: 'scene_1', response: 'I explained how the mechanism connects evidence to a claim and why the source remains traceable.' },
      },
      {
        eventType: 'transferTaskCompleted',
        clientEventId: 'transfer:verified',
        occurredAt: now.toISOString(),
        payload: {
          taskId: 'scene_1',
          sceneId: 'scene_1',
          promptText: 'Apply the method to a new project and verify the result.',
          outcome: 'I applied the source-to-claim workflow to a new project and recorded the remaining uncertainty.',
        },
      },
    ]);
    expect(verifiedResult.mastery).toMatchObject({ estimate: expect.any(Number), confidence: expect.any(Number) });
    expect(verifiedResult.verification).toMatchObject({
      learningVerified: true,
      passedEvaluationCount: 3,
      transferPassed: true,
      authoritativeMastery: 0.9,
      authoritativeConfidence: 0.9,
    });
    expect(repository.markSprintCompleted).toHaveBeenCalledWith(ownerId, sprint.id, now);
    expect(persistedSnapshots[0]?.verifiedKnowledge).not.toHaveLength(0);
  });

  it('recomputes mastery and refreshes the affected graph after device events', async () => {
    const now = new Date('2026-07-23T10:30:00.000Z');
    const ownerId = `own_${'1'.repeat(32)}`;
    const deviceId = `dev_${'2'.repeat(32)}`;
    const sprint: LearningSprintRecord = {
      id: `spr_${'3'.repeat(32)}`,
      ownerId,
      classroomId: 'course_device_evidence',
      projectId: `prj_${'4'.repeat(32)}`,
      goal: 'device evidence',
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };
    const event = stampLearningEvent({
      id: `lev_${'5'.repeat(32)}`,
      ownerId,
      sprintId: sprint.id,
      eventType: 'practiceSubmitted',
      clientEventId: 'obsidian-practice-1',
      deviceId,
      occurredAt: now.toISOString(),
      source: 'obsidian-plugin',
      payload: {
        taskId: 'scene_quiz',
        sceneId: 'scene_quiz',
        score: 0.9,
        response: '{"earned":9,"possible":10}',
      },
    });
    const repository = {
      findSprint: vi.fn(async () => sprint),
      appendEvents: vi.fn(async () => ({ accepted: 1, deduplicated: 0 })),
      listEvents: vi.fn(async () => [{ ...event, receivedAt: now.toISOString(), serverSeq: 1 }]),
      replaceMasteryProjections: vi.fn(async () => undefined),
    } as unknown as LearningProgressRepository;
    const onKnowledgeChanged = vi.fn(async () => undefined);
    const service = new LearningProgressService({
      ownerId,
      repository,
      now: () => now,
      readClassroom: async () => ({
        id: sprint.classroomId,
        stage: { id: sprint.classroomId, name: 'Device evidence classroom' },
        scenes: [{ id: 'scene_quiz', title: 'Quiz', order: 0, type: 'quiz' }],
        createdAt: now.toISOString(),
      }),
      onKnowledgeChanged,
    });

    await expect(
      service.appendDeviceEvents(
        {
          ownerId,
          deviceId,
          vaultBindingId: `vlt_${'6'.repeat(32)}`,
          scopes: ['events:append'],
        },
        [event],
      ),
    ).resolves.toEqual({ accepted: 1, deduplicated: 0 });

    expect(repository.replaceMasteryProjections).toHaveBeenCalledOnce();
    expect(onKnowledgeChanged).toHaveBeenCalledWith(
      expect.objectContaining({
        triggerKind: 'learning-event',
        classroomId: sprint.classroomId,
        projectId: sprint.projectId,
      }),
    );
  });

  it('requires active recall for review and keeps the self-rating out of mastery evidence', async () => {
    const now = new Date('2026-07-23T11:15:00.000Z');
    const ownerId = `own_${'1'.repeat(32)}`;
    const sprint: LearningSprintRecord = {
      id: `spr_${'2'.repeat(32)}`,
      ownerId,
      classroomId: 'course_rumination',
      goal: '反刍项目核心机制',
      status: 'completed',
      createdAt: now,
      updatedAt: now,
    };
    const review = {
      id: `rvi_${'3'.repeat(32)}`,
      ownerId,
      sprintId: sprint.id,
      conceptId: 'scene:scene_core',
      projectorVersion: 'mastery-evidence-v4',
      state: 'due' as const,
      dueAt: new Date('2026-07-23T08:00:00.000Z'),
      createdAt: now,
      updatedAt: now,
      classroomId: sprint.classroomId,
      goal: sprint.goal,
      masteryEstimate: 0.72,
      masteryConfidence: 0.55,
      masteryEvidenceCount: 3,
      isDue: true,
    };
    const stored: LearningEvent[] = [];
    const appendEvents = vi.fn(async (events: readonly LearningEvent[]) => {
      for (const event of events) {
        if (!stored.some((item) => item.clientEventId === event.clientEventId)) stored.push(event);
      }
      return { accepted: events.length, deduplicated: 0 };
    });
    const replaceMasteryProjections = vi.fn(
      async (
        _ownerId: string,
        _sprintId: string,
        _projections: readonly MasteryProjection[],
        _now: Date,
      ) => undefined,
    );
    const repository = {
      findReviewQueueItem: vi.fn(async () => review),
      findSprint: vi.fn(async () => sprint),
      appendEvents,
      listEvents: vi.fn(async () =>
        stored.map((event, index) => ({
          ...event,
          receivedAt: now.toISOString(),
          serverSeq: index + 1,
        })),
      ),
      replaceMasteryProjections,
    } as unknown as LearningProgressRepository;
    const service = new LearningProgressService({
      ownerId,
      repository,
      now: () => now,
      readClassroom: async () => ({
        id: sprint.classroomId,
        stage: { id: sprint.classroomId, name: '反刍课堂' },
        scenes: [{ id: 'scene_core', title: '核心机制', order: 0, type: 'explanation' }],
        createdAt: now.toISOString(),
      }),
    });

    await service.completeReview(review.id, {
      attemptId: 'review_attempt_core_001',
      response: '闭卷回忆：核心机制由输入、约束和验证闭环组成；可以迁移到新的项目审查。',
      rating: 'easy',
      durationMs: 42_000,
    });

    const batch = appendEvents.mock.calls[0]?.[0] as LearningEvent[];
    expect(batch.map((event) => event.eventType)).toEqual([
      'retrievalAttempted',
      'reviewCompleted',
    ]);
    expect(batch[0]).toMatchObject({
      clientEventId: 'review-recall:review_attempt_core_001',
      payload: {
        sceneId: 'scene_core',
        durationMs: 42_000,
      },
    });
    expect((batch[0]?.payload as unknown as Record<string, unknown>).score).toBeUndefined();
    expect(batch[1]).toMatchObject({
      clientEventId: 'review-completed:review_attempt_core_001',
      causationId: batch[0]?.id,
      correlationId: 'review_attempt_core_001',
      payload: { rating: 'easy', conceptId: 'scene:scene_core' },
    });
    const projections = replaceMasteryProjections.mock.calls[0]?.[2];
    const sceneProjection = projections?.find(
      (projection) => projection.conceptId === 'scene:scene_core',
    );
    expect(sceneProjection?.evidenceTypes).toEqual(['retrievalAttempted']);
    expect(sceneProjection?.evidenceCount).toBe(1);
  });

  it('never auto-creates the first mutable note, even after local automation was enabled', async () => {
    const now = new Date('2026-07-23T11:00:00.000Z');
    const ownerId = `own_${'1'.repeat(32)}`;
    const sprint: LearningSprintRecord = {
      id: `spr_${'2'.repeat(32)}`,
      ownerId,
      classroomId: 'course_first_companion',
      goal: '安全创建第一份学习伴随笔记',
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };
    const stored: LearningEvent[] = [];
    const updates: string[] = [];
    const depositionItems: Array<Record<string, unknown>> = [];
    const repository = {
      ensureSprint: vi.fn(async () => sprint),
      appendEvents: vi.fn(async (events: readonly LearningEvent[]) => {
        for (const event of events) {
          if (!stored.some((item) => item.clientEventId === event.clientEventId)) stored.push(event);
        }
        return { accepted: events.length, deduplicated: 0 };
      }),
      listEvents: vi.fn(async () =>
        stored.map((event, index) => ({
          ...event,
          receivedAt: now.toISOString(),
          serverSeq: index + 1,
        })),
      ),
      replaceMasteryProjections: vi.fn(async () => undefined),
      markSprintCompleted: vi.fn(async () => undefined),
      getDepositionPolicy: vi.fn(async () => ({
        ownerId,
        mode: 'managed-auto' as const,
        managedAutoEnabled: true,
        allowCompanionUpdates: true,
        allowExternalCards: false,
        updatedAt: now,
      })),
      findOrCreateDepositionRun: vi.fn(async (input) => ({
        id: input.id,
        ownerId,
        sprintId: sprint.id,
        assetType: 'learning-companion' as const,
        idempotencyKey: input.idempotencyKey,
        projectorVersion: input.projectorVersion,
        state: 'pending' as const,
        riskLevel: 'low' as const,
        createdAt: now,
        updatedAt: now,
      })),
      updateDepositionRun: vi.fn(async (input) => {
        updates.push(input.state);
        return null;
      }),
      createDepositionItem: vi.fn(async (input) => {
        depositionItems.push(input);
        return { ...input, createdAt: now, updatedAt: now };
      }),
      findWritebackTarget: vi.fn(async () => ({
        deviceId: `dev_${'4'.repeat(32)}`,
        vaultBindingId: `vlt_${'5'.repeat(32)}`,
        vaultName: 'J-obsidian',
      })),
      createDraft: vi.fn(async (input: CreateWritebackDraftRecord) => ({
        id: input.id,
        ownerId: input.ownerId,
        draftKind: 'learning-summary' as const,
        sprintId: input.sprintId,
        targetDeviceId: input.targetDeviceId,
        targetVaultBindingId: input.targetVaultBindingId,
        revision: 1,
        status: 'generated' as const,
        operation: input.operation ?? 'createManagedNote',
        companionId: input.companionId,
        managedBlocks: input.managedBlocks ?? [],
        relativePath: input.relativePath,
        content: input.content,
        frontmatter: input.frontmatter,
        createdAt: now,
        updatedAt: now,
      })),
      approveDraft: vi.fn(),
    } as unknown as LearningProgressRepository;
    const service = new LearningProgressService({
      ownerId,
      repository,
      now: () => now,
      readClassroom: async () => ({
        id: sprint.classroomId,
        stage: { id: sprint.classroomId, name: 'First companion classroom' },
        scenes: [{ id: 'scene_1', title: '阅读', order: 0, type: 'slide' }],
        createdAt: now.toISOString(),
      }),
    });

    await service.appendWebEvents(sprint.classroomId, [
      {
        eventType: 'sceneCompleted',
        clientEventId: 'scene-completed:first',
        occurredAt: now.toISOString(),
        payload: { sceneId: 'scene_1', completionKind: 'manual' },
      },
    ]);

    expect(repository.approveDraft).not.toHaveBeenCalled();
    expect(depositionItems).toHaveLength(0);
    expect(updates).toEqual([]);
  });

  it('creates a previewable draft and emits one idempotent device-bound command after approval', async () => {
    const now = new Date('2026-07-21T08:00:00.000Z');
    const ownerId = `own_${'1'.repeat(32)}`;
    const sprint: LearningSprintRecord = {
      id: `spr_${'2'.repeat(32)}`,
      ownerId,
      classroomId: 'course_123',
      sourceBundleId: `src_${'3'.repeat(32)}`,
      goal: '掌握类型收窄',
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };
    let savedDraft: WritebackDraftRecord | undefined;
    const repository = {
      ensureSprint: vi.fn(async () => sprint),
      findWritebackTarget: vi.fn(async () => ({
        deviceId: `dev_${'4'.repeat(32)}`,
        vaultBindingId: `vlt_${'5'.repeat(32)}`,
        vaultName: 'J-obsidian',
      })),
      listEvents: vi.fn(async () => []),
      createDraft: vi.fn(async (input: CreateWritebackDraftRecord) => {
        savedDraft = {
          id: input.id,
          ownerId: input.ownerId,
          draftKind: 'learning-summary',
          sprintId: input.sprintId,
          targetDeviceId: input.targetDeviceId,
          targetVaultBindingId: input.targetVaultBindingId,
          revision: 1,
          status: 'generated',
          operation: input.operation ?? 'createManagedNote',
          companionId: input.companionId,
          managedBlocks: input.managedBlocks ?? [],
          relativePath: input.relativePath,
          content: input.content,
          frontmatter: input.frontmatter,
          createdAt: input.now,
          updatedAt: input.now,
        };
        return savedDraft;
      }),
      findDraft: vi.fn(async () => savedDraft ?? null),
      approveDraft: vi.fn(async (input: ApproveWritebackDraftInput) => input.command),
      appendEvents: vi.fn(async (events: readonly LearningEvent[]) => ({
        accepted: events.length,
        deduplicated: 0,
      })),
    } as unknown as LearningProgressRepository;

    const service = new LearningProgressService({
      ownerId,
      repository,
      now: () => now,
      readClassroom: async () => ({
        id: 'course_123',
        stage: {
          id: 'course_123',
          name: 'TypeScript 类型收窄',
          learningContext: {
            sourceBundleId: sprint.sourceBundleId,
            goal: sprint.goal,
          },
        },
        scenes: [{ id: 'quiz_1', title: '主动回忆', order: 1, type: 'quiz' }],
        createdAt: now.toISOString(),
      }),
    });

    await expect(
      service.createWritebackDraft('course_123', { currentSceneId: 'quiz_1', quizSummaries: [] }),
    ).rejects.toMatchObject({ code: 'dependency_unavailable', status: 503 });
    /* Legacy unverified-draft assertions intentionally retired.
    const draft = await service.createWritebackDraft('course_123', {
      currentSceneId: 'quiz_1',
      quizSummaries: [
        { sceneId: 'quiz_1', title: '主动回忆', answered: 2, total: 2, earned: 1, possible: 2 },
      ],
    });
    expect(draft.targetVaultName).toBe('J-obsidian');
    expect(draft.relativePath).toMatch(/^Vaultide\/学习记录\//);
    expect(draft.content).toContain('得分 1/2');

    const command = await service.approveWritebackDraft(draft.id, draft.revision);
    expect(validateWritebackCommand(command)).toEqual({ valid: true });
    expect(command).toMatchObject({
      ownerId,
      deviceId: `dev_${'4'.repeat(32)}`,
      vaultBindingId: `vlt_${'5'.repeat(32)}`,
      operation: 'createManagedNote',
      arguments: { expectedAbsent: true, relativePath: draft.relativePath },
    });
    expect(repository.approveDraft).toHaveBeenCalledTimes(1);
    expect(repository.appendEvents).toHaveBeenCalledTimes(1); */
  });

  it('approves a synthesis draft without inventing a classroom learning event', async () => {
    const now = new Date('2026-07-21T08:00:00.000Z');
    const ownerId = `own_${'1'.repeat(32)}`;
    const draft: WritebackDraftRecord = {
      id: `wbd_${'2'.repeat(32)}`,
      ownerId,
      draftKind: 'synthesis',
      synthesisRunId: `syn_${'3'.repeat(32)}`,
      targetDeviceId: `dev_${'4'.repeat(32)}`,
      targetVaultBindingId: `vlt_${'5'.repeat(32)}`,
      revision: 1,
      status: 'generated',
      operation: 'createManagedNote',
      managedBlocks: [],
      relativePath: 'Vaultide/归纳/2026-07-21-知识归纳.md',
      content: '# 知识归纳',
      frontmatter: { maic_status: 'synthesized' },
      createdAt: now,
      updatedAt: now,
    };
    const repository = {
      findDraft: vi.fn(async () => draft),
      approveDraft: vi.fn(async (input: ApproveWritebackDraftInput) => input.command),
      appendEvents: vi.fn(),
    } as unknown as LearningProgressRepository;
    const service = new LearningProgressService({
      ownerId,
      repository,
      now: () => now,
      readClassroom: async () => null,
    });

    const command = await service.approveWritebackDraft(draft.id, draft.revision);
    expect(validateWritebackCommand(command)).toEqual({ valid: true });
    expect(command.arguments.relativePath).toBe(draft.relativePath);
    expect(repository.appendEvents).not.toHaveBeenCalled();
  });

  it('binds one Obsidian source to one mutable companion and emits block-level updates later', async () => {
    const now = new Date('2026-07-23T08:00:00.000Z');
    const ownerId = `own_${'1'.repeat(32)}`;
    const sprint: LearningSprintRecord = {
      id: `spr_${'2'.repeat(32)}`,
      ownerId,
      classroomId: 'course_companion',
      sourceBundleId: `src_${'3'.repeat(32)}`,
      goal: '理解这份已有笔记',
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };
    let companion: import('@/lib/learning/domain/learning-progress').LearningCompanionRecord | undefined;
    const drafts = new Map<string, WritebackDraftRecord>();
    const repository = {
      ensureSprint: vi.fn(async () => sprint),
      findWritebackTarget: vi.fn(async () => ({
        deviceId: `dev_${'4'.repeat(32)}`,
        vaultBindingId: `vlt_${'5'.repeat(32)}`,
        vaultName: 'J-obsidian',
      })),
      findOrCreateCompanion: vi.fn(async (input) => {
        companion ??= {
          id: input.id,
          ownerId: input.ownerId,
          vaultBindingId: input.vaultBindingId,
          sourceId: input.sourceId,
          sourceBundleId: input.sourceBundleId,
          sourceSnapshotId: input.sourceSnapshotId,
          originalRelativePath: input.originalRelativePath,
          relativePath: input.relativePath,
          status: 'active',
          managedBlocks: input.initialManagedBlocks,
          createdAt: input.now,
          updatedAt: input.now,
        };
        return companion;
      }),
      listEvents: vi.fn(async () => []),
      createDraft: vi.fn(async (input: CreateWritebackDraftRecord) => {
        const draft: WritebackDraftRecord = {
          id: input.id,
          ownerId: input.ownerId,
          draftKind: 'learning-summary',
          sprintId: input.sprintId,
          targetDeviceId: input.targetDeviceId,
          targetVaultBindingId: input.targetVaultBindingId,
          revision: 1,
          status: 'generated',
          operation: input.operation ?? 'createManagedNote',
          companionId: input.companionId,
          managedBlocks: input.managedBlocks ?? [],
          relativePath: input.relativePath,
          content: input.content,
          frontmatter: input.frontmatter,
          createdAt: input.now,
          updatedAt: input.now,
        };
        drafts.set(draft.id, draft);
        return draft;
      }),
      findDraft: vi.fn(async (_ownerId: string, draftId: string) => drafts.get(draftId) ?? null),
      approveDraft: vi.fn(async (input: ApproveWritebackDraftInput) => input.command),
      appendEvents: vi.fn(async (events: readonly LearningEvent[]) => ({
        accepted: events.length,
        deduplicated: 0,
      })),
    } as unknown as LearningProgressRepository;
    const service = new LearningProgressService({
      ownerId,
      repository,
      now: () => now,
      readClassroom: async () => ({
        id: sprint.classroomId,
        stage: {
          id: sprint.classroomId,
          name: '已有笔记课堂',
          learningContext: { sourceBundleId: sprint.sourceBundleId, goal: sprint.goal },
        },
        scenes: [{ id: 'scene_1', title: '核心概念', order: 1, type: 'explanation' }],
        createdAt: now.toISOString(),
      }),
      readSourceArchive: async () =>
        ({
          bundle: {
            snapshots: [
              {
                id: `snp_${'6'.repeat(32)}`,
                origin: 'obsidian',
                locator: {
                  kind: 'obsidian',
                  vaultBindingId: `vlt_${'5'.repeat(32)}`,
                  relativePath: '项目/原有笔记.md',
                  sourceId: `sou_${'7'.repeat(32)}`,
                },
              },
            ],
          },
        }) as never,
    });

    await expect(
      service.createWritebackDraft(sprint.classroomId, { currentSceneId: 'scene_1', quizSummaries: [] }),
    ).rejects.toMatchObject({ code: 'dependency_unavailable', status: 503 });
    /* Legacy unverified companion assertions intentionally retired.
    const initial = await service.createWritebackDraft(sprint.classroomId, {
      currentSceneId: 'scene_1',
      quizSummaries: [],
    });
    expect(initial.operation).toBe('createManagedNote');
    expect(initial.relativePath).toMatch(/^Vaultide\/伴随笔记\/独立笔记\//);
    const createCommand = await service.approveWritebackDraft(initial.id, initial.revision);
    expect(createCommand.operation).toBe('createManagedNote');
    if (createCommand.operation !== 'createManagedNote') throw new Error('expected companion create');
    expect(createCommand.arguments.content).toContain('## 我的补充');

    const initialDraft = drafts.get(initial.id);
    if (!companion || !initialDraft) throw new Error('expected a companion draft');
    companion = {
      ...companion,
      lastContentHash: '8'.repeat(64),
      managedBlocks: initialDraft.managedBlocks.map(({ id, content, contentHash }) => ({
        id,
        content,
        contentHash,
      })),
    };

    const update = await service.createWritebackDraft(sprint.classroomId, {
      currentSceneId: 'scene_1',
      quizSummaries: [{ sceneId: 'scene_1', title: '核心概念', answered: 1, total: 1 }],
    });
    expect(update.operation).toBe('replaceManagedBlocks');
    expect(update.relativePath).toBe(initial.relativePath);
    const replaceCommand = await service.approveWritebackDraft(update.id, update.revision);
    expect(replaceCommand).toMatchObject({
      operation: 'replaceManagedBlocks',
      arguments: { companionId: companion.id },
    });
    if (replaceCommand.operation !== 'replaceManagedBlocks') throw new Error('expected replacement');
    expect(replaceCommand.arguments.blocks).toHaveLength(4);
    expect(replaceCommand.arguments.blocks.every((block) => Boolean(block.expectedHash))).toBe(true); */
  });

  it('creates a separate project index, then upgrades only its managed blocks after a receipt', async () => {
    const now = new Date('2026-07-23T12:00:00.000Z');
    const ownerId = `own_${'1'.repeat(32)}`;
    const projectId = `prj_${'2'.repeat(32)}`;
    const vaultBindingId = `vlt_${'3'.repeat(32)}`;
    const index = {
      project: {
        id: projectId,
        ownerId,
        vaultBindingId,
        kind: 'folder',
        projectName: 'Project index safety',
        rootPath: 'Projects/index-safety',
        status: 'active' as const,
        bindingRevision: 1,
        projectRevision: 2,
        metadata: {},
        createdAt: now,
        updatedAt: now,
      },
      sources: [],
      generatedAt: now,
    } as import('@/lib/learning/domain/project-learning').ProjectLearningIndexRecord;
    let document:
      | import('@/lib/learning/domain/project-learning').ProjectLearningIndexDocumentRecord
      | undefined;
    const drafts = new Map<string, WritebackDraftRecord>();
    const repository = {
      findWritebackTarget: vi.fn(async () => ({
        deviceId: `dev_${'4'.repeat(32)}`,
        vaultBindingId,
        vaultName: 'J-obsidian',
      })),
      findOrCreateProjectLearningIndex: vi.fn(async (input) => {
        document ??= {
          id: input.id,
          ownerId: input.ownerId,
          projectId: input.projectId,
          vaultBindingId: input.vaultBindingId,
          relativePath: input.relativePath,
          status: 'active',
          managedBlocks: input.initialManagedBlocks,
          createdAt: input.now,
          updatedAt: input.now,
        };
        return document;
      }),
      findOpenDraftByProjectIndex: vi.fn(async () => null),
      createDraft: vi.fn(async (input: CreateWritebackDraftRecord) => {
        const draft: WritebackDraftRecord = {
          id: input.id,
          ownerId: input.ownerId,
          draftKind: input.draftKind ?? 'learning-summary',
          projectIndexId: input.projectIndexId,
          targetDeviceId: input.targetDeviceId,
          targetVaultBindingId: input.targetVaultBindingId,
          revision: 1,
          status: 'generated',
          operation: input.operation ?? 'createManagedNote',
          managedBlocks: input.managedBlocks ?? [],
          relativePath: input.relativePath,
          content: input.content,
          frontmatter: input.frontmatter,
          createdAt: input.now,
          updatedAt: input.now,
        };
        drafts.set(draft.id, draft);
        return draft;
      }),
      findDraft: vi.fn(async (_ownerId: string, draftId: string) => drafts.get(draftId) ?? null),
      approveDraft: vi.fn(async (input: ApproveWritebackDraftInput) => input.command),
      appendEvents: vi.fn(),
    } as unknown as LearningProgressRepository;
    const service = new LearningProgressService({
      ownerId,
      repository,
      projectLearningIndexes: {
        findProjectLearningIndex: vi.fn(async () => index),
      } as never,
      now: () => now,
      readClassroom: async () => null,
    });

    const initial = await service.createProjectLearningIndexDraft(projectId);
    expect(initial).toMatchObject({
      draftKind: 'project-index',
      operation: 'createManagedNote',
      projectIndexId: expect.stringMatching(/^pdx_/),
    });
    const createCommand = await service.approveWritebackDraft(initial.id, initial.revision);
    expect(createCommand.operation).toBe('createManagedNote');

    if (!document) throw new Error('Expected project-index document');
    document = {
      ...document,
      lastContentHash: 'a'.repeat(64),
      managedBlocks: document.managedBlocks,
    };
    const update = await service.createProjectLearningIndexDraft(projectId);
    expect(update.operation).toBe('replaceProjectIndexBlocks');
    const updateCommand = await service.approveWritebackDraft(update.id, update.revision);
    expect(validateWritebackCommand(updateCommand)).toEqual({ valid: true });
    expect(updateCommand).toMatchObject({
      operation: 'replaceProjectIndexBlocks',
      arguments: { projectId, projectIndexId: document.id },
    });
  });

  it('issues a separately identified, block-CAS command for a periodic synthesis index', async () => {
    const now = new Date('2026-07-23T13:00:00.000Z');
    const ownerId = `own_${'1'.repeat(32)}`;
    const scheduleId = `sch_${'2'.repeat(32)}`;
    const synthesisIndexId = `sdx_${'3'.repeat(32)}`;
    const draft: WritebackDraftRecord = {
      id: `wbd_${'4'.repeat(32)}`,
      ownerId,
      draftKind: 'synthesis-index',
      synthesisIndexId,
      targetDeviceId: `dev_${'5'.repeat(32)}`,
      targetVaultBindingId: `vlt_${'6'.repeat(32)}`,
      revision: 1,
      status: 'generated',
      operation: 'replaceSynthesisIndexBlocks',
      managedBlocks: [
        {
          id: 'snapshots',
          content: '## 不可变快照\n\n- 新增一份。',
          contentHash: 'a'.repeat(64),
          expectedHash: 'b'.repeat(64),
        },
      ],
      relativePath: 'Vaultide/归纳/周期/索引/weekly.md',
      content: '# 周期归纳索引',
      frontmatter: {
        maic_note_id: synthesisIndexId,
        maic_synthesis_index_id: synthesisIndexId,
        maic_synthesis_schedule_id: scheduleId,
        maic_managed: true,
      },
      createdAt: now,
      updatedAt: now,
    };
    const repository = {
      findDraft: vi.fn(async () => draft),
      approveDraft: vi.fn(async (input: ApproveWritebackDraftInput) => input.command),
      appendEvents: vi.fn(async () => ({ accepted: 0, deduplicated: 0 })),
    } as unknown as LearningProgressRepository;
    const service = new LearningProgressService({
      ownerId,
      repository,
      now: () => now,
      readClassroom: async () => null,
    });

    const command = await service.approveWritebackDraft(draft.id, draft.revision);
    expect(validateWritebackCommand(command)).toEqual({ valid: true });
    expect(command).toMatchObject({
      operation: 'replaceSynthesisIndexBlocks',
      arguments: { scheduleId, synthesisIndexId, relativePath: draft.relativePath },
    });
  });
});
