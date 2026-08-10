const OWNER_ID = /^own_[a-f0-9]{32}$/;
const VAULT_BINDING_ID = /^vlt_[a-f0-9]{32}$/;

export interface PairingConfig {
  ownerId: string;
  ownerDisplayName: string;
  hmacSecret: string;
}

export class LearningConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LearningConfigurationError';
  }
}

export function learningDatabaseUrl(): string | undefined {
  return process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
}

export function learningMigrationDatabaseUrl(): string | undefined {
  return (
    process.env.DATABASE_URL_UNPOOLED ??
    process.env.POSTGRES_URL_NON_POOLING ??
    learningDatabaseUrl()
  );
}

export function loadPairingConfig(): PairingConfig {
  const ownerId = process.env.LEARNING_OWNER_ID?.trim();
  const hmacSecret = process.env.PAIRING_HMAC_SECRET ?? '';
  if (!ownerId || !OWNER_ID.test(ownerId)) {
    throw new LearningConfigurationError(
      'LEARNING_OWNER_ID must use the form own_ followed by 32 lowercase hex characters.',
    );
  }
  if (hmacSecret.length < 32) {
    throw new LearningConfigurationError(
      'PAIRING_HMAC_SECRET must contain at least 32 characters.',
    );
  }
  if (!learningDatabaseUrl()) {
    throw new LearningConfigurationError('DATABASE_URL is not configured.');
  }
  return {
    ownerId,
    ownerDisplayName: process.env.LEARNING_OWNER_DISPLAY_NAME?.trim() || 'OpenMAIC Owner',
    hmacSecret,
  };
}

export function pairingIsConfigured(): boolean {
  try {
    loadPairingConfig();
    return Boolean(process.env.ACCESS_CODE);
  } catch {
    return false;
  }
}

export function sourceUploadIsConfigured(): boolean {
  return (
    pairingIsConfigured() &&
    Boolean(process.env.BLOB_READ_WRITE_TOKEN) &&
    (process.env.CRON_SECRET?.length ?? 0) >= 32
  );
}

export function learningProgressIsConfigured(): boolean {
  return pairingIsConfigured();
}

/**
 * Optional single-owner deployment preference used only when an operation has
 * no source bundle that already identifies its originating Vault.
 */
export function preferredWritebackVaultBindingId(): string | undefined {
  const value = process.env.LEARNING_PREFERRED_VAULT_BINDING_ID?.trim();
  return value && VAULT_BINDING_ID.test(value) ? value : undefined;
}
