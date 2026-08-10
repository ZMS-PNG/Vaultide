import type { JsonObject } from '@openmaic/learning-protocol';

export type SynthesisMode = 'timeline' | 'domain' | 'combined';
export type SynthesisSourceType = 'obsidian' | 'external' | 'hybrid' | 'classroom';
export type SynthesisSchedulePeriod = 'daily' | 'weekly' | 'monthly' | 'custom';
export type SynthesisScheduleStatus = 'active' | 'paused';
export type SynthesisScheduleRunState = 'running' | 'succeeded' | 'skipped' | 'failed';
export type KnowledgeNodeType = 'project' | 'classroom' | 'concept' | 'source' | 'obsidian';
export type KnowledgeEdgeType =
  | 'contains'
  | 'belongs-to'
  | 'precedes'
  | 'cites'
  | 'derived-from'
  | 'related';

export interface KnowledgeNode {
  id: string;
  label: string;
  type: KnowledgeNodeType;
  classroomId?: string;
  projectId?: string;
  domain: string;
  timestamp: string;
  /** null means no active evidence was available for a defensible estimate. */
  mastery: number | null;
  x: number;
  y: number;
  z: number;
  url?: string;
  citationId?: string;
}

export interface KnowledgeEdge {
  id: string;
  source: string;
  target: string;
  type: KnowledgeEdgeType;
  weight: number;
  label?: string;
}

export interface KnowledgeGraph {
  schemaVersion: 'knowledge-graph/1';
  dimensions: {
    x: 'time';
    y: 'domain';
    z: 'mastery';
  };
  domains: string[];
  nodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
}

export type SynthesisScope = JsonObject & {
  question?: string;
  timeFrom?: string;
  timeTo?: string;
  domainQuery?: string;
  domain?: string;
  sourceType?: SynthesisSourceType;
  topicTags?: string[];
  projectIds?: string[];
  classroomIds?: string[];
};

export interface SynthesisRequest {
  mode: SynthesisMode;
  question?: string;
  timeFrom?: string;
  timeTo?: string;
  domainQuery?: string;
  domain?: string;
  sourceType?: SynthesisSourceType;
  topicTags?: string[];
  projectIds?: string[];
  classroomIds?: string[];
}

export interface SynthesisClassroomFilterOption {
  classroomId: string;
  projectId?: string;
  projectName?: string;
  title: string;
  createdAt: string;
  domain: string;
  sourceType: SynthesisSourceType;
  topicTags: string[];
}

export interface SynthesisProjectFilterOption {
  projectId: string;
  projectName: string;
  classroomCount: number;
  latestActivityAt: string;
}

export interface SynthesisFilterOptions {
  projects: SynthesisProjectFilterOption[];
  classrooms: SynthesisClassroomFilterOption[];
  domains: string[];
  topicTags: string[];
  sourceTypes: SynthesisSourceType[];
}

export interface SynthesisResearchSource {
  citationId: string;
  title: string;
  url: string;
  domain: string;
  authority: 'primary' | 'authoritative' | 'general';
  score: number;
}

export interface SynthesisClassroomRecord {
  classroomId: string;
  sprintId?: string;
  projectId?: string;
  projectName?: string;
  projectRevision?: number;
  sourceBundleId?: string;
  researchRunId?: string;
  goal: string;
  createdAt: Date;
  updatedAt: Date;
  /** Active cognitive work only; excludes navigation and writeback workflow events. */
  activeLearningEventCount: number;
  practicePayloads: JsonObject[];
  researchSources: SynthesisResearchSource[];
}

export interface SynthesisClassroomInput extends SynthesisClassroomRecord {
  title: string;
  description?: string;
  scenes: Array<{ id: string; title: string; order: number; type: string }>;
  obsidianSources: Array<{ title: string; tags: string[] }>;
}

export interface SynthesisRunRecord {
  id: string;
  ownerId: string;
  scheduleId?: string;
  projectId?: string;
  projectName?: string;
  mode: SynthesisMode;
  title: string;
  scope: SynthesisScope;
  summaryMarkdown: string;
  graph: KnowledgeGraph;
  graphHash: string;
  classroomCount: number;
  baselineSynthesisId?: string;
  incremental: boolean;
  evidenceManifest: SynthesisEvidenceFingerprint[];
  delta?: SynthesisDelta;
  taskCandidates: SynthesisTaskCandidate[];
  createdAt: Date;
  updatedAt: Date;
}

export type SaveSynthesisRunInput = SynthesisRunRecord;

export interface SynthesisListItem {
  id: string;
  projectId?: string;
  projectName?: string;
  mode: SynthesisMode;
  title: string;
  classroomCount: number;
  nodeCount: number;
  edgeCount: number;
  createdAt: string;
}

export interface SynthesisRunView extends SynthesisListItem {
  scheduleId?: string;
  baselineSynthesisId?: string;
  incremental: boolean;
  scope: SynthesisScope;
  summaryMarkdown: string;
  graph: KnowledgeGraph;
  graphHash: string;
  evidenceManifest: SynthesisEvidenceFingerprint[];
  delta?: SynthesisDelta;
  taskCandidates: SynthesisTaskCandidate[];
  updatedAt: string;
}

/** A privacy-preserving fingerprint of the durable evidence used by one run. */
export interface SynthesisEvidenceFingerprint {
  /**
   * The durable classroom that produced the evidence. For legacy rows created
   * before snapshot identities were separated, this may still contain a
   * snapshot id; freshness evaluation falls back to graph provenance.
   */
  classroomId: string;
  /** Distinguishes multiple verified revisions produced by one classroom. */
  snapshotId?: string;
  activityAt: string;
  fingerprint: string;
}

export interface SynthesisMasteryChange {
  nodeId: string;
  label: string;
  from: number | null;
  to: number | null;
}

/**
 * A factual graph comparison. `conflicts` stays empty unless a future
 * evidence-level contradiction detector can cite both conflicting sources.
 */
export interface SynthesisDelta {
  schemaVersion: 'synthesis-delta/1';
  baselineSynthesisId?: string;
  addedClassroomIds: string[];
  updatedClassroomIds: string[];
  removedClassroomIds: string[];
  addedNodeIds: string[];
  removedNodeIds: string[];
  addedEdgeIds: string[];
  removedEdgeIds: string[];
  strengthened: SynthesisMasteryChange[];
  weakened: SynthesisMasteryChange[];
  relationChanges: Array<{ edgeId: string; kind: 'added' | 'removed'; label: string }>;
  conflicts: Array<{ nodeId: string; reason: string }>;
}

export interface SynthesisTaskCandidate {
  id: string;
  kind: 'review' | 'transfer';
  title: string;
  priority: 'high' | 'normal';
  classroomId?: string;
  relatedNodeIds: string[];
  rationale: string;
}

export interface SynthesisScheduleRecord {
  id: string;
  ownerId: string;
  name: string;
  period: SynthesisSchedulePeriod;
  /** Required only for a custom rolling interval. */
  intervalMinutes?: number;
  timezone: string;
  mode: SynthesisMode;
  scope: SynthesisScope;
  scopeHash: string;
  status: SynthesisScheduleStatus;
  nextRunAt: Date;
  lastSuccessAt?: Date;
  lastSynthesisId?: string;
  lastError?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface SynthesisScheduleRunRecord {
  id: string;
  ownerId: string;
  scheduleId: string;
  scheduledFor: Date;
  state: SynthesisScheduleRunState;
  synthesisId?: string;
  baselineSynthesisId?: string;
  evidenceManifest: SynthesisEvidenceFingerprint[];
  errorDetail?: string;
  startedAt: Date;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}
