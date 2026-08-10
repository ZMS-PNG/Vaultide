import type { KnowledgeEdge, KnowledgeNode, SynthesisRunRecord } from '../synthesis';
import {
  KNOWLEDGE_GRAPH_LAYOUT_VERSION,
  KNOWLEDGE_GRAPH_PROJECTOR_VERSION,
  KNOWLEDGE_GRAPH_SCHEMA_VERSION,
  type KnowledgeClusterV2,
  type KnowledgeCompanionContext,
  type KnowledgeEdgeTypeV2,
  type KnowledgeEdgeV2,
  type KnowledgeEvidenceRefV2,
  type KnowledgeGraphProjectionContext,
  type KnowledgeGraphStatisticsV2,
  type KnowledgeGraphV2,
  type KnowledgeMasteryContext,
  type KnowledgeNodeTypeV2,
  type KnowledgeNodeV2,
  type KnowledgeSourceContext,
} from './contracts';
import { projectKnowledgeCoordinates } from './coordinate-projector';
import {
  canonicalConceptIdentity,
  cleanKnowledgeLabel,
  normalizeConceptLabel,
  stableDomainId,
  stableEntityId,
  stableHash,
} from './stable-identity';

interface BuildKnowledgeGraphV2Input {
  projectionId: string;
  synthesis: SynthesisRunRecord;
  context: KnowledgeGraphProjectionContext;
  generatedAt: Date;
}

type NodeDraft = Omit<KnowledgeNodeV2, 'coordinates' | 'layoutCoordinates' | 'projectorVersion'>;

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort();
}

function v1NodeType(type: KnowledgeNode['type']): KnowledgeNodeTypeV2 {
  switch (type) {
    case 'source':
      return 'external-source';
    case 'obsidian':
      return 'original-note';
    default:
      return type;
  }
}

function v1EdgeType(type: KnowledgeEdge['type']): KnowledgeEdgeTypeV2 {
  return type === 'related' ? 'related-to' : type;
}

function masteryKey(classroomId: string, conceptId: string): string {
  return `${classroomId}\u0000${conceptId}`;
}

function masteryForNode(
  node: KnowledgeNode,
  masteries: ReadonlyMap<string, KnowledgeMasteryContext>,
): KnowledgeMasteryContext | undefined {
  if (!node.classroomId) return undefined;
  if (node.type === 'classroom') return masteries.get(masteryKey(node.classroomId, 'classroom'));
  if (node.type !== 'concept') return undefined;
  const match = /^concept:[^:]+:(.+)$/.exec(node.id);
  return match ? masteries.get(masteryKey(node.classroomId, `scene:${match[1]}`)) : undefined;
}

function weightedMastery(
  left: Pick<NodeDraft, 'mastery' | 'masteryConfidence' | 'evidenceCount'>,
  right: Pick<NodeDraft, 'mastery' | 'masteryConfidence' | 'evidenceCount'>,
): { mastery: number | null; masteryConfidence: number; evidenceCount: number } {
  const evidenceCount = left.evidenceCount + right.evidenceCount;
  if (left.mastery === null && right.mastery === null) {
    return {
      mastery: null,
      masteryConfidence: Math.max(left.masteryConfidence, right.masteryConfidence),
      evidenceCount,
    };
  }
  if (left.mastery === null) {
    return {
      mastery: right.mastery,
      masteryConfidence: right.masteryConfidence,
      evidenceCount,
    };
  }
  if (right.mastery === null) {
    return {
      mastery: left.mastery,
      masteryConfidence: left.masteryConfidence,
      evidenceCount,
    };
  }
  const leftWeight = Math.max(0.01, left.masteryConfidence * Math.max(1, left.evidenceCount));
  const rightWeight = Math.max(0.01, right.masteryConfidence * Math.max(1, right.evidenceCount));
  return {
    mastery: clamp(
      (left.mastery * leftWeight + right.mastery * rightWeight) / (leftWeight + rightWeight),
    ),
    masteryConfidence: clamp(1 - (1 - left.masteryConfidence) * (1 - right.masteryConfidence)),
    evidenceCount,
  };
}

