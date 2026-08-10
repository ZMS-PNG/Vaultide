import {
  LEARNING_PROTOCOL_VERSION,
  SOURCE_ARCHIVE_SCHEMA_VERSION,
  SOURCE_BUNDLE_SCHEMA_VERSION,
  type SourceArchive,
} from '@openmaic/learning-protocol';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { uploadMock } = vi.hoisted(() => ({ uploadMock: vi.fn() }));
vi.mock('@vercel/blob/client', () => ({ upload: uploadMock }));

import { buildProjectSourceUploadIntent, uploadSourceArchive } from '../src/source-upload';

function archive(): SourceArchive {
  return {
    protocolVersion: LEARNING_PROTOCOL_VERSION,
    schemaVersion: SOURCE_ARCHIVE_SCHEMA_VERSION,
    bundle: {
      protocolVersion: LEARNING_PROTOCOL_VERSION,
      schemaVersion: SOURCE_BUNDLE_SCHEMA_VERSION,
      id: `src_${'a'.repeat(32)}`,
      ownerId: `own_${'b'.repeat(32)}`,
      revision: 1,
      manifestHash: 'c'.repeat(64),
      byteSize: 4,
      itemCount: 1,
      selectionReason: 'Explicit selection',
      sourcePolicy: { externalSearch: 'disabled' },
      snapshots: [
        {
          id: `snp_${'d'.repeat(32)}`,
          origin: 'obsidian',
          title: 'Note',
          contentHash: 'e'.repeat(64),
          mimeType: 'text/markdown',
          byteSize: 4,
          locator: {
            kind: 'obsidian',
            vaultBindingId: `vlt_${'f'.repeat(32)}`,
            relativePath: 'Note.md',
          },
        },
      ],
      retentionUntil: '2026-07-22T00:00:00.000Z',
      createdAt: '2026-07-21T00:00:00.000Z',
    },
    contents: [{ snapshotId: `snp_${'d'.repeat(32)}`, utf8Content: 'note' }],
  };
}

describe('private source upload client', () => {
  beforeEach(() => uploadMock.mockReset());

  it('uses a private exact pathname and sends credentials only to the configured server route', async () => {
    uploadMock.mockResolvedValue({
      url: 'https://blob.example/private.json',
      pathname: 'stored/path.json',
    });
    const value = archive();
    const vaultBindingId = `vlt_${'f'.repeat(32)}`;

    await uploadSourceArchive({
      serverUrl: 'https://openmaic.example.com',
      accessToken: 'maic_at_secret',
      archive: value,
    });

    expect(uploadMock).toHaveBeenCalledWith(
      `learning-sources/${value.bundle.ownerId}/${vaultBindingId}/${value.bundle.id}.json`,
      JSON.stringify(value),
      expect.objectContaining({
        access: 'private',
        handleUploadUrl: 'https://openmaic.example.com/api/v1/source-uploads',
        headers: {
          Authorization: 'Bearer maic_at_secret',
          'X-MAIC-Protocol-Version': LEARNING_PROTOCOL_VERSION,
        },
      }),
    );
  });

  it('sends a strict project-aware partial upload intent without changing the Blob pathname', async () => {
    uploadMock.mockResolvedValue({
      url: 'https://blob.example/private.json',
      pathname: 'stored/path.json',
    });
    const value = archive();
    const intent = buildProjectSourceUploadIntent({
      archive: value,
      projectId: `prj_${'1'.repeat(32)}`,
      expectedProjectRevision: 3,
      baseManifestHash: '2'.repeat(64),
      coverage: 'partial',
      sources: [
        {
          snapshotId: value.bundle.snapshots[0]!.id,
          sourceId: `sou_${'3'.repeat(32)}`,
        },
      ],
    });

    await uploadSourceArchive({
      serverUrl: 'https://openmaic.example.com',
      accessToken: 'maic_at_secret',
      archive: value,
      uploadIntent: intent,
    });

    const firstSnapshot = value.bundle.snapshots[0];
    if (!firstSnapshot || firstSnapshot.origin !== 'obsidian') {
      throw new Error('Expected an Obsidian snapshot.');
    }
    const [pathname, , uploadOptions] = uploadMock.mock.calls[0] as [
      string,
      string,
      { clientPayload: string },
    ];
    expect(pathname).toBe(
      `learning-sources/${value.bundle.ownerId}/${firstSnapshot.locator.vaultBindingId}/${value.bundle.id}.json`,
    );
    expect(JSON.parse(uploadOptions.clientPayload)).toMatchObject({
      schemaVersion: 'source-upload-intent/1',
      project: {
        projectId: `prj_${'1'.repeat(32)}`,
        expectedProjectRevision: 3,
        coverage: 'partial',
      },
    });
  });
});
