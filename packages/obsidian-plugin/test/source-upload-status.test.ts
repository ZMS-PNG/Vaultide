import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requestUrlMock } = vi.hoisted(() => ({ requestUrlMock: vi.fn() }));
vi.mock('obsidian', () => ({ requestUrl: requestUrlMock }));

import { waitForValidatedSourceUpload } from '../src/source-upload-status';

const BUNDLE_ID = `src_${'a'.repeat(32)}`;
const PROJECT_ID = `prj_${'b'.repeat(32)}`;

describe('project source upload status', () => {
  beforeEach(() => requestUrlMock.mockReset());

  it('waits for validated before returning the confirmed project revision', async () => {
    requestUrlMock
      .mockResolvedValueOnce({
        status: 200,
        json: {
          upload: {
            bundleId: BUNDLE_ID,
            status: 'pending',
            projectId: PROJECT_ID,
            expectedProjectRevision: 4,
          },
        },
      })
      .mockResolvedValueOnce({
        status: 200,
        json: {
          upload: {
            bundleId: BUNDLE_ID,
            status: 'validated',
            projectId: PROJECT_ID,
            expectedProjectRevision: 4,
          },
        },
      });
    const wait = vi.fn().mockResolvedValue(undefined);

    await expect(
      waitForValidatedSourceUpload({
        serverUrl: 'https://openmaic.example.com',
        accessToken: 'maic_at_secret',
        bundleId: BUNDLE_ID,
        projectId: PROJECT_ID,
        expectedProjectRevision: 4,
        attempts: 2,
        intervalMs: 0,
        wait,
      }),
    ).resolves.toMatchObject({ status: 'validated', projectRevision: 5 });
    expect(wait).toHaveBeenCalledOnce();
    expect(requestUrlMock).toHaveBeenCalledTimes(2);
  });

  it('does not accept a rejected upload or an unconfirmed project identity', async () => {
    requestUrlMock.mockResolvedValueOnce({
      status: 200,
      json: {
        bundleId: BUNDLE_ID,
        status: 'rejected',
        projectId: PROJECT_ID,
        failureCode: 'manifest_hash_mismatch',
      },
    });
    await expect(
      waitForValidatedSourceUpload({
        serverUrl: 'https://openmaic.example.com',
        accessToken: 'maic_at_secret',
        bundleId: BUNDLE_ID,
        projectId: PROJECT_ID,
        expectedProjectRevision: 0,
      }),
    ).rejects.toThrow('manifest_hash_mismatch');

    requestUrlMock.mockResolvedValueOnce({
      status: 200,
      json: {
        bundleId: BUNDLE_ID,
        status: 'validated',
        projectId: `prj_${'c'.repeat(32)}`,
        projectRevision: 1,
      },
    });
    await expect(
      waitForValidatedSourceUpload({
        serverUrl: 'https://openmaic.example.com',
        accessToken: 'maic_at_secret',
        bundleId: BUNDLE_ID,
        projectId: PROJECT_ID,
        expectedProjectRevision: 0,
      }),
    ).rejects.toThrow('confirmed project revision');
  });

  it('does not report a project as learnable until the chunk index is ready', async () => {
    requestUrlMock
      .mockResolvedValueOnce({
        status: 200,
        json: {
          upload: {
            bundleId: BUNDLE_ID,
            status: 'validated',
            projectId: PROJECT_ID,
            projectRevision: 5,
            chunkIndexStatus: 'pending',
          },
        },
      })
      .mockResolvedValueOnce({
        status: 200,
        json: {
          upload: {
            bundleId: BUNDLE_ID,
            status: 'validated',
            projectId: PROJECT_ID,
            projectRevision: 5,
            chunkIndexStatus: 'ready',
            indexedChunkCount: 17,
            chunkIndexedAt: '2026-07-23T12:00:00.000Z',
          },
        },
      });
    const wait = vi.fn().mockResolvedValue(undefined);

    await expect(
      waitForValidatedSourceUpload({
        serverUrl: 'https://openmaic.example.com',
        accessToken: 'maic_at_secret',
        bundleId: BUNDLE_ID,
        projectId: PROJECT_ID,
        expectedProjectRevision: 4,
        requireReadyIndex: true,
        attempts: 2,
        intervalMs: 0,
        wait,
      }),
    ).resolves.toMatchObject({
      status: 'validated',
      chunkIndexStatus: 'ready',
      indexedChunkCount: 17,
    });
    expect(wait).toHaveBeenCalledOnce();
  });

  it('surfaces a validated upload whose retriever index failed', async () => {
    requestUrlMock.mockResolvedValueOnce({
      status: 200,
      json: {
        upload: {
          bundleId: BUNDLE_ID,
          status: 'validated',
          projectId: PROJECT_ID,
          projectRevision: 5,
          chunkIndexStatus: 'failed',
          chunkIndexFailureCode: 'chunk_index_dependency_failure',
        },
      },
    });

    await expect(
      waitForValidatedSourceUpload({
        serverUrl: 'https://openmaic.example.com',
        accessToken: 'maic_at_secret',
        bundleId: BUNDLE_ID,
        projectId: PROJECT_ID,
        expectedProjectRevision: 4,
        requireReadyIndex: true,
        attempts: 1,
      }),
    ).rejects.toThrow('chunk_index_dependency_failure');
  });
});
