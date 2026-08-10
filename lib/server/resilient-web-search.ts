import { searchWeb } from '@/lib/web-search';
import { normalizeWebSearchError, type WebSearchErrorKind } from '@/lib/web-search/provider-error';
import { normalizeAndRankWebSearchSources } from '@/lib/web-search/source-quality';
import type {
  WebSearchAttempt,
  WebSearchProviderMode,
  WebSearchProvenance,
  WebSearchResult,
  WebSearchSourcePolicy,
} from '@/lib/types/web-search';
import type { BaiduSubSources, WebSearchProviderId } from '@/lib/web-search/types';
import { createLogger } from '@/lib/logger';

const log = createLogger('ResilientWebSearch');

export interface WebSearchCandidate {
  providerId: WebSearchProviderId;
  apiKey: string;
  baseUrl?: string;
  mode: WebSearchProviderMode;
  baiduSubSources?: BaiduSubSources;
}

export class WebSearchExhaustedError extends Error {
  readonly code: 'RATE_LIMITED' | 'NO_QUALIFYING_SOURCES' | 'UPSTREAM_ERROR';
  readonly status: number;
  readonly retryAfterMs?: number;

  constructor(readonly attempts: WebSearchAttempt[]) {
    const failed = attempts.filter((attempt) => attempt.outcome === 'failed');
    const allRateLimited =
      failed.length > 0 && failed.every((attempt) => attempt.errorKind === 'rate_limited');
    const publicBraveOnly =
      failed.length > 0 &&
      failed.every(
        (attempt) =>
          attempt.providerId === 'brave' &&
          attempt.mode === 'public-page' &&
          attempt.errorKind === 'rate_limited',
      );
    const authorityRescueExhausted = attempts.some(
      (attempt) => attempt.strategy === 'authority-rescue' && attempt.outcome === 'empty',
    );
    super(
      publicBraveOnly
        ? 'Brave public-page search is rate limited. Add BRAVE_API_KEY or TAVILY_API_KEY to the Vercel deployment, or configure a private SearXNG instance.'
        : authorityRescueExhausted
          ? 'No primary or authoritative sources were found for this topic. Try a more specific query, choose balanced sources, or supply trusted source material.'
          : 'No configured web-search provider returned usable sources. Check provider credentials and try again.',
    );
    this.name = 'WebSearchExhaustedError';
    this.code = allRateLimited
      ? 'RATE_LIMITED'
      : authorityRescueExhausted
        ? 'NO_QUALIFYING_SOURCES'
        : 'UPSTREAM_ERROR';
    this.status = allRateLimited ? 429 : authorityRescueExhausted ? 422 : 503;
    const retryValues = failed
      .map((attempt) => attempt.retryAfterMs)
      .filter((value): value is number => value !== undefined);
    if (retryValues.length > 0) this.retryAfterMs = Math.min(...retryValues);
  }
}

function retryDelay(
  kind: WebSearchErrorKind,
  retryAfterMs: number | undefined,
): number | undefined {
  if (retryAfterMs !== undefined) return retryAfterMs <= 1_500 ? retryAfterMs : undefined;
  if (kind === 'network' || kind === 'upstream') return 250;
  return undefined;
}

const RESEARCH_AUTHORITY_RESCUE_SUFFIX =
  'peer reviewed research evidence official university academic paper';
const TECHNICAL_AUTHORITY_RESCUE_SUFFIX =
  'official documentation architecture reference implementation';

function technicalQuery(query: string): boolean {
  return /\b(api|architecture|capacitor|docker|fastapi|framework|github|javascript|next\.?js|node\.?js|python|react|repository|typescript|vite)\b|架构|接口|代码|框架|技术栈|仓库/iu.test(
    query,
  );
}

export function buildAuthorityRescueQuery(query: string): string {
  const suffix = technicalQuery(query)
    ? TECHNICAL_AUTHORITY_RESCUE_SUFFIX
    : RESEARCH_AUTHORITY_RESCUE_SUFFIX;
  // All current providers accept at least 400 characters. Keep the topic at
  // the front so provider-side truncation never drops the user's intent.
  const suffixLength = suffix.length + 1;
  return `${query.trim().slice(0, 400 - suffixLength)} ${suffix}`.trim();
}

