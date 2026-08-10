import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NeonProjectRetrievalRepository } from '@/lib/learning/adapters/neon/project-retrieval-repository';

const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('@/lib/learning/adapters/neon/client', () => ({
  getLearningSql: () => ({ query: mocks.query }),
}));

const OWNER_ID = `own_${'1'.repeat(32)}`;
const PROJECT_ID = `prj_${'2'.repeat(32)}`;
const SOURCE_ID = `sou_${'3'.repeat(32)}`;
const NOW = new Date('2026-07-23T12:00:00.000Z');

describe('NeonProjectRetrievalRepository', () => {
  beforeEach(() => mocks.query.mockReset());

  it('reports searchable, pending, and failed source coverage separately', async () => {
    mocks.query.mockResolvedValue([
      {
        project_id: PROJECT_ID,
        display_name: 'Project',
        project_revision: 7,
        active_source_count: 12,
        searchable_source_count: 9,
        pending_source_count: 2,
        failed_source_count: 1,
        indexed_chunk_count: 36,
        last_indexed_at: NOW.toISOString(),
      },
    ]);
    const store = new NeonProjectRetrievalRepository();

    await expect(store.findProject(OWNER_ID, PROJECT_ID, NOW)).resolves.toMatchObject({
      activeSourceCount: 12,
      searchableSourceCount: 9,
      pendingSourceCount: 2,
      failedSourceCount: 1,
      indexedChunkCount: 36,
    });
    const [sql, values] = mocks.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("source_index.status = 'ready'");
    expect(sql).toContain("source_index.status = 'pending'");
    expect(sql).toContain("source_index.status = 'failed'");
    expect(sql).toContain('ps.latest_version_id');
    expect(values).toEqual([OWNER_ID, PROJECT_ID, NOW]);
  });

  it('loads explicit required sources only from current ready versions and live bundles', async () => {
    mocks.query.mockResolvedValue([
      {
        chunk_id: `chk_${'4'.repeat(32)}`,
        source_id: SOURCE_ID,
        source_version_id: `svr_${'5'.repeat(32)}`,
        source_bundle_id: `src_${'6'.repeat(32)}`,
        snapshot_id: `snp_${'7'.repeat(32)}`,
        title: 'Required source',
        relative_path: 'Project/Required.md',
        chunk_ordinal: 1,
        start_char: 0,
        end_char: 120,
        content_hash: '8'.repeat(64),
        heading_path: ['Constraint'],
        score: 0,
      },
    ]);
    const store = new NeonProjectRetrievalRepository();

    await expect(
      store.listSourceChunks(OWNER_ID, PROJECT_ID, NOW, [SOURCE_ID], 3),
    ).resolves.toEqual([
      expect.objectContaining({
        sourceId: SOURCE_ID,
        relativePath: 'Project/Required.md',
        fallback: false,
      }),
    ]);
    const [sql, values] = mocks.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('ps.source_id = ANY($4::text[])');
    expect(sql).toContain("source_index.status = 'ready'");
    expect(sql).toContain("live_upload.status = 'validated'");
    expect(values).toEqual([OWNER_ID, PROJECT_ID, NOW, [SOURCE_ID], 3]);
  });

  it('validates the serialized citation count without forcing a database division error', async () => {
    mocks.query.mockResolvedValue([{ owner_id: OWNER_ID }]);
    const store = new NeonProjectRetrievalRepository();

    await expect(
      store.saveRun({
        id: `prr_${'4'.repeat(32)}`,
        ownerId: OWNER_ID,
        projectId: PROJECT_ID,
        projectRevision: 1,
        goal: 'Understand the project startup path.',
        goalHash: '5'.repeat(64),
        strategy: 'lexical-diverse-v1',
        maxContextChars: 20_000,
        contextCharCount: 1_200,
        candidateChunkCount: 1,
        selectedChunkCount: 1,
        selectedSourceCount: 1,
        metrics: {},
        citations: [
          {
            citationId: 'V1',
            chunkId: `chk_${'6'.repeat(32)}`,
            sourceId: SOURCE_ID,
            sourceVersionId: `svr_${'7'.repeat(32)}`,
            sourceBundleId: `src_${'8'.repeat(32)}`,
            snapshotId: `snp_${'9'.repeat(32)}`,
            title: 'Startup',
            relativePath: 'Project/Startup.md',
            headingPath: [],
            chunkOrdinal: 1,
            score: 0.1,
            excerptChars: 1200,
            excerptPreview: 'Preview',
            matchedTerms: ['startup'],
            selectionReason: 'goal-match',
            contentHash: 'a'.repeat(64),
          },
        ],
        requiredSourceIds: [],
        excludedSourceIds: [],
        createdAt: NOW,
      }),
    ).resolves.toBe(true);

    const [sql, values] = mocks.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('jsonb_array_length($16::jsonb) = $12');
    expect(sql).not.toContain('1 / 0');
    expect(values[11]).toBe(1);
    expect(JSON.parse(String(values[15]))).toHaveLength(1);
  });
});
