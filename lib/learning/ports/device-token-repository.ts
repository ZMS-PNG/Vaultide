import type { DeviceScope } from '../domain/pairing';
import type { DeviceTokenPrincipal } from '../domain/device-token';

export interface RotateDeviceTokenClaim {
  refreshTokenDigest: string;
  accessTokenDigest: string;
  accessTokenExpiresAt: Date;
  nextRefreshTokenDigest: string;
  nextRefreshTokenExpiresAt: Date;
  now: Date;
}

export interface DeviceTokenRepository {
  authenticateAccessToken(
    accessTokenDigest: string,
    now: Date,
  ): Promise<DeviceTokenPrincipal | null>;
  rotateRefreshToken(claim: RotateDeviceTokenClaim): Promise<DeviceTokenPrincipal | null>;
  revokeRefreshToken(
    refreshTokenDigest: string,
    now: Date,
    reason: string,
  ): Promise<DeviceTokenPrincipal | null>;
}

export function isDeviceScope(value: string): value is DeviceScope {
  return [
    'sources:write',
    'sprints:write',
    'artifacts:read',
    'events:append',
    'writebacks:read',
    'writebacks:receipt',
    'device:self',
  ].includes(value);
}
