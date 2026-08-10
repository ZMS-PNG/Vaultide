import { describe, expect, it } from 'vitest';
import {
  diffSynthesisGraphs,
  hasSynthesisEvidenceChanges,
  nextSynthesisScheduleRunAt,
  synthesisEvidenceManifest,
  synthesisScopeHash,
  synthesisTaskCandidates,
} from '@/lib/learning/domain/synthesis-schedule';
import {
  renderSynthesisIndex,
  synthesisIndexDraftBlocks,
} from '@/lib/learning/domain/synthesis-index';
import type { SynthesisIndexDocumentRecord } from '@/lib/learning/domain/synthesis-index';
import type {
  KnowledgeGraph,
  SynthesisClassroomInput,
  SynthesisRunRecord,
  SynthesisScheduleRecord,
} from '@/lib/learning/domain/synthesis';

function graph(input: Partial<KnowledgeGraph> = {}): KnowledgeGraph {
  return {
    schemaVersion: 'knowledge-graph/1',
    dimensions: { x: 'time', y: 'domain', z: 'mastery' },
    domains: ['engineering'],
    nodes: [],
    edges: [],
    ...input,
  };
}

function classroom(overrides: Partial<SynthesisClassroomInput> = {}): SynthesisClassroomInput {
  return {
    classroomId: 'course_a',
    goal: 'Understand the topic',
    createdAt: new Date('2026-07-01T08:00:00.000Z'),
    updatedAt: new Date('2026-07-02T08:00:00.000Z'),
    activeLearningEventCount: 2,
    practicePayloads: [],
    researchSources: [],
    title: 'TypeScript course',
    scenes: [{ id: 'scene_1', title: 'Basics', order: 1, type: 'slide' }],
    obsidianSources: [{ title: 'Original note', tags: ['typescript'] }],
    ...overrides,
  };
}

