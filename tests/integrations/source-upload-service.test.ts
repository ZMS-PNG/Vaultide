import { createHash } from 'node:crypto';
import {
  canonicalSourceManifest,
  stampSourceUploadIntent,
  stampSourceArchive,
  stampSourceBundle,
  type SourceArchive,
} from '@openmaic/learning-protocol';
import { describe, expect, it, vi, type Mocked } from 'vitest';
import type {
  PrivateBlobRead,
  PrivateBlobStore,
} from '@/lib/learning/adapters/vercel/private-blob-store';
import type { DeviceTokenService } from '@/lib/learning/application/device-token-service';
import { SourceUploadService } from '@/lib/learning/application/source-upload-service';
import type { DeviceTokenPrincipal } from '@/lib/learning/domain/device-token';
import {
  SOURCE_ARCHIVE_CONTENT_TYPE,
  type SourceUploadTokenPayload,
} from '@/lib/learning/domain/source-upload';
import type { SourceUploadRepository } from '@/lib/learning/ports/source-upload-repository';

const NOW = new Date('2026-07-21T12:00:00.000Z');
const CONTENT = '# Project\n';
const PROJECT_ID = `prj_${'1'.repeat(32)}`;
const SOURCE_ID = `sou_${'2'.repeat(32)}`;
const principal: DeviceTokenPrincipal = {
  ownerId: `own_${'a'.repeat(32)}`,
  deviceId: `dev_${'b'.repeat(32)}`,
  vaultBindingId: `vlt_${'c'.repeat(32)}`,
  scopes: ['sources:write', 'device:self'],
};

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function archive(): SourceArchive {
  const snapshot = {
    id: `snp_${'d'.repeat(32)}`,
    origin: 'obsidian' as const,
    title: 'Project',
    contentHash: sha256(CONTENT),
    mimeType: 'text/markdown',
    byteSize: Buffer.byteLength(CONTENT),
    locator: {
      kind: 'obsidian' as const,
      vaultBindingId: principal.vaultBindingId,
      relativePath: 'Projects/Test.md',
      sourceMtime: NOW.toISOString(),
    },
  };
  const provisional = stampSourceBundle({
    id: `src_${'e'.repeat(32)}`,
    ownerId: principal.ownerId,
    revision: 1,
    manifestHash: '0'.repeat(64),
    byteSize: snapshot.byteSize,
    itemCount: 1,
    selectionReason: 'Explicit test selection',
    sourcePolicy: { externalSearch: 'disabled' },
    snapshots: [snapshot],
    retentionUntil: new Date(NOW.getTime() + 24 * 60 * 60 * 1000).toISOString(),
    createdAt: NOW.toISOString(),
  });
  const bundle = { ...provisional, manifestHash: sha256(canonicalSourceManifest(provisional)) };
  return stampSourceArchive({
    bundle,
    contents: [{ snapshotId: snapshot.id, utf8Content: CONTENT }],
  });
}

function repository(): Mocked<SourceUploadRepository> {
  return {
    beginUpload: vi.fn().mockResolvedValue(true),
    completeUpload: vi.fn().mockResolvedValue(true),
    rejectUpload: vi.fn().mockResolvedValue(undefined),
    claimDeletion: vi.fn().mockResolvedValue({ blobUrl: 'https://blob.example/source.json' }),
    markDeleted: vi.fn().mockResolvedValue(true),
    listExpired: vi.fn().mockResolvedValue([]),
    markRetentionDeleted: vi.fn().mockResolvedValue(true),
    getValidatedForOwner: vi.fn().mockResolvedValue(null),
    getStatus: vi.fn().mockResolvedValue(null),
    getProjectBundleIndexState: vi.fn().mockResolvedValue(null),
    indexProjectChunks: vi.fn().mockResolvedValue(true),
    markProjectChunkIndexFailed: vi.fn().mockResolvedValue(undefined),
  } as Mocked<SourceUploadRepository>;
}

function tokenService(): DeviceTokenService {
  return {
    authenticateAccess: vi.fn().mockResolvedValue(principal),
  } as unknown as DeviceTokenService;
}

