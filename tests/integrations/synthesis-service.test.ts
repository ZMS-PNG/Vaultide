import { describe, expect, it, vi } from 'vitest';
import {
  SynthesisService,
  SynthesisServiceError,
} from '@/lib/learning/application/synthesis-service';
import {
  asTrustedKnowledgeSpaceGraph,
  type TrustedKnowledgeSnapshotInput,
} from '@/lib/learning/domain/knowledge-space-synthesis';
import { KNOWLEDGE_SNAPSHOT_PROJECTOR_VERSION } from '@/lib/learning/domain/knowledge-snapshot';
import type {
  CreateSynthesisWritebackDraftRecord,
  WritebackDraftRecord,
} from '@/lib/learning/domain/learning-progress';
import type {
  SaveSynthesisRunInput,
  SynthesisRunRecord,
  SynthesisScheduleRecord,
  SynthesisScheduleRunRecord,
} from '@/lib/learning/domain/synthesis';
import type { KnowledgeSpaceEvidenceRepository } from '@/lib/learning/ports/knowledge-space-evidence-repository';
import type { LearningProgressRepository } from '@/lib/learning/ports/learning-progress-repository';
import type { SynthesisRepository } from '@/lib/learning/ports/synthesis-repository';

const OWNER_ID = `own_${'1'.repeat(32)}`;
const PROJECT_ID = `prj_${'6'.repeat(32)}`;
const CLASSROOM_ID = 'course_typescript';
const SOURCE_REFERENCE = {
  referenceId: 'typescript-handbook',
  kind: 'canonical-source' as const,
  citationId: 'S1',
  sourceId: `sou_${'7'.repeat(32)}`,
  sourceVersionId: `sov_${'8'.repeat(32)}`,
  locator: 'https://www.typescriptlang.org/docs/handbook/2/narrowing.html',
  contentHash: 'a'.repeat(64),
};

function knowledgeTrace(suffix: string, verifiedAt = '2026-07-21T07:30:00.000Z') {
  return {
    learningEventId: `lev_${suffix.repeat(32).slice(0, 32)}`,
    evaluationEventId: `lev_${suffix.toUpperCase().repeat(32).slice(0, 32)}`,
    verifiedAt,
    confidence: 0.96,
    rubricVersion: 'knowledge-evidence-rubric-v2',
    sourceReferences: [SOURCE_REFERENCE],
  };
}

function verifiedSnapshot(
  overrides: Partial<TrustedKnowledgeSnapshotInput> = {},
): TrustedKnowledgeSnapshotInput {
  return {
    snapshotId: `ksn_${'2'.repeat(32)}`,
    sessionId: `lsn_${'3'.repeat(32)}`,
    scopeKind: 'project',
    scopeId: PROJECT_ID,
    revision: 1,
    sourceManifestSha256: 'b'.repeat(64),
    projectId: PROJECT_ID,
    projectName: 'TypeScript 项目',
    classroomId: CLASSROOM_ID,
    sourceMode: 'hybrid',
    topicTags: ['typescript', '类型系统'],
    createdAt: new Date('2026-07-21T08:00:00.000Z'),
    verifiedKnowledge: [
      {
        id: 'ken_claim',
        kind: 'claim',
        text: 'TypeScript 通过控制流分析缩小联合类型，并在可达赋值后更新变量类型。',
        trace: knowledgeTrace('a'),
      },
      {
        id: 'ken_skill',
        kind: 'skill',
        text: '能够使用可辨识联合和穷尽检查实现安全的状态建模。',
        trace: knowledgeTrace('b'),
      },
    ],
    misconceptions: [
      {
        id: 'ken_misconception',
        misconception: '类型断言会在运行时验证数据结构。',
        correction: '类型断言只影响静态检查，不会生成运行时验证。',
        trace: knowledgeTrace('c'),
      },
    ],
    unresolvedItems: [
      {
        id: 'ken_question',
        question: '如何为外部 JSON 建立可追溯的运行时类型验证边界？',
        trace: knowledgeTrace('d'),
      },
    ],
    evidenceSummary: {
      projectorVersion: KNOWLEDGE_SNAPSHOT_PROJECTOR_VERSION,
      acceptedEvaluationEventIds: [`lev_${'A'.repeat(32)}`],
      evaluatedLearningEventIds: [`lev_${'a'.repeat(32)}`],
      sourceReferenceIds: [SOURCE_REFERENCE.referenceId],
      rejected: {
        unverifiedLearningEvents: 0,
        invalidEvaluations: 0,
        malformedEntries: 0,
        missingSourceReferences: 0,
      },
    },
    eligibleForPersistence: true,
    ...overrides,
  };
}