describe('synthesis schedule domain', () => {
  it('keeps scope identity stable and honors calendar boundaries', () => {
    const left = synthesisScopeHash('combined', {
      topicTags: ['typescript', 'architecture'],
      projectIds: [`prj_${'1'.repeat(32)}`, `prj_${'2'.repeat(32)}`],
    });
    const right = synthesisScopeHash('combined', {
      projectIds: [`prj_${'2'.repeat(32)}`, `prj_${'1'.repeat(32)}`],
      topicTags: ['architecture', 'typescript'],
    });
    expect(left).toBe(right);

    const anchor = new Date('2026-01-31T09:30:00.000Z');
    expect(nextSynthesisScheduleRunAt(anchor, 'daily').toISOString()).toBe(
      '2026-02-01T09:30:00.000Z',
    );
    expect(nextSynthesisScheduleRunAt(anchor, 'weekly').toISOString()).toBe(
      '2026-02-07T09:30:00.000Z',
    );
    expect(nextSynthesisScheduleRunAt(anchor, 'monthly').toISOString()).toBe(
      '2026-02-28T09:30:00.000Z',
    );
    expect(nextSynthesisScheduleRunAt(anchor, 'custom', 90).toISOString()).toBe(
      '2026-01-31T11:00:00.000Z',
    );
  });

  it('fingerprints only durable authorized evidence and detects meaningful changes', () => {
    const baseline = synthesisEvidenceManifest([classroom()]);
    const same = synthesisEvidenceManifest([classroom()]);
    const changed = synthesisEvidenceManifest([classroom({ activeLearningEventCount: 3 })]);
    expect(same).toEqual(baseline);
    expect(changed[0]?.fingerprint).not.toBe(baseline[0]?.fingerprint);
  });

  it('returns an explainable graph delta without inventing conflicts', () => {
    const baseline = graph({
      nodes: [
        {
          id: 'classroom:course_a',
          label: 'Course A',
          type: 'classroom',
          classroomId: 'course_a',
          domain: 'engineering',
          timestamp: '2026-07-01T00:00:00.000Z',
          mastery: 0.3,
          x: 0,
          y: 0,
          z: 0.3,
        },
        {
          id: 'concept:removed',
          label: 'Removed concept',
          type: 'concept',
          domain: 'engineering',
          timestamp: '2026-07-01T00:00:00.000Z',
          mastery: null,
          x: 0,
          y: 0,
          z: 0,
        },
      ],
      edges: [],
    });
    const current = graph({
      nodes: [
        {
          id: 'classroom:course_a',
          label: 'Course A',
          type: 'classroom',
          classroomId: 'course_a',
          domain: 'engineering',
          timestamp: '2026-07-02T00:00:00.000Z',
          mastery: 0.62,
          x: 1,
          y: 0,
          z: 0.62,
        },
        {
          id: 'concept:new',
          label: 'New concept',
          type: 'concept',
          domain: 'engineering',
          timestamp: '2026-07-02T00:00:00.000Z',
          mastery: null,
          x: 1,
          y: 1,
          z: 0,
        },
      ],
      edges: [
        {
          id: 'related:course-a:new',
          source: 'classroom:course_a',
          target: 'concept:new',
          type: 'related',
          weight: 0.6,
          label: 'Course A relates to new concept',
        },
      ],
    });
    const delta = diffSynthesisGraphs({
      current,
      baseline,
      baselineSynthesisId: `syn_${'1'.repeat(32)}`,
      currentEvidence: [
        { classroomId: 'course_a', activityAt: '2026-07-02T00:00:00.000Z', fingerprint: 'new' },
        { classroomId: 'course_b', activityAt: '2026-07-02T00:00:00.000Z', fingerprint: 'b' },
      ],
      baselineEvidence: [
        { classroomId: 'course_a', activityAt: '2026-07-01T00:00:00.000Z', fingerprint: 'old' },
        { classroomId: 'course_c', activityAt: '2026-07-01T00:00:00.000Z', fingerprint: 'c' },
      ],
    });

    expect(delta).toMatchObject({
      baselineSynthesisId: `syn_${'1'.repeat(32)}`,
      addedClassroomIds: ['course_b'],
      updatedClassroomIds: ['course_a'],
      removedClassroomIds: ['course_c'],
      addedNodeIds: ['concept:new'],
      removedNodeIds: ['concept:removed'],
      strengthened: [{ nodeId: 'classroom:course_a', from: 0.3, to: 0.62 }],
      relationChanges: [{ edgeId: 'related:course-a:new', kind: 'added' }],
      conflicts: [],
    });
    expect(hasSynthesisEvidenceChanges(delta)).toBe(true);
  });

  it('aggregates multiple snapshot revisions into one classroom change', () => {
    const delta = diffSynthesisGraphs({
      current: graph(),
      baseline: graph(),
      currentEvidence: [
        {
          classroomId: 'course_a',
          snapshotId: 'snapshot_1',
          activityAt: '2026-07-02T00:00:00.000Z',
          fingerprint: 'revision_1',
        },
        {
          classroomId: 'course_a',
          snapshotId: 'snapshot_2',
          activityAt: '2026-07-03T00:00:00.000Z',
          fingerprint: 'revision_2',
        },
      ],
      baselineEvidence: [
        {
          classroomId: 'course_a',
          snapshotId: 'snapshot_1',
          activityAt: '2026-07-02T00:00:00.000Z',
          fingerprint: 'revision_1',
        },
      ],
    });

    expect(delta.addedClassroomIds).toEqual([]);
    expect(delta.updatedClassroomIds).toEqual(['course_a']);
    expect(delta.removedClassroomIds).toEqual([]);
  });

  it('offers review and transfer work as candidates only', () => {
    const candidates = synthesisTaskCandidates(
      graph({
        nodes: [
          {
            id: 'classroom:course_a',
            label: 'Course A',
            type: 'classroom',
            classroomId: 'course_a',
            domain: 'engineering',
            timestamp: '2026-07-02T00:00:00.000Z',
            mastery: 0.2,
            x: 0,
            y: 0,
            z: 0.2,
          },
          {
            id: 'concept:target',
            label: 'Target concept',
            type: 'concept',
            domain: 'engineering',
            timestamp: '2026-07-02T00:00:00.000Z',
            mastery: null,
            x: 0,
            y: 1,
            z: 0,
          },
        ],
        edges: [
          {
            id: 'related:course-a:target',
            source: 'classroom:course_a',
            target: 'concept:target',
            type: 'related',
            weight: 0.7,
          },
        ],
      }),
    );
    expect(candidates.map((candidate) => candidate.kind)).toEqual(['review', 'transfer']);
    expect(candidates.every((candidate) => candidate.id.length > 0)).toBe(true);
  });

  it('keeps periodic snapshots immutable while giving a schedule one mutable index', () => {
    const now = new Date('2026-07-23T08:00:00.000Z');
    const schedule: SynthesisScheduleRecord = {
      id: `sch_${'1'.repeat(32)}`,
      ownerId: `own_${'2'.repeat(32)}`,
      name: '每周工程学习归纳',
      period: 'weekly',
      timezone: 'Asia/Shanghai',
      mode: 'combined',
      scope: { domain: '工程' },
      scopeHash: 'a'.repeat(64),
      status: 'active',
      nextRunAt: now,
      createdAt: now,
      updatedAt: now,
    };
    const snapshots: SynthesisRunRecord[] = [
      {
        id: `syn_${'3'.repeat(32)}`,
        ownerId: schedule.ownerId,
        scheduleId: schedule.id,
        mode: 'combined',
        title: '本周归纳快照',
        scope: schedule.scope,
        summaryMarkdown: '# 不可变快照',
        graph: graph(),
        graphHash: 'b'.repeat(64),
        classroomCount: 1,
        incremental: true,
        evidenceManifest: [],
        delta: {
          schemaVersion: 'synthesis-delta/1',
          addedClassroomIds: ['course_a'],
          updatedClassroomIds: [],
          removedClassroomIds: [],
          addedNodeIds: [],
          removedNodeIds: [],
          addedEdgeIds: [],
          removedEdgeIds: [],
          strengthened: [],
          weakened: [],
          relationChanges: [],
          conflicts: [],
        },
        taskCandidates: [],
        createdAt: now,
        updatedAt: now,
      },
    ];
    const indexId = `sdx_${'4'.repeat(32)}`;
    const rendered = renderSynthesisIndex({ synthesisIndexId: indexId, schedule, snapshots, now });
    expect(rendered.relativePath).toMatch(/^Vaultide\/归纳\/周期\/索引\//);
    expect(rendered.content).toContain('## 不可变快照');
    expect(rendered.content).toContain('## 我的补充');
    expect(rendered.content).toContain(snapshots[0].id);
    expect(rendered.frontmatter).toMatchObject({
      maic_synthesis_index_id: indexId,
      maic_synthesis_schedule_id: schedule.id,
      maic_managed: true,
    });

    const initialDocument: SynthesisIndexDocumentRecord = {
      id: indexId,
      ownerId: schedule.ownerId,
      scheduleId: schedule.id,
      vaultBindingId: `vlt_${'5'.repeat(32)}`,
      relativePath: rendered.relativePath,
      status: 'active',
      managedBlocks: rendered.managedBlocks,
      createdAt: now,
      updatedAt: now,
    };
    expect(synthesisIndexDraftBlocks(rendered.managedBlocks, initialDocument)).toEqual(
      rendered.managedBlocks,
    );

    const persistedDocument = {
      ...initialDocument,
      lastContentHash: 'c'.repeat(64),
    };
    const update = synthesisIndexDraftBlocks(rendered.managedBlocks, persistedDocument);
    expect(update).toHaveLength(rendered.managedBlocks.length);
    expect(update.every((block) => block.expectedHash === block.contentHash)).toBe(true);
  });
});
