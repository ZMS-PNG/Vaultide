import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NeonKnowledgeSnapshotRepository } from '@/lib/learning/adapters/neon/knowledge-snapshot-repository';
import {
  KNOWLEDGE_SNAPSHOT_PROJECTOR_VERSION,
  type KnowledgeSnapshotProjection,
} from '@/lib/learning/domain/knowledge-snapshot';

const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('@/lib/learning/adapters/neon/client', () => ({
  getLearningSql: () => ({ query: mocks.query }),
}));

const OWNER_ID = `own_${'1'.repeat(32)}`;
const SESSION_ID = `lsn_${'2'.repeat(32)}`;
const PARENT_ID = `ksn_${'3'.repeat(32)}`;
const NOW = new Date('2026-07-28T12:00:00.000Z');

const projection: KnowledgeSnapshotProjection = {
  verifiedKnowledge: [
    {
      id: `ken_${'4'.repeat(32)}`,
      kind: 'claim',
      text: 'A verified claim.',
      trace: {
        learningEventId: `lev_${'5'.repeat(32)}`,
        evaluationEventId: `lev_${'6'.repeat(32)}`,
        verifiedAt: NOW.toISOString(),
        confidence: 0.96,
        sourceReferences: [{ referenceId: 'V1', locator: 'Projects/source.md' }],
      },
    },
  ],
  misconceptions: [],
  unresolvedItems: [],
  evidenceSummary: {
    projectorVersion: KNOWLEDGE_SNAPSHOT_PROJECTOR_VERSION,
    parentSnapshotId: PARENT_ID,
    acceptedEvaluationEventIds: [`lev_${'6'.repeat(32)}`],
    evaluatedLearningEventIds: [`lev_${'5'.repeat(32)}`],
    sourceReferenceIds: ['V1'],
    rejected: {
      unverifiedLearningEvents: 0,
      invalidEvaluations: 0,
      malformedEntries: 0,
      missingSourceReferences: 0,
    },
  },
  eligibleForPersistence: true,
};

function row(id = `ksn_${'7'.repeat(32)}`) {
  return {
    id,
    owner_id: OWNER_ID,
    session_id: SESSION_ID,
    scope_kind: 'project',
    scope_id: `prj_${'8'.repeat(32)}`,
    revision: 2,
    parent_snapshot_id: PARENT_ID,
    source_manifest_sha256: '9'.repeat(64),
    verified_knowledge: projection.verifiedKnowledge,
    misconceptions: [],
    unresolved_items: [],
    evidence_summary: projection.evidenceSummary,
    created_at: NOW.toISOString(),
  };
}

describe('NeonKnowledgeSnapshotRepository', () => {
  beforeEach(() => mocks.query.mockReset());

  it('appends under a session lock with a parent compare-and-swap guard', async () => {
    mocks.query.mockResolvedValueOnce([row()]);
    const repository = new NeonKnowledgeSnapshotRepository();

    await expect(
      repository.append({
        ownerId: OWNER_ID,
        sessionId: SESSION_ID,
        projection,
        expectedParentSnapshotId: PARENT_ID,
        now: NOW,
      }),
    ).resolves.toMatchObject({
      ownerId: OWNER_ID,
      sessionId: SESSION_ID,
      revision: 2,
      scopeKind: 'project',
      parentSnapshotId: PARENT_ID,
      sourceManifestSha256: '9'.repeat(64),
      verifiedKnowledge: projection.verifiedKnowledge,
    });

    const [sql, values] = mocks.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('pg_advisory_xact_lock');
    expect(sql).toContain("jsonb_build_object('parentSnapshotId', state.latest_id)");
    expect(sql).toContain('current_knowledge_snapshot_id = inserted.id');
    expect(values[3]).toBe(PARENT_ID);
    expect(values[4]).toBe(JSON.stringify(projection.verifiedKnowledge));
    expect(values[2]).toMatch(/^ksn_[a-f0-9]{32}$/);
  });

  it('fails closed on an empty projection and on a stale parent', async () => {
    const repository = new NeonKnowledgeSnapshotRepository();
    await expect(
      repository.append({
        ownerId: OWNER_ID,
        sessionId: SESSION_ID,
        projection: {
          ...projection,
          verifiedKnowledge: [],
          eligibleForPersistence: false,
        },
        now: NOW,
      }),
    ).rejects.toThrow('knowledge_snapshot_has_no_verified_content');
    expect(mocks.query).not.toHaveBeenCalled();

    mocks.query.mockResolvedValueOnce([]);
    await expect(
      repository.append({
        ownerId: OWNER_ID,
        sessionId: SESSION_ID,
        projection,
        expectedParentSnapshotId: PARENT_ID,
        now: NOW,
      }),
    ).rejects.toThrow('knowledge_snapshot_parent_conflict');
  });

  it('loads the latest immutable revision', async () => {
    mocks.query.mockResolvedValueOnce([row()]);
    const repository = new NeonKnowledgeSnapshotRepository();
    await expect(repository.findLatest(OWNER_ID, SESSION_ID)).resolves.toMatchObject({
      revision: 2,
      evidenceSummary: {
        parentSnapshotId: PARENT_ID,
        sourceReferenceIds: ['V1'],
      },
    });
    expect((mocks.query.mock.calls[0] as [string])[0]).toContain('ORDER BY revision DESC');
  });

  it('loads the latest verified basis across sessions in the same project scope', async () => {
    mocks.query.mockResolvedValueOnce([row()]);
    const repository = new NeonKnowledgeSnapshotRepository();
    await expect(
      repository.findLatestForScope(OWNER_ID, 'project', `prj_${'8'.repeat(32)}`),
    ).resolves.toMatchObject({
      scopeKind: 'project',
      scopeId: `prj_${'8'.repeat(32)}`,
      revision: 2,
    });
    const [sql, values] = mocks.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('scope_kind = $2');
    expect(values).toEqual([OWNER_ID, 'project', `prj_${'8'.repeat(32)}`]);
  });
});
