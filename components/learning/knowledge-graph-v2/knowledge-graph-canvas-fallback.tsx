'use client';

import { useMemo } from 'react';
import { KnowledgeGraph3D } from '@/components/learning/knowledge-graph-3d';
import type { KnowledgeGraphV2 } from '@/lib/learning/domain/knowledge-graph-v2/contracts';
import type { KnowledgeSpaceAxis } from '@/lib/learning/domain/knowledge-graph-v2/knowledge-space';
import type { KnowledgeEdge, KnowledgeGraph, KnowledgeNode } from '@/lib/learning/domain/synthesis';
import { layoutKnowledgeGraph } from './knowledge-graph-layout';

function legacyType(type: KnowledgeGraphV2['nodes'][number]['type']): KnowledgeNode['type'] {
  switch (type) {
    case 'project':
    case 'classroom':
    case 'concept':
      return type;
    case 'external-source':
      return 'source';
    case 'original-note':
    case 'companion-note':
      return 'obsidian';
    default:
      return 'concept';
  }
}

function labelPrefix(type: KnowledgeGraphV2['nodes'][number]['type']): string {
  if (type === 'original-note') return '原笔记 · ';
  if (type === 'companion-note') return '伴随笔记 · ';
  if (type === 'review') return '复习 · ';
  return '';
}

export function KnowledgeGraphCanvasFallback({
  graph,
  axisLabels,
}: {
  graph: KnowledgeGraphV2;
  axisLabels?: { x: KnowledgeSpaceAxis; y: KnowledgeSpaceAxis; z: KnowledgeSpaceAxis };
}) {
  const layoutById = useMemo(
    () =>
      new Map(
        layoutKnowledgeGraph(
          graph.nodes.map((node) => ({ id: node.id, coordinates: node.coordinates })),
          graph.edges.map((edge) => ({ source: edge.source, target: edge.target })),
        ).map((position) => [position.id, position]),
      ),
    [graph],
  );
  const nodes: KnowledgeNode[] = graph.nodes.map((node) => ({
    id: node.id,
    label: `${labelPrefix(node.type)}${node.label}`,
    type: legacyType(node.type),
    ...(node.classroomIds[0] ? { classroomId: node.classroomIds[0] } : {}),
    ...(node.projectIds[0] ? { projectId: node.projectIds[0] } : {}),
    domain: node.domainIds[0] ?? '通用知识',
    timestamp: node.timestamp ?? graph.generatedAt,
    mastery: node.mastery,
    x: (layoutById.get(node.id)?.x ?? node.coordinates.x * 5) / 5,
    y: (layoutById.get(node.id)?.z ?? node.coordinates.y * 4) / 4,
    z: (layoutById.get(node.id)?.y ?? node.coordinates.z * 3.2) / 3.2,
    ...(node.externalUrl ? { url: node.externalUrl } : {}),
  }));
  const edges: KnowledgeEdge[] = graph.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    type:
      edge.type === 'related-to' ||
      edge.type === 'companion-of' ||
      edge.type === 'review-of' ||
      edge.type === 'prerequisite' ||
      edge.type === 'supports' ||
      edge.type === 'contradicts' ||
      edge.type === 'applies-to'
        ? 'related'
        : edge.type,
    weight: edge.weight,
    label: edge.type,
  }));
  const legacy: KnowledgeGraph = {
    schemaVersion: 'knowledge-graph/1',
    dimensions: { x: 'time', y: 'domain', z: 'mastery' },
    domains: [...new Set(graph.nodes.flatMap((node) => node.domainIds))],
    nodes,
    edges,
  };
  return <KnowledgeGraph3D graph={legacy} axisLabels={axisLabels} />;
}
