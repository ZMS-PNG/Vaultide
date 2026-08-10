import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  runDueSchedules: vi.fn(),
  processPending: vi.fn(),
}));
vi.mock('@/lib/learning/synthesis', () => ({
  getSynthesisService: () => ({ runDueSchedules: mocks.runDueSchedules }),
}));
vi.mock('@/lib/learning/knowledge-graph-refresh', () => ({
  getKnowledgeGraphRefreshService: () => ({ processPending: mocks.processPending }),
}));

import { GET } from '@/lib/server/api-routes/v1/maintenance/knowledge-graph-refresh/handler';

const originalSecret = process.env.CRON_SECRET;

describe('knowledge graph refresh cron route', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = 'g'.repeat(32);
    mocks.runDueSchedules.mockReset().mockResolvedValue({
      attempted: 0,
      succeeded: 0,
      skipped: 0,
      failed: 0,
      syntheses: [],
    });
    mocks.processPending.mockReset().mockResolvedValue({
      attempted: 2,
      succeeded: 2,
      skipped: 0,
      failed: 0,
      projectionIds: [`kgp_${'1'.repeat(32)}`],
    });
  });

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = originalSecret;
  });

  it('requires the exact Vercel Cron bearer secret', async () => {
    const response = await GET(
      new NextRequest('http://localhost/api/v1/maintenance/knowledge-graph-refresh'),
    );
    expect(response.status).toBe(401);
    expect(mocks.runDueSchedules).not.toHaveBeenCalled();
    expect(mocks.processPending).not.toHaveBeenCalled();
  });

  it('runs due synthesis schedules before draining the projection refresh queue', async () => {
    const response = await GET(
      new NextRequest('http://localhost/api/v1/maintenance/knowledge-graph-refresh', {
        headers: { Authorization: `Bearer ${'g'.repeat(32)}` },
      }),
    );
    expect(response.status).toBe(200);
    expect(mocks.runDueSchedules).toHaveBeenCalledWith(10);
    expect(mocks.processPending).toHaveBeenCalledWith(10);
    expect(await response.json()).toMatchObject({
      ok: true,
      refresh: { attempted: 2, succeeded: 2, failed: 0 },
    });
  });
});