export async function searchWebResilient(options: {
  requestedProviderId: WebSearchProviderId;
  candidates: readonly WebSearchCandidate[];
  query: string;
  maxResults?: number;
  sourcePolicy?: WebSearchSourcePolicy;
  now?: () => Date;
  wait?: (milliseconds: number) => Promise<void>;
  search?: typeof searchWeb;
}): Promise<{ result: WebSearchResult; provenance: WebSearchProvenance }> {
  const sourcePolicy = options.sourcePolicy ?? 'prefer-primary';
  const now = options.now ?? (() => new Date());
  const wait =
    options.wait ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const runSearch = options.search ?? searchWeb;
  const attempts: WebSearchAttempt[] = [];
  const unavailableCandidates = new Set<WebSearchCandidate>();

  const queryStrategies =
    sourcePolicy === 'prefer-primary'
      ? ([
          { strategy: 'original', query: options.query },
          { strategy: 'authority-rescue', query: buildAuthorityRescueQuery(options.query) },
        ] as const)
      : ([{ strategy: 'original', query: options.query }] as const);

  // Give every configured provider the unmodified topic before broadening the
  // query. Only after those options are exhausted do we run authority rescue.
  for (const queryStrategy of queryStrategies) {
    for (const candidate of options.candidates) {
      if (queryStrategy.strategy === 'authority-rescue' && unavailableCandidates.has(candidate)) {
        continue;
      }
      let tryNumber = 1;
      while (tryNumber <= 2) {
        try {
          const raw = await runSearch({
            providerId: candidate.providerId,
            query: queryStrategy.query,
            apiKey: candidate.apiKey,
            maxResults: options.maxResults,
            baseUrl: candidate.baseUrl,
            ...(candidate.providerId === 'baidu' && candidate.baiduSubSources
              ? { baiduSubSources: candidate.baiduSubSources }
              : {}),
          });
          const sources = normalizeAndRankWebSearchSources(
            raw.sources,
            sourcePolicy,
            options.query,
          );
          log.info('Web search candidate evaluated.', {
            providerId: candidate.providerId,
            mode: candidate.mode,
            strategy: queryStrategy.strategy,
            rawSourceCount: raw.sources.length,
            qualifyingSourceCount: sources.length,
          });
          // Learning content must be grounded in inspectable citations. A
          // provider-generated answer without source URLs is not sufficient.
          if (sources.length === 0) {
            attempts.push({
              providerId: candidate.providerId,
              mode: candidate.mode,
              try: tryNumber,
              strategy: queryStrategy.strategy,
              outcome: 'empty',
              rawSourceCount: raw.sources.length,
              qualifyingSourceCount: 0,
            });
            break;
          }
          attempts.push({
            providerId: candidate.providerId,
            mode: candidate.mode,
            try: tryNumber,
            strategy: queryStrategy.strategy,
            outcome: 'success',
            rawSourceCount: raw.sources.length,
            qualifyingSourceCount: sources.length,
          });
          const fetchedAt = now().toISOString();
          return {
            result: { ...raw, sources },
            provenance: {
              requestedProviderId: options.requestedProviderId,
              providerId: candidate.providerId,
              mode: candidate.mode,
              fetchedAt,
              sourcePolicy,
              attempts,
              outcome: 'ready',
              storagePolicy: 'citation-metadata-only',
            },
          };
        } catch (error) {
          const normalized = normalizeWebSearchError(candidate.providerId, candidate.mode, error);
          attempts.push({
            providerId: candidate.providerId,
            mode: candidate.mode,
            try: tryNumber,
            strategy: queryStrategy.strategy,
            outcome: 'failed',
            errorKind: normalized.kind,
            status: normalized.status,
            retryable: normalized.retryable,
            retryAfterMs: normalized.retryAfterMs,
          });
          const delay =
            candidate.mode === 'public-page' || !normalized.retryable
              ? undefined
              : retryDelay(normalized.kind, normalized.retryAfterMs);
          if (tryNumber === 1 && delay !== undefined) {
            await wait(delay);
            tryNumber += 1;
            continue;
          }
          unavailableCandidates.add(candidate);
          break;
        }
      }
    }
  }

  throw new WebSearchExhaustedError(attempts);
}
