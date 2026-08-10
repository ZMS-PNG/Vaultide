import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  persistClassroom: vi.fn(),
}));

vi.mock('@/lib/server/classroom-storage', () => ({
  buildRequestOrigin: () => 'https://example.test',
  isValidClassroomId: () => true,
  persistClassroom: mocks.persistClassroom,
  readClassroomWithMetadata: vi.fn(),
}));

vi.mock('@/lib/generation/orchestration/service', () => ({
  getCourseGenerationService: () => ({
    publishedRelease: vi.fn(),
  }),
}));

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    error: vi.fn(),
  }),
}));

import { POST } from '@/lib/server/api-routes/classroom/handler';

describe('durable classroom release immutability', () => {
  beforeEach(() => {
    mocks.persistClassroom.mockReset();
  });

  it('rejects playback sync even when the client omits generationComplete', async () => {
    const request = new NextRequest('https://example.test/api/classroom', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        stage: {
          id: 'released-classroom',
          name: 'Released course',
          createdAt: 1,
          updatedAt: 2,
          learningContext: {
            generationJobId: `cgj_${'b'.repeat(32)}`,
          },
        },
        scenes: [{ id: 'scene-1', stageId: 'released-classroom', order: 1 }],
        generation: {
          outlines: [],
          generationComplete: false,
          generationStatus: 'generating',
          failedOutlineIds: [],
        },
      }),
    });

    const response = await POST(request);
    const body = (await response.json()) as {
      errorCode?: string;
      error?: string;
    };

    expect(response.status).toBe(403);
    expect(body.errorCode).toBe('SCOPE_DENIED');
    expect(body.error).toContain('immutable');
    expect(mocks.persistClassroom).not.toHaveBeenCalled();
  });
});
