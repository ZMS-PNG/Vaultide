import type { TrustedKnowledgeSnapshotInput } from '../domain/knowledge-space-synthesis';

/**
 * Read-only evidence boundary for synthesis.
 *
 * Implementations may read durable learning state, but they must never project
 * learner-authored answers directly. The domain layer re-validates every
 * returned snapshot before it is allowed into a synthesis.
 */
export interface KnowledgeSpaceEvidenceRepository {
  listKnowledgeSnapshots(ownerId: string): Promise<TrustedKnowledgeSnapshotInput[]>;
}
