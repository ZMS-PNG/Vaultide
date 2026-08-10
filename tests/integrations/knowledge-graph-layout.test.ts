import { describe, expect, it } from 'vitest';
import { layoutKnowledgeGraph } from '@/components/learning/knowledge-graph-v2/knowledge-graph-layout';

describe('knowledge graph client layout', () => {
  it('is deterministic and remains linear enough for a 2,000-node LOD fixture', () => {
    const nodes = Array.from({ length: 2000 }, (_, index) => ({
      id: `concept:${index.toString().padStart(4, '0')}`,
      coordinates: {
        x: (index % 101) / 50 - 1,
        y: (index % 19) / 9 - 1,
        z: (index % 11) / 5 - 1,
      },
    }));
    const edges = Array.from({ length: 4000 }, (_, index) => ({
      source: nodes[index % nodes.length]!.id,
      target: nodes[(index * 17 + 31) % nodes.length]!.id,
    }));
    const startedAt = performance.now();
    const first = layoutKnowledgeGraph(nodes, edges);
    const elapsed = performance.now() - startedAt;
    const second = layoutKnowledgeGraph(nodes, edges);

    expect(first).toEqual(second);
    expect(first).toHaveLength(2000);
    expect(first.every((item) => Number.isFinite(item.x + item.y + item.z))).toBe(true);
    expect(elapsed).toBeLessThan(500);
  });
});
