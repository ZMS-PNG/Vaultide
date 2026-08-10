import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';

import { buildRequestOrigin } from '@/lib/server/classroom-storage';

describe('buildRequestOrigin', () => {
  it('uses the first proxy value when a proxy appends forwarding headers', () => {
    const request = new NextRequest('http://127.0.0.1:3104/api/v1/course-plans', {
      headers: {
        'x-forwarded-host': 'vaultide.example, internal-proxy:3000',
        'x-forwarded-proto': 'https, http',
      },
    });

    expect(buildRequestOrigin(request)).toBe('https://vaultide.example');
  });

  it('falls back to the request origin when forwarded headers do not form a URL', () => {
    const request = new NextRequest('http://127.0.0.1:3104/api/v1/course-plans', {
      headers: {
        'x-forwarded-host': 'not a valid host value',
        'x-forwarded-proto': 'https, http',
      },
    });

    expect(buildRequestOrigin(request)).toBe(request.nextUrl.origin);
  });
});
