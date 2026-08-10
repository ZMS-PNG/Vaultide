import { beforeEach, describe, expect, it } from 'vitest';
import { PairingService, PairingServiceError } from '@/lib/learning/application/pairing-service';
import type { PairingExchangeClaim, PairingSessionRecord } from '@/lib/learning/domain/pairing';
import {
  PairingCodeConflictError,
  type PairingRepository,
} from '@/lib/learning/ports/pairing-repository';
import type { PairingCrypto } from '@/lib/learning/security/pairing-crypto';

const NOW = new Date('2026-07-21T12:00:00.000Z');

class MemoryPairingRepository implements PairingRepository {
  sessions: PairingSessionRecord[] = [];
  consumed = new Set<string>();
  claims: PairingExchangeClaim[] = [];
  rateResults: Array<{ allowed: boolean; retryAfterSeconds: number }> = [];
  createConflicts = 0;

  async ensureOwner(): Promise<void> {}

  async createPairingSession(session: PairingSessionRecord): Promise<void> {
    if (this.createConflicts > 0) {
      this.createConflicts -= 1;
      throw new PairingCodeConflictError();
    }
    this.sessions.push(session);
  }

  async claimExchangeAttempt(): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
    return this.rateResults.shift() ?? { allowed: true, retryAfterSeconds: 0 };
  }

  async consumePairingSession(claim: PairingExchangeClaim): Promise<{ ownerId: string } | null> {
    this.claims.push(claim);
    const session = this.sessions.find(
      (candidate) =>
        candidate.codeDigest === claim.codeDigest &&
        candidate.expiresAt > claim.now &&
        !this.consumed.has(candidate.id),
    );
    if (!session) return null;
    this.consumed.add(session.id);
    return { ownerId: session.ownerId };
  }
}

function deterministicCrypto(codes = ['123456']): PairingCrypto {
  let id = 0;
  let credential = 0;
  return {
    createCode: () => codes.shift() ?? '999999',
    createId: (prefix) => `${prefix}_${(++id).toString(16).padStart(32, '0')}`,
    digestCode: (code) => (code === '123456' ? 'c' : 'd').repeat(64),
    digestRateKey: (value) => `rate-${value}`.padEnd(64, '0').slice(0, 64),
    createCredential: (prefix) => {
      credential += 1;
      return {
        plaintext: `${prefix}_plaintext-${credential}`,
        digest: `digest-${prefix}-${credential}`.padEnd(64, '0').slice(0, 64),
      };
    },
  };
}

function exchangeInput() {
  return {
    code: '123456',
    deviceId: `dev_${'a'.repeat(32)}`,
    vaultBindingId: `vlt_${'b'.repeat(32)}`,
    vaultName: 'Learning Vault',
    pluginVersion: '0.1.0',
    rateIdentity: '203.0.113.10',
  };
}

describe('PairingService', () => {
  let repository: MemoryPairingRepository;

  beforeEach(() => {
    repository = new MemoryPairingRepository();
  });

  it('exchanges a pairing code once and sends only credential digests to persistence', async () => {
    const service = new PairingService(repository, deterministicCrypto(), {
      ownerId: `own_${'c'.repeat(32)}`,
      ownerDisplayName: 'Owner',
      now: () => NOW,
    });
    await service.createSession();

    const result = await service.exchange(exchangeInput());

    expect(result).toMatchObject({
      accessToken: 'maic_at_plaintext-1',
      refreshToken: 'maic_rt_plaintext-2',
      ownerId: `own_${'c'.repeat(32)}`,
      deviceId: `dev_${'a'.repeat(32)}`,
    });
    const persisted = JSON.stringify(repository.claims[0]);
    expect(persisted).not.toContain('123456');
    expect(persisted).not.toContain(result.accessToken);
    expect(persisted).not.toContain(result.refreshToken);

    await expect(service.exchange(exchangeInput())).rejects.toMatchObject({
      code: 'token_invalid',
      status: 401,
    });
  });

  it('checks both network and device rate limits before minting a claim', async () => {
    repository.rateResults.push(
      { allowed: true, retryAfterSeconds: 0 },
      { allowed: false, retryAfterSeconds: 90 },
      { allowed: true, retryAfterSeconds: 0 },
    );
    const service = new PairingService(repository, deterministicCrypto(), {
      ownerId: `own_${'c'.repeat(32)}`,
      ownerDisplayName: 'Owner',
      now: () => NOW,
    });

    await expect(service.exchange(exchangeInput())).rejects.toEqual(
      expect.objectContaining<Partial<PairingServiceError>>({
        code: 'quota_exceeded',
        status: 429,
        details: { retryAfterSeconds: 90 },
      }),
    );
    expect(repository.claims).toHaveLength(0);
  });

  it('retries a pairing-code digest collision', async () => {
    repository.createConflicts = 1;
    const service = new PairingService(repository, deterministicCrypto(['111111', '222222']), {
      ownerId: `own_${'c'.repeat(32)}`,
      ownerDisplayName: 'Owner',
      now: () => NOW,
    });

    const session = await service.createSession();

    expect(session.code).toBe('222222');
    expect(repository.sessions).toHaveLength(1);
  });
});
