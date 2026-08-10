export const DEVICE_SCOPES = [
  'sources:write',
  'sprints:write',
  'artifacts:read',
  'events:append',
  'writebacks:read',
  'writebacks:receipt',
  'device:self',
] as const;

export type DeviceScope = (typeof DEVICE_SCOPES)[number];

export interface PairingSessionRecord {
  id: string;
  ownerId: string;
  codeDigest: string;
  createdAt: Date;
  expiresAt: Date;
}

export interface PairingExchangeClaim {
  codeDigest: string;
  deviceId: string;
  vaultBindingId: string;
  vaultName: string;
  pluginVersion: string;
  tokenId: string;
  accessTokenDigest: string;
  accessTokenExpiresAt: Date;
  refreshTokenDigest: string;
  refreshTokenExpiresAt: Date;
  scopes: readonly DeviceScope[];
  now: Date;
}

export interface PairingExchangeSuccess {
  accessToken: string;
  refreshToken: string;
  ownerId: string;
  deviceId: string;
  vaultBindingId: string;
  expiresAt: string;
  scopes: DeviceScope[];
}
