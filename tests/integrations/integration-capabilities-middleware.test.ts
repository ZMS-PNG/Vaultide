import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { middleware } from '@/middleware';
import { createAccessToken } from '@/lib/server/access-token';

const originalAccessCode = process.env.ACCESS_CODE;

afterEach(() => {
  vi.useRealTimers();
  if (originalAccessCode === undefined) {
    delete process.env.ACCESS_CODE;
  } else {
    process.env.ACCESS_CODE = originalAccessCode;
  }
});

describe('integration capabilities middleware boundary', () => {
  it('allows protocol discovery before site or device authentication', async () => {
    process.env.ACCESS_CODE = 'test-access-code';

    const response = await middleware(
      new NextRequest('http://localhost/api/v1/integration-capabilities'),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('x-middleware-next')).toBe('1');
  });

  it('does not make other API routes public', async () => {
    process.env.ACCESS_CODE = 'test-access-code';

    const response = await middleware(new NextRequest('http://localhost/api/server-providers'));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({
      success: false,
      errorCode: 'INVALID_REQUEST',
      error: 'Access code required',
    });
  });

  it('allows only the pairing exchange endpoint through the bootstrap boundary', async () => {
    process.env.ACCESS_CODE = 'test-access-code';

    const exchange = await middleware(
      new NextRequest('http://localhost/api/v1/pairing-sessions/exchange'),
    );
    const create = await middleware(new NextRequest('http://localhost/api/v1/pairing-sessions'));

    expect(exchange.headers.get('x-middleware-next')).toBe('1');
    expect(create.status).toBe(401);
  });

  it('lets device-token routes reach their own bearer authentication', async () => {
    process.env.ACCESS_CODE = 'test-access-code';

    for (const path of [
      '/api/v1/device-tokens/refresh',
      '/api/v1/device-tokens/revoke',
      '/api/v1/deposition-policy',
      '/api/v1/writeback-commands/pending',
      `/api/v1/writeback-commands/wbc_${'a'.repeat(32)}/local-validation`,
      '/api/v1/writeback-receipts',
    ]) {
      const response = await middleware(new NextRequest(`http://localhost${path}`));
      expect(response.headers.get('x-middleware-next')).toBe('1');
    }
  });

  it('lets Blob callbacks and cron requests reach route-level authentication', async () => {
    process.env.ACCESS_CODE = 'test-access-code';

    for (const path of [
      '/api/v1/source-uploads',
      `/api/v1/source-uploads/src_${'a'.repeat(32)}/status`,
      `/api/v1/projects/prj_${'a'.repeat(32)}`,
      `/api/v1/source-bundles/src_${'a'.repeat(32)}`,
      '/api/v1/maintenance/source-retention',
      '/api/v1/maintenance/knowledge-graph-refresh',
    ]) {
      const response = await middleware(new NextRequest(`http://localhost${path}`));
      expect(response.headers.get('x-middleware-next')).toBe('1');
    }
  });

  it('uses the same 90-day personal session lifetime as the access-code route', async () => {
    process.env.ACCESS_CODE = 'test-access-code';
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-01T00:00:00Z'));
    const token = createAccessToken(process.env.ACCESS_CODE);

    vi.setSystemTime(new Date('2026-08-29T00:00:00Z'));
    const active = await middleware(
      new NextRequest('http://localhost/api/server-providers', {
        headers: { Cookie: `openmaic_access=${token}` },
      }),
    );
    expect(active.headers.get('x-middleware-next')).toBe('1');

    vi.setSystemTime(new Date('2026-08-30T00:00:01Z'));
    const expired = await middleware(
      new NextRequest('http://localhost/api/server-providers', {
        headers: { Cookie: `openmaic_access=${token}` },
      }),
    );
    expect(expired.status).toBe(401);
  });
});
