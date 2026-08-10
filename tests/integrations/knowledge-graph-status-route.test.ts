import { LEARNING_PROTOCOL_VERSION } from '@openmaic/learning-protocol';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAccessToken } from '@/lib/server/access-token';

const mocks = vi.hoisted(() => ({ queueStatus: vi.fn() }));
vi.mock('@/lib/learning/knowledge-graph-refresh', () => ({
  getKnowledgeGraphRefreshService: () => ({ queueStatus: mocks.queueStatus }),
}));

import { GET } from '@/lib/server/api-routes/v1/maintenance/knowledge-graph-status/handler';

const ACCESS_CODE = 'knowledge-graph-status-access';
const originalAccessCode = process.env.ACCESS_CODE;
const originalGraphFlag = process.env.KNOWLEDGE_GRAPH_V2_ENABLED;

function request(authenticated = true): NextRequest {
  return new NextRequest('http://localhost/api/v1/maintenance/knowledge-graph-status', {
    headers: {
      'X-MAIC-Protocol-Version': LEARNING_PROTOCOL_VERSION,
      ...(authenticated ? { Cookie: `openmaic_access=${createAccessToken(ACCESS_CODE)}` } : {}),
    },
  });
}

describe('knowledge graph status route', () => {
  beforeEach(() => {
    process.env.ACCESS_CODE = ACCESS_CODE;
    process.env.KNOWLEDGE_GRAPH_V2_ENABLED = 'true';
    mocks.queueStatus.mockReset().mockResolvedValue({
      pending: 2,
      processing: 1,
      failed: 0,
      succeeded: 9,
      skipped: 3,
      exhausted: 0,
      oldestAvailableAt: new Date('2026-07-24T12:00:00.000Z'),
    });
  });

  afterEach(() => {
    if (originalAccessCode === undefined) delete process.env.ACCESS_CODE;
    else process.env.ACCESS_CODE = originalAccessCode;
    if (originalGraphFlag === undefined) delete process.env.KNOWLEDGE_GRAPH_V2_ENABLED;
    else process.env.KNOWLEDGE_GRAPH_V2_ENABLED = originalGraphFlag;
  });

  it('never exposes health metadata without the administrator cookie', async () => {
    const response = await GET(request(false));
    expect(response.status).toBe(401);
    expect(mocks.queueStatus).not.toHaveBeenCalled();
  });

  it('returns only queue counters, flags and timestamps for an administrator', async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toMatchObject({
      queue: {
        pending: 2,
        processing: 1,
        exhausted: 0,
        oldestAvailableAt: '2026-07-24T12:00:00.000Z',
      },
      flags: { enabled: true },
    });
  });
});
