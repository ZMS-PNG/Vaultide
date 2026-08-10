import { NextRequest } from 'next/server';

const MAX_PAIRING_BODY_BYTES = 16_384;
const DEVICE_ID = /^dev_[a-f0-9]{32}$/;
const VAULT_BINDING_ID = /^vlt_[a-f0-9]{32}$/;
const PLUGIN_VERSION = /^[0-9A-Za-z][0-9A-Za-z.+_-]{0,39}$/;
const ALLOWED_FIELDS = new Set([
  'code',
  'deviceId',
  'vaultBindingId',
  'vaultName',
  'pluginVersion',
]);

export class PairingInputError extends Error {
  constructor(
    message: string,
    readonly field?: string,
  ) {
    super(message);
    this.name = 'PairingInputError';
  }
}

export interface PairingExchangeInput {
  code: string;
  deviceId: string;
  vaultBindingId: string;
  vaultName: string;
  pluginVersion: string;
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string') throw new PairingInputError(`${key} must be a string.`, key);
  return value;
}

export async function readPairingExchangeInput(
  request: NextRequest,
): Promise<PairingExchangeInput> {
  const contentType = request.headers.get('content-type')?.toLowerCase() ?? '';
  if (!contentType.startsWith('application/json')) {
    throw new PairingInputError('Content-Type must be application/json.');
  }

  const declaredLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_PAIRING_BODY_BYTES) {
    throw new PairingInputError('Pairing request body is too large.');
  }

  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_PAIRING_BODY_BYTES) {
    throw new PairingInputError('Pairing request body is too large.');
  }

  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new PairingInputError('Pairing request body must be valid JSON.');
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new PairingInputError('Pairing request body must be a JSON object.');
  }

  const record = value as Record<string, unknown>;
  const unknownField = Object.keys(record).find((key) => !ALLOWED_FIELDS.has(key));
  if (unknownField) throw new PairingInputError('Unknown field is not allowed.', unknownField);

  const code = requiredString(record, 'code');
  const deviceId = requiredString(record, 'deviceId');
  const vaultBindingId = requiredString(record, 'vaultBindingId');
  const vaultName = requiredString(record, 'vaultName').trim();
  const pluginVersion = requiredString(record, 'pluginVersion');

  if (!/^\d{6}$/.test(code)) {
    throw new PairingInputError('code must contain exactly 6 digits.', 'code');
  }
  if (!DEVICE_ID.test(deviceId)) {
    throw new PairingInputError('deviceId has an invalid format.', 'deviceId');
  }
  if (!VAULT_BINDING_ID.test(vaultBindingId)) {
    throw new PairingInputError('vaultBindingId has an invalid format.', 'vaultBindingId');
  }
  if (vaultName.length < 1 || vaultName.length > 255 || /[\u0000-\u001f]/.test(vaultName)) {
    throw new PairingInputError('vaultName must contain 1 to 255 safe characters.', 'vaultName');
  }
  if (!PLUGIN_VERSION.test(pluginVersion)) {
    throw new PairingInputError('pluginVersion has an invalid format.', 'pluginVersion');
  }

  return { code, deviceId, vaultBindingId, vaultName, pluginVersion };
}

export function pairingRateIdentity(request: NextRequest): string {
  const candidates = [
    request.headers.get('x-vercel-forwarded-for'),
    request.headers.get('x-forwarded-for')?.split(',')[0],
    request.headers.get('x-real-ip'),
  ];
  for (const candidate of candidates) {
    const value = candidate?.trim();
    if (value && value.length <= 64 && /^[0-9A-Fa-f:.]+$/.test(value)) return value;
  }
  return 'unknown-network';
}
