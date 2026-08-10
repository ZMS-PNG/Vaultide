import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ purgeExpired: vi.fn() }));
vi.mock('@/lib/learning/source-uploads', () => ({
  getSourceUploadService: () => mocks,
}));

import { GET } from '@/lib/server/api-routes/v1/maintenance/source-retention/handler';

const originalSecret = process.env.CRON_SECRET;

describe('source retention cron route', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = 's'.repeat(32);
    mocks.purgeExpired.mockReset().mockResolvedValue({ deleted: 2, failed: 0 });
  });

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = originalSecret;
  });

  it('rejects requests without the configured Vercel Cron bearer secret', async () => {
    const response = await GET(
      new NextRequest('http://localhost/api/v1/maintenance/source-retention'),
    );
    expect(response.status).toBe(401);
    expect(mocks.purgeExpired).not.toHaveBeenCalled();
  });

  it('deletes expired sources only after exact bearer authentication', async () => {
    const response = await GET(
      new NextRequest('http://localhost/api/v1/maintenance/source-retention', {
        headers: { Authorization: `Bearer ${'s'.repeat(32)}` },
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, deleted: 2, failed: 0 });
  });
});
