import type { NeonDbError } from '@neondatabase/serverless';
import type { PairingExchangeClaim, PairingSessionRecord } from '../../domain/pairing';
import {
  PairingCodeConflictError,
  type ExchangeRateLimitResult,
  type PairingRepository,
} from '../../ports/pairing-repository';
import { getLearningSql } from './client';

function postgresCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as NeonDbError).code)
    : undefined;
}

export class NeonPairingRepository implements PairingRepository {
  async ensureOwner(ownerId: string, displayName: string, now: Date): Promise<void> {
    const sql = getLearningSql();
    await sql`
      INSERT INTO learning_owners (id, display_name, created_at, updated_at)
      VALUES (${ownerId}, ${displayName}, ${now}, ${now})
      ON CONFLICT (id) DO UPDATE
      SET display_name = EXCLUDED.display_name, updated_at = EXCLUDED.updated_at
    `;
  }

  async createPairingSession(session: PairingSessionRecord): Promise<void> {
    const sql = getLearningSql();
    try {
      await sql.transaction((tx) => [
        tx`
          UPDATE pairing_sessions
          SET invalidated_at = ${session.createdAt}
          WHERE owner_id = ${session.ownerId}
            AND consumed_at IS NULL
            AND invalidated_at IS NULL
        `,
        tx`
          DELETE FROM pairing_rate_limits
          WHERE updated_at < ${new Date(session.createdAt.getTime() - 24 * 60 * 60 * 1000)}
        `,
        tx`
          INSERT INTO pairing_sessions
            (id, owner_id, code_digest, created_at, expires_at)
          VALUES
            (${session.id}, ${session.ownerId}, ${session.codeDigest},
             ${session.createdAt}, ${session.expiresAt})
        `,
      ]);
    } catch (error) {
      if (postgresCode(error) === '23505') throw new PairingCodeConflictError();
      throw error;
    }
  }

  async claimExchangeAttempt(rateKey: string, now: Date): Promise<ExchangeRateLimitResult> {
    const sql = getLearningSql();
    const rows = (await sql.query(
      `
        INSERT INTO pairing_rate_limits
          (rate_key, window_started_at, attempt_count, blocked_until, updated_at)
        VALUES ($1, $2, 1, NULL, $2)
        ON CONFLICT (rate_key) DO UPDATE
        SET
          window_started_at = CASE
            WHEN pairing_rate_limits.window_started_at <= $2 - INTERVAL '10 minutes'
              THEN $2
            ELSE pairing_rate_limits.window_started_at
          END,
          attempt_count = CASE
            WHEN pairing_rate_limits.window_started_at <= $2 - INTERVAL '10 minutes'
              THEN 1
            ELSE pairing_rate_limits.attempt_count + 1
          END,
          blocked_until = CASE
            WHEN pairing_rate_limits.blocked_until > $2
              THEN pairing_rate_limits.blocked_until
            WHEN pairing_rate_limits.window_started_at <= $2 - INTERVAL '10 minutes'
              THEN NULL
            WHEN pairing_rate_limits.attempt_count + 1 > 10
              THEN $2 + INTERVAL '10 minutes'
            ELSE NULL
          END,
          updated_at = $2
        RETURNING attempt_count, blocked_until
      `,
      [rateKey, now],
    )) as Array<{ attempt_count: number; blocked_until: string | null }>;
    const row = rows[0];
    const blockedUntil = row?.blocked_until ? new Date(row.blocked_until) : undefined;
    const allowed = Boolean(row) && row.attempt_count <= 10 && !blockedUntil;
    return {
      allowed,
      retryAfterSeconds: blockedUntil
        ? Math.max(1, Math.ceil((blockedUntil.getTime() - now.getTime()) / 1000))
        : 0,
    };
  }

  async consumePairingSession(claim: PairingExchangeClaim): Promise<{ ownerId: string } | null> {
    const sql = getLearningSql();
    const rows = (await sql.query(
      `
        WITH claimed AS (
          UPDATE pairing_sessions
          SET consumed_at = $10, consumed_by_device_id = $2
          WHERE code_digest = $1
            AND consumed_at IS NULL
            AND invalidated_at IS NULL
            AND expires_at > $10
          RETURNING id, owner_id
        ), device_write AS (
          INSERT INTO integration_devices
            (owner_id, device_id, label, plugin_version, created_at, last_seen_at, revoked_at)
          SELECT owner_id, $2, 'Obsidian device', $5, $10, $10, NULL
          FROM claimed
          ON CONFLICT (owner_id, device_id) DO UPDATE
          SET plugin_version = EXCLUDED.plugin_version,
              last_seen_at = EXCLUDED.last_seen_at,
              revoked_at = NULL
          RETURNING owner_id, device_id
        ), vault_write AS (
          INSERT INTO vault_bindings
            (owner_id, vault_binding_id, device_id, vault_name, created_at, last_seen_at, revoked_at)
          SELECT owner_id, $3, device_id, $4, $10, $10, NULL
          FROM device_write
          ON CONFLICT (owner_id, vault_binding_id) DO UPDATE
          SET device_id = EXCLUDED.device_id,
              vault_name = EXCLUDED.vault_name,
              last_seen_at = EXCLUDED.last_seen_at,
              revoked_at = NULL
          RETURNING owner_id, device_id, vault_binding_id
        ), token_write AS (
          INSERT INTO integration_tokens
            (id, owner_id, device_id, vault_binding_id, access_token_digest,
             access_expires_at, refresh_token_digest, refresh_expires_at,
             scopes, revision, created_at, updated_at, revoked_at, revoked_reason)
          SELECT $6, owner_id, device_id, vault_binding_id, $7, $8, $9, $11,
                 $12::text[], 1, $10, $10, NULL, NULL
          FROM vault_write
          ON CONFLICT (owner_id, device_id, vault_binding_id) DO UPDATE
          SET id = EXCLUDED.id,
              access_token_digest = EXCLUDED.access_token_digest,
              access_expires_at = EXCLUDED.access_expires_at,
              refresh_token_digest = EXCLUDED.refresh_token_digest,
              refresh_expires_at = EXCLUDED.refresh_expires_at,
              scopes = EXCLUDED.scopes,
              revision = integration_tokens.revision + 1,
              updated_at = EXCLUDED.updated_at,
              revoked_at = NULL,
              revoked_reason = NULL
          RETURNING owner_id, device_id
        ), audit_write AS (
          INSERT INTO learning_audit_events
            (id, owner_id, device_id, event_type, metadata, created_at)
          SELECT 'aud_' || replace(gen_random_uuid()::text, '-', ''), owner_id, device_id,
                 'device.paired', jsonb_build_object('pairingSessionId', claimed.id), $10
          FROM token_write
          JOIN claimed USING (owner_id)
          RETURNING owner_id
        )
        SELECT owner_id FROM audit_write
      `,
      [
        claim.codeDigest,
        claim.deviceId,
        claim.vaultBindingId,
        claim.vaultName,
        claim.pluginVersion,
        claim.tokenId,
        claim.accessTokenDigest,
        claim.accessTokenExpiresAt,
        claim.refreshTokenDigest,
        claim.now,
        claim.refreshTokenExpiresAt,
        [...claim.scopes],
      ],
    )) as Array<{ owner_id: string }>;
    return rows[0] ? { ownerId: rows[0].owner_id } : null;
  }
}