function companionLookupKey(label: string, projectId: string | undefined): string {
  return `${projectId ?? ''}\u0000${normalizeConceptLabel(label)}`;
}

function classroomSourceLookupKey(label: string, classroomId: string): string {
  return `${classroomId}\u0000${normalizeConceptLabel(label)}`;
}

function relationIdentity(
  ownerId: string,
  source: string,
  target: string,
  type: KnowledgeEdgeTypeV2,
  directed: boolean,
  origin: KnowledgeEdgeV2['origin'],
): string {
  const endpoints = directed || source < target ? [source, target] : [target, source];
  return stableEntityId('kgr', { ownerId, endpoints, type, directed, origin });
}

function clusterCoordinates(nodes: readonly KnowledgeNodeV2[]): {
  x: number;
  y: number;
  z: number;
} {
  if (nodes.length === 0) return { x: 0, y: 0, z: 0 };
  return nodes.reduce(
    (sum, node) => ({
      x: sum.x + node.coordinates.x / nodes.length,
      y: sum.y + node.coordinates.y / nodes.length,
      z: sum.z + node.coordinates.z / nodes.length,
    }),
    { x: 0, y: 0, z: 0 },
  );
}

function graphStatistics(
  nodes: readonly KnowledgeNodeV2[],
  edges: readonly KnowledgeEdgeV2[],
  evidence: readonly KnowledgeEvidenceRefV2[],
): KnowledgeGraphStatisticsV2 {
  const nodeCountsByType: KnowledgeGraphStatisticsV2['nodeCountsByType'] = {};
  const edgeCountsByType: KnowledgeGraphStatisticsV2['edgeCountsByType'] = {};
  for (const node of nodes) nodeCountsByType[node.type] = (nodeCountsByType[node.type] ?? 0) + 1;
  for (const edge of edges) edgeCountsByType[edge.type] = (edgeCountsByType[edge.type] ?? 0) + 1;
  return {
    nodeCount: nodes.length,
    edgeCount: edges.length,
    conceptCount: nodeCountsByType.concept ?? 0,
    evidenceCount: evidence.length,
    unknownMasteryCount: nodes.filter((node) => node.mastery === null).length,
    inferredEdgeCount: edges.filter((edge) => edge.origin !== 'deterministic').length,
    candidateEdgeCount: edges.filter((edge) => edge.status === 'candidate').length,
    nodeCountsByType,
    edgeCountsByType,
  };
}

