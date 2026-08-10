import { describe, expect, it } from 'vitest';
import { evaluateSynthesisFreshness } from '@/lib/learning/domain/synthesis-freshness';
import type { SynthesisFilterOptions, SynthesisRunView } from '@/lib/learning/domain/synthesis';

const filters: SynthesisFilterOptions = {
  projects: [
    {
      projectId: 'project-a',
      projectName: 'Project A',
      classroomCount: 2,
      latestActivityAt: '2026-07-24T10:00:00.000Z',
    },
  ],
  classrooms: [
    {
      classroomId: 'classroom-a',
      projectId: 'project-a',
      projectName: 'Project A',
      title: 'Classroom A',
      createdAt: '2026-07-20T10:00:00.000Z',
      domain: 'software',
      sourceType: 'obsidian',
      topicTags: ['project'],
    },
    {
      classroomId: 'classroom-b',
      projectId: 'project-a',
      projectName: 'Project A',
      title: 'Classroom B',
      createdAt: '2026-07-24T10:00:00.000Z',
      domain: 'software',
      sourceType: 'hybrid',
      topicTags: ['project'],
    },
  ],
  domains: ['software'],
  topicTags: ['project'],
  sourceTypes: ['obsidian', 'hybrid'],
};

const synthesis = {
  id: 'synthesis-a',
  mode: 'combined',
  title: 'Project synthesis',
  classroomCount: 1,
  nodeCount: 5,
  edgeCount: 4,
  createdAt: '2026-07-21T10:00:00.000Z',
  updatedAt: '2026-07-21T10:00:00.000Z',
  incremental: false,
  scope: { projectIds: ['project-a'] },
  summaryMarkdown: '# Summary',
  graph: {
    schemaVersion: 'knowledge-graph/1',
    dimensions: { x: 'time', y: 'domain', z: 'mastery' },
    domains: [],
    nodes: [],
    edges: [],
  },
  graphHash: 'hash',
  evidenceManifest: [
    {
      classroomId: 'classroom-a',
      activityAt: '2026-07-20T10:00:00.000Z',
      fingerprint: 'fingerprint',
    },
  ],
  taskCandidates: [],
} as SynthesisRunView;

describe('synthesis freshness', () => {
  it('flags new classrooms and later project activity', () => {
    const result = evaluateSynthesisFreshness({
      synthesis,
      filters,
      isLatest: true,
      now: new Date('2026-07-25T10:00:00.000Z'),
    });

    expect(result.status).toBe('stale');
    expect(result.newClassroomCount).toBe(1);
    expect(result.changedProjectCount).toBe(1);
    expect(result.coveredClassroomCount).toBe(1);
    expect(result.scopedClassroomCount).toBe(2);
  });

  it('marks an older selected snapshot as historical', () => {
    const result = evaluateSynthesisFreshness({
      synthesis,
      filters,
      isLatest: false,
      now: new Date('2026-07-25T10:00:00.000Z'),
    });

    expect(result.status).toBe('historical');
  });

  it('uses trusted graph provenance for legacy manifests that stored snapshot ids', () => {
    const legacy = {
      ...synthesis,
      scope: { classroomIds: ['classroom-a'] },
      createdAt: '2026-07-25T09:00:00.000Z',
      updatedAt: '2026-07-25T09:00:00.000Z',
      evidenceManifest: [
        {
          classroomId: `ksn_${'1'.repeat(32)}`,
          activityAt: '2026-07-25T08:00:00.000Z',
          fingerprint: 'legacy-fingerprint',
        },
      ],
      graph: {
        schemaVersion: 'trusted-knowledge-space/1',
        nodes: [
          {
            classroomId: 'classroom-a',
            classroomIds: ['classroom-a'],
          },
        ],
        edges: [],
        evidence: [],
      },
    } as unknown as SynthesisRunView;

    const result = evaluateSynthesisFreshness({
      synthesis: legacy,
      filters,
      isLatest: true,
      now: new Date('2026-07-25T10:00:00.000Z'),
    });

    expect(result.status).toBe('fresh');
    expect(result.coveredClassroomCount).toBe(1);
    expect(result.scopedClassroomCount).toBe(1);
    expect(result.newClassroomCount).toBe(0);
  });
});