function blobStore(
  value: SourceArchive,
): PrivateBlobStore & Record<string, ReturnType<typeof vi.fn>> {
  const text = JSON.stringify(value);
  const blob: PrivateBlobRead = {
    url: 'https://blob.example/source.json',
    pathname: pathname(value),
    contentType: SOURCE_ARCHIVE_CONTENT_TYPE,
    size: Buffer.byteLength(text),
    text,
  };
  return {
    read: vi.fn().mockResolvedValue(blob),
    delete: vi.fn().mockResolvedValue(undefined),
  };
}

function pathname(value: SourceArchive): string {
  return `learning-sources/${principal.ownerId}/${principal.vaultBindingId}/${value.bundle.id}.json`;
}

function payload(value: SourceArchive): SourceUploadTokenPayload {
  return {
    ownerId: principal.ownerId,
    deviceId: principal.deviceId,
    vaultBindingId: principal.vaultBindingId,
    bundleId: value.bundle.id,
    manifestHash: value.bundle.manifestHash,
    sourceByteSize: value.bundle.byteSize,
    itemCount: value.bundle.itemCount,
    retentionUntil: new Date(value.bundle.retentionUntil),
    pathname: pathname(value),
  };
}

function projectIntent(value: SourceArchive, expectedProjectRevision = 0) {
  return stampSourceUploadIntent({
    bundleId: value.bundle.id,
    manifestHash: value.bundle.manifestHash,
    sourceByteSize: value.bundle.byteSize,
    itemCount: value.bundle.itemCount,
    retentionUntil: value.bundle.retentionUntil,
    project: {
      projectId: PROJECT_ID,
      expectedProjectRevision,
      coverage: 'partial',
      sources: [
        {
          snapshotId: value.bundle.snapshots[0]!.id,
          sourceId: SOURCE_ID,
        },
      ],
    },
  });
}

