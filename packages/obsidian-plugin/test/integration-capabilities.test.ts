import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requestUrlMock } = vi.hoisted(() => ({ requestUrlMock: vi.fn() }));
vi.mock('obsidian', () => ({ requestUrl: requestUrlMock }));

import { fetchProjectSyncCapabilities } from '../src/integration-capabilities';

describe('project sync capability discovery', () => {
  beforeEach(() => requestUrlMock.mockReset());

  it('enables project sync only when every v0.5 contract is advertised', async () => {
    requestUrlMock.mockResolvedValue({
      status: 200,
      json: {
        schemas: {
          projectBinding: 'project-binding/1',
          sourceUploadIntent: 'source-upload-intent/1',
        },
        features: {
          projectBindings: true,
          projectAwareSourceUploads: true,
          sourceUploadStatus: true,
          markdownChunkIndex: true,
          projectGoalRetrieval: true,
        },
      },
    });

    await expect(
      fetchProjectSyncCapabilities('https://openmaic.example.com'),
    ).resolves.toMatchObject({ supported: true, goalRetrievalSupported: true });
  });

  it('treats the 0.4 capability response as unsupported without guessing', async () => {
    requestUrlMock.mockResolvedValue({
      status: 200,
      json: {
        schemas: { sourceBundle: 'source-bundle/1' },
        features: { sourceUpload: true },
      },
    });

    await expect(fetchProjectSyncCapabilities('https://openmaic.example.com')).resolves.toEqual({
      supported: false,
      projectBindingSchema: undefined,
      sourceUploadIntentSchema: undefined,
      goalRetrievalSupported: false,
    });
  });
});
