import type {
  KnowledgeEdgeV2,
  KnowledgeGraphNeighborhood,
  KnowledgeGraphPath,
  KnowledgeGraphProjectionQuery,
  KnowledgeGraphV2,
  KnowledgeNodeV2,
} from './contracts';

function intersects(left: readonly string[], right: ReadonlySet<string>): boolean {
  return left.some((item) => right.has(item));
}

export function filterKnowledgeGraph(
  graph: KnowledgeGraphV2,
  query: KnowledgeGraphProjectionQuery,
): KnowledgeGraphV2 {
  const nodeTypes = query.nodeTypes?.length ? new Set(query.nodeTypes) : undefined;
  const edgeTypes = query.edgeTypes?.length ? new Set(query.edgeTypes) : undefined;
  const projectIds = query.projectIds?.length ? new Set(query.projectIds) : undefined;
  const from = query.timeFrom ? Date.parse(query.timeFrom) : Number.NEGATIVE_INFINITY;
  const to = query.timeTo ? Date.parse(query.timeTo) : Number.POSITIVE_INFINITY;
  const minimum = Math.max(0, Math.min(1, query.minConfidence ?? 0));

  let nodes = graph.nodes.filter((node) => {
    if (nodeTypes && !nodeTypes.has(node.type)) return false;
    if (projectIds && !intersects(node.projectIds, projectIds)) return false;
    if (node.confidence < minimum) return false;
    if (node.timestamp) {
      const timestamp = Date.parse(node.timestamp);
      if (Number.isFinite(timestamp) && (timestamp < from || timestamp > to)) return false;
    }
    return true;
  });

  const lod = query.lod ?? 0;
  if (lod > 0) {
    const alwaysVisible = new Set(['project', 'classroom', 'review']);
    const limit = lod === 1 ? 1000 : 300;
    nodes = [...nodes]
      .sort(
        (left, right) =>
          Number(alwaysVisible.has(right.type)) - Number(alwaysVisible.has(left.type)) ||
          right.evidenceCount - left.evidenceCount ||
          right.confidence - left.confidence ||
          left.id.localeCompare(right.id),
      )
      .slice(0, limit);
  }

  const visible = new Set(nodes.map((node) => node.id));
  const edges = graph.edges.filter((edge) => {
    if (!visible.has(edge.source) || !visible.has(edge.target)) return false;
    if (edgeTypes && !edgeTypes.has(edge.type)) return false;
    if (edge.confidence < minimum) return false;
    if (!query.includeCandidates && edge.status === 'candidate') return false;
    return edge.status !== 'rejected';
  });
  const evidenceIds = new Set([
    ...nodes.flatMap((node) => node.evidenceRefs),
    ...edges.flatMap((edge) => edge.evidenceRefs),
  ]);
  return {
    ...graph,
    nodes,
    edges,
    evidence: graph.evidence.filter((item) => evidenceIds.has(item.id)),
    clusters: graph.clusters
      .map((cluster) => ({ ...cluster, nodeIds: cluster.nodeIds.filter((id) => visible.has(id)) }))
      .filter((cluster) => cluster.nodeIds.length > 0),
    statistics: {
      ...graph.statistics,
      nodeCount: nodes.length,
      edgeCount: edges.length,
    },
  };
}

function adjacency(edges: readonly KnowledgeEdgeV2[]): Map<string, KnowledgeEdgeV2[]> {
  const map = new Map<string, KnowledgeEdgeV2[]>();
  for (const edge of edges) {
    map.set(edge.source, [...(map.get(edge.source) ?? []), edge]);
    map.set(edge.target, [...(map.get(edge.target) ?? []), edge]);
  }
  return map;
}

export function graphNeighborhood(
  graph: KnowledgeGraphV2,
  rootNodeId: string,
  depth: 1 | 2,
): KnowledgeGraphNeighborhood {
  const byNode = new Map(graph.nodes.map((node) => [node.id, node]));
  if (!byNode.has(rootNodeId)) {
    return { projectionId: graph.projectionId, rootNodeId, depth, nodes: [], edges: [] };
  }
  const adjacent = adjacency(graph.edges);
  const visible = new Set([rootNodeId]);
  let frontier = new Set([rootNodeId]);
  for (let level = 0; level < depth; level += 1) {
    const next = new Set<string>();
    for (const id of frontier) {
      for (const edge of adjacent.get(id) ?? []) {
        const neighbor = edge.source === id ? edge.target : edge.source;
        if (!visible.has(neighbor)) next.add(neighbor);
        visible.add(neighbor);
      }
    }
    frontier = next;
  }
  return {
    projectionId: graph.projectionId,
    rootNodeId,
    depth,
    nodes: graph.nodes.filter((node) => visible.has(node.id)),
    edges: graph.edges.filter((edge) => visible.has(edge.source) && visible.has(edge.target)),
  };
}

export function shortestKnowledgePath(
  graph: KnowledgeGraphV2,
  from: string,
  to: string,
): KnowledgeGraphPath {
  const byNode = new Map(graph.nodes.map((node) => [node.id, node]));
  if (!byNode.has(from) || !byNode.has(to)) {
    return { projectionId: graph.projectionId, from, to, found: false, nodes: [], edges: [] };
  }
  const adjacent = adjacency(graph.edges);
  const queue = [from];
  const previous = new Map<string, { nodeId: string; edge: KnowledgeEdgeV2 }>();
  const visited = new Set([from]);
  while (queue.length > 0 && visited.size <= 10_000) {
    const current = queue.shift() as string;
    if (current === to) break;
    const candidates = [...(adjacent.get(current) ?? [])].sort(
      (left, right) => right.confidence - left.confidence || left.id.localeCompare(right.id),
    );
    for (const edge of candidates) {
      const neighbor = edge.source === current ? edge.target : edge.source;
      if (visited.has(neighbor)) continue;
      visited.add(neighbor);
      previous.set(neighbor, { nodeId: current, edge });
      queue.push(neighbor);
    }
  }
  if (!visited.has(to)) {
    return { projectionId: graph.projectionId, from, to, found: false, nodes: [], edges: [] };
  }
  const nodeIds = [to];
  const edges: KnowledgeEdgeV2[] = [];
  let cursor = to;
  while (cursor !== from) {
    const step = previous.get(cursor);
    if (!step) break;
    edges.push(step.edge);
    cursor = step.nodeId;
    nodeIds.push(cursor);
  }
  nodeIds.reverse();
  edges.reverse();
  return {
    projectionId: graph.projectionId,
    from,
    to,
    found: true,
    nodes: nodeIds
      .map((id) => byNode.get(id))
      .filter((node): node is KnowledgeNodeV2 => Boolean(node)),
    edges,
  };
}
