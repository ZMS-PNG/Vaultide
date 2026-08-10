import type {
  KnowledgeSnapshotProjection,
  KnowledgeSnapshotRecord,
  KnowledgeSnapshotScopeKind,
} from '../domain/knowledge-snapshot';

export interface AppendKnowledgeSnapshotInput {
  ownerId: string;
  sessionId: string;
  projection: KnowledgeSnapshotProjection;
  /**
   * Optional compare-and-swap guard. If supplied, the append succeeds only
   * when this is still the latest snapshot for the session.
   */
  expectedParentSnapshotId?: string;
  now: Date;
}

export interface KnowledgeSnapshotRepository {
  append(input: AppendKnowledgeSnapshotInput): Promise<KnowledgeSnapshotRecord>;
  findLatest(ownerId: string, sessionId: string): Promise<KnowledgeSnapshotRecord | null>;
  findLatestForScope(
    ownerId: string,
    scopeKind: KnowledgeSnapshotScopeKind,
    scopeId: string,
  ): Promise<KnowledgeSnapshotRecord | null>;
  findById(ownerId: string, snapshotId: string): Promise<KnowledgeSnapshotRecord | null>;
}