function untrustedSnapshot(): TrustedKnowledgeSnapshotInput {
  return verifiedSnapshot({
    snapshotId: `ksn_${'9'.repeat(32)}`,
    sessionId: `lsn_${'9'.repeat(32)}`,
    scopeId: `prj_${'9'.repeat(32)}`,
    projectId: `prj_${'9'.repeat(32)}`,
    projectName: '不得进入归纳的项目',
    verifiedKnowledge: [
      {
        id: 'learner_only',
        kind: 'claim',
        text: '这条只有学习者自评的内容绝不能进入可信归纳。',
        trace: knowledgeTrace('e'),
      },
    ],
    eligibleForPersistence: false,
  });
}

function synthesisRepositoryFixture() {
  const savedRuns: SynthesisRunRecord[] = [];
  const repository: SynthesisRepository = {
    listClassroomInputs: vi.fn(async () => []),
    save: vi.fn(async (input: SaveSynthesisRunInput) => {
      savedRuns.push(input);
      return input;
    }),
    find: vi.fn(async (_ownerId, synthesisId) => {
      return savedRuns.find((run) => run.id === synthesisId) ?? null;
    }),
    list: vi.fn(async () => savedRuns),
    listBySchedule: vi.fn(async (_ownerId, scheduleId) =>
      savedRuns.filter((run) => run.scheduleId === scheduleId),
    ),
    createSchedule: vi.fn(async () => {
      throw new Error('Schedule operations are not configured by this fixture.');
    }),
    findSchedule: vi.fn(async () => null),
    listSchedules: vi.fn(async () => []),
    updateSchedule: vi.fn(async () => null),
    listDueSchedules: vi.fn(async () => []),
    claimScheduleRun: vi.fn(async () => null),
    completeScheduleRun: vi.fn(async () => undefined),
  };
  return { repository, savedRuns };
}

