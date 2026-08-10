import { describe, expect, it } from 'vitest';
import type { KnowledgeEdgeV2 } from '@/lib/learning/domain/knowledge-graph-v2/contracts';
import { describeKnowledgeRelation } from '@/lib/learning/domain/knowledge-graph-v2/relation-semantics';

function relation(overrides: Partial<KnowledgeEdgeV2> = {}): KnowledgeEdgeV2 {
  return {
    id: 'relation-1',
    source: 'source',
    target: 'target',
    type: 'supports',
    directed: true,
    weight: 0.8,
    confidence: 0.86,
    evidenceRefs: ['evidence-1'],
    origin: 'embedding',
    generatorVersion: 'test',
    status: 'active',
    ...overrides,
  };
}

describe('knowledge relation semantics', () => {
  it('explains a relation in learning language without treating confidence as truth', () => {
    const result = describeKnowledgeRelation(relation());

    expect(result).toMatchObject({
      typeLabel: '支持',
      statusLabel: '系统关系',
      originLabel: '语义相似性',
      confidencePercent: 86,
      evidenceCount: 1,
    });
    expect(result.headline).toContain('依据较强');
    expect(result.caution).toContain('不代表节点内容本身的事实正确率');
  });

  it('marks evidence-free candidates as needing verification', () => {
    const result = describeKnowledgeRelation(
      relation({
        type: 'contradicts',
        status: 'candidate',
        evidenceRefs: [],
        confidence: 0.92,
        origin: 'llm',
      }),
    );

    expect(result.typeLabel).toBe('存在矛盾');
    expect(result.statusLabel).toBe('待核验');
    expect(result.headline).toContain('人工核验');
  });

  it('does not present rejected relations as usable evidence', () => {
    const result = describeKnowledgeRelation(relation({ status: 'rejected' }));

    expect(result.headline).toContain('不应作为学习依据');
  });
});
