import type {
  KnowledgeGraphRefreshChange,
  KnowledgeGraphRefreshRequestRecord,
  KnowledgeGraphRefreshQueueStatus,
  KnowledgeGraphRefreshState,
} from '../domain/knowledge-graph-refresh';

export interface EnqueueKnowledgeGraphRefreshInput extends KnowledgeGraphRefreshChange {
  id: string;
  ownerId: string;
  dedupeKey: string;
  now: Date;
}

export interface CompleteKnowledgeGraphRefreshInput {
  ownerId: string;
  requestId: string;
  state: Exclude<KnowledgeGraphRefreshState, 'pending' | 'processing'>;
  synthesisIds: string[];
  projectionIds: string[];
  errorDetail?: string;
  retryAt?: Date;
  now: Date;
}

export interface KnowledgeGraphRefreshRepository {
  enqueue(
    input: EnqueueKnowledgeGraphRefreshInput,
  ): Promise<{ record: KnowledgeGraphRefreshRequestRecord; enqueued: boolean }>;
  claimPending(
    ownerId: string,
    now: Date,
    leaseExpiresAt: Date,
    limit: number,
  ): Promise<KnowledgeGraphRefreshRequestRecord[]>;
  findAffectedSynthesisIds(
    ownerId: string,
    request: KnowledgeGraphRefreshRequestRecord,
    limit: number,
  ): Promise<string[]>;
  queueStatus(ownerId: string): Promise<KnowledgeGraphRefreshQueueStatus>;
  complete(input: CompleteKnowledgeGraphRefreshInput): Promise<void>;
}
