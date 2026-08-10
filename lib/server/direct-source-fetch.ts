import sanitizeHtml from 'sanitize-html';
import type { WebSearchResult, WebSearchSourcePolicy } from '@/lib/types/web-search';
import { validateUrlForSSRF } from '@/lib/server/ssrf-guard';
import { normalizeAndRankWebSearchSources } from '@/lib/web-search/source-quality';

const MAX_DIRECT_SOURCES = 3;
const MAX_REDIRECTS = 5;
const MAX_SOURCE_BYTES = 2 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 15_000;

const TRAILING_URL_PUNCTUATION = /[.,;:!?)}\]>'"，。；：！？）》】』]+$/u;
const HTTP_URL_PATTERN = /https?:\/\/[^\s<>"'`]+/giu;
const ARXIV_ID_PATTERN = /\barxiv\s*:\s*(\d{4}\.\d{4,5}(?:v\d+)?)\b/giu;

export function extractDirectSourceUrls(requirement: string): string[] {
  const urls: string[] = [];
  for (const match of requirement.matchAll(HTTP_URL_PATTERN)) {
    const candidate = match[0].replace(TRAILING_URL_PUNCTUATION, '');
    if (candidate) urls.push(candidate);
  }
  for (const match of requirement.matchAll(ARXIV_ID_PATTERN)) {
    urls.push(`https://arxiv.org/abs/${match[1]}`);
  }
  return [...new Set(urls)].slice(0, MAX_DIRECT_SOURCES);
}

/**
 * A repository landing page is application chrome, not repository evidence.
 * Its useful README, documentation and metadata are available through the
 * official GitHub discovery path, which preserves Markdown boundaries and can
 * retrieve companion documents.  Do not let a root GitHub URL short-circuit
 * that path by returning sign-in text, navigation labels, or star counts.
 */
function delegatesRepositoryRootToOfficialDiscovery(value: string): boolean {
  try {
    const parsed = new URL(value);
    const hostname = parsed.hostname.toLocaleLowerCase();
    if (hostname !== 'github.com' && hostname !== 'www.github.com') return false;
    const segments = parsed.pathname.split('/').filter(Boolean);
    return segments.length === 2;
  } catch {
    return false;
  }
}

export async function fetchDirectSourcesFromRequirement(options: {
  requirement: string;
  sourcePolicy: WebSearchSourcePolicy;
  now?: () => number;
}): Promise<WebSearchResult | undefined> {
  const urls = extractDirectSourceUrls(options.requirement)
    .filter((url) => !delegatesRepositoryRootToOfficialDiscovery(url));
  if (urls.length === 0) return undefined;

  const now = options.now ?? Date.now;
  const startedAt = now();
  const settled = await Promise.allSettled(urls.map((url) => fetchDirectSource(url)));
  const sources = settled
    .filter(
      (result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof fetchDirectSource>>> =>
        result.status === 'fulfilled',
    )
    .map((result) => result.value);

  const ranked = normalizeAndRankWebSearchSources(
    sources,
    options.sourcePolicy,
    options.requirement,
  );
  if (ranked.length === 0) return undefined;

  return {
    answer: '',
    sources: ranked,
    query: options.requirement.trim(),
    responseTime: Math.max(0, now() - startedAt) / 1_000,
  };
}

async function fetchDirectSource(url: string) {
  let currentUrl = url;
  let response: Response | undefined;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const ssrfError = await validateUrlForSSRF(currentUrl);
    if (ssrfError) throw new Error(ssrfError);

    response = await fetch(currentUrl, {
      redirect: 'manual',
      headers: {
        Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9',
        'User-Agent': 'Vaultide-Learning/1.0 (+https://github.com/THU-MAIC/OpenMAIC)',
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (response.status < 300 || response.status >= 400) break;
    const location = response.headers.get('location');
    if (!location) throw new Error('Redirect response did not include a Location header');
    if (hop === MAX_REDIRECTS) throw new Error('Too many redirects');
    currentUrl = new URL(location, currentUrl).href;
  }

  if (!response?.ok) {
    throw new Error(`Direct source returned HTTP ${response?.status ?? 'unknown'}`);
  }

  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  if (
    !contentType.includes('text/html') &&
    !contentType.includes('application/xhtml+xml') &&
    !contentType.includes('text/plain')
  ) {
    throw new Error(`Unsupported direct-source content type: ${contentType || 'unknown'}`);
  }

  const declaredSize = Number(response.headers.get('content-length') ?? '');
  if (Number.isFinite(declaredSize) && declaredSize > MAX_SOURCE_BYTES) {
    throw new Error(`Direct source is too large (${declaredSize} bytes)`);
  }
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > MAX_SOURCE_BYTES) {
    throw new Error(`Direct source is too large (${bytes.byteLength} bytes)`);
  }

  const html = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  const title =
    decodeText(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/iu)?.[1] ?? '') ||
    new URL(currentUrl).hostname;
  const content = decodeText(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, ' ')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, ' ')
      .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/giu, ' '),
  );
  if (content.length < 80) throw new Error('Direct source did not contain enough readable text');

  return {
    title: title.slice(0, 500),
    url: currentUrl,
    content: content.slice(0, 8_000),
    score: 1,
  };
}

function richerFetchUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.hostname.toLowerCase() !== 'github.com') return value;
    const segments = url.pathname.split('/').filter(Boolean);
    if (segments.length === 2) {
      return `https://raw.githubusercontent.com/${segments[0]}/${segments[1]}/HEAD/README.md`;
    }
    if (segments.length >= 5 && segments[2] === 'blob') {
      return `https://raw.githubusercontent.com/${segments[0]}/${segments[1]}/${segments
        .slice(3)
        .join('/')}`;
    }
  } catch {
    return value;
  }
  return value;
}

/**
 * Search providers often return only a sentence-long snippet. Hydrate the top
 * primary sources with directly readable content before those sources become
 * outline or scene evidence.
 */
export async function enrichWebSearchResultWithDirectContent(
  result: WebSearchResult,
  maxSources = 4,
): Promise<WebSearchResult> {
  if (process.env.NODE_ENV === 'test') return result;
  const enriched = await Promise.all(
    result.sources.map(async (source, index) => {
      if (index >= maxSources || String(source.content ?? '').trim().length >= 3_000) return source;
      const preferredUrl = richerFetchUrl(source.url);
      const candidates =
        preferredUrl === source.url ? [source.url] : [preferredUrl, source.url];
      for (const candidate of candidates) {
        try {
          const fetched = await fetchDirectSource(candidate);
          if (fetched.content.length > String(source.content ?? '').length) {
            return { ...source, content: fetched.content };
          }
        } catch {
          // Try the canonical search result after a specialized URL (for
          // example a missing GitHub README) fails.
        }
      }
      return source;
    }),
  );
  return { ...result, sources: enriched };
}

function decodeText(value: string): string {
  return sanitizeHtml(value, {
    allowedTags: [],
    allowedAttributes: {},
  })
    .replace(/\s+/gu, ' ')
    .trim();
}
