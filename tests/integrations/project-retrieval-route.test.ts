import { LEARNING_PROTOCOL_VERSION } from '@openmaic/learning-protocol';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectRetrievalServiceError } from '@/lib/learning/application/project-retrieval-service';
import { createAccessToken } from '@/lib/server/access-token';

const mocks = vi.hoisted(() => ({ retrieve: vi.fn() }));
vi.mock('@/lib/learning/project-retrieval', () => ({
  getProjectRetrievalService: () => mocks,
}));

import { POST } from '@/lib/server/api-routes/v1/projects/[projectId]/retrievals/handler';

const PROJECT_ID = `prj_${'1'.repeat(32)}`;
const SOURCE_ID = `sou_${'2'.repeat(32)}`;
const originalAccessCode = process.env.ACCESS_CODE;
const ACCESS_CODE = 'test-project-retrieval-access';

function request(body: unknown): NextRequest {
  return new NextRequest(`http://localhost/api/v1/projects/${PROJECT_ID}/retrievals`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-MAIC-Protocol-Version': LEARNING_PROTOCOL_VERSION,
      Cookie: `openmaic_access=${createAccessToken(ACCESS_CODE)}`,
    },
    body: JSON.stringify(body),
  });
}

describe('project retrieval route', () => {
  beforeEach(() => {
    process.env.ACCESS_CODE = ACCESS_CODE;
    mocks.retrieve.mockReset();
  });

  afterEach(() => {
    if (originalAccessCode === undefined) delete process.env.ACCESS_CODE;
    else process.env.ACCESS_CODE = originalAccessCode;
  });

  it('passes explicit source controls into a frozen retrieval run', async () => {
    mocks.retrieve.mockResolvedValue({
      retrievalId: `prr_${'3'.repeat(32)}`,
      matchQuality: 'strong',
    });
    const response = await POST(
      request({
        goal: '理解缓存失效路径并能够独立排查问题',
        maxContextChars: 44_000,
        requiredSourceIds: [SOURCE_ID],
        excludedSourceIds: [],
      }),
      { params: Promise.resolve({ projectId: PROJECT_ID }) },
    );

    expect(response.status).toBe(201);
    expect(mocks.retrieve).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      goal: '理解缓存失效路径并能够独立排查问题',
      maxContextChars: 44_000,
      requiredSourceIds: [SOURCE_ID],
      excludedSourceIds: [],
    });
  });

  it('rejects unknown request fields and preserves zero-match conflicts', async () => {
    const unknown = await POST(
      request({ goal: '理解数据流并能够解释模块协作', ownerId: 'forged' }),
      { params: Promise.resolve({ projectId: PROJECT_ID }) },
    );
    expect(unknown.status).toBe(400);
    expect(mocks.retrieve).not.toHaveBeenCalled();

    mocks.retrieve.mockRejectedValue(
      new ProjectRetrievalServiceError('conflict', 409, '当前目标没有命中项目证据。'),
    );
    const noMatch = await POST(request({ goal: '理解量子编译流水线并能够定位相位折叠错误' }), {
      params: Promise.resolve({ projectId: PROJECT_ID }),
    });
    expect(noMatch.status).toBe(409);
    expect(await noMatch.json()).toMatchObject({
      error: { code: 'conflict', message: '当前目标没有命中项目证据。' },
    });
  });
});
