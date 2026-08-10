import { describe, expect, it } from 'vitest';
import type {
  KnowledgeEdgeV2,
  KnowledgeGraphV2,
  KnowledgeNodeV2,
} from '@/lib/learning/domain/knowledge-graph-v2/contracts';
import {
  buildKnowledgeLearningPlan,
  summarizeKnowledgeLearning,
} from '@/lib/learning/domain/knowledge-graph-v2/learning-navigation';

function node(
  id: string,
  overrides: Partial<KnowledgeNodeV2> = {},
): KnowledgeNodeV2 {
  return {
    id,
    canonicalId: id,
    label: id,
    type: 'concept',
    domainIds: [],
    projectIds: [],
    sourceVersionIds: [],
    classroomIds: ['course-a'],
    mastery: null,
    masteryConfidence: 0.6,
    evidenceCount: 2,
    evidenceRefs: [],
    coordinates: { x: 0, y: 0, z: 0 },
    writable: false,
    statusFlags: ['unknown-mastery'],
    confidence: 1,
    projectorVersion: 'test',
    ...overrides,
  };
}

function edge(
  source: string,
  target: string,
  type: KnowledgeEdgeV2['type'],
): KnowledgeEdgeV2 {
  return {
    id: `${type}:${source}:${target}`,
    source,
    target,
    type,
    directed: true,
    weight: 1,
    confidence: 0.9,
    evidenceRefs: [],
    origin: 'deterministic',
    generatorVersion: 'test',
    status: 'active',
  };
}

function graph(nodes: KnowledgeNodeV2[], edges: KnowledgeEdgeV2[] = []): KnowledgeGraphV2 {
  return {
    schemaVersion: 'knowledge-graph/2',
    projectionId: 'projection',
    sourceSynthesisId: 'synthesis',
    scopeHash: 'scope',
    generatedAt: '2026-07-24T00:00:00.000Z',
    projectorVersion: 'test',
    layoutVersion: 'test',
    nodes,
    edges,
    evidence: [],
    clusters: [],
    statistics: {
      nodeCount: nodes.length,
      edgeCount: edges.length,
      conceptCount: nodes.filter((item) => item.type === 'concept').length,
      evidenceCount: 0,
      unknownMasteryCount: 0,
      inferredEdgeCount: 0,
      candidateEdgeCount: 0,
      nodeCountsByType: {},
      edgeCountsByType: {},
    },
  };
}

describe('knowledge learning navigation', () => {
  it('prioritizes due reviews, prerequisites and weak concepts over unknown mastery', () => {
    const due = node('due', {
      mastery: 0.55,
      statusFlags: ['review-due'],
    });
    const prerequisite = node('prerequisite', {
      mastery: 0.76,
      statusFlags: [],
    });
    const target = node('target', {
      mastery: 0.45,
      statusFlags: [],
    });
    const unknown = node('unknown');
    const plan = buildKnowledgeLearningPlan(
      graph(
        [due, prerequisite, target, unknown],
        [edge(prerequisite.id, target.id, 'prerequisite')],
      ),
    );

    expect(plan[0]?.node.id).toBe('due');
    expect(plan.find((item) => item.node.id === 'prerequisite')).toMatchObject({
      kind: 'prerequisite',
    });
    expect(plan.findIndex((item) => item.node.id === 'target')).toBeLessThan(
      plan.findIndex((item) => item.node.id === 'unknown'),
    );
  });

  it('keeps unknown mastery distinct and counts source updates', () => {
    const updated = node('updated-source', {
      type: 'original-note',
      statusFlags: ['unknown-mastery', 'source-updated', 'read-only'],
    });
    const weak = node('weak', {
      mastery: 0.4,
      masteryConfidence: 0.8,
      statusFlags: [],
    });
    const summary = summarizeKnowledgeLearning(graph([updated, weak]));

    expect(summary).toEqual({
      reviewDue: 0,
      weak: 1,
      unknown: 1,
      updated: 1,
    });
    expect(buildKnowledgeLearningPlan(graph([updated, weak]))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ node: expect.objectContaining({ id: 'updated-source' }) }),
        expect.objectContaining({ node: expect.objectContaining({ id: 'weak' }), kind: 'weak' }),
      ]),
    );
  });
});