describe('SourceUploadService', () => {
  it('authorizes only the exact owner/Vault/bundle pathname', async () => {
    const source = archive();
    const store = repository();
    const service = new SourceUploadService(store, tokenService(), blobStore(source), () => NOW);
    const metadata = JSON.stringify({
      bundleId: source.bundle.id,
      manifestHash: source.bundle.manifestHash,
      sourceByteSize: source.bundle.byteSize,
      itemCount: 1,
      retentionUntil: source.bundle.retentionUntil,
    });

    await expect(
      service.authorizeUpload({
        accessToken: 'maic_at_test',
        pathname: pathname(source),
        clientPayload: metadata,
      }),
    ).resolves.toMatchObject({ bundleId: source.bundle.id, ownerId: principal.ownerId });
    await expect(
      service.authorizeUpload({
        accessToken: 'maic_at_test',
        pathname: 'learning-sources/another/path.json',
        clientPayload: metadata,
      }),
    ).rejects.toMatchObject({ code: 'invalid_request', status: 400 });
  });

  it('re-reads a private blob and validates manifest plus content hashes before registration', async () => {
    const source = archive();
    const store = repository();
    const blobs = blobStore(source);
    const service = new SourceUploadService(store, tokenService(), blobs, () => NOW);

    await expect(
      service.completeUpload({
        blob: {
          url: 'https://blob.example/source.json',
          pathname: pathname(source),
          contentType: SOURCE_ARCHIVE_CONTENT_TYPE,
        },
        tokenPayload: JSON.stringify(payload(source)),
      }),
    ).resolves.toEqual({ accepted: true });
    expect(store.completeUpload).toHaveBeenCalledWith(
      expect.objectContaining({ bundleId: source.bundle.id }),
      'https://blob.example/source.json',
      expect.any(Number),
      NOW,
      undefined,
    );
    expect(blobs.delete).not.toHaveBeenCalled();
  });

  it('rejects and deletes a newly uploaded blob when source content is tampered', async () => {
    const source = archive();
    source.contents[0].utf8Content = '# Tampered';
    const store = repository();
    const blobs = blobStore(source);
    const service = new SourceUploadService(store, tokenService(), blobs, () => NOW);

    await expect(
      service.completeUpload({
        blob: {
          url: 'https://blob.example/source.json',
          pathname: pathname(source),
          contentType: SOURCE_ARCHIVE_CONTENT_TYPE,
        },
        tokenPayload: JSON.stringify(payload(source)),
      }),
    ).resolves.toEqual({ accepted: false });
    expect(store.rejectUpload).toHaveBeenCalled();
    expect(blobs.delete).toHaveBeenCalledWith(pathname(source));
    expect(store.completeUpload).not.toHaveBeenCalled();
  });

  it('deletes only a bundle owned by the authenticated device and marks the row deleted', async () => {
    const source = archive();
    const store = repository();
    const blobs = blobStore(source);
    const service = new SourceUploadService(store, tokenService(), blobs, () => NOW);

    await expect(service.deleteUpload('maic_at_test', source.bundle.id)).resolves.toBe(true);
    expect(blobs.delete).toHaveBeenCalledWith('https://blob.example/source.json');
    expect(store.markDeleted).toHaveBeenCalledWith(principal, source.bundle.id, NOW);
  });

  it('purges expired private blobs and records retention deletion', async () => {
    const source = archive();
    const store = repository();
    store.listExpired.mockResolvedValue([
      { bundleId: source.bundle.id, blobUrl: 'https://blob.example/expired.json' },
    ]);
    const blobs = blobStore(source);
    const service = new SourceUploadService(store, tokenService(), blobs, () => NOW);

    await expect(service.purgeExpired()).resolves.toEqual({ deleted: 1, failed: 0 });
    expect(blobs.delete).toHaveBeenCalledWith('https://blob.example/expired.json');
    expect(store.markRetentionDeleted).toHaveBeenCalledWith(source.bundle.id, NOW);
  });

  it('reads a validated private archive only through owner-scoped metadata', async () => {
    const source = archive();
    const store = repository();
    store.getValidatedForOwner.mockResolvedValue(payload(source));
    const blobs = blobStore(source);
    const service = new SourceUploadService(store, tokenService(), blobs, () => NOW);

    await expect(
      service.readValidatedArchive(principal.ownerId, source.bundle.id),
    ).resolves.toEqual(source);
    expect(store.getValidatedForOwner).toHaveBeenCalledWith(
      principal.ownerId,
      source.bundle.id,
      NOW,
    );
    expect(blobs.read).toHaveBeenCalledWith(pathname(source));
  });

  it('enriches a verified project archive with server-assigned source identities for learning', async () => {
    const source = archive();
    const store = repository();
    store.getValidatedForOwner.mockResolvedValue(payload(source));
    store.getProjectBundleIndexState.mockResolvedValue({
      bundleId: source.bundle.id,
      projectId: PROJECT_ID,
      retentionUntil: new Date(source.bundle.retentionUntil),
      status: 'ready',
      sources: [
        {
          snapshotId: source.bundle.snapshots[0]!.id,
          sourceId: SOURCE_ID,
        },
      ],
    });
    const service = new SourceUploadService(
      store,
      tokenService(),
      blobStore(source),
      () => NOW,
    );

    const learningArchive = await service.readValidatedArchiveForLearning(
      principal.ownerId,
      source.bundle.id,
    );

    expect(learningArchive?.bundle.snapshots[0]).toMatchObject({
      id: source.bundle.snapshots[0]!.id,
      locator: { sourceId: SOURCE_ID },
    });
    expect(source.bundle.snapshots[0]!.locator).not.toHaveProperty('sourceId');
  });

  it('uses the exact project sidecar and supplied sou_ id without changing SourceBundle/1', async () => {
    const source = archive();
    const store = repository();
    const blobs = blobStore(source);
    const onKnowledgeChanged = vi.fn(async () => undefined);
    const service = new SourceUploadService(
      store,
      tokenService(),
      blobs,
      () => NOW,
      onKnowledgeChanged,
    );
    const intent = projectIntent(source);

    const signed = await service.authorizeUpload({
      accessToken: 'maic_at_test',
      pathname: pathname(source),
      clientPayload: JSON.stringify(intent),
    });
    expect(signed).toMatchObject({
      projectId: PROJECT_ID,
      expectedProjectRevision: 0,
      projectCoverage: 'partial',
      projectSources: [{ snapshotId: source.bundle.snapshots[0]!.id, sourceId: SOURCE_ID }],
    });
    expect(source.bundle).not.toHaveProperty('project');

    await expect(
      service.completeUpload({
        blob: {
          url: 'https://blob.example/source.json',
          pathname: pathname(source),
          contentType: SOURCE_ARCHIVE_CONTENT_TYPE,
        },
        tokenPayload: JSON.stringify(signed),
      }),
    ).resolves.toEqual({ accepted: true });

    const registered = store.completeUpload.mock.calls[0]?.[4];
    expect(registered).toMatchObject({
      projectId: PROJECT_ID,
      coverage: 'partial',
      expectedProjectRevision: 0,
      nextProjectRevision: 1,
      items: [
        expect.objectContaining({
          snapshotId: source.bundle.snapshots[0]!.id,
          sourceId: SOURCE_ID,
        }),
      ],
    });
    expect(store.indexProjectChunks).toHaveBeenCalledWith(
      principal.ownerId,
      source.bundle.id,
      new Date(source.bundle.retentionUntil),
      expect.arrayContaining([
        expect.objectContaining({
          sourceId: SOURCE_ID,
          snapshotId: source.bundle.snapshots[0]!.id,
          ordinal: 1,
        }),
      ]),
      NOW,
    );
    expect(onKnowledgeChanged).toHaveBeenCalledWith({
      triggerKind: 'source-version',
      triggerId: source.bundle.id,
      projectId: PROJECT_ID,
    });
  });

  it('rejects legacy syncMode/full fields instead of silently translating them', async () => {
    const source = archive();
    const store = repository();
    const service = new SourceUploadService(store, tokenService(), blobStore(source), () => NOW);

    await expect(
      service.authorizeUpload({
        accessToken: 'maic_at_test',
        pathname: pathname(source),
        clientPayload: JSON.stringify({ ...projectIntent(source), syncMode: 'full' }),
      }),
    ).rejects.toMatchObject({ code: 'learning_contract_invalid', status: 422 });
    expect(store.beginUpload).not.toHaveBeenCalled();
  });

  it('returns the plugin status contract with a confirmed revision only after validation', async () => {
    const source = archive();
    const store = repository();
    store.getStatus.mockResolvedValue({
      bundleId: source.bundle.id,
      projectId: PROJECT_ID,
      projectCoverage: 'partial',
      expectedProjectRevision: 4,
      bundleRevision: 1,
      manifestHash: source.bundle.manifestHash,
      itemCount: 1,
      sourceByteSize: source.bundle.byteSize,
      status: 'validated',
      retentionUntil: new Date(source.bundle.retentionUntil),
      createdAt: NOW,
      completedAt: NOW,
      projectIndexedAt: NOW,
    });
    const service = new SourceUploadService(store, tokenService(), blobStore(source), () => NOW);

    const status = await service.uploadStatus('maic_at_test', source.bundle.id);
    expect(status).toMatchObject({
      bundleId: source.bundle.id,
      status: 'validated',
      projectId: PROJECT_ID,
      projectRevision: 5,
      coverage: 'partial',
    });
    expect(status).not.toHaveProperty('expectedProjectRevision');
    expect(status).not.toHaveProperty('syncMode');
    expect(store.getStatus).toHaveBeenCalledWith(principal, source.bundle.id);

    store.getStatus.mockResolvedValue({
      bundleId: source.bundle.id,
      projectId: PROJECT_ID,
      projectCoverage: 'partial',
      expectedProjectRevision: 4,
      manifestHash: source.bundle.manifestHash,
      itemCount: 1,
      sourceByteSize: source.bundle.byteSize,
      status: 'pending',
      retentionUntil: new Date(source.bundle.retentionUntil),
      createdAt: NOW,
    });
    const pending = await service.uploadStatus('maic_at_test', source.bundle.id);
    expect(pending).toMatchObject({
      status: 'pending',
      projectId: PROJECT_ID,
      expectedProjectRevision: 4,
    });
    expect(pending).not.toHaveProperty('projectRevision');
    expect(pending).not.toHaveProperty('syncMode');
  });
});