export function buildKnowledgeGraphV2(input: BuildKnowledgeGraphV2Input): KnowledgeGraphV2 {
  const { projectionId, synthesis, context, generatedAt } = input;
  const evidence = new Map<string, KnowledgeEvidenceRefV2>();
  const nodes = new Map<string, NodeDraft>();
  const edges = new Map<string, KnowledgeEdgeV2>();
  const aliases = new Map<string, string>();
  const sceneConcepts = new Map<string, string>();
  const masteryByKey = new Map(
    context.masteries.map((item) => [masteryKey(item.classroomId, item.conceptId), item]),
  );
  const companionsByLabel = new Map<string, KnowledgeCompanionContext>();
  const companionsBySourceId = new Map<string, KnowledgeCompanionContext>();
  for (const companion of context.companions) {
    companionsBySourceId.set(companion.sourceId, companion);
    companionsByLabel.set(
      companionLookupKey(companion.sourceTitle, companion.projectId),
      companion,
    );
    companionsByLabel.set(companionLookupKey(companion.sourceTitle, undefined), companion);
  }
  const sourcesByProjectLabel = new Map<string, KnowledgeSourceContext>();
  const sourcesByClassroomLabel = new Map<string, KnowledgeSourceContext>();
  const sourcesByUniqueLabel = new Map<string, KnowledgeSourceContext>();
  const duplicateSourceLabels = new Set<string>();
  for (const source of context.sources) {
    const normalizedLabel = normalizeConceptLabel(source.sourceTitle);
    if (!normalizedLabel) continue;
    if (source.projectId) {
      sourcesByProjectLabel.set(companionLookupKey(source.sourceTitle, source.projectId), source);
    }
    for (const classroomId of source.classroomIds) {
      sourcesByClassroomLabel.set(
        classroomSourceLookupKey(source.sourceTitle, classroomId),
        source,
      );
    }
    if (sourcesByUniqueLabel.has(normalizedLabel)) {
      duplicateSourceLabels.add(normalizedLabel);
      sourcesByUniqueLabel.delete(normalizedLabel);
    } else if (!duplicateSourceLabels.has(normalizedLabel)) {
      sourcesByUniqueLabel.set(normalizedLabel, source);
    }
  }

  const sourceForNode = (node: KnowledgeNode): KnowledgeSourceContext | undefined => {
    if (node.projectId) {
      const projectMatch = sourcesByProjectLabel.get(
        companionLookupKey(node.label, node.projectId),
      );
      if (projectMatch) return projectMatch;
    }
    if (node.classroomId) {
      const classroomMatch = sourcesByClassroomLabel.get(
        classroomSourceLookupKey(node.label, node.classroomId),
      );
      if (classroomMatch) return classroomMatch;
    }
    return sourcesByUniqueLabel.get(normalizeConceptLabel(node.label));
  };

  const addEvidence = (value: Omit<KnowledgeEvidenceRefV2, 'id'>, identity: unknown): string => {
    const id = stableEntityId('kge', { projectionId, identity });
    evidence.set(id, { id, ...value });
    return id;
  };

  const addNode = (node: NodeDraft): void => {
    const existing = nodes.get(node.id);
    if (!existing) {
      nodes.set(node.id, {
        ...node,
        domainIds: unique(node.domainIds),
        projectIds: unique(node.projectIds),
        sourceVersionIds: unique(node.sourceVersionIds),
        classroomIds: unique(node.classroomIds),
        evidenceRefs: unique(node.evidenceRefs),
        statusFlags: unique(node.statusFlags) as NodeDraft['statusFlags'],
      });
      return;
    }
    const mastery = weightedMastery(existing, node);
    nodes.set(node.id, {
      ...existing,
      label: existing.label.length >= node.label.length ? existing.label : node.label,
      domainIds: unique([...existing.domainIds, ...node.domainIds]),
      projectIds: unique([...existing.projectIds, ...node.projectIds]),
      sourceVersionIds: unique([...existing.sourceVersionIds, ...node.sourceVersionIds]),
      classroomIds: unique([...existing.classroomIds, ...node.classroomIds]),
      evidenceRefs: unique([...existing.evidenceRefs, ...node.evidenceRefs]),
      statusFlags: unique([
        ...existing.statusFlags,
        ...node.statusFlags,
      ]) as NodeDraft['statusFlags'],
      timestamp:
        !existing.timestamp || (node.timestamp && node.timestamp < existing.timestamp)
          ? node.timestamp
          : existing.timestamp,
      mastery: mastery.mastery,
      masteryConfidence: mastery.masteryConfidence,
      evidenceCount: mastery.evidenceCount,
      confidence: Math.max(existing.confidence, node.confidence),
    });
  };

  const addEdge = (
    edge: Omit<KnowledgeEdgeV2, 'id'>,
    identity?: unknown,
  ): KnowledgeEdgeV2 | undefined => {
    if (edge.source === edge.target) return undefined;
    if (edge.origin !== 'deterministic' && edge.confidence < 0.55) return undefined;
    const id = relationIdentity(
      synthesis.ownerId,
      edge.source,
      edge.target,
      edge.type,
      edge.directed,
      edge.origin,
    );
    const existing = edges.get(id);
    const value: KnowledgeEdgeV2 = {
      id,
      ...edge,
      evidenceRefs: unique(edge.evidenceRefs),
      ...(identity
        ? { generatorVersion: `${edge.generatorVersion}:${stableHash(identity).slice(0, 8)}` }
        : {}),
    };
    if (!existing || value.confidence > existing.confidence) edges.set(id, value);
    return value;
  };

  for (const node of synthesis.graph.nodes) {
    const domainId = stableDomainId(node.domain);
    const mastery = masteryForNode(node, masteryByKey);
    const classroomEvidenceId = node.classroomId
      ? addEvidence(
          {
            kind: 'classroom',
            entityId: node.classroomId,
            label: `课堂证据：${node.classroomId}`,
            locator: { classroomId: node.classroomId },
            occurredAt: node.timestamp,
          },
          { kind: 'classroom', classroomId: node.classroomId },
        )
      : undefined;
    const masteryEvidenceId = mastery
      ? addEvidence(
          {
            kind: 'mastery-projection',
            entityId: mastery.projectionId,
            label: `${mastery.evidenceCount} 条主动学习证据`,
            locator: {
              sprintId: mastery.sprintId,
              classroomId: mastery.classroomId,
              conceptId: mastery.conceptId,
              projectorVersion: mastery.projectorVersion,
            },
            occurredAt: mastery.lastPracticedAt,
          },
          { kind: 'mastery', id: mastery.projectionId },
        )
      : undefined;

    let nodeId = node.id;
    let canonicalId = node.id;
    const type = v1NodeType(node.type);
    const writable = false;
    let originalPath: string | undefined;
    let companionId: string | undefined;
    let sourceVersionId: string | undefined;
    let sourceUpdated = false;
    const externalUrl = node.url;
    let confidence = 1;

    if (node.type === 'concept') {
      const concept = canonicalConceptIdentity(node.label, domainId, synthesis.ownerId);
      nodeId = `concept:${concept.id}`;
      canonicalId = concept.id;
      const match = node.classroomId ? /^concept:[^:]+:(.+)$/.exec(node.id) : undefined;
      if (match && node.classroomId) {
        sceneConcepts.set(masteryKey(node.classroomId, `scene:${match[1]}`), nodeId);
      }
    } else if (node.type === 'source') {
      nodeId = `external:${stableHash(node.url ?? node.id).slice(0, 32)}`;
      canonicalId = node.url ? `url:${stableHash(node.url).slice(0, 32)}` : nodeId;
      confidence = node.url ? 1 : 0.85;
    } else if (node.type === 'obsidian') {
      const source = sourceForNode(node);
      const companion =
        (source ? companionsBySourceId.get(source.sourceId) : undefined) ??
        companionsByLabel.get(companionLookupKey(node.label, node.projectId));
      if (source || companion) {
        const sourceId = source?.sourceId ?? (companion as KnowledgeCompanionContext).sourceId;
        nodeId = `source:${sourceId}`;
        canonicalId = sourceId;
        originalPath = source?.originalRelativePath ?? companion?.originalRelativePath;
        sourceVersionId = source?.sourceVersionId ?? companion?.sourceVersionId;
        companionId = companion?.companionId;
        sourceUpdated = companion?.sourceUpdated ?? false;
      } else {
        nodeId = `original:${stableHash({
          projectId: node.projectId ?? null,
          label: normalizeConceptLabel(node.label),
        }).slice(0, 32)}`;
        canonicalId = nodeId;
      }
    }
    aliases.set(node.id, nodeId);
    const estimate = mastery?.estimate ?? null;
    const sourceEvidenceId = sourceVersionId
      ? addEvidence(
          {
            kind: 'source-version',
            entityId: sourceVersionId,
            label: `来源版本：${cleanKnowledgeLabel(node.label, sourceVersionId)}`,
            locator: {
              sourceVersionId,
              ...(originalPath ? { originalPath } : {}),
            },
            occurredAt: node.timestamp,
          },
          { kind: 'source-version', id: sourceVersionId },
        )
      : undefined;
    addNode({
      id: nodeId,
      canonicalId,
      label: cleanKnowledgeLabel(node.label, node.id),
      type,
      domainIds: [domainId],
      projectIds: node.projectId ? [node.projectId] : [],
      sourceVersionIds: sourceVersionId ? [sourceVersionId] : [],
      classroomIds: node.classroomId ? [node.classroomId] : [],
      timestamp: node.timestamp,
      mastery: estimate,
      masteryConfidence: mastery?.confidence ?? 0,
      evidenceCount: mastery?.evidenceCount ?? 0,
      evidenceRefs: [classroomEvidenceId, masteryEvidenceId, sourceEvidenceId].filter(
        (value): value is string => Boolean(value),
      ),
      ...(originalPath ? { originalPath } : {}),
      ...(companionId ? { companionId } : {}),
      ...(externalUrl ? { externalUrl } : {}),
      writable,
      statusFlags: [
        ...(estimate === null ? (['unknown-mastery'] as const) : []),
        ...(type === 'original-note' ? (['read-only'] as const) : []),
        ...(sourceUpdated ? (['source-updated'] as const) : []),
      ],
      confidence,
    });
  }

  for (const companion of context.companions) {
    const originalId = `source:${companion.sourceId}`;
    const companionNodeId = `companion:${companion.companionId}`;
    const domainId = stableDomainId(companion.sourceTitle);
    const bindingEvidenceId = addEvidence(
      {
        kind: 'companion-binding',
        entityId: companion.companionId,
        label: '原笔记与唯一学习伴随笔记的受管绑定',
        locator: {
          sourceId: companion.sourceId,
          companionId: companion.companionId,
          originalPath: companion.originalRelativePath,
          companionPath: companion.companionRelativePath,
        },
        occurredAt: companion.updatedAt,
      },
      { kind: 'companion-binding', companionId: companion.companionId },
    );
    const sourceEvidenceId = companion.sourceVersionId
      ? addEvidence(
          {
            kind: 'source-version',
            entityId: companion.sourceVersionId,
            label: `来源版本：${companion.sourceTitle}`,
            locator: {
              sourceId: companion.sourceId,
              sourceVersionId: companion.sourceVersionId,
            },
            occurredAt: companion.updatedAt,
          },
          { kind: 'source-version', id: companion.sourceVersionId },
        )
      : undefined;
    addNode({
      id: originalId,
      canonicalId: companion.sourceId,
      label: cleanKnowledgeLabel(companion.sourceTitle, companion.originalRelativePath),
      type: 'original-note',
      domainIds: [domainId],
      projectIds: companion.projectId ? [companion.projectId] : [],
      sourceVersionIds: companion.sourceVersionId ? [companion.sourceVersionId] : [],
      classroomIds: [],
      timestamp: companion.updatedAt,
      mastery: null,
      masteryConfidence: 0,
      evidenceCount: sourceEvidenceId ? 1 : 0,
      evidenceRefs: [sourceEvidenceId].filter((value): value is string => Boolean(value)),
      originalPath: companion.originalRelativePath,
      companionId: companion.companionId,
      writable: false,
      statusFlags: [
        'unknown-mastery',
        'read-only',
        ...(companion.sourceUpdated ? (['source-updated'] as const) : []),
      ],
      confidence: 1,
    });
    addNode({
      id: companionNodeId,
      canonicalId: companion.companionId,
      label: `学习伴随：${cleanKnowledgeLabel(companion.sourceTitle, companion.companionId)}`,
      type: 'companion-note',
      domainIds: [domainId],
      projectIds: companion.projectId ? [companion.projectId] : [],
      sourceVersionIds: companion.sourceVersionId ? [companion.sourceVersionId] : [],
      classroomIds: [],
      timestamp: companion.updatedAt,
      mastery: null,
      masteryConfidence: 0,
      evidenceCount: 1,
      evidenceRefs: [bindingEvidenceId],
      originalPath: companion.originalRelativePath,
      companionPath: companion.companionRelativePath,
      companionId: companion.companionId,
      writable: true,
      statusFlags: ['unknown-mastery'],
      confidence: 1,
    });
    addEdge({
      source: originalId,
      target: companionNodeId,
      type: 'companion-of',
      directed: true,
      weight: 1,
      confidence: 1,
      evidenceRefs: [bindingEvidenceId],
      origin: 'deterministic',
      generatorVersion: KNOWLEDGE_GRAPH_PROJECTOR_VERSION,
      status: 'active',
    });
    if (companion.projectId) {
      addEdge({
        source: `project:${companion.projectId}`,
        target: originalId,
        type: 'contains',
        directed: true,
        weight: 1,
        confidence: 1,
        evidenceRefs: [bindingEvidenceId],
        origin: 'deterministic',
        generatorVersion: KNOWLEDGE_GRAPH_PROJECTOR_VERSION,
        status: 'active',
      });
      addEdge({
        source: `project:${companion.projectId}`,
        target: companionNodeId,
        type: 'contains',
        directed: true,
        weight: 1,
        confidence: 1,
        evidenceRefs: [bindingEvidenceId],
        origin: 'deterministic',
        generatorVersion: KNOWLEDGE_GRAPH_PROJECTOR_VERSION,
        status: 'active',
      });
    }
  }

  for (const edge of synthesis.graph.edges) {
    const source = aliases.get(edge.source) ?? edge.source;
    const target = aliases.get(edge.target) ?? edge.target;
    const type = v1EdgeType(edge.type);
    const origin = edge.type === 'related' ? 'lexical' : 'deterministic';
    const confidence = origin === 'deterministic' ? 1 : clamp(edge.weight);
    const lexicalEvidenceId =
      origin === 'lexical'
        ? addEvidence(
            {
              kind: 'lexical-comparison',
              entityId: edge.id,
              label: '标题与术语的保守词元重合候选',
              locator: {
                sourceNodeId: source,
                targetNodeId: target,
                synthesisId: synthesis.id,
              },
            },
            { kind: 'lexical', synthesisId: synthesis.id, edgeId: edge.id },
          )
        : undefined;
    const endpointEvidence = unique([
      ...(nodes.get(source)?.evidenceRefs ?? []),
      ...(nodes.get(target)?.evidenceRefs ?? []),
    ]).slice(0, 8);
    addEdge({
      source,
      target,
      type,
      directed: type !== 'related-to',
      weight: origin === 'deterministic' ? 1 : clamp(edge.weight),
      confidence,
      evidenceRefs: lexicalEvidenceId ? [lexicalEvidenceId] : endpointEvidence,
      origin,
      generatorVersion:
        origin === 'lexical' ? 'v1-title-token-adapter-v2.1' : KNOWLEDGE_GRAPH_PROJECTOR_VERSION,
      status: origin === 'lexical' && confidence < 0.75 ? 'candidate' : 'active',
    });
  }

  for (const review of context.reviews) {
    const target =
      review.conceptId === 'classroom'
        ? `classroom:${review.classroomId}`
        : (sceneConcepts.get(masteryKey(review.classroomId, review.conceptId)) ??
          `classroom:${review.classroomId}`);
    if (!nodes.has(target)) continue;
    const evidenceId = addEvidence(
      {
        kind: 'review-item',
        entityId: review.reviewId,
        label: review.state === 'due' ? '已到期复习项' : '计划复习项',
        locator: {
          reviewId: review.reviewId,
          sprintId: review.sprintId,
          classroomId: review.classroomId,
          conceptId: review.conceptId,
          state: review.state,
        },
        occurredAt: review.dueAt,
      },
      { kind: 'review', reviewId: review.reviewId },
    );
    const targetNode = nodes.get(target) as NodeDraft;
    const reviewNodeId = `review:${review.reviewId}`;
    addNode({
      id: reviewNodeId,
      canonicalId: review.reviewId,
      label: `复习：${targetNode.label}`,
      type: 'review',
      domainIds: targetNode.domainIds,
      projectIds: unique([
        ...targetNode.projectIds,
        ...(review.projectId ? [review.projectId] : []),
      ]),
      sourceVersionIds: targetNode.sourceVersionIds,
      classroomIds: [review.classroomId],
      timestamp: review.dueAt,
      mastery: targetNode.mastery,
      masteryConfidence: targetNode.masteryConfidence,
      evidenceCount: 1,
      evidenceRefs: [evidenceId],
      writable: false,
      statusFlags: review.state === 'due' ? ['review-due'] : [],
      confidence: 1,
    });
    addEdge({
      source: reviewNodeId,
      target,
      type: 'review-of',
      directed: true,
      weight: 1,
      confidence: 1,
      evidenceRefs: [evidenceId],
      origin: 'deterministic',
      generatorVersion: KNOWLEDGE_GRAPH_PROJECTOR_VERSION,
      status: 'active',
    });
  }

  const projectedNodes = projectKnowledgeCoordinates(
    [...nodes.values()].sort((left, right) => left.id.localeCompare(right.id)),
  );
  const finalEdges = [...edges.values()]
    .filter((edge) => nodes.has(edge.source) && nodes.has(edge.target))
    .sort((left, right) => left.id.localeCompare(right.id));
  const evidenceValues = [...evidence.values()].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
  const clusters: KnowledgeClusterV2[] = [];
  const domains = new Set(projectedNodes.flatMap((node) => node.domainIds));
  for (const domainId of [...domains].sort()) {
    const members = projectedNodes.filter((node) => node.domainIds.includes(domainId));
    clusters.push({
      id: `cluster:${domainId}`,
      label: domainId,
      kind: 'domain',
      nodeIds: members.map((node) => node.id),
      coordinates: clusterCoordinates(members),
    });
  }
  const projects = new Set(projectedNodes.flatMap((node) => node.projectIds));
  for (const projectId of [...projects].sort()) {
    const members = projectedNodes.filter((node) => node.projectIds.includes(projectId));
    const projectNode = projectedNodes.find((node) => node.id === `project:${projectId}`);
    clusters.push({
      id: `cluster:project:${projectId}`,
      label: projectNode?.label ?? projectId,
      kind: 'project',
      nodeIds: members.map((node) => node.id),
      coordinates: clusterCoordinates(members),
    });
  }

  return {
    schemaVersion: KNOWLEDGE_GRAPH_SCHEMA_VERSION,
    projectionId,
    sourceSynthesisId: synthesis.id,
    scopeHash: stableHash(synthesis.scope),
    generatedAt: generatedAt.toISOString(),
    projectorVersion: KNOWLEDGE_GRAPH_PROJECTOR_VERSION,
    layoutVersion: KNOWLEDGE_GRAPH_LAYOUT_VERSION,
    nodes: projectedNodes,
    edges: finalEdges,
    evidence: evidenceValues,
    clusters,
    statistics: graphStatistics(projectedNodes, finalEdges, evidenceValues),
  };
}

