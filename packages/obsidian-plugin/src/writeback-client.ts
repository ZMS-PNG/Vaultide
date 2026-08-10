import { requestUrl } from 'obsidian';
import {
  LEARNING_PROTOCOL_VERSION,
  validateWritebackCommand,
  type WritebackCommand,
  type WritebackOperation,
  type WritebackReceipt,
} from '@openmaic/learning-protocol';
import { normalizeServerUrl } from './server-url';

function serverError(value: unknown, fallback: string): string {
  if (typeof value !== 'object' || value === null) return fallback;
  const error = (value as { error?: unknown }).error;
  if (typeof error !== 'object' || error === null) return fallback;
  const message = (error as { message?: unknown }).message;
  return typeof message === 'string' && message.length > 0 ? message : fallback;
}

export async function fetchPendingWritebacks(options: {
  serverUrl: string;
  accessToken: string;
  limit?: number;
  /** Restricts leasing so background automation never delays manual drafts. */
  operations?: readonly WritebackOperation[];
}): Promise<WritebackCommand[]> {
  const serverUrl = normalizeServerUrl(options.serverUrl);
  const limit = Math.max(1, Math.min(20, Math.trunc(options.limit ?? 10)));
  const query = new URLSearchParams({ limit: String(limit) });
  for (const operation of options.operations ?? []) query.append('operation', operation);
  const response = await requestUrl({
    url: `${serverUrl}/api/v1/writeback-commands/pending?${query.toString()}`,
    method: 'GET',
    headers: {
      Authorization: `Bearer ${options.accessToken}`,
      'X-MAIC-Protocol-Version': LEARNING_PROTOCOL_VERSION,
    },
    throw: false,
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(
      serverError(response.json, `Writeback check failed with HTTP ${response.status}.`),
    );
  }
  const commands =
    typeof response.json === 'object' &&
    response.json !== null &&
    Array.isArray((response.json as { commands?: unknown }).commands)
      ? (response.json as { commands: unknown[] }).commands
      : undefined;
  if (!commands) throw new Error('Writeback response is missing its command list.');
  return commands.map((command) => {
    const validation = validateWritebackCommand(command);
    if (!validation.valid) {
      throw new Error(
        `Server returned an unsafe WritebackCommand (${validation.errors[0]?.path ?? '/'}).`,
      );
    }
    return command as WritebackCommand;
  });
}

export async function submitWritebackReceipt(options: {
  serverUrl: string;
  accessToken: string;
  receipt: WritebackReceipt;
}): Promise<void> {
  const serverUrl = normalizeServerUrl(options.serverUrl);
  const response = await requestUrl({
    url: `${serverUrl}/api/v1/writeback-receipts`,
    method: 'POST',
    headers: {
      Authorization: `Bearer ${options.accessToken}`,
      'Content-Type': 'application/json',
      'X-MAIC-Protocol-Version': LEARNING_PROTOCOL_VERSION,
    },
    body: JSON.stringify({ receipt: options.receipt }),
    throw: false,
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(
      serverError(response.json, `Receipt upload failed with HTTP ${response.status}.`),
    );
  }
}

/**
 * Records that the connector passed its identity/path/approval gate just
 * before it applies a command. Failure to record telemetry never blocks the
 * local safety checks or changes their result.
 */
export async function markWritebackLocallyValidated(options: {
  serverUrl: string;
  accessToken: string;
  commandId: string;
}): Promise<void> {
  const serverUrl = normalizeServerUrl(options.serverUrl);
  const response = await requestUrl({
    url: `${serverUrl}/api/v1/writeback-commands/${encodeURIComponent(options.commandId)}/local-validation`,
    method: 'POST',
    headers: {
      Authorization: `Bearer ${options.accessToken}`,
      'X-MAIC-Protocol-Version': LEARNING_PROTOCOL_VERSION,
    },
    throw: false,
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(
      serverError(response.json, `Writeback validation status failed with HTTP ${response.status}.`),
    );
  }
}
