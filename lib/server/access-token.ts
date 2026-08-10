import { createHmac, timingSafeEqual } from 'crypto';
import { ACCESS_SESSION_MAX_AGE_MS } from '@/lib/access-session';

const ACCESS_TOKEN_FUTURE_TOLERANCE_MS = 5 * 60 * 1000;

/** Create an HMAC-signed token: `timestamp.signature` */
export function createAccessToken(accessCode: string): string {
  const timestamp = Date.now().toString();
  const signature = createHmac('sha256', accessCode).update(timestamp).digest('hex');
  return `${timestamp}.${signature}`;
}

/** Verify an HMAC-signed token against the access code */
export function verifyAccessToken(token: string, accessCode: string): boolean {
  const dotIndex = token.indexOf('.');
  if (dotIndex === -1) return false;

  const timestamp = token.substring(0, dotIndex);
  const signature = token.substring(dotIndex + 1);

  if (!/^\d{13}$/.test(timestamp) || !/^[a-f0-9]{64}$/.test(signature)) return false;
  const issuedAt = Number(timestamp);
  const now = Date.now();
  if (
    !Number.isSafeInteger(issuedAt) ||
    issuedAt < now - ACCESS_SESSION_MAX_AGE_MS ||
    issuedAt > now + ACCESS_TOKEN_FUTURE_TOLERANCE_MS
  ) {
    return false;
  }

  const expected = createHmac('sha256', accessCode).update(timestamp).digest('hex');

  const sigBuf = Buffer.from(signature, 'hex');
  const expBuf = Buffer.from(expected, 'hex');
  if (sigBuf.length !== expBuf.length) return false;

  return timingSafeEqual(sigBuf, expBuf);
}