export function knowledgeGraphContentHash(graph: KnowledgeGraphV2): string {
  const evidenceIdentity = new Map(
    graph.evidence.map((item) => [
      item.id,
      stableHash({
        kind: item.kind,
        entityId: item.entityId,
        label: item.label,
        locator: item.locator,
        occurredAt: item.occurredAt ?? null,
      }),
    ]),
  );
  const normalizedEvidenceRefs = (refs: readonly string[]) =>
    refs.map((id) => evidenceIdentity.get(id) ?? id).sort();
  return stableHash({
    schemaVersion: graph.schemaVersion,
    sourceSynthesisId: graph.sourceSynthesisId,
    scopeHash: graph.scopeHash,
    projectorVersion: graph.projectorVersion,
    layoutVersion: graph.layoutVersion,
    nodes: graph.nodes.map((node) => ({
      ...node,
      evidenceRefs: normalizedEvidenceRefs(node.evidenceRefs),
    })),
    edges: graph.edges.map((edge) => ({
      ...edge,
      evidenceRefs: normalizedEvidenceRefs(edge.evidenceRefs),
    })),
    evidence: graph.evidence
      .map((item) => ({
        kind: item.kind,
        entityId: item.entityId,
        label: item.label,
        locator: item.locator,
        occurredAt: item.occurredAt ?? null,
      }))
      .sort((left, right) => stableHash(left).localeCompare(stableHash(right))),
    clusters: graph.clusters,
    statistics: graph.statistics,
  });
}
