import { LEARNING_PROTOCOL_VERSION } from '@openmaic/learning-protocol';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAccessToken } from '@/lib/server/access-token';

const mocks = vi.hoisted(() => ({
  createSession: vi.fn(),
  exchange: vi.fn(),
}));

vi.mock('@/lib/learning/pairing', () => ({
  getPairingService: () => mocks,
}));

import { POST as createPairingSession } from '@/lib/server/api-routes/v1/pairing-sessions/handler';
import { POST as exchangePairingSession } from '@/lib/server/api-routes/v1/pairing-sessions/exchange/handler';

const originalAccessCode = process.env.ACCESS_CODE;
const protocolHeaders = {
  'Content-Type': 'application/json',
  'X-MAIC-Protocol-Version': LEARNING_PROTOCOL_VERSION,
};

function validExchangeBody(extra: Record<string, unknown> = {}) {
  return {
    code: '123456',
    deviceId: `dev_${'a'.repeat(32)}`,
    vaultBindingId: `vlt_${'b'.repeat(32)}`,
    vaultName: 'J-obsidian',
    pluginVersion: '0.1.0',
    ...extra,
  };
}

describe('learning pairing routes', () => {
  beforeEach(() => {
    process.env.ACCESS_CODE = 'test-access-code';
    mocks.createSession.mockReset();
    mocks.exchange.mockReset();
  });

  afterEach(() => {
    if (originalAccessCode === undefined) delete process.env.ACCESS_CODE;
    else process.env.ACCESS_CODE = originalAccessCode;
  });

  it('requires an authenticated administrator to create a one-time code', async () => {
    const unauthorized = await createPairingSession(
      new NextRequest('http://localhost/api/v1/pairing-sessions', {
        method: 'POST',
        headers: { 'X-MAIC-Protocol-Version': LEARNING_PROTOCOL_VERSION },
      }),
    );
    expect(unauthorized.status).toBe(401);
    expect(mocks.createSession).not.toHaveBeenCalled();

    mocks.createSession.mockResolvedValue({
      id: `prs_${'1'.repeat(32)}`,
      code: '123456',
      expiresAt: '2026-07-21T12:10:00.000Z',
    });
    const token = createAccessToken('test-access-code');
    const authorized = await createPairingSession(
      new NextRequest('http://localhost/api/v1/pairing-sessions', {
        method: 'POST',
        headers: {
          'X-MAIC-Protocol-Version': LEARNING_PROTOCOL_VERSION,
          Cookie: `openmaic_access=${token}`,
        },
      }),
    );

    expect(authorized.status).toBe(201);
    expect(await authorized.json()).toMatchObject({ code: '123456' });
  });

  it('validates and exchanges a public bootstrap request', async () => {
    mocks.exchange.mockResolvedValue({
      accessToken: 'maic_at_test',
      refreshToken: 'maic_rt_test',
      ownerId: `own_${'c'.repeat(32)}`,
      deviceId: `dev_${'a'.repeat(32)}`,
      vaultBindingId: `vlt_${'b'.repeat(32)}`,
      expiresAt: '2026-07-21T12:15:00.000Z',
      scopes: ['sources:write'],
    });
    const response = await exchangePairingSession(
      new NextRequest('http://localhost/api/v1/pairing-sessions/exchange', {
        method: 'POST',
        headers: { ...protocolHeaders, 'X-Forwarded-For': '203.0.113.9' },
        body: JSON.stringify(validExchangeBody()),
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.exchange).toHaveBeenCalledWith(
      expect.objectContaining({ rateIdentity: '203.0.113.9', vaultName: 'J-obsidian' }),
    );
    expect(await response.json()).toMatchObject({ accessToken: 'maic_at_test' });
  });

  it('rejects unknown fields and missing protocol versions before service execution', async () => {
    const unknown = await exchangePairingSession(
      new NextRequest('http://localhost/api/v1/pairing-sessions/exchange', {
        method: 'POST',
        headers: protocolHeaders,
        body: JSON.stringify(validExchangeBody({ ownerId: `own_${'c'.repeat(32)}` })),
      }),
    );
    expect(unknown.status).toBe(400);
    expect(await unknown.json()).toMatchObject({
      error: { code: 'invalid_request', details: { field: 'ownerId' } },
    });

    const missingProtocol = await exchangePairingSession(
      new NextRequest('http://localhost/api/v1/pairing-sessions/exchange', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validExchangeBody()),
      }),
    );
    expect(missingProtocol.status).toBe(426);
    expect(mocks.exchange).not.toHaveBeenCalled();
  });
});
