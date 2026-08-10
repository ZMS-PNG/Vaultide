import type { PairingExchangeClaim, PairingSessionRecord } from '../domain/pairing';

export class PairingCodeConflictError extends Error {
  constructor() {
    super('An active pairing code already has the same digest.');
    this.name = 'PairingCodeConflictError';
  }
}

export interface ExchangeRateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

export interface PairingRepository {
  ensureOwner(ownerId: string, displayName: string, now: Date): Promise<void>;
  createPairingSession(session: PairingSessionRecord): Promise<void>;
  claimExchangeAttempt(rateKey: string, now: Date): Promise<ExchangeRateLimitResult>;
  consumePairingSession(claim: PairingExchangeClaim): Promise<{ ownerId: string } | null>;
}
