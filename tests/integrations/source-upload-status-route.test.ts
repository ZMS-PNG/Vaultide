import { LEARNING_PROTOCOL_VERSION } from '@openmaic/learning-protocol';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  uploadStatus: vi.fn(),
}));

vi.mock('@/lib/learning/source-uploads', () => ({
  getSourceUploadService: () => mocks,
}));

import { GET } from '@/lib/server/api-routes/v1/source-uploads/[bundleId]/handler';

const BUNDLE_ID = `src_${'1'.repeat(32)}`;
const PROJECT_ID = `prj_${'2'.repeat(32)}`;

describe('source upload status route', () => {
  beforeEach(() => mocks.uploadStatus.mockReset());

  it('requires a device bearer before exposing project upload status', async () => {
    const unauthorized = await GET(
      new NextRequest(`http://localhost/api/v1/source-uploads/${BUNDLE_ID}`, {
        headers: { 'X-MAIC-Protocol-Version': LEARNING_PROTOCOL_VERSION },
      }),
      { params: Promise.resolve({ bundleId: BUNDLE_ID }) },
    );
    expect(unauthorized.status).toBe(401);
    expect(mocks.uploadStatus).not.toHaveBeenCalled();

    mocks.uploadStatus.mockResolvedValue({
      bundleId: BUNDLE_ID,
      status: 'validated',
      projectId: PROJECT_ID,
      projectRevision: 3,
    });
    const response = await GET(
      new NextRequest(`http://localhost/api/v1/source-uploads/${BUNDLE_ID}`, {
        headers: {
          Authorization: 'Bearer maic_at_test',
          'X-MAIC-Protocol-Version': LEARNING_PROTOCOL_VERSION,
        },
      }),
      { params: Promise.resolve({ bundleId: BUNDLE_ID }) },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      upload: {
        bundleId: BUNDLE_ID,
        status: 'validated',
        projectId: PROJECT_ID,
        projectRevision: 3,
      },
    });
    expect(mocks.uploadStatus).toHaveBeenCalledWith('maic_at_test', BUNDLE_ID);
  });
});
