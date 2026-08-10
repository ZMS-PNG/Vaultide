import type { JsonObject } from '@openmaic/learning-protocol';

export const KNOWLEDGE_GRAPH_SCHEMA_VERSION = 'knowledge-graph/2' as const;
export const KNOWLEDGE_GRAPH_PROJECTOR_VERSION = 'knowledge-graph-projector-v2.2' as const;
export const KNOWLEDGE_GRAPH_LAYOUT_VERSION = 'knowledge-graph-layout-v2.1' as const;

export type KnowledgeNodeTypeV2 =
  | 'project'
  | 'original-note'
  | 'companion-note'
  | 'external-source'
  | 'classroom'
  | 'concept'
  | 'claim'
  | 'skill'
  | 'artifact'
  | 'review';

export type KnowledgeEdgeTypeV2 =
  | 'belongs-to'
  | 'contains'
  | 'cites'
  | 'derived-from'
  | 'companion-of'
  | 'precedes'
  | 'prerequisite'
  | 'supports'
  | 'contradicts'
  | 'applies-to'
  | 'related-to'
  | 'review-of';

export type KnowledgeEdgeOrigin = 'deterministic' | 'lexical' | 'embedding' | 'llm' | 'manual';
export type KnowledgeRelationStatus = 'active' | 'candidate' | 'confirmed' | 'rejected';
export type KnowledgeEvidenceKind =
  | 'source-version'
  | 'classroom'
  | 'learning-event'
  | 'mastery-projection'
  | 'companion-binding'
  | 'review-item'
  | 'synthesis'
  | 'lexical-comparison'
  | 'manual-feedback';

export interface KnowledgeCoordinates {
  x: number;
  y: number;
  z: number;
}

export interface KnowledgeEvidenceRefV2 {
  id: string;
  kind: KnowledgeEvidenceKind;
  entityId: string;
  label: string;
  locator: JsonObject;
  occurredAt?: string;
  relationId?: string;
}

export interface KnowledgeNodeV2 {
  id: string;
  canonicalId: string;
  label: string;
  type: KnowledgeNodeTypeV2;
  domainIds: string[];
  projectIds: string[];
  sourceVersionIds: string[];
  classroomIds: string[];
  timestamp?: string;
  /** null means there is no defensible active-learning evidence. */
  mastery: number | null;
  masteryConfidence: number;
  evidenceCount: number;
  evidenceRefs: string[];
  coordinates: KnowledgeCoordinates;
  layoutCoordinates?: KnowledgeCoordinates;
  originalPath?: string;
  companionPath?: string;
  companionId?: string;
  externalUrl?: string;
  writable: boolean;
  statusFlags: Array<'unknown-mastery' | 'review-due' | 'source-updated' | 'read-only'>;
  confidence: number;
  projectorVersion: string;
}

export interface KnowledgeEdgeV2 {
  id: string;
  source: string;
  target: string;
  type: KnowledgeEdgeTypeV2;
  directed: boolean;
  weight: number;
  confidence: number;
  evidenceRefs: string[];
  origin: KnowledgeEdgeOrigin;
  generatorVersion: string;
  status: KnowledgeRelationStatus;
}

export interface KnowledgeClusterV2 {
  id: string;
  label: string;
  kind: 'domain' | 'project';
  nodeIds: string[];
  coordinates: KnowledgeCoordinates;
}

export interface KnowledgeGraphStatisticsV2 {
  nodeCount: number;
  edgeCount: number;
  conceptCount: number;
  evidenceCount: number;
  unknownMasteryCount: number;
  inferredEdgeCount: number;
  candidateEdgeCount: number;
  nodeCountsByType: Partial<Record<KnowledgeNodeTypeV2, number>>;
  edgeCountsByType: Partial<Record<KnowledgeEdgeTypeV2, number>>;
}

export interface KnowledgeGraphV2 {
  schemaVersion: typeof KNOWLEDGE_GRAPH_SCHEMA_VERSION;
  projectionId: string;
  sourceSynthesisId: string;
  scopeHash: string;
  generatedAt: string;
  projectorVersion: string;
  layoutVersion: string;
  nodes: KnowledgeNodeV2[];
  edges: KnowledgeEdgeV2[];
  evidence: KnowledgeEvidenceRefV2[];
  clusters: KnowledgeClusterV2[];
  statistics: KnowledgeGraphStatisticsV2;
}

export interface KnowledgeGraphProjectionRecord {
  id: string;
  ownerId: string;
  synthesisId: string;
  scopeHash: string;
  inputHash: string;
  graphHash: string;
  projectorVersion: string;
  layoutVersion: string;
  status: 'building' | 'ready' | 'failed';
  graph: KnowledgeGraphV2;
  generatedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface KnowledgeCompanionContext {
  companionId: string;
  sourceId: string;
  sourceTitle: string;
  sourceOrigin: 'obsidian' | 'web' | 'pdf' | 'github' | 'arxiv' | 'manual';
  sourceVersionId?: string;
  projectId?: string;
  sourceBundleId?: string;
  sourceSnapshotId?: string;
  originalRelativePath: string;
  companionRelativePath: string;
  sourceUpdated: boolean;
  updatedAt: string;
}

export interface KnowledgeSourceContext {
  sourceId: string;
  sourceTitle: string;
  sourceOrigin: 'obsidian' | 'web' | 'pdf' | 'github' | 'arxiv' | 'manual';
  sourceVersionId?: string;
  projectId?: string;
  classroomIds: string[];
  originalRelativePath?: string;
  updatedAt: string;
}

export interface KnowledgeMasteryContext {
  projectionId: string;
  sprintId: string;
  classroomId: string;
  conceptId: string;
  estimate: number | null;
  confidence: number;
  evidenceCount: number;
  evidenceSummary: Array<{
    eventId?: string;
    eventType?: string;
    occurredAt?: string;
    score?: number;
    weight?: number;
  }>;
  lastPracticedAt?: string;
  nextReviewAt?: string;
  projectorVersion: string;
}

export interface KnowledgeReviewContext {
  reviewId: string;
  sprintId: string;
  classroomId: string;
  projectId?: string;
  conceptId: string;
  state: 'scheduled' | 'due';
  dueAt: string;
}

export interface KnowledgeGraphProjectionContext {
  sources: KnowledgeSourceContext[];
  companions: KnowledgeCompanionContext[];
  masteries: KnowledgeMasteryContext[];
  reviews: KnowledgeReviewContext[];
}

export interface KnowledgeGraphProjectionQuery {
  lod?: 0 | 1 | 2;
  nodeTypes?: KnowledgeNodeTypeV2[];
  edgeTypes?: KnowledgeEdgeTypeV2[];
  projectIds?: string[];
  timeFrom?: string;
  timeTo?: string;
  minConfidence?: number;
  includeCandidates?: boolean;
}

export interface KnowledgeGraphNeighborhood {
  projectionId: string;
  rootNodeId: string;
  depth: 1 | 2;
  nodes: KnowledgeNodeV2[];
  edges: KnowledgeEdgeV2[];
}

export interface KnowledgeGraphPath {
  projectionId: string;
  from: string;
  to: string;
  found: boolean;
  nodes: KnowledgeNodeV2[];
  edges: KnowledgeEdgeV2[];
}

export interface KnowledgeRelationFeedbackRecord {
  id: string;
  ownerId: string;
  relationId: string;
  action: 'confirm' | 'reject';
  reason?: string;
  createdAt: Date;
  updatedAt: Date;
}
