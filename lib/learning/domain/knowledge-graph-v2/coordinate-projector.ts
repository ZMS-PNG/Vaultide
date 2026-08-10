import type { KnowledgeCoordinates, KnowledgeNodeV2 } from './contracts';
import { KNOWLEDGE_GRAPH_LAYOUT_VERSION, KNOWLEDGE_GRAPH_PROJECTOR_VERSION } from './contracts';
import { stableHash } from './stable-identity';

type CoordinateInput = Omit<
  KnowledgeNodeV2,
  'coordinates' | 'layoutCoordinates' | 'projectorVersion'
>;

function unit(identity: string, offset: number): number {
  const hash = stableHash(identity);
  const value = Number.parseInt(hash.slice(offset, offset + 8), 16) / 0xffffffff;
  return value * 2 - 1;
}

function clamp(value: number, minimum = -1.25, maximum = 1.25): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function semanticCoordinates(nodeId: string): KnowledgeCoordinates {
  const x = unit(`${KNOWLEDGE_GRAPH_LAYOUT_VERSION}:${nodeId}`, 0);
  const y = unit(`${KNOWLEDGE_GRAPH_LAYOUT_VERSION}:${nodeId}`, 8);
  const z = unit(`${KNOWLEDGE_GRAPH_LAYOUT_VERSION}:${nodeId}`, 16);
  const length = Math.max(0.0001, Math.hypot(x, y, z));
  const radius = 0.55 + (unit(nodeId, 24) + 1) * 0.28;
  return {
    x: (x / length) * radius,
    y: (y / length) * radius,
    z: (z / length) * radius,
  };
}

export function projectKnowledgeCoordinates(inputs: readonly CoordinateInput[]): KnowledgeNodeV2[] {
  const timestamps = inputs
    .map((node) => (node.timestamp ? Date.parse(node.timestamp) : Number.NaN))
    .filter(Number.isFinite);
  const earliest = timestamps.length ? Math.min(...timestamps) : 0;
  const latest = timestamps.length ? Math.max(...timestamps) : earliest;
  const span = Math.max(1, latest - earliest);

  return inputs.map((node) => {
    const parsedTime = node.timestamp ? Date.parse(node.timestamp) : Number.NaN;
    const timeCoordinate = Number.isFinite(parsedTime)
      ? ((parsedTime - earliest) / span) * 2 - 1
      : unit(`time:${node.id}`, 0) * 0.15;
    const domainId = node.domainIds[0] ?? 'domain:general';
    const domainCoordinate = unit(`domain:${domainId}`, 8);
    const jitterX = unit(`jitter-x:${node.id}`, 16) * 0.035;
    const jitterY = unit(`jitter-y:${node.id}`, 24) * 0.045;
    const masteryCoordinate = node.mastery === null ? -1.2 : node.mastery * 2 - 1;
    return {
      ...node,
      coordinates: {
        x: clamp(timeCoordinate + jitterX),
        y: clamp(domainCoordinate + jitterY),
        z: node.mastery === null ? -1.2 : clamp(masteryCoordinate),
      },
      layoutCoordinates: semanticCoordinates(node.id),
      projectorVersion: KNOWLEDGE_GRAPH_PROJECTOR_VERSION,
    };
  });
}
