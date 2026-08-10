import { afterEach, describe, expect, test, vi } from 'vitest';

import { createAccessToken, verifyAccessToken } from '@/lib/server/access-token';

describe('access token signing', () => {
  afterEach(() => vi.useRealTimers());

  test('verifies tokens signed with the same access code', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-25T00:00:00Z'));

    const token = createAccessToken('demo-code');

    expect(verifyAccessToken(token, 'demo-code')).toBe(true);
    expect(verifyAccessToken(token, 'other-code')).toBe(false);
    expect(verifyAccessToken('bad-token', 'demo-code')).toBe(false);
  });

  test('rejects expired, future, malformed, and non-hex tokens', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-01T00:00:00Z'));
    const expired = createAccessToken('demo-code');

    vi.setSystemTime(new Date('2026-08-29T00:00:00Z'));
    expect(verifyAccessToken(expired, 'demo-code')).toBe(true);

    vi.setSystemTime(new Date('2026-08-30T00:00:01Z'));
    expect(verifyAccessToken(expired, 'demo-code')).toBe(false);

    vi.setSystemTime(new Date('2026-06-01T00:10:00Z'));
    const future = createAccessToken('demo-code');
    vi.setSystemTime(new Date('2026-06-01T00:00:00Z'));
    expect(verifyAccessToken(future, 'demo-code')).toBe(false);
    expect(verifyAccessToken('123.not-hex', 'demo-code')).toBe(false);
    expect(verifyAccessToken(`${Date.now()}.zz${'0'.repeat(62)}`, 'demo-code')).toBe(false);
  });
});
