export type KnowledgeGraphRefreshTriggerKind =
  | 'learning-event'
  | 'source-version'
  | 'writeback-receipt'
  | 'synthesis';

export type KnowledgeGraphRefreshState =
  | 'pending'
  | 'processing'
  | 'succeeded'
  | 'skipped'
  | 'failed';

export interface KnowledgeGraphRefreshChange {
  triggerKind: KnowledgeGraphRefreshTriggerKind;
  triggerId: string;
  classroomId?: string;
  projectId?: string;
  synthesisId?: string;
  sourceVersionId?: string;
}

export interface KnowledgeGraphRefreshRequestRecord extends KnowledgeGraphRefreshChange {
  id: string;
  ownerId: string;
  dedupeKey: string;
  state: KnowledgeGraphRefreshState;
  attemptCount: number;
  availableAt: Date;
  leaseExpiresAt?: Date;
  errorDetail?: string;
  result: {
    synthesisIds: string[];
    projectionIds: string[];
  };
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
}

export interface KnowledgeGraphRefreshProcessResult {
  attempted: number;
  succeeded: number;
  skipped: number;
  failed: number;
  projectionIds: string[];
}

export interface KnowledgeGraphRefreshQueueStatus {
  pending: number;
  processing: number;
  failed: number;
  succeeded: number;
  skipped: number;
  exhausted: number;
  oldestAvailableAt?: Date;
}
