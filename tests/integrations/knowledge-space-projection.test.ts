import { describe, expect, it } from 'vitest';
import type {
  KnowledgeEdgeV2,
  KnowledgeGraphV2,
  KnowledgeNodeV2,
} from '@/lib/learning/domain/knowledge-graph-v2/contracts';
import {
  projectKnowledgeSpace,
  recommendKnowledgeSpaceLens,
} from '@/lib/learning/domain/knowledge-graph-v2/knowledge-space';

function node(
  id: string,
  type: KnowledgeNodeV2['type'],
  domain: string,
  overrides: Partial<KnowledgeNodeV2> = {},
): KnowledgeNodeV2 {
  return {
    id,
    canonicalId: id,
    label: id,
    type,
    domainIds: [domain],
    projectIds: ['project-a'],
    sourceVersionIds: [],
    classroomIds: [],
    timestamp: '2026-07-24T00:00:00.000Z',
    mastery: null,
    masteryConfidence: 0,
    evidenceCount: 0,
    evidenceRefs: [],
    coordinates: { x: 0, y: 0, z: 0 },
    writable: false,
    statusFlags: ['unknown-mastery'],
    confidence: 0.8,
    projectorVersion: 'test',
    ...overrides,
  };
}

function edge(source: string, target: string): KnowledgeEdgeV2 {
  return {
    id: `edge:${source}:${target}`,
    source,
    target,
    type: 'prerequisite',
    directed: true,
    weight: 1,
    confidence: 1,
    evidenceRefs: [],
    origin: 'deterministic',
    generatorVersion: 'test',
    status: 'active',
  };
}

function fixture(): KnowledgeGraphV2 {
  const nodes = [
    node('source-a', 'original-note', 'domain-a', {
      evidenceCount: 1,
      statusFlags: ['unknown-mastery', 'read-only'],
    }),
    node('classroom-a', 'classroom', 'domain-a', {
      evidenceCount: 2,
      classroomIds: ['classroom-a'],
    }),
    node('concept-a', 'concept', 'domain-a', {
      mastery: 0.45,
      masteryConfidence: 0.8,
      evidenceCount: 3,
      statusFlags: [],
    }),
    node('skill-a', 'skill', 'domain-a', {
      mastery: 0.72,
      masteryConfidence: 0.9,
      evidenceCount: 5,
      statusFlags: [],
    }),
    node('review-a', 'review', 'domain-a', {
      mastery: 0.6,
      masteryConfidence: 0.9,
      evidenceCount: 4,
      statusFlags: ['review-due'],
    }),
    node('source-b', 'external-source', 'domain-b', {
      projectIds: [],
      timestamp: '2026-07-25T00:00:00.000Z',
    }),
  ];
  return {
    schemaVersion: 'knowledge-graph/2',
    projectionId: 'projection',
    sourceSynthesisId: 'synthesis',
    scopeHash: 'scope',
    generatedAt: '2026-07-24T00:00:00.000Z',
    projectorVersion: 'test',
    layoutVersion: 'test',
    nodes,
    edges: [
      edge('source-a', 'classroom-a'),
      edge('classroom-a', 'concept-a'),
      edge('concept-a', 'skill-a'),
      edge('skill-a', 'review-a'),
    ],
    evidence: [],
    clusters: [
      {
        id: 'cluster:domain-a',
        label: '软件与人工智能',
        kind: 'domain',
        nodeIds: nodes.filter((item) => item.domainIds.includes('domain-a')).map((item) => item.id),
        coordinates: { x: 0, y: 0, z: 0 },
      },
      {
        id: 'cluster:domain-b',
        label: '学习与认知',
        kind: 'domain',
        nodeIds: ['source-b'],
        coordinates: { x: 0, y: 0, z: 0 },
      },
    ],
    statistics: {
      nodeCount: nodes.length,
      edgeCount: 4,
      conceptCount: 1,
      evidenceCount: 0,
      unknownMasteryCount: 3,
      inferredEdgeCount: 0,
      candidateEdgeCount: 0,
      nodeCountsByType: {},
      edgeCountsByType: {},
    },
  };
}

describe('recommendKnowledgeSpaceLens', () => {
  it('turns a synthesis question into a useful default lens', () => {
    expect(recommendKnowledgeSpaceLens('这些技术在过去三年如何演化？')).toBe('time');
    expect(recommendKnowledgeSpaceLens('哪些论文证据相互冲突？')).toBe('source');
    expect(recommendKnowledgeSpaceLens('不同项目板块之间有什么关联？')).toBe('domain');
    expect(recommendKnowledgeSpaceLens('我下一步应该怎样学习？')).toBe('logic');
  });

  it('prioritizes comparison intent over a generic recency cue', () => {
    expect(recommendKnowledgeSpaceLens('学习最新的智能体记忆架构，比较主流方案')).toBe('domain');
  });
});

describe('multi-dimensional knowledge space', () => {
  it('creates ordered, discrete logic-stage clusters across domains', () => {
    const projection = projectKnowledgeSpace(fixture(), 'logic');
    const positions = new Map(projection.graph.nodes.map((item) => [item.id, item.coordinates]));

    expect(positions.get('source-a')!.x).toBeLessThan(positions.get('classroom-a')!.x);
    expect(positions.get('classroom-a')!.x).toBeLessThan(positions.get('concept-a')!.x);
    expect(positions.get('concept-a')!.x).toBeLessThan(positions.get('skill-a')!.x);
    expect(positions.get('skill-a')!.x).toBeLessThan(positions.get('review-a')!.x);
    expect(positions.get('source-a')!.y).toBe(positions.get('concept-a')!.y);
    expect(positions.get('source-a')!.y).not.toBe(positions.get('source-b')!.y);
    expect(projection.clusters.map((cluster) => cluster.label)).toEqual(
      expect.arrayContaining([
        '软件与人工智能 · 来源基础',
        '软件与人工智能 · 概念建构',
        '软件与人工智能 · 应用迁移',
        '软件与人工智能 · 复习巩固',
      ]),
    );
  });

  it('aggregates source transformation stages with learning evidence statistics', () => {
    const projection = projectKnowledgeSpace(fixture(), 'source');
    const reviewCluster = projection.clusters.find((cluster) =>
      cluster.label.startsWith('复习巩固｜'),
    );
    const conceptCluster = projection.clusters.find((cluster) =>
      cluster.label.startsWith('概念建构｜'),
    );

    expect(projection.clusters.map((cluster) => cluster.label)).toEqual([
      '原始来源｜软件与人工智能',
      '课堂理解｜软件与人工智能',
      '概念建构｜软件与人工智能',
      '应用沉淀｜软件与人工智能',
      '复习巩固｜软件与人工智能',
    ]);
    expect(reviewCluster).toMatchObject({
      nodeCount: 1,
      evidenceCount: 4,
      reviewDueCount: 1,
      unknownCount: 0,
      actionKind: 'review',
    });
    expect(reviewCluster?.nextAction).toContain('闭卷回忆');
    expect(conceptCluster?.averageMastery).toBeCloseTo(0.45);
    expect(conceptCluster).toMatchObject({
      weakCount: 1,
      actionKind: 'reinforce',
    });
  });

  it('is deterministic and creates daily time slices for a short learning range', () => {
    const graph = fixture();
    const first = projectKnowledgeSpace(graph, 'time');
    const second = projectKnowledgeSpace(graph, 'time');

    expect(first).toEqual(second);
    expect(first.clusters.map((cluster) => cluster.label)).toEqual([
      '2026-07-24｜软件与人工智能',
      '2026-07-25｜学习与认知',
    ]);
  });
});
