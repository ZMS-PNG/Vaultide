import type {
  WebSearchSource,
  WebSearchSourceAuthority,
  WebSearchSourcePolicy,
} from '@/lib/types/web-search';
import { extractResearchTerms, researchTermOverlap } from '@/lib/web-search/relevance';

const PRIMARY_HOSTS = new Set([
  'who.int',
  'un.org',
  'europa.eu',
  'w3.org',
  'ietf.org',
  'rfc-editor.org',
  'iso.org',
  'nist.gov',
  'doi.org',
  'arxiv.org',
  'pubmed.ncbi.nlm.nih.gov',
  'ncbi.nlm.nih.gov',
  // A repository is the primary source for its own source code, README,
  // releases, and architecture documentation. Treating GitHub as ordinary
  // web content made repository-learning fail closed under prefer-primary.
  'github.com',
  'raw.githubusercontent.com',
]);

const AUTHORITATIVE_HOSTS = new Set([
  'developer.mozilla.org',
  'docs.python.org',
  'learn.microsoft.com',
  'developer.apple.com',
  'developers.google.com',
  'docs.github.com',
  'react.dev',
  'nextjs.org',
  'typescriptlang.org',
  'vite.dev',
  'fastapi.tiangolo.com',
  'capacitorjs.com',
  'nodejs.org',
  'python.org',
  'postgresql.org',
  'mysql.com',
  'redis.io',
  'docs.docker.com',
  'lbsyun.baidu.com',
]);

const TRACKING_PARAMS = new Set(['fbclid', 'gclid', 'mc_cid', 'mc_eid', 'ref', 'source']);

function isGovernmentOrAcademic(host: string): boolean {
  return (
    host.endsWith('.gov') ||
    host.includes('.gov.') ||
    host.endsWith('.edu') ||
    host.includes('.edu.') ||
    host.includes('.ac.')
  );
}

function hostMatches(host: string, candidates: Set<string>): boolean {
  return [...candidates].some((candidate) => host === candidate || host.endsWith(`.${candidate}`));
}

export function canonicalizeResearchUrl(
  value: string,
): { url: string; domain: string; authority: WebSearchSourceAuthority } | undefined {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return undefined;
    parsed.hash = '';
    parsed.hostname = parsed.hostname.toLowerCase();
    for (const key of [...parsed.searchParams.keys()]) {
      if (key.toLowerCase().startsWith('utm_') || TRACKING_PARAMS.has(key.toLowerCase())) {
        parsed.searchParams.delete(key);
      }
    }
    parsed.searchParams.sort();
    const domain = parsed.hostname.replace(/^www\./, '');
    const path = parsed.pathname.toLowerCase();
    let authority: WebSearchSourceAuthority = 'general';
    if (isGovernmentOrAcademic(domain) || hostMatches(domain, PRIMARY_HOSTS)) {
      authority = 'primary';
    } else if (
      hostMatches(domain, AUTHORITATIVE_HOSTS) ||
      domain.startsWith('docs.') ||
      domain.startsWith('developer.') ||
      domain.startsWith('developers.') ||
      /\/(docs?|documentation|reference|standards?)\b/.test(path)
    ) {
      authority = 'authoritative';
    }
    return { url: parsed.toString(), domain, authority };
  } catch {
    return undefined;
  }
}

const AUTHORITY_WEIGHT: Record<WebSearchSourceAuthority, number> = {
  primary: 3,
  authoritative: 2,
  general: 0,
};

// Search providers expose a semantic relevance score. It is especially useful
// when the question and source use different languages, where literal token
// overlap is expected to be zero. A very low score is not safe enough for
// learning evidence even when the hostname itself is trusted.
const MIN_SEMANTIC_RELEVANCE_SCORE = 0.1;

export function normalizeAndRankWebSearchSources(
  sources: readonly WebSearchSource[],
  policy: WebSearchSourcePolicy,
  query?: string,
): WebSearchSource[] {
  const unique = new Map<string, WebSearchSource>();
  for (const source of sources) {
    const canonical = canonicalizeResearchUrl(source.url);
    if (!canonical) continue;
    const normalized: WebSearchSource = {
      ...source,
      title: source.title.trim().slice(0, 500) || canonical.domain,
      url: canonical.url,
      content: source.content.trim().slice(0, 8_000),
      score: Number.isFinite(source.score) ? source.score : 0,
      domain: canonical.domain,
      authority: canonical.authority,
    };
    const existing = unique.get(canonical.url);
    if (!existing || normalized.score > existing.score) unique.set(canonical.url, normalized);
  }

  const queryTerms = query ? extractResearchTerms(query) : new Set<string>();
  const ranked = [...unique.values()]
    .map((source) => ({
      source,
      relevance:
        queryTerms.size >= 2
          ? researchTermOverlap(query ?? '', `${source.title}\n${source.content.slice(0, 2_000)}`)
          : 1,
    }))
    .filter(
      (item) =>
        item.relevance > 0 ||
        (item.source.authority !== 'general' && item.source.score >= MIN_SEMANTIC_RELEVANCE_SCORE),
    );
  if (policy === 'prefer-primary') {
    ranked.sort(
      (a, b) =>
        AUTHORITY_WEIGHT[b.source.authority ?? 'general'] -
          AUTHORITY_WEIGHT[a.source.authority ?? 'general'] ||
        b.relevance - a.relevance ||
        b.source.score - a.source.score,
    );
    // `prefer-primary` is the safe learning mode: ordinary search results may
    // help discovery, but they must not silently become course evidence.
    // The resilient search layer performs one authority-focused rescue query
    // when this leaves no usable sources.
    return ranked
      .filter(
        ({ source, relevance }) =>
          source.authority !== 'general' &&
          (source.score > 0 ? source.score >= MIN_SEMANTIC_RELEVANCE_SCORE : relevance >= 3),
      )
      .map(({ source }, index) => ({ ...source, citationId: `S${index + 1}` }));
  } else {
    ranked.sort((a, b) => b.relevance - a.relevance || b.source.score - a.source.score);
  }
  return ranked.map(({ source }, index) => ({ ...source, citationId: `S${index + 1}` }));
}
