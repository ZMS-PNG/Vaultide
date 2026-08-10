import type { ApiErrorCode } from '@openmaic/learning-protocol';
import {
  DEVICE_SCOPES,
  type PairingExchangeSuccess,
  type PairingSessionRecord,
} from '../domain/pairing';
import { PairingCodeConflictError, type PairingRepository } from '../ports/pairing-repository';
import type { PairingCrypto } from '../security/pairing-crypto';

const PAIRING_TTL_MS = 10 * 60 * 1000;
const ACCESS_TOKEN_TTL_MS = 15 * 60 * 1000;
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export class PairingServiceError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    readonly status: number,
    message: string,
    readonly retryable = false,
    readonly details?: Record<string, string | number | boolean | null>,
  ) {
    super(message);
    this.name = 'PairingServiceError';
  }
}

export interface PairingServiceOptions {
  ownerId: string;
  ownerDisplayName: string;
  now?: () => Date;
}

export class PairingService {
  private readonly now: () => Date;

  constructor(
    private readonly repository: PairingRepository,
    private readonly crypto: PairingCrypto,
    private readonly options: PairingServiceOptions,
  ) {
    this.now = options.now ?? (() => new Date());
  }

  async createSession(): Promise<{ id: string; code: string; expiresAt: string }> {
    const now = this.now();
    await this.repository.ensureOwner(this.options.ownerId, this.options.ownerDisplayName, now);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = this.crypto.createCode();
      const record: PairingSessionRecord = {
        id: this.crypto.createId('prs'),
        ownerId: this.options.ownerId,
        codeDigest: this.crypto.digestCode(code),
        createdAt: now,
        expiresAt: new Date(now.getTime() + PAIRING_TTL_MS),
      };
      try {
        await this.repository.createPairingSession(record);
        return { id: record.id, code, expiresAt: record.expiresAt.toISOString() };
      } catch (error) {
        if (!(error instanceof PairingCodeConflictError)) throw error;
      }
    }
    throw new PairingServiceError(
      'dependency_unavailable',
      503,
      'Unable to allocate a unique pairing code. Try again.',
      true,
    );
  }

  async exchange(input: {
    code: string;
    deviceId: string;
    vaultBindingId: string;
    vaultName: string;
    pluginVersion: string;
    rateIdentity: string;
  }): Promise<PairingExchangeSuccess> {
    const now = this.now();
    const globalRate = await this.repository.claimExchangeAttempt(
      this.crypto.digestRateKey('deployment-global'),
      now,
    );
    if (!globalRate.allowed) this.throwRateLimit(globalRate.retryAfterSeconds);

    const rateChecks = await Promise.all([
      this.repository.claimExchangeAttempt(
        this.crypto.digestRateKey(`network\0${input.rateIdentity}`),
        now,
      ),
      this.repository.claimExchangeAttempt(
        this.crypto.digestRateKey(`device\0${input.deviceId}`),
        now,
      ),
    ]);
    const blockedRate = rateChecks.find((rate) => !rate.allowed);
    if (blockedRate) this.throwRateLimit(blockedRate.retryAfterSeconds);

    const accessToken = this.crypto.createCredential('maic_at');
    const refreshToken = this.crypto.createCredential('maic_rt');
    const accessTokenExpiresAt = new Date(now.getTime() + ACCESS_TOKEN_TTL_MS);
    const result = await this.repository.consumePairingSession({
      codeDigest: this.crypto.digestCode(input.code),
      deviceId: input.deviceId,
      vaultBindingId: input.vaultBindingId,
      vaultName: input.vaultName,
      pluginVersion: input.pluginVersion,
      tokenId: this.crypto.createId('tok'),
      accessTokenDigest: accessToken.digest,
      accessTokenExpiresAt,
      refreshTokenDigest: refreshToken.digest,
      refreshTokenExpiresAt: new Date(now.getTime() + REFRESH_TOKEN_TTL_MS),
      scopes: DEVICE_SCOPES,
      now,
    });
    if (!result) {
      throw new PairingServiceError(
        'token_invalid',
        401,
        'The pairing code is invalid, expired, or already used.',
      );
    }
    return {
      accessToken: accessToken.plaintext,
      refreshToken: refreshToken.plaintext,
      ownerId: result.ownerId,
      deviceId: input.deviceId,
      vaultBindingId: input.vaultBindingId,
      expiresAt: accessTokenExpiresAt.toISOString(),
      scopes: [...DEVICE_SCOPES],
    };
  }

  private throwRateLimit(retryAfterSeconds: number): never {
    throw new PairingServiceError(
      'quota_exceeded',
      429,
      'Too many pairing attempts. Wait before trying again.',
      true,
      { retryAfterSeconds },
    );
  }
}
