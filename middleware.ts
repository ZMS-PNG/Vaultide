import { NextRequest, NextResponse } from 'next/server';
import { ACCESS_SESSION_MAX_AGE_MS } from '@/lib/access-session';

/** Convert string to Uint8Array */
function encode(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

/** Convert ArrayBuffer to hex string */
function bufToHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Verify an HMAC-signed token using Web Crypto API (Edge-compatible) */
async function verifyToken(token: string, accessCode: string): Promise<boolean> {
  const dotIndex = token.indexOf('.');
  if (dotIndex === -1) return false;

  const timestamp = token.substring(0, dotIndex);
  const signature = token.substring(dotIndex + 1);

  if (!/^\d{13}$/.test(timestamp) || !/^[a-f0-9]{64}$/.test(signature)) return false;
  const issuedAt = Number(timestamp);
  const now = Date.now();
  const futureToleranceMs = 5 * 60 * 1000;
  if (
    !Number.isSafeInteger(issuedAt) ||
    issuedAt < now - ACCESS_SESSION_MAX_AGE_MS ||
    issuedAt > now + futureToleranceMs
  )
    return false;

  const keyData = encode(accessCode);
  const key = await crypto.subtle.importKey(
    'raw',
    keyData.buffer as ArrayBuffer,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const data = encode(timestamp);
  const expected = bufToHex(await crypto.subtle.sign('HMAC', key, data.buffer as ArrayBuffer));

  // Constant-length comparison (not truly constant-time in JS, but sufficient here)
  if (signature.length !== expected.length) return false;
  let mismatch = 0;
  for (let i = 0; i < signature.length; i++) {
    mismatch |= signature.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return mismatch === 0;
}

export async function middleware(request: NextRequest) {
  const accessCode = process.env.ACCESS_CODE;
  const { pathname } = request.nextUrl;

  if (!accessCode) {
    return NextResponse.next();
  }

  // Public bootstrap endpoints must work before site or device authentication.
  if (
    pathname.startsWith('/api/access-code/') ||
    pathname === '/api/health' ||
    pathname === '/api/internal/course-generation/worker' ||
    pathname === '/api/v1/course-inputs' ||
    pathname === '/api/v1/integration-capabilities' ||
    pathname === '/api/v1/pairing-sessions/exchange' ||
    pathname === '/api/v1/device-tokens/refresh' ||
    pathname === '/api/v1/device-tokens/revoke' ||
    pathname === '/api/v1/source-uploads' ||
    pathname.startsWith('/api/v1/source-uploads/') ||
    pathname === '/api/v1/projects' ||
    pathname.startsWith('/api/v1/projects/') ||
    pathname.startsWith('/api/v1/source-bundles/') ||
    pathname === '/api/v1/learning-events/batch' ||
    pathname === '/api/v1/deposition-policy' ||
    pathname === '/api/v1/writeback-commands/pending' ||
    /^\/api\/v1\/writeback-commands\/[^/]+\/local-validation$/.test(pathname) ||
    pathname === '/api/v1/writeback-receipts' ||
    pathname === '/api/v1/maintenance/source-retention' ||
    pathname === '/api/v1/maintenance/knowledge-graph-refresh' ||
    pathname === '/api/v1/maintenance/course-generation'
  ) {
    return NextResponse.next();
  }

  // Check cookie — validate HMAC signature, not just existence
  const cookie = request.cookies.get('openmaic_access');
  if (cookie?.value && (await verifyToken(cookie.value, accessCode))) {
    return NextResponse.next();
  }

  // API requests without valid cookie → 401
  if (pathname.startsWith('/api/')) {
    return NextResponse.json(
      { success: false, errorCode: 'INVALID_REQUEST', error: 'Access code required' },
      { status: 401 },
    );
  }

  // Page requests → let through, frontend shows modal
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|logos/|\.well-known/workflow/).*)'],
};
