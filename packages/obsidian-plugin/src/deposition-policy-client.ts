import { requestUrl } from 'obsidian';
import { LEARNING_PROTOCOL_VERSION } from '@openmaic/learning-protocol';
import { normalizeServerUrl } from './server-url';

export interface DepositionPolicy {
  mode: 'manual' | 'batch' | 'managed-auto';
  managedAutoEnabled: boolean;
  allowCompanionUpdates: boolean;
  allowSynthesisIndexUpdates: boolean;
  allowExternalCards: boolean;
  updatedAt: string;
}

function serverError(value: unknown, fallback: string): string {
  if (typeof value !== 'object' || value === null) return fallback;
  const error = (value as { error?: unknown }).error;
  if (typeof error !== 'object' || error === null) return fallback;
  const message = (error as { message?: unknown }).message;
  return typeof message === 'string' && message.length > 0 ? message : fallback;
}

function policyFromResponse(value: unknown): DepositionPolicy {
  const policy =
    typeof value === 'object' && value !== null
      ? (value as { policy?: unknown }).policy
      : undefined;
  if (
    typeof policy !== 'object' ||
    policy === null ||
    !['manual', 'batch', 'managed-auto'].includes(String((policy as { mode?: unknown }).mode)) ||
    typeof (policy as { managedAutoEnabled?: unknown }).managedAutoEnabled !== 'boolean' ||
    typeof (policy as { allowCompanionUpdates?: unknown }).allowCompanionUpdates !== 'boolean' ||
    ((policy as { allowSynthesisIndexUpdates?: unknown }).allowSynthesisIndexUpdates !== undefined &&
      typeof (policy as { allowSynthesisIndexUpdates?: unknown }).allowSynthesisIndexUpdates !==
        'boolean') ||
    typeof (policy as { allowExternalCards?: unknown }).allowExternalCards !== 'boolean' ||
    typeof (policy as { updatedAt?: unknown }).updatedAt !== 'string'
  ) {
    throw new Error('Vaultide automation policy response is invalid.');
  }
  return {
    ...(policy as Omit<DepositionPolicy, 'allowSynthesisIndexUpdates'>),
    allowSynthesisIndexUpdates:
      (policy as { allowSynthesisIndexUpdates?: boolean }).allowSynthesisIndexUpdates ?? false,
  };
}

export async function fetchDepositionPolicy(options: {
  serverUrl: string;
  accessToken: string;
}): Promise<DepositionPolicy> {
  const response = await requestUrl({
    url: `${normalizeServerUrl(options.serverUrl)}/api/v1/deposition-policy`,
    method: 'GET',
    headers: {
      Authorization: `Bearer ${options.accessToken}`,
      'X-MAIC-Protocol-Version': LEARNING_PROTOCOL_VERSION,
    },
    throw: false,
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(serverError(response.json, `Automation policy check failed with HTTP ${response.status}.`));
  }
  return policyFromResponse(response.json);
}

export async function updateDepositionPolicy(options: {
  serverUrl: string;
  accessToken: string;
  policy: Pick<
    DepositionPolicy,
    | 'mode'
    | 'managedAutoEnabled'
    | 'allowCompanionUpdates'
    | 'allowSynthesisIndexUpdates'
    | 'allowExternalCards'
  >;
}): Promise<DepositionPolicy> {
  const response = await requestUrl({
    url: `${normalizeServerUrl(options.serverUrl)}/api/v1/deposition-policy`,
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${options.accessToken}`,
      'Content-Type': 'application/json',
      'X-MAIC-Protocol-Version': LEARNING_PROTOCOL_VERSION,
    },
    body: JSON.stringify(options.policy),
    throw: false,
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(serverError(response.json, `Automation policy update failed with HTTP ${response.status}.`));
  }
  return policyFromResponse(response.json);
}
