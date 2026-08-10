import type { KnowledgeGraphV2 } from './contracts';

export interface KnowledgeGraphDiffV2 {
  fromProjectionId: string;
  toProjectionId: string;
  addedNodeIds: string[];
  removedNodeIds: string[];
  addedEdgeIds: string[];
  removedEdgeIds: string[];
  masteryChanges: Array<{
    nodeId: string;
    from: number | null;
    to: number | null;
    confidenceFrom: number;
    confidenceTo: number;
  }>;
  relationStatusChanges: Array<{ edgeId: string; from: string; to: string }>;
}

export function diffKnowledgeGraphs(
  from: KnowledgeGraphV2,
  to: KnowledgeGraphV2,
): KnowledgeGraphDiffV2 {
  const fromNodes = new Map(from.nodes.map((node) => [node.id, node]));
  const toNodes = new Map(to.nodes.map((node) => [node.id, node]));
  const fromEdges = new Map(from.edges.map((edge) => [edge.id, edge]));
  const toEdges = new Map(to.edges.map((edge) => [edge.id, edge]));
  const sharedNodeIds = [...fromNodes.keys()].filter((id) => toNodes.has(id)).sort();
  return {
    fromProjectionId: from.projectionId,
    toProjectionId: to.projectionId,
    addedNodeIds: [...toNodes.keys()].filter((id) => !fromNodes.has(id)).sort(),
    removedNodeIds: [...fromNodes.keys()].filter((id) => !toNodes.has(id)).sort(),
    addedEdgeIds: [...toEdges.keys()].filter((id) => !fromEdges.has(id)).sort(),
    removedEdgeIds: [...fromEdges.keys()].filter((id) => !toEdges.has(id)).sort(),
    masteryChanges: sharedNodeIds
      .map((nodeId) => {
        const before = fromNodes.get(nodeId);
        const after = toNodes.get(nodeId);
        if (!before || !after) return undefined;
        if (
          before.mastery === after.mastery &&
          before.masteryConfidence === after.masteryConfidence
        ) {
          return undefined;
        }
        return {
          nodeId,
          from: before.mastery,
          to: after.mastery,
          confidenceFrom: before.masteryConfidence,
          confidenceTo: after.masteryConfidence,
        };
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item)),
    relationStatusChanges: [...fromEdges.entries()]
      .map(([edgeId, before]) => {
        const after = toEdges.get(edgeId);
        return after && after.status !== before.status
          ? { edgeId, from: before.status, to: after.status }
          : undefined;
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
      .sort((left, right) => left.edgeId.localeCompare(right.edgeId)),
  };
}
