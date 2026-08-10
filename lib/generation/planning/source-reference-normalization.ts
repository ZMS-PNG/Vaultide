import type { LearningSourceReference } from '@/lib/learning/domain/learning-context-pack';

const AUTHORITY_RANK: Record<NonNullable<LearningSourceReference['authority']>, number> = {
  general: 0,
  authoritative: 1,
  primary: 2,
  'private-original': 3,
};

function strongerAuthority(
  left: LearningSourceReference['authority'],
  right: LearningSourceReference['authority'],
): LearningSourceReference['authority'] {
  if (!left) return right;
  if (!right) return left;
  return AUTHORITY_RANK[right] > AUTHORITY_RANK[left] ? right : left;
}

/**
 * Retrieval selects chunks, while the durable context manifest identifies
 * canonical sources. Multiple selected chunks from one file must therefore
 * collapse to one source reference before planning.
 */
export function normalizeCourseSourceReferences(
  references: readonly LearningSourceReference[],
): LearningSourceReference[] {
  const byId = new Map<string, LearningSourceReference>();

  for (const reference of references) {
    const existing = byId.get(reference.id);
    if (!existing) {
      byId.set(reference.id, { ...reference });
      continue;
    }

    const authority = strongerAuthority(existing.authority, reference.authority);
    byId.set(reference.id, {
      ...existing,
      included: existing.included || reference.included,
      ...(existing.versionId || reference.versionId
        ? { versionId: existing.versionId ?? reference.versionId }
        : {}),
      ...(existing.locator || reference.locator
        ? { locator: existing.locator ?? reference.locator }
        : {}),
      ...(existing.contentHash || reference.contentHash
        ? { contentHash: existing.contentHash ?? reference.contentHash }
        : {}),
      ...(authority ? { authority } : {}),
      ...(existing.reason || reference.reason
        ? { reason: existing.reason ?? reference.reason }
        : {}),
    });
  }

  return [...byId.values()];
}
