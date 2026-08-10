import type {
  JsonObject,
  LearningEvent,
  WritebackCommand,
  WritebackReceipt,
} from '@openmaic/learning-protocol';

export interface LearningSprintRecord {
  id: string;
  ownerId: string;
  classroomId: string;
  sourceBundleId?: string;
  projectId?: string;
  projectName?: string;
  projectRevision?: number;
  retrievalRunId?: string;
  researchRunId?: string;
  goal: string;
  status: 'active' | 'completed' | 'archived';
  createdAt: Date;
  updatedAt: Date;
}

export interface WritebackTarget {
  deviceId: string;
  vaultBindingId: string;
  vaultName: string;
}

export interface QuizProgressSummary {
  sceneId: string;
  title: string;
  answered: number;
  total: number;
  earned?: number;
  possible?: number;
}

export interface LearningProgressSnapshot {
  currentSceneId?: string;
  quizSummaries: QuizProgressSummary[];
}

export interface ManagedBlockState {
  id: string;
  content: string;
  contentHash: string;
}

/** The desired next state plus the compare-and-swap hash for a draft. */
export interface ManagedBlockDraft extends ManagedBlockState {
  expectedHash?: string;
}

export interface LearningCompanionRecord {
  id: string;
  ownerId: string;
  vaultBindingId: string;
  sourceId: string;
  sourceBundleId?: string;
  sourceSnapshotId?: string;
  projectId?: string;
  originalRelativePath: string;
  relativePath: string;
  status: 'active' | 'archived';
  managedBlocks: ManagedBlockState[];
  lastContentHash?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface WritebackDraftRecord {
  id: string;
  ownerId: string;
  draftKind:
    | 'learning-summary'
    | 'external-card'
    | 'synthesis'
    | 'project-index'
    | 'synthesis-index'
    | 'vault-overview';
  sprintId?: string;
  synthesisRunId?: string;
  assetId?: string;
  assetVersionId?: string;
  projectIndexId?: string;
  synthesisIndexId?: string;
  vaultOverviewId?: string;
  targetDeviceId: string;
  targetVaultBindingId: string;
  revision: number;
  status:
    | 'generated'
    | 'edited'
    | 'approved'
    | 'applied'
    | 'conflicted'
    | 'failed'
    | 'rejected'
    | 'expired';
  operation:
    | 'createManagedNote'
    | 'replaceManagedBlocks'
    | 'replaceProjectIndexBlocks'
    | 'replaceSynthesisIndexBlocks'
    | 'replaceVaultOverviewBlocks';
  companionId?: string;
  managedBlocks: ManagedBlockDraft[];
  relativePath: string;
  content: string;
  frontmatter: JsonObject;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateWritebackDraftRecord {
  id: string;
  ownerId: string;
  sprintId?: string;
  draftKind?:
    | 'learning-summary'
    | 'external-card'
    | 'project-index'
    | 'synthesis-index'
    | 'vault-overview';
  assetId?: string;
  assetVersionId?: string;
  projectIndexId?: string;
  synthesisIndexId?: string;
  vaultOverviewId?: string;
  targetDeviceId: string;
  targetVaultBindingId: string;
  operation?: WritebackDraftRecord['operation'];
  companionId?: string;
  managedBlocks?: ManagedBlockDraft[];
  relativePath: string;
  content: string;
  frontmatter: JsonObject;
  now: Date;
}

export interface CreateSynthesisWritebackDraftRecord {
  id: string;
  ownerId: string;
  synthesisRunId: string;
  targetDeviceId: string;
  targetVaultBindingId: string;
  relativePath: string;
  content: string;
  frontmatter: JsonObject;
  now: Date;
}

export interface AppendLearningEventsResult {
  accepted: number;
  deduplicated: number;
}

export interface MasteryProjectionRecord {
  id: string;
  ownerId: string;
  sprintId: string;
  conceptId: string;
  estimate: number | null;
  confidence: number;
  evidenceCount: number;
  evidenceTypes: string[];
  evidenceSummary: Array<{
    eventId: string;
    eventType: string;
    occurredAt: string;
    score: number;
    weight: number;
    independence: number;
  }>;
  lastPracticedAt?: string;
  nextReviewAt?: string;
  projectorVersion: string;
  computedAt: Date;
  classroomId: string;
  goal: string;
  projectId?: string;
  projectName?: string;
}

export interface ReviewItemRecord {
  id: string;
  ownerId: string;
  sprintId: string;
  conceptId: string;
  projectorVersion: string;
  state: 'scheduled' | 'due' | 'completed' | 'cancelled';
  dueAt: Date;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

/** A due/scheduled review enriched with the classroom and project it belongs to. */
export interface ReviewQueueItemRecord extends ReviewItemRecord {
  classroomId: string;
  goal: string;
  projectId?: string;
  projectName?: string;
  masteryEstimate: number | null;
  masteryConfidence: number;
  masteryEvidenceCount: number;
  isDue: boolean;
}

export type DepositionMode = 'manual' | 'batch' | 'managed-auto';

export interface DepositionPolicyRecord {
  ownerId: string;
  mode: DepositionMode;
  managedAutoEnabled: boolean;
  allowCompanionUpdates: boolean;
  allowSynthesisIndexUpdates: boolean;
  allowExternalCards: boolean;
  updatedAt: Date;
}

export type DepositionRunState =
  | 'pending'
  | 'collecting'
  | 'generated'
  | 'policy_checked'
  | 'queued'
  | 'leased'
  | 'locally_validated'
  | 'applied'
  | 'receipted'
  | 'blocked_missing_source'
  | 'blocked_policy'
  | 'conflicted'
  | 'expired'
  | 'failed_retryable'
  | 'failed_terminal'
  | 'cancelled';

export interface DepositionRunRecord {
  id: string;
  ownerId: string;
  sprintId?: string;
  assetType:
    | 'learning-companion'
    | 'learning-summary'
    | 'external-card'
    | 'project-index'
    | 'synthesis';
  idempotencyKey: string;
  projectorVersion: string;
  state: DepositionRunState;
  riskLevel: 'none' | 'low' | 'medium' | 'high';
  errorCode?: string;
  errorDetail?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface DepositionItemRecord {
  id: string;
  ownerId: string;
  runId: string;
  sourceVersionId?: string;
  targetKind: 'companion' | 'managed-note' | 'project-index' | 'synthesis';
  targetId?: string;
  writebackDraftId?: string;
  writebackCommandId?: string;
  receiptId?: string;
  state:
    | 'pending'
    | 'generated'
    | 'queued'
    | 'leased'
    | 'locally_validated'
    | 'applied'
    | 'receipted'
    | 'conflicted'
    | 'expired'
    | 'rejected'
    | 'failed'
    | 'skipped';
  commandRiskLevel: 'none' | 'low' | 'medium' | 'high';
  createdAt: Date;
  updatedAt: Date;
}

export interface ReceiptRecordResult {
  state: 'stored' | 'duplicate' | 'mismatch' | 'not_found';
  sprintId?: string;
}

export interface ClassroomLearningSnapshot {
  id: string;
  stage: {
    id: string;
    name: string;
    description?: string;
    learningContext?: {
      sourceBundleId?: string;
      projectId?: string;
      projectName?: string;
      projectRevision?: number;
      retrievalRunId?: string;
      retrievalStrategy?: string;
      retrievedSourceCount?: number;
      retrievedChunkCount?: number;
      retrievalMatchQuality?: 'strong' | 'weak';
      retrievalUnavailableSourceCount?: number;
      projectCoverageState?: 'authorized-index-complete' | 'authorized-index-partial';
      retrievalCitations?: Array<{
        citationId: string;
        sourceId: string;
        sourceVersionId: string;
        chunkId: string;
        relativePath: string;
        headingPath: string[];
        excerptChars: number;
        contentHash: string;
      }>;
      goal?: string;
      learningProject?: import('@openmaic/dsl').StageLearningProject;
      webSearchEnabled?: boolean;
      researchRunId?: string;
      researchProviderId?: string;
      researchFetchedAt?: string;
      researchSourcePolicy?: 'balanced' | 'prefer-primary';
      researchSources?: Array<{
        citationId?: string;
        title: string;
        url: string;
        domain?: string;
        authority?: 'primary' | 'authoritative' | 'general';
        score?: number;
      }>;
    };
  };
  scenes: Array<{
    id: string;
    title: string;
    order: number;
    type: string;
  }>;
  createdAt: string;
  updatedAt?: string;
}

export interface WritebackDraftView {
  id: string;
  revision: number;
  sprintId?: string;
  synthesisRunId?: string;
  draftKind: WritebackDraftRecord['draftKind'];
  assetId?: string;
  assetVersionId?: string;
  projectIndexId?: string;
  synthesisIndexId?: string;
  vaultOverviewId?: string;
  targetVaultName: string;
  operation: WritebackDraftRecord['operation'];
  companionId?: string;
  relativePath: string;
  content: string;
  status: WritebackDraftRecord['status'];
}

export type StoredLearningEvent = LearningEvent & {
  receivedAt: string;
  serverSeq: number;
};

export interface LeasedWritebackCommands {
  commands: WritebackCommand[];
  leaseExpiresAt?: string;
}

export type PendingWritebackReceipt = WritebackReceipt;
