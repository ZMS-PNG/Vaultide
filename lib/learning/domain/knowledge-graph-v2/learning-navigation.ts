import type {
  KnowledgeGraphV2,
  KnowledgeNodeV2,
} from './contracts';

export type KnowledgeLearningActionKind =
  | 'review'
  | 'weak'
  | 'prerequisite'
  | 'unknown'
  | 'updated';

export interface KnowledgeLearningRecommendation {
  node: KnowledgeNodeV2;
  kind: KnowledgeLearningActionKind;
  score: number;
  reason: string;
}

export interface KnowledgeLearningSummary {
  reviewDue: number;
  weak: number;
  unknown: number;
  updated: number;
}

const ACTIONABLE_TYPES = new Set<KnowledgeNodeV2['type']>([
  'concept',
  'skill',
  'review',
  'classroom',
  'claim',
  'original-note',
  'external-source',
]);

function isWeak(node: KnowledgeNodeV2): boolean {
  return (
    node.mastery !== null &&
    node.mastery < 0.7 &&
    node.masteryConfidence >= 0.25
  );
}

function isUnknown(node: KnowledgeNodeV2): boolean {
  return (
    node.mastery === null &&
    ACTIONABLE_TYPES.has(node.type) &&
    (node.evidenceCount > 0 || node.classroomIds.length > 0)
  );
}

export function summarizeKnowledgeLearning(
  graph: KnowledgeGraphV2,
): KnowledgeLearningSummary {
  return {
    reviewDue: graph.nodes.filter((node) => node.statusFlags.includes('review-due')).length,
    weak: graph.nodes.filter(isWeak).length,
    unknown: graph.nodes.filter(isUnknown).length,
    updated: graph.nodes.filter((node) => node.statusFlags.includes('source-updated')).length,
  };
}

export function buildKnowledgeLearningPlan(
  graph: KnowledgeGraphV2,
  limit = 8,
): KnowledgeLearningRecommendation[] {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const recommendations = new Map<string, KnowledgeLearningRecommendation>();

  const add = (
    node: KnowledgeNodeV2,
    kind: KnowledgeLearningActionKind,
    score: number,
    reason: string,
  ) => {
    const current = recommendations.get(node.id);
    if (!current || score > current.score) {
      recommendations.set(node.id, { node, kind, score, reason });
    }
  };

  for (const node of graph.nodes) {
    if (node.statusFlags.includes('review-due')) {
      add(node, 'review', 110 + (1 - (node.mastery ?? 0.5)) * 20, '复习已经到期，优先主动回忆并完成一次检验。');
    }
    if (isWeak(node)) {
      add(
        node,
        'weak',
        90 + (1 - (node.mastery ?? 0)) * 20,
        `当前掌握度 ${Math.round((node.mastery ?? 0) * 100)}%，建议从错因和关键例子重新学习。`,
      );
    }
    if (isUnknown(node)) {
      add(node, 'unknown', 65 + Math.min(node.evidenceCount, 10), '还没有足够的主动学习证据，先做一次理解检查。');
    }
    if (node.statusFlags.includes('source-updated')) {
      add(node, 'updated', 72, '来源已经更新，建议检查变化后再刷新现有理解。');
    }
  }

  for (const edge of graph.edges) {
    if (
      edge.type !== 'prerequisite' ||
      edge.status === 'candidate' ||
      edge.status === 'rejected'
    ) {
      continue;
    }
    const prerequisite = byId.get(edge.source);
    const target = byId.get(edge.target);
    if (!prerequisite || !target) continue;
    const targetNeedsLearning = target.mastery === null || target.mastery < 0.7;
    const prerequisiteNotSolid =
      prerequisite.mastery === null || prerequisite.mastery < 0.8;
    if (targetNeedsLearning && prerequisiteNotSolid) {
      add(
        prerequisite,
        'prerequisite',
        100 + edge.confidence * 5,
        `它是“${target.label}”的先修知识，先补齐可减少后续学习阻力。`,
      );
    }
  }

  return [...recommendations.values()]
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.node.evidenceCount - left.node.evidenceCount ||
        left.node.label.localeCompare(right.node.label),
    )
    .slice(0, Math.max(1, limit));
}
