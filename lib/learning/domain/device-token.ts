import type { DeviceScope } from './pairing';

export interface DeviceTokenPrincipal {
  ownerId: string;
  deviceId: string;
  vaultBindingId: string;
  scopes: DeviceScope[];
}

export interface RotatedDeviceToken extends DeviceTokenPrincipal {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
}