describe('SynthesisService', () => {
  it('persists only verified snapshots as a trusted synthesis and drafts a managed note', async () => {
    const now = new Date('2026-07-21T08:00:00.000Z');
    const { repository } = synthesisRepositoryFixture();
    const evidenceRepository: KnowledgeSpaceEvidenceRepository = {
      listKnowledgeSnapshots: vi.fn(async () => [verifiedSnapshot(), untrustedSnapshot()]),
    };
    let savedDraft: WritebackDraftRecord | undefined;
    const learningProgressRepository = {
      findWritebackTarget: vi.fn(async () => ({
        deviceId: `dev_${'4'.repeat(32)}`,
        vaultBindingId: `vlt_${'5'.repeat(32)}`,
        vaultName: 'J-obsidian',
      })),
      createSynthesisDraft: vi.fn(async (input: CreateSynthesisWritebackDraftRecord) => {
        savedDraft = {
          id: input.id,
          ownerId: input.ownerId,
          draftKind: 'synthesis',
          synthesisRunId: input.synthesisRunId,
          targetDeviceId: input.targetDeviceId,
          targetVaultBindingId: input.targetVaultBindingId,
          revision: 1,
          status: 'generated',
          operation: 'createManagedNote',
          managedBlocks: [],
          relativePath: input.relativePath,
          content: input.content,
          frontmatter: input.frontmatter,
          createdAt: input.now,
          updatedAt: input.now,
        };
        return savedDraft;
      }),
    } as unknown as LearningProgressRepository;
    const onKnowledgeChanged = vi.fn(async () => undefined);
    const service = new SynthesisService({
      ownerId: OWNER_ID,
      repository,
      knowledgeSpaceEvidenceRepository: evidenceRepository,
      learningProgressRepository,
      onKnowledgeChanged,
      now: () => now,
    });

    const generated = await service.generate({ mode: 'combined', domainQuery: 'TypeScript' });
    const graph = asTrustedKnowledgeSpaceGraph(generated.graph);

    expect(graph).toBeDefined();
    expect(generated.classroomCount).toBe(1);
    expect(generated.projectId).toBe(PROJECT_ID);
    expect(graph?.inputAudit).toMatchObject({
      acceptedSnapshotIds: [verifiedSnapshot().snapshotId],
      rejectedSnapshots: [
        expect.objectContaining({
          snapshotId: untrustedSnapshot().snapshotId,
          reason: 'snapshot_not_eligible_for_persistence',
        }),
      ],
    });
    expect(new Set(graph?.nodes.map((node) => node.type))).toEqual(
      new Set(['concept', 'claim', 'skill', 'artifact']),
    );
    expect(graph?.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'supports',
          evidenceRefs: expect.arrayContaining([expect.stringMatching(/^kse_/)]),
          confidence: 0.96,
        }),
        expect.objectContaining({ type: 'contradicts', confidence: 0.96 }),
      ]),
    );
    expect(graph?.synthesis.conclusions.length).toBeGreaterThan(0);
    expect(graph?.synthesis.conflicts).toHaveLength(1);
    expect(graph?.synthesis.unknowns.length).toBeGreaterThan(0);
    expect(generated.summaryMarkdown).toContain('## 核心结论');
    expect(generated.summaryMarkdown).toContain('## 知识演化');
    expect(generated.summaryMarkdown).toContain('## 维度比较');
    expect(generated.summaryMarkdown).toContain('## 支持关系');
    expect(generated.summaryMarkdown).toContain('## 冲突与修正');
    expect(generated.summaryMarkdown).toContain('## 未知与边界');
    expect(generated.summaryMarkdown).toContain('## 下一轮主动学习');
    expect(generated.summaryMarkdown).not.toContain('这条只有学习者自评的内容');
    expect(repository.listClassroomInputs).not.toHaveBeenCalled();
    expect(onKnowledgeChanged).toHaveBeenCalledWith({
      triggerKind: 'synthesis',
      triggerId: generated.id,
      synthesisId: generated.id,
      projectId: PROJECT_ID,
    });

    const filters = await service.filterOptions();
    expect(filters.projects).toEqual([
      expect.objectContaining({
        projectId: PROJECT_ID,
        projectName: 'TypeScript 项目',
      }),
    ]);
    expect(filters.classrooms).toEqual([
      expect.objectContaining({
        classroomId: CLASSROOM_ID,
        sourceType: 'hybrid',
      }),
    ]);

    const draft = await service.createWritebackDraft(generated.id);
    expect(draft.targetVaultName).toBe('J-obsidian');
    expect(draft.synthesisRunId).toBe(generated.id);
    expect(draft.relativePath).toMatch(/^Vaultide\/归纳\/TypeScript 项目--66666666\/2026-07-21-/);
    expect(savedDraft?.draftKind).toBe('synthesis');
    expect(savedDraft?.frontmatter).toMatchObject({
      maic_project_id: PROJECT_ID,
      maic_synthesis_schema: 'trusted-synthesis/1',
      maic_knowledge_space_schema: 'trusted-knowledge-space/1',
      maic_verified_snapshot_count: 1,
      maic_incremental: false,
      maic_status: 'synthesized',
    });
    expect(savedDraft?.content).not.toMatch(/^---\r?\n/);
    expect(savedDraft?.content).toContain('## 核心结论');
  });

  it('counts one classroom once while preserving all verified snapshot revisions', async () => {
    const { repository } = synthesisRepositoryFixture();
    const first = verifiedSnapshot();
    const second = verifiedSnapshot({
      snapshotId: `ksn_${'4'.repeat(32)}`,
      revision: 2,
      parentSnapshotId: first.snapshotId,
      createdAt: new Date('2026-07-21T09:00:00.000Z'),
    });
    const service = new SynthesisService({
      ownerId: OWNER_ID,
      repository,
      knowledgeSpaceEvidenceRepository: {
        listKnowledgeSnapshots: async () => [first, second],
      },
      learningProgressRepository: {} as LearningProgressRepository,
      now: () => new Date('2026-07-21T10:00:00.000Z'),
    });

    const generated = await service.generate({
      mode: 'combined',
      classroomIds: [CLASSROOM_ID],
    });

    expect(generated.classroomCount).toBe(1);
    expect(generated.evidenceManifest).toHaveLength(2);
    expect(generated.evidenceManifest.map((entry) => entry.classroomId)).toEqual([
      CLASSROOM_ID,
      CLASSROOM_ID,
    ]);
    expect(generated.evidenceManifest.map((entry) => entry.snapshotId)).toEqual([
      first.snapshotId,
      second.snapshotId,
    ]);
  });

  it('creates one incremental scheduled snapshot and skips an unchanged next period', async () => {
    let now = new Date('2026-07-23T08:00:00.000Z');
    const snapshot = verifiedSnapshot({
      snapshotId: `ksn_${'5'.repeat(32)}`,
      createdAt: new Date('2026-07-23T07:00:00.000Z'),
    });
    const storedRuns: SynthesisRunRecord[] = [];
    const schedules: SynthesisScheduleRecord[] = [];
    const scheduleRuns = new Map<string, SynthesisScheduleRunRecord>();
    const approveWritebackDraft = vi.fn(async () => undefined);
    const createdDrafts: WritebackDraftRecord[] = [];
    const repository: SynthesisRepository = {
      listClassroomInputs: async () => [],
      save: async (input) => {
        storedRuns.push(input);
        return input;
      },
      find: async (_ownerId, synthesisId) =>
        storedRuns.find((run) => run.id === synthesisId) ?? null,
      list: async () => storedRuns,
      listBySchedule: async (_ownerId, scheduleId) =>
        storedRuns.filter((run) => run.scheduleId === scheduleId),
      createSchedule: async (input) => {
        const created: SynthesisScheduleRecord = {
          id: input.id,
          ownerId: input.ownerId,
          name: input.name,
          period: input.period,
          ...(input.intervalMinutes ? { intervalMinutes: input.intervalMinutes } : {}),
          timezone: input.timezone,
          mode: input.mode,
          scope: input.scope,
          scopeHash: input.scopeHash,
          status: 'active',
          nextRunAt: input.nextRunAt,
          createdAt: input.now,
          updatedAt: input.now,
        };
        schedules.push(created);
        return created;
      },
      findSchedule: async (_ownerId, scheduleId) =>
        schedules.find((schedule) => schedule.id === scheduleId) ?? null,
      listSchedules: async () => schedules,
      updateSchedule: async (input) => {
        const schedule = schedules.find((candidate) => candidate.id === input.scheduleId);
        if (!schedule) return null;
        Object.assign(schedule, {
          name: input.name,
          period: input.period,
          intervalMinutes: input.intervalMinutes,
          timezone: input.timezone,
          mode: input.mode,
          scope: input.scope,
          scopeHash: input.scopeHash,
          status: input.status,
          nextRunAt: input.nextRunAt,
          updatedAt: input.now,
        });
        return schedule;
      },
      listDueSchedules: async (_ownerId, dueAt) =>
        schedules.filter((schedule) => schedule.status === 'active' && schedule.nextRunAt <= dueAt),
      claimScheduleRun: async (input) => {
        const key = `${input.scheduleId}:${input.scheduledFor.toISOString()}`;
        const existing = scheduleRuns.get(key);
        if (existing && existing.state !== 'failed') return null;
        const claimed: SynthesisScheduleRunRecord = {
          id: input.id,
          ownerId: input.ownerId,
          scheduleId: input.scheduleId,
          scheduledFor: input.scheduledFor,
          state: 'running',
          evidenceManifest: [],
          startedAt: input.now,
          createdAt: input.now,
          updatedAt: input.now,
        };
        scheduleRuns.set(key, claimed);
        return claimed;
      },
      completeScheduleRun: async (input) => {
        const key = `${input.schedule.id}:${input.schedule.nextRunAt.toISOString()}`;
        const run = scheduleRuns.get(key);
        if (run) {
          run.state = input.state;
          run.evidenceManifest = input.evidenceManifest;
          run.completedAt = input.now;
          run.updatedAt = input.now;
        }
        if (input.state !== 'failed') {
          input.schedule.lastSuccessAt = input.now;
          if (input.synthesisId) input.schedule.lastSynthesisId = input.synthesisId;
          if (input.nextRunAt) input.schedule.nextRunAt = input.nextRunAt;
        }
      },
    };
    const learningProgressRepository = {
      findWritebackTarget: vi.fn(async () => ({
        deviceId: `dev_${'4'.repeat(32)}`,
        vaultBindingId: `vlt_${'5'.repeat(32)}`,
        vaultName: 'J-obsidian',
      })),
      createSynthesisDraft: vi.fn(async (input: CreateSynthesisWritebackDraftRecord) => {
        const draft = {
          ...input,
          draftKind: 'synthesis',
          revision: 1,
          status: 'generated',
          operation: 'createManagedNote',
          managedBlocks: [],
          createdAt: input.now,
          updatedAt: input.now,
        } as WritebackDraftRecord;
        createdDrafts.push(draft);
        return draft;
      }),
      findOrCreateSynthesisIndex: vi.fn(async (input) => ({
        id: input.id,
        ownerId: input.ownerId,
        scheduleId: input.scheduleId,
        vaultBindingId: input.vaultBindingId,
        relativePath: input.relativePath,
        status: 'active',
        managedBlocks: input.initialManagedBlocks,
        lastContentHash: 'b'.repeat(64),
        createdAt: input.now,
        updatedAt: input.now,
      })),
      findOpenDraftBySynthesisIndex: vi.fn(async () => null),
      createDraft: vi.fn(async (input) => {
        const draft = {
          ...input,
          revision: 1,
          status: 'generated',
          createdAt: input.now,
          updatedAt: input.now,
        } as WritebackDraftRecord;
        createdDrafts.push(draft);
        return draft;
      }),
      getDepositionPolicy: vi.fn(async () => ({
        ownerId: OWNER_ID,
        mode: 'managed-auto',
        managedAutoEnabled: true,
        allowCompanionUpdates: true,
        allowSynthesisIndexUpdates: true,
        allowExternalCards: false,
        updatedAt: now,
      })),
    } as unknown as LearningProgressRepository;
    const service = new SynthesisService({
      ownerId: OWNER_ID,
      repository,
      knowledgeSpaceEvidenceRepository: {
        listKnowledgeSnapshots: async () => [snapshot],
      },
      learningProgressRepository,
      approveWritebackDraft,
      now: () => now,
    });

    const schedule = await service.createSchedule({
      name: 'Daily trusted synthesis',
      period: 'daily',
      mode: 'combined',
      scope: {},
    });
    const first = await service.runDueSchedules();
    expect(first).toMatchObject({
      attempted: 1,
      succeeded: 1,
      skipped: 0,
      failed: 0,
      writebackDrafted: 2,
      synthesisIndexUpdatesQueued: 1,
      writebackFailed: 0,
    });
    expect(createdDrafts.map((draft) => draft.draftKind)).toEqual(['synthesis', 'synthesis-index']);
    expect(approveWritebackDraft).toHaveBeenCalledTimes(1);
    expect(storedRuns).toHaveLength(1);
    expect(storedRuns[0]).toMatchObject({ scheduleId: schedule.id, incremental: true });
    expect(storedRuns[0]?.evidenceManifest).toHaveLength(1);

    now = new Date('2026-07-24T08:00:00.000Z');
    const unchanged = await service.runDueSchedules();
    expect(unchanged).toMatchObject({
      attempted: 1,
      succeeded: 0,
      skipped: 1,
      failed: 0,
    });
    expect(storedRuns).toHaveLength(1);
  });

  it('refuses to synthesize when no verified snapshot matches', async () => {
    const { repository } = synthesisRepositoryFixture();
    const service = new SynthesisService({
      ownerId: OWNER_ID,
      repository,
      knowledgeSpaceEvidenceRepository: {
        listKnowledgeSnapshots: async () => [untrustedSnapshot()],
      },
      learningProgressRepository: {} as LearningProgressRepository,
    });

    await expect(service.generate({ mode: 'timeline' })).rejects.toMatchObject({
      code: 'conflict',
      status: 409,
    } satisfies Partial<SynthesisServiceError>);
  });
});
