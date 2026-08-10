import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LEARNING_PROTOCOL_VERSION,
  PROJECT_BINDING_SCHEMA_VERSION,
} from '@openmaic/learning-protocol';

const { requestUrlMock } = vi.hoisted(() => ({ requestUrlMock: vi.fn() }));
vi.mock('obsidian', () => ({ requestUrl: requestUrlMock }));

import { finalizeProjectSync, registerProjectBinding } from '../src/project-client';

const PROJECT_ID = `prj_${'a'.repeat(32)}`;
const SOURCE_ID_A = `sou_${'b'.repeat(32)}`;
const SOURCE_ID_B = `sou_${'c'.repeat(32)}`;

describe('project binding client', () => {
  beforeEach(() => requestUrlMock.mockReset());

  it('registers a client-stable project id without sending owner or Vault identity', async () => {
    requestUrlMock.mockResolvedValue({
      status: 200,
      json: {
        protocolVersion: LEARNING_PROTOCOL_VERSION,
        schemaVersion: PROJECT_BINDING_SCHEMA_VERSION,
        projectId: PROJECT_ID,
        kind: 'obsidian-folder',
        displayName: 'OpenMAIC',
        folderPath: 'Projects/OpenMAIC',
        bindingRevision: 2,
        projectRevision: 4,
        latestManifestHash: 'b'.repeat(64),
        registeredAt: '2026-07-23T08:00:00.000Z',
      },
    });

    await expect(
      registerProjectBinding({
        serverUrl: 'https://openmaic.example.com',
        accessToken: 'maic_at_secret',
        projectId: PROJECT_ID,
        displayName: 'OpenMAIC',
        folderPath: 'Projects/OpenMAIC',
        expectedBindingRevision: 1,
      }),
    ).resolves.toMatchObject({ projectId: PROJECT_ID, projectRevision: 4 });

    const request = requestUrlMock.mock.calls[0]?.[0] as {
      url: string;
      body: string;
      headers: Record<string, string>;
    };
    expect(request.url).toBe('https://openmaic.example.com/api/v1/projects');
    expect(request.headers.Authorization).toBe('Bearer maic_at_secret');
    expect(JSON.parse(request.body)).toEqual(
      expect.objectContaining({
        projectId: PROJECT_ID,
        expectedBindingRevision: 1,
      }),
    );
    expect(request.body).not.toContain('ownerId');
    expect(request.body).not.toContain('vaultBindingId');
  });

  it('fails closed when the server returns a different binding', async () => {
    requestUrlMock.mockResolvedValue({
      status: 200,
      json: {
        protocolVersion: LEARNING_PROTOCOL_VERSION,
        schemaVersion: PROJECT_BINDING_SCHEMA_VERSION,
        projectId: `prj_${'c'.repeat(32)}`,
        kind: 'obsidian-folder',
        displayName: 'OpenMAIC',
        folderPath: 'Projects/OpenMAIC',
        bindingRevision: 1,
        projectRevision: 0,
        registeredAt: '2026-07-23T08:00:00.000Z',
      },
    });

    await expect(
      registerProjectBinding({
        serverUrl: 'https://openmaic.example.com',
        accessToken: 'maic_at_secret',
        projectId: PROJECT_ID,
        displayName: 'OpenMAIC',
        folderPath: 'Projects/OpenMAIC',
      }),
    ).rejects.toThrow('does not match');
  });

  it('finalizes the complete sorted source set after all batches', async () => {
    requestUrlMock.mockResolvedValue({
      status: 200,
      json: {
        projectId: PROJECT_ID,
        projectRevision: 8,
        manifestId: `prm_${'d'.repeat(32)}`,
        manifestSha256: 'e'.repeat(64),
        sourceCount: 2,
      },
    });

    await expect(
      finalizeProjectSync({
        serverUrl: 'https://openmaic.example.com',
        accessToken: 'maic_at_secret',
        projectId: PROJECT_ID,
        expectedProjectRevision: 7,
        sourceIds: [SOURCE_ID_B, SOURCE_ID_A],
        sourceBundleId: `src_${'f'.repeat(32)}`,
      }),
    ).resolves.toMatchObject({
      projectRevision: 8,
      manifestId: `prm_${'d'.repeat(32)}`,
      sourceCount: 2,
    });

    const request = requestUrlMock.mock.calls[0]?.[0] as {
      url: string;
      body: string;
      headers: Record<string, string>;
    };
    expect(request.url).toBe(
      `https://openmaic.example.com/api/v1/projects/${PROJECT_ID}/finalize-sync`,
    );
    expect(request.headers.Authorization).toBe('Bearer maic_at_secret');
    expect(JSON.parse(request.body)).toEqual({
      expectedProjectRevision: 7,
      sourceIds: [SOURCE_ID_A, SOURCE_ID_B],
      sourceBundleId: `src_${'f'.repeat(32)}`,
    });
    expect(request.body).not.toContain('ownerId');
    expect(request.body).not.toContain('vaultBindingId');
  });

  it('accepts the short-lived nested finalization envelope for safe retries', async () => {
    requestUrlMock.mockResolvedValue({
      status: 201,
      json: {
        revision: {
          projectId: PROJECT_ID,
          projectRevision: 8,
          manifestId: `prm_${'d'.repeat(32)}`,
          manifestSha256: 'e'.repeat(64),
          sourceCount: 2,
        },
      },
    });

    await expect(
      finalizeProjectSync({
        serverUrl: 'https://openmaic.example.com',
        accessToken: 'maic_at_secret',
        projectId: PROJECT_ID,
        expectedProjectRevision: 7,
        sourceIds: [SOURCE_ID_B, SOURCE_ID_A],
      }),
    ).resolves.toMatchObject({
      projectRevision: 8,
      manifestId: `prm_${'d'.repeat(32)}`,
      sourceCount: 2,
    });
  });

  it('does not accept a malformed or stale finalization response', async () => {
    requestUrlMock.mockResolvedValue({
      status: 200,
      json: {
        projectId: PROJECT_ID,
        projectRevision: 7,
        manifestId: `prm_${'d'.repeat(32)}`,
        manifestSha256: 'e'.repeat(64),
        sourceCount: 1,
      },
    });

    await expect(
      finalizeProjectSync({
        serverUrl: 'https://openmaic.example.com',
        accessToken: 'maic_at_secret',
        projectId: PROJECT_ID,
        expectedProjectRevision: 7,
        sourceIds: [SOURCE_ID_A],
      }),
    ).rejects.toThrow('does not match');
  });

  it('rejects duplicate source ids before making a finalization request', async () => {
    await expect(
      finalizeProjectSync({
        serverUrl: 'https://openmaic.example.com',
        accessToken: 'maic_at_secret',
        projectId: PROJECT_ID,
        expectedProjectRevision: 7,
        sourceIds: [SOURCE_ID_A, SOURCE_ID_A],
      }),
    ).rejects.toThrow('unique canonical source ids');
    expect(requestUrlMock).not.toHaveBeenCalled();
  });
});
