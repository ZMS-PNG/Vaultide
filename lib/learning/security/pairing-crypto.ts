import { createHash, createHmac, randomBytes, randomInt, randomUUID } from 'node:crypto';

export interface OpaqueCredential {
  plaintext: string;
  digest: string;
}

export interface PairingCrypto {
  createCode(): string;
  createId(prefix: 'prs' | 'tok'): string;
  digestCode(code: string): string;
  digestRateKey(value: string): string;
  createCredential(prefix: 'maic_at' | 'maic_rt'): OpaqueCredential;
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function createPairingCrypto(hmacSecret: string): PairingCrypto {
  if (hmacSecret.length < 32) {
    throw new Error('PAIRING_HMAC_SECRET must contain at least 32 characters.');
  }
  const hmac = (purpose: string, value: string) =>
    createHmac('sha256', hmacSecret).update(`${purpose}\0${value}`, 'utf8').digest('hex');

  return {
    createCode: () => randomInt(0, 1_000_000).toString().padStart(6, '0'),
    createId: (prefix) => `${prefix}_${randomUUID().replaceAll('-', '')}`,
    digestCode: (code) => hmac('pairing-code', code),
    digestRateKey: (value) => hmac('pairing-rate-key', value),
    createCredential: (prefix) => {
      const plaintext = `${prefix}_${randomBytes(32).toString('base64url')}`;
      return { plaintext, digest: sha256(plaintext) };
    },
  };
}

export function digestOpaqueCredential(value: string): string {
  return sha256(value);
}
