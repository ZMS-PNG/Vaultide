import type { WebSearchProviderId } from './types';
import type { WebSearchProviderMode } from '@/lib/types/web-search';

export type WebSearchErrorKind =
  | 'rate_limited'
  | 'authentication'
  | 'invalid_request'
  | 'upstream'
  | 'network';

function boundedText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const cleaned = value
    .replace(/<[^>]*>/g, ' ')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned ? cleaned.slice(0, 240) : undefined;
}

function safeUpstreamDetail(body: string): string | undefined {
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    const nested =
      typeof parsed.error === 'object' && parsed.error !== null
        ? (parsed.error as Record<string, unknown>)
        : undefined;
    return boundedText(
      (typeof parsed.error === 'string' ? parsed.error : undefined) ??
        parsed.message ??
        parsed.detail ??
        nested?.message,
    );
  } catch {
    // HTML error pages are intentionally not reflected to the browser.
    return undefined;
  }
}

export function parseRetryAfterMs(headers: Headers, nowMs = Date.now()): number | undefined {
  const retryAfter = headers.get('retry-after')?.trim();
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
    const dateMs = Date.parse(retryAfter);
    if (Number.isFinite(dateMs)) return Math.max(0, dateMs - nowMs);
  }

  // Brave documents X-RateLimit-Reset as seconds until reset. Some gateways
  // use an epoch instead, so support both without trusting unbounded values.
  const reset = headers.get('x-ratelimit-reset')?.split(',')[0]?.trim();
  if (!reset) return undefined;
  const value = Number(reset);
  if (!Number.isFinite(value) || value < 0) return undefined;
  if (value > 10_000_000_000) return Math.max(0, value - nowMs);
  if (value > 10_000_000) return Math.max(0, value * 1000 - nowMs);
  return Math.round(value * 1000);
}

function kindForStatus(status: number): WebSearchErrorKind {
  if (status === 429) return 'rate_limited';
  if (status === 401 || status === 403) return 'authentication';
  if (status >= 400 && status < 500) return 'invalid_request';
  return 'upstream';
}

function safeProviderMessage(options: {
  providerId: WebSearchProviderId;
  mode: WebSearchProviderMode;
  kind: WebSearchErrorKind;
  status?: number;
  detail?: string;
}): string {
  const { providerId, mode, kind, status, detail } = options;
  if (providerId === 'brave' && mode === 'public-page' && kind === 'rate_limited') {
    return 'Brave public-page search was rate limited. Configure an official Brave Search API key, Tavily, or a private SearXNG instance for production use.';
  }
  const prefix = `${providerId} web search`;
  if (kind === 'rate_limited') return `${prefix} is temporarily rate limited.`;
  if (kind === 'authentication') return `${prefix} rejected its credentials or configuration.`;
  if (kind === 'invalid_request')
    return `${prefix} rejected the request${detail ? `: ${detail}` : '.'}`;
  if (kind === 'network') return `${prefix} could not be reached.`;
  return `${prefix} is temporarily unavailable${status ? ` (${status})` : '.'}`;
}

export class WebSearchProviderError extends Error {
  constructor(
    readonly providerId: WebSearchProviderId,
    readonly mode: WebSearchProviderMode,
    readonly kind: WebSearchErrorKind,
    readonly status: number | undefined,
    readonly retryable: boolean,
    readonly retryAfterMs: number | undefined,
    message: string,
  ) {
    super(message);
    this.name = 'WebSearchProviderError';
  }
}

export async function webSearchResponseError(options: {
  providerId: WebSearchProviderId;
  mode: WebSearchProviderMode;
  response: Response;
}): Promise<WebSearchProviderError> {
  const { providerId, mode, response } = options;
  const body = await response.text().catch(() => '');
  const kind = kindForStatus(response.status);
  const detail = safeUpstreamDetail(body);
  const retryAfterMs = parseRetryAfterMs(response.headers);
  return new WebSearchProviderError(
    providerId,
    mode,
    kind,
    response.status,
    kind === 'rate_limited' || response.status >= 500,
    retryAfterMs,
    safeProviderMessage({ providerId, mode, kind, status: response.status, detail }),
  );
}

export function normalizeWebSearchError(
  providerId: WebSearchProviderId,
  mode: WebSearchProviderMode,
  error: unknown,
): WebSearchProviderError {
  if (error instanceof WebSearchProviderError) return error;
  // Vitest module resets, worker boundaries, and some server bundlers can
  // duplicate the class constructor. Preserve typed fields structurally rather
  // than downgrading a real 429 to a generic network error.
  if (typeof error === 'object' && error !== null) {
    const record = error as Partial<WebSearchProviderError>;
    if (
      record.name === 'WebSearchProviderError' &&
      ['rate_limited', 'authentication', 'invalid_request', 'upstream', 'network'].includes(
        String(record.kind),
      )
    ) {
      const kind = record.kind as WebSearchErrorKind;
      return new WebSearchProviderError(
        providerId,
        mode,
        kind,
        typeof record.status === 'number' ? record.status : undefined,
        record.retryable === true,
        typeof record.retryAfterMs === 'number' ? record.retryAfterMs : undefined,
        safeProviderMessage({
          providerId,
          mode,
          kind,
          status: typeof record.status === 'number' ? record.status : undefined,
        }),
      );
    }
  }
  const raw = error instanceof Error ? error.message : String(error);
  const statusMatch = raw.match(/\((\d{3})\)/);
  const status = statusMatch ? Number(statusMatch[1]) : undefined;
  const kind = status ? kindForStatus(status) : 'network';
  return new WebSearchProviderError(
    providerId,
    mode,
    kind,
    status,
    kind === 'network' || kind === 'rate_limited' || (status !== undefined && status >= 500),
    undefined,
    safeProviderMessage({ providerId, mode, kind, status }),
  );
}
