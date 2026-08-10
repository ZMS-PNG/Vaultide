import type { DeviceTokenPrincipal } from '../../domain/device-token';
import type {
  DeviceTokenRepository,
  RotateDeviceTokenClaim,
} from '../../ports/device-token-repository';
import { isDeviceScope } from '../../ports/device-token-repository';
import { getLearningSql } from './client';

interface PrincipalRow {
  owner_id: string;
  device_id: string;
  vault_binding_id: string;
  scopes: string[];
}

function principal(row: PrincipalRow | undefined): DeviceTokenPrincipal | null {
  if (!row || !row.scopes.every(isDeviceScope)) return null;
  return {
    ownerId: row.owner_id,
    deviceId: row.device_id,
    vaultBindingId: row.vault_binding_id,
    scopes: row.scopes,
  };
}

export class NeonDeviceTokenRepository implements DeviceTokenRepository {
  async authenticateAccessToken(
    accessTokenDigest: string,
    now: Date,
  ): Promise<DeviceTokenPrincipal | null> {
    const rows = (await getLearningSql().query(
      `
        UPDATE integration_tokens
        SET last_used_at = $2
        WHERE access_token_digest = $1
          AND revoked_at IS NULL
          AND access_expires_at > $2
        RETURNING owner_id, device_id, vault_binding_id, scopes
      `,
      [accessTokenDigest, now],
    )) as PrincipalRow[];
    return principal(rows[0]);
  }

  async rotateRefreshToken(claim: RotateDeviceTokenClaim): Promise<DeviceTokenPrincipal | null> {
    const rows = (await getLearningSql().query(
      `
        WITH rotated AS (
          UPDATE integration_tokens
          SET access_token_digest = $2,
              access_expires_at = $3,
              refresh_token_digest = $4,
              refresh_expires_at = $5,
              revision = revision + 1,
              updated_at = $6,
              last_used_at = $6
          WHERE refresh_token_digest = $1
            AND revoked_at IS NULL
            AND refresh_expires_at > $6
          RETURNING owner_id, device_id, vault_binding_id, scopes
        ), audited AS (
          INSERT INTO learning_audit_events
            (id, owner_id, device_id, event_type, metadata, created_at)
          SELECT 'aud_' || replace(gen_random_uuid()::text, '-', ''), owner_id, device_id,
                 'device.token_rotated', '{}'::jsonb, $6
          FROM rotated
          RETURNING owner_id
        )
        SELECT owner_id, device_id, vault_binding_id, scopes
        FROM rotated
        WHERE EXISTS (SELECT 1 FROM audited)
      `,
      [
        claim.refreshTokenDigest,
        claim.accessTokenDigest,
        claim.accessTokenExpiresAt,
        claim.nextRefreshTokenDigest,
        claim.nextRefreshTokenExpiresAt,
        claim.now,
      ],
    )) as PrincipalRow[];
    return principal(rows[0]);
  }

  async revokeRefreshToken(
    refreshTokenDigest: string,
    now: Date,
    reason: string,
  ): Promise<DeviceTokenPrincipal | null> {
    const rows = (await getLearningSql().query(
      `
        WITH revoked AS (
          UPDATE integration_tokens
          SET revoked_at = $2, revoked_reason = $3, updated_at = $2
          WHERE refresh_token_digest = $1
            AND revoked_at IS NULL
            AND refresh_expires_at > $2
          RETURNING owner_id, device_id, vault_binding_id, scopes
        ), audited AS (
          INSERT INTO learning_audit_events
            (id, owner_id, device_id, event_type, metadata, created_at)
          SELECT 'aud_' || replace(gen_random_uuid()::text, '-', ''), owner_id, device_id,
                 'device.revoked', jsonb_build_object('reason', $3::text), $2
          FROM revoked
          RETURNING owner_id
        )
        SELECT owner_id, device_id, vault_binding_id, scopes
        FROM revoked
        WHERE EXISTS (SELECT 1 FROM audited)
      `,
      [refreshTokenDigest, now, reason],
    )) as PrincipalRow[];
    return principal(rows[0]);
  }
}
