export interface KnowledgeGraphLayoutNode {
  id: string;
  coordinates: { x: number; y: number; z: number };
}

export interface KnowledgeGraphLayoutEdge {
  source: string;
  target: string;
}

export interface KnowledgeGraphLayoutPosition {
  id: string;
  x: number;
  y: number;
  z: number;
}

/** Presentation-only, deterministic O(nodes + edges) semantic layout. */
export function layoutKnowledgeGraph(
  nodes: readonly KnowledgeGraphLayoutNode[],
  edges: readonly KnowledgeGraphLayoutEdge[],
): KnowledgeGraphLayoutPosition[] {
  const grouped = new Map<string, KnowledgeGraphLayoutNode[]>();
  for (const node of nodes) {
    const key = Number.isFinite(node.coordinates.y) ? node.coordinates.y.toFixed(6) : 'domain:unknown';
    const group = grouped.get(key) ?? [];
    group.push(node);
    grouped.set(key, group);
  }

  const positions = new Map<string, KnowledgeGraphLayoutPosition>();
  for (const group of grouped.values()) {
    group.sort((left, right) => left.id.localeCompare(right.id));
    const count = group.length;
    group.forEach((node, index) => {
      const angle = (index / Math.max(1, count)) * Math.PI * 2;
      const ring = 0.16 + Math.sqrt(index / Math.max(1, count)) * 0.64;
      positions.set(node.id, {
        id: node.id,
        x: node.coordinates.x * 5 + Math.cos(angle) * ring,
        y: node.coordinates.z * 3.2 + Math.sin(angle) * ring * 0.55,
        z: node.coordinates.y * 4 + Math.sin(angle) * ring * 0.28,
      });
    });
  }

  const orderedEdges = [...edges].sort(
    (left, right) =>
      left.source.localeCompare(right.source) || left.target.localeCompare(right.target),
  );
  for (let pass = 0; pass < 6; pass += 1) {
    for (const edge of orderedEdges) {
      const source = positions.get(edge.source);
      const target = positions.get(edge.target);
      if (!source || !target) continue;
      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const dz = target.z - source.z;
      const distance = Math.max(0.001, Math.hypot(dx, dy, dz));
      const adjustment = Math.max(-0.018, Math.min(0.018, (distance - 1.25) * 0.006));
      const x = (dx / distance) * adjustment;
      const y = (dy / distance) * adjustment;
      const z = (dz / distance) * adjustment;
      source.x += x;
      source.y += y;
      source.z += z;
      target.x -= x;
      target.y -= y;
      target.z -= z;
    }
  }
  return nodes.map((node) => positions.get(node.id)!).filter(Boolean);
}
