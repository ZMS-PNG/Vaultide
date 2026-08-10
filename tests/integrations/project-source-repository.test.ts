import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeviceTokenPrincipal } from '@/lib/learning/domain/device-token';
import type {
  SourceUploadIntent,
  SourceUploadTokenPayload,
  ValidatedProjectSourceBundle,
} from '@/lib/learning/domain/source-upload';

const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('@/lib/learning/adapters/neon/client', () => ({
  getLearningSql: () => ({ query: mocks.query }),
}));

import { NeonSourceUploadRepository } from '@/lib/learning/adapters/neon/source-upload-repository';
import { NeonProjectRepository } from '@/lib/learning/adapters/neon/project-repository';

const NOW = new Date('2026-07-23T08:00:00.000Z');
const PROJECT_ID = `prj_${'1'.repeat(32)}`;
const SOURCE_ID = `sou_${'2'.repeat(32)}`;
const SNAPSHOT_ID = `snp_${'3'.repeat(32)}`;
const BUNDLE_ID = `src_${'4'.repeat(32)}`;
const principal: DeviceTokenPrincipal = {
  ownerId: `own_${'5'.repeat(32)}`,
  deviceId: `dev_${'6'.repeat(32)}`,
  vaultBindingId: `vlt_${'7'.repeat(32)}`,
  scopes: ['sources:write'],
};
const pathname = `learning-sources/${principal.ownerId}/${principal.vaultBindingId}/${BUNDLE_ID}.json`;

function intent(): SourceUploadIntent {
  return {
    bundleId: BUNDLE_ID,
    manifestHash: '8'.repeat(64),
    sourceByteSize: 4,
    itemCount: 1,
    retentionUntil: new Date('2026-07-24T08:00:00.000Z'),
    projectId: PROJECT_ID,
    expectedProjectRevision: 2,
    baseManifestHash: '9'.repeat(64),
    projectCoverage: 'partial',
    projectSources: [{ snapshotId: SNAPSHOT_ID, sourceId: SOURCE_ID }],
  };
}

function payload(): SourceUploadTokenPayload {
  return {
    ...intent(),
    ...principal,
    pathname,
  };
}

function sources(): ValidatedProjectSourceBundle {
  return {
    projectId: PROJECT_ID,
    coverage: 'partial',
    expectedProjectRevision: 2,
    nextProjectRevision: 3,
    baseManifestHash: '9'.repeat(64),
    bundleRevision: 1,
    items: [
      {
        ordinal: 1,
        snapshotId: SNAPSHOT_ID,
        sourceId: SOURCE_ID,
        origin: 'obsidian',
        identityKeyHash: 'a'.repeat(64),
        title: 'Note',
        contentHash: 'b'.repeat(64),
        mimeType: 'text/markdown',
        byteSize: 4,
        locator: {
          kind: 'obsidian',
          vaultBindingId: principal.vaultBindingId,
          relativePath: 'Projects/Note.md',
        },
        metadata: {},
      },
    ],
    chunks: [
      {
        chunkId: `chk_${'c'.repeat(32)}`,
        sourceId: SOURCE_ID,
        snapshotId: SNAPSHOT_ID,
        ordinal: 1,
        startChar: 0,
        endChar: 4,
        charCount: 4,
        contentHash: 'd'.repeat(64),
        headingPath: ['Note'],
        anchorTokens: 'note',
        bodyTokens: 'body',
        tokenCount: 1,
      },
    ],
  };
}

