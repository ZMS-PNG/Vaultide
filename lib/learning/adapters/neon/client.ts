import { neon, neonConfig } from '@neondatabase/serverless';
import { learningDatabaseUrl, LearningConfigurationError } from '../../config';

type LearningSql = ReturnType<typeof neon>;
type FetchLike = typeof fetch;

const PRE_TLS_RETRY_ATTEMPTS = 2;
const PRE_TLS_RETRY_DELAYS_MS = [90, 260] as const;

let cached: { url: string; sql: LearningSql } | undefined;
let retryingFetchInstalled = false;

function errorDetails(error: unknown): { message: string; code?: string } {
  const candidate = error instanceof Error ? error : undefined;
  const cause = candidate?.cause as { code?: unknown; message?: unknown } | undefined;
  const directCode = (candidate as (Error & { code?: unknown }) | undefined)?.code;
  return {
    message: [candidate?.message, typeof cause?.message === 'string' ? cause.message : '']
      .filter(Boolean)
      .join(' '),
    code:
      typeof cause?.code === 'string'
        ? cause.code
        : typeof directCode === 'string'
          ? directCode
          : undefined,
  };
}

/**
 * Only a connection that failed before TLS is retried. At that point no SQL
 * request can have reached Neon, so retrying cannot duplicate a write. Other
 * HTTP/database failures are deliberately returned to the caller unchanged.
 */
export function isSafePreTlsRetry(error: unknown): boolean {
  const { message, code } = errorDetails(error);
  return (
    /before secure TLS connection was established/iu.test(message) ||
    (code === 'ECONNRESET' && /TLS|socket disconnected/iu.test(message)) ||
    code === 'EAI_AGAIN' ||
    code === 'ENETUNREACH'
  );
}

export function createPreTlsRetryingFetch(
  fetcher: FetchLike = fetch,
  sleep: (milliseconds: number) => Promise<void> = (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)),
): FetchLike {
  return (async (...args: Parameters<FetchLike>): Promise<Response> => {
    let lastError: unknown;
    for (let attempt = 0; attempt <= PRE_TLS_RETRY_ATTEMPTS; attempt++) {
      try {
        return await fetcher(...args);
      } catch (error) {
        lastError = error;
        if (!isSafePreTlsRetry(error) || attempt === PRE_TLS_RETRY_ATTEMPTS) throw error;
        await sleep(PRE_TLS_RETRY_DELAYS_MS[attempt] ?? PRE_TLS_RETRY_DELAYS_MS.at(-1) ?? 260);
      }
    }
    throw lastError;
  }) as FetchLike;
}

function installNeonPreTlsRetry(): void {
  if (retryingFetchInstalled) return;
  neonConfig.fetchFunction = createPreTlsRetryingFetch();
  retryingFetchInstalled = true;
}

export function getLearningSql(): LearningSql {
  const url = learningDatabaseUrl();
  if (!url) throw new LearningConfigurationError('DATABASE_URL is not configured.');
  installNeonPreTlsRetry();
  if (!cached || cached.url !== url) cached = { url, sql: neon(url) };
  return cached.sql;
}
