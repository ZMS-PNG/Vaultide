export const LEARNING_PROTOCOL_VERSION = '2026-07-draft-1' as const;
export const SOURCE_BUNDLE_SCHEMA_VERSION = 'source-bundle/1' as const;
export const SOURCE_ARCHIVE_SCHEMA_VERSION = 'source-archive/1' as const;
export const LEARNING_EVENT_SCHEMA_VERSION = 'learning-event/1' as const;
export const WRITEBACK_COMMAND_SCHEMA_VERSION = 'writeback-command/1' as const;
export const PROJECT_BINDING_SCHEMA_VERSION = 'project-binding/1' as const;
export const SOURCE_UPLOAD_INTENT_SCHEMA_VERSION = 'source-upload-intent/1' as const;

export type LearningProtocolVersion = typeof LEARNING_PROTOCOL_VERSION;

export interface ProtocolCompatibility {
  compatible: boolean;
  serverVersion: LearningProtocolVersion;
  minimumClientVersion: LearningProtocolVersion;
  reason?: 'missing' | 'unsupported';
}

/**
 * P0 deliberately supports one explicit protocol version. Compatibility must
 * be widened through a reviewed migration, never by silently accepting an
 * unknown command shape.
 */
export function negotiateProtocol(clientVersion: unknown): ProtocolCompatibility {
  if (typeof clientVersion !== 'string' || clientVersion.length === 0) {
    return {
      compatible: false,
      serverVersion: LEARNING_PROTOCOL_VERSION,
      minimumClientVersion: LEARNING_PROTOCOL_VERSION,
      reason: 'missing',
    };
  }
  if (clientVersion !== LEARNING_PROTOCOL_VERSION) {
    return {
      compatible: false,
      serverVersion: LEARNING_PROTOCOL_VERSION,
      minimumClientVersion: LEARNING_PROTOCOL_VERSION,
      reason: 'unsupported',
    };
  }
  return {
    compatible: true,
    serverVersion: LEARNING_PROTOCOL_VERSION,
    minimumClientVersion: LEARNING_PROTOCOL_VERSION,
  };
}

export const API_ERROR_CODES = [
  'invalid_request',
  'token_invalid',
  'scope_denied',
  'conflict',
  'writeback_conflict',
  'direct_upload_required',
  'learning_contract_invalid',
  'protocol_upgrade_required',
  'quota_exceeded',
  'dependency_unavailable',
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export interface ApiErrorEnvelope {
  error: {
    code: ApiErrorCode;
    message: string;
    retryable: boolean;
    requestId: string;
    details?: Record<string, string | number | boolean | null>;
  };
}