describe('NeonSourceUploadRepository project contract', () => {
  beforeEach(() => mocks.query.mockReset());

  it('starts only at the expected project_revision with the real coverage fields', async () => {
    mocks.query.mockResolvedValue([{ id: BUNDLE_ID }]);
    const store = new NeonSourceUploadRepository();

    await expect(store.beginUpload(principal, intent(), pathname, NOW)).resolves.toBe(true);
    const [sql, values] = mocks.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('project_coverage, expected_project_revision, base_manifest_hash');
    expect(sql).toContain('p.project_revision = $11');
    expect(sql).not.toMatch(/sync_mode|syncMode|\bfull\b/);
    expect(values).toContain('partial');
    expect(values).toContain(2);
  });

  it('registers the sidecar sou_ id atomically and never removes sources for partial coverage', async () => {
    mocks.query.mockResolvedValue([{ owner_id: principal.ownerId }]);
    const store = new NeonSourceUploadRepository();

    await expect(
      store.completeUpload(payload(), 'https://blob.example/private.json', 512, NOW, sources()),
    ).resolves.toBe(true);
    const [sql, values] = mocks.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('SELECT source_id, owner_id');
    expect(sql).toContain('SET project_revision = $18');
    expect(sql).toContain("AND $14::text = 'complete'");
    expect(sql).toContain('learning_sources.identity_key_hash = EXCLUDED.identity_key_hash');
    const sourceConflict = sql.match(
      /ON CONFLICT \(id\) DO UPDATE([\s\S]*?)RETURNING id, owner_id, vault_binding_id/,
    )?.[1];
    expect(sourceConflict).toBeDefined();
    expect(sourceConflict).not.toContain('identity_key_hash = EXCLUDED.identity_key_hash,');
    expect(sourceConflict).not.toContain('origin = EXCLUDED.origin,');
    expect(sql).not.toMatch(/'sor_'|p\.revision|sync_mode|syncMode|\bfull\b/);
    expect(values[13]).toBe('partial');
    const serializedItems = JSON.parse(String(values[18])) as Array<{
      source_id: string;
    }>;
    expect(serializedItems).toEqual([expect.objectContaining({ source_id: SOURCE_ID })]);
  });

  it('scopes status by owner, device, and Vault', async () => {
    mocks.query.mockResolvedValue([
      {
        id: BUNDLE_ID,
        project_id: PROJECT_ID,
        project_coverage: 'partial',
        expected_project_revision: 2,
        bundle_revision: 1,
        manifest_hash: '8'.repeat(64),
        item_count: 1,
        source_byte_size: 4,
        archive_byte_size: 512,
        status: 'validated',
        failure_code: null,
        retention_until: '2026-07-24T08:00:00.000Z',
        created_at: NOW.toISOString(),
        completed_at: NOW.toISOString(),
        project_indexed_at: NOW.toISOString(),
      },
    ]);
    const store = new NeonSourceUploadRepository();

    await expect(store.getStatus(principal, BUNDLE_ID)).resolves.toMatchObject({
      projectId: PROJECT_ID,
      projectCoverage: 'partial',
      expectedProjectRevision: 2,
      status: 'validated',
    });
    const [sql, values] = mocks.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('id = $1 AND owner_id = $2 AND device_id = $3 AND vault_binding_id = $4');
    expect(values).toEqual([
      BUNDLE_ID,
      principal.ownerId,
      principal.deviceId,
      principal.vaultBindingId,
    ]);
  });

  it('treats a duplicate validated callback as idempotent', async () => {
    mocks.query.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: BUNDLE_ID }]);
    const store = new NeonSourceUploadRepository();

    await expect(
      store.completeUpload(payload(), 'https://blob.example/private.json', 512, NOW, sources()),
    ).resolves.toBe(true);
    expect(mocks.query).toHaveBeenCalledTimes(2);
    const mutationSql = String(mocks.query.mock.calls[0]?.[0]);
    const confirmationSql = String(mocks.query.mock.calls[1]?.[0]);
    expect(mutationSql).toContain('FROM candidate_upload');
    expect(confirmationSql).toContain("bundle_revision = $14 AND status = 'validated'");
  });

  it('builds deterministic chunks separately from upload validation and marks the batch ready', async () => {
    mocks.query
      .mockResolvedValueOnce([{ source_id: SOURCE_ID, source_version_id: `svr_${'d'.repeat(32)}` }])
      .mockResolvedValueOnce([{ owner_id: principal.ownerId }]);
    const store = new NeonSourceUploadRepository();
    const chunk = sources().chunks[0]!;

    await expect(
      store.indexProjectChunks(principal.ownerId, BUNDLE_ID, intent().retentionUntil, [chunk], NOW),
    ).resolves.toBe(true);
    expect(mocks.query).toHaveBeenCalledTimes(2);
    const prepareSql = String(mocks.query.mock.calls[0]?.[0]);
    const indexSql = String(mocks.query.mock.calls[1]?.[0]);
    expect(prepareSql).toContain('INSERT INTO learning_source_indexes');
    expect(indexSql).toContain('INSERT INTO learning_source_chunks');
    expect(indexSql).toContain("SET chunk_index_status = 'ready'");
    expect(indexSql).toContain('chunk_assertion');
  });

  it('keeps legacy uploads compatible without allowing them to downgrade project rows', async () => {
    mocks.query.mockResolvedValue([{ id: BUNDLE_ID }]);
    const store = new NeonSourceUploadRepository();
    const legacyIntent: SourceUploadIntent = {
      bundleId: BUNDLE_ID,
      manifestHash: '8'.repeat(64),
      sourceByteSize: 4,
      itemCount: 1,
      retentionUntil: new Date('2026-07-24T08:00:00.000Z'),
    };

    await expect(store.beginUpload(principal, legacyIntent, pathname, NOW)).resolves.toBe(true);
    expect(String(mocks.query.mock.calls[0]?.[0])).toContain('source_uploads.project_id IS NULL');

    mocks.query.mockReset();
    mocks.query.mockResolvedValue([{ owner_id: principal.ownerId }]);
    const legacyPayload: SourceUploadTokenPayload = {
      ...legacyIntent,
      ...principal,
      pathname,
    };
    await expect(
      store.completeUpload(legacyPayload, 'https://blob.example/private.json', 512, NOW),
    ).resolves.toBe(true);
    expect(String(mocks.query.mock.calls[0]?.[0])).toContain('AND project_id IS NULL');
  });
});

describe('NeonProjectRepository binding contract', () => {
  beforeEach(() => mocks.query.mockReset());

  it('allows an optimistic folder move while preserving the stable prj_ id', async () => {
    mocks.query.mockResolvedValue([
      {
        id: PROJECT_ID,
        owner_id: principal.ownerId,
        vault_binding_id: principal.vaultBindingId,
        kind: 'obsidian-folder',
        display_name: 'Project',
        root_path: 'Projects/Moved',
        status: 'active',
        binding_revision: 2,
        project_revision: 0,
        latest_manifest_hash: null,
        metadata: {},
        last_indexed_at: null,
        created_at: NOW.toISOString(),
        updated_at: NOW.toISOString(),
      },
    ]);
    const store = new NeonProjectRepository();

    await expect(
      store.register(
        principal,
        {
          projectId: PROJECT_ID,
          vaultBindingId: principal.vaultBindingId,
          kind: 'obsidian-folder',
          projectName: 'Project',
          rootPath: 'Projects/Moved',
          bindingKeyHash: 'c'.repeat(64),
          metadata: {},
          expectedBindingRevision: 1,
        },
        NOW,
      ),
    ).resolves.toMatchObject({
      id: PROJECT_ID,
      rootPath: 'Projects/Moved',
      bindingRevision: 2,
    });
    const sql = String(mocks.query.mock.calls[0]?.[0]);
    expect(sql).toContain('root_path = $6');
    expect(sql).toContain('binding_key_hash = $7');
    expect(sql).toContain('p.binding_revision = $10');
  });
});
