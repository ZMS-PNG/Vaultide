import { requestUrl } from 'obsidian';
import { LEARNING_PROTOCOL_VERSION } from '@openmaic/learning-protocol';
import type { LocalIdentity } from './identity';
import { normalizeServerUrl } from './server-url';

export { normalizeServerUrl } from './server-url';

export interface PairingExchangeResponse {
  accessToken: string;
  refreshToken: string;
  ownerId: string;
  expiresAt: string;
  scopes: string[];
}

function parsePairingResponse(value: unknown): PairingExchangeResponse {
  if (typeof value !== 'object' || value === null) throw new Error('Invalid pairing response.');
  const response = value as Record<string, unknown>;
  if (
    typeof response.accessToken !== 'string' ||
    response.accessToken.length === 0 ||
    typeof response.refreshToken !== 'string' ||
    response.refreshToken.length === 0 ||
    typeof response.ownerId !== 'string' ||
    response.ownerId.length === 0 ||
    typeof response.expiresAt !== 'string' ||
    Number.isNaN(Date.parse(response.expiresAt)) ||
    !Array.isArray(response.scopes) ||
    !response.scopes.every((scope) => typeof scope === 'string')
  ) {
    throw new Error('Pairing response is missing required credential fields.');
  }
  return {
    accessToken: response.accessToken,
    refreshToken: response.refreshToken,
    ownerId: response.ownerId,
    expiresAt: response.expiresAt,
    scopes: response.scopes,
  };
}

export async function refreshDeviceCredentials(options: {
  serverUrl: string;
  refreshToken: string;
}): Promise<PairingExchangeResponse> {
  const serverUrl = normalizeServerUrl(options.serverUrl);
  const response = await requestUrl({
    url: `${serverUrl}/api/v1/device-tokens/refresh`,
    method: 'POST',
    headers: {
      Authorization: `Bearer ${options.refreshToken}`,
      'X-MAIC-Protocol-Version': LEARNING_PROTOCOL_VERSION,
    },
    throw: false,
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Credential refresh failed with HTTP ${response.status}. Pair again.`);
  }
  return parsePairingResponse(response.json);
}

export async function revokeDeviceCredentials(options: {
  serverUrl: string;
  refreshToken: string;
}): Promise<void> {
  const serverUrl = normalizeServerUrl(options.serverUrl);
  const response = await requestUrl({
    url: `${serverUrl}/api/v1/device-tokens/revoke`,
    method: 'POST',
    headers: {
      Authorization: `Bearer ${options.refreshToken}`,
      'X-MAIC-Protocol-Version': LEARNING_PROTOCOL_VERSION,
    },
    throw: false,
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Credential revocation failed with HTTP ${response.status}.`);
  }
}

export async function exchangePairingCode(options: {
  serverUrl: string;
  code: string;
  identity: LocalIdentity;
  vaultName: string;
  pluginVersion: string;
}): Promise<PairingExchangeResponse> {
  if (!/^\d{6}$/.test(options.code)) throw new Error('Pairing code must contain exactly 6 digits.');
  const serverUrl = normalizeServerUrl(options.serverUrl);
  const response = await requestUrl({
    url: `${serverUrl}/api/v1/pairing-sessions/exchange`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-MAIC-Protocol-Version': LEARNING_PROTOCOL_VERSION,
    },
    body: JSON.stringify({
      code: options.code,
      deviceId: options.identity.deviceId,
      vaultBindingId: options.identity.vaultBindingId,
      vaultName: options.vaultName,
      pluginVersion: options.pluginVersion,
    }),
    throw: false,
  });
  if (response.status < 200 || response.status >= 300) {
    const errorMessage =
      typeof response.json === 'object' &&
      response.json !== null &&
      typeof (response.json as { error?: { message?: unknown } }).error?.message === 'string'
        ? (response.json as { error: { message: string } }).error.message
        : `Pairing failed with HTTP ${response.status}.`;
    throw new Error(errorMessage);
  }
  return parsePairingResponse(response.json);
}
