export interface WebSearchSource {
  title: string;
  url: string;
  content: string;
  score: number;
  /** Stable citation label within one research run (for example `S1`). */
  citationId?: string;
  /** Canonical host used for duplicate detection and source-quality display. */
  domain?: string;
  /** A conservative quality hint; it is never presented as a truth guarantee. */
  authority?: WebSearchSourceAuthority;
}

export interface WebSearchResult {
  answer: string;
  sources: WebSearchSource[];
  query: string;
  responseTime: number;
}

export type WebSearchSourceAuthority = 'primary' | 'authoritative' | 'general';

export type WebSearchSourcePolicy = 'balanced' | 'prefer-primary';

export type WebSearchProviderMode =
  | 'official-api'
  | 'self-hosted'
  | 'public-page'
  | 'direct-url'
  | 'unavailable';

export interface WebSearchAttempt {
  providerId: string;
  mode: WebSearchProviderMode;
  try: number;
  /** Original topic query or a bounded retry constrained to authoritative domains. */
  strategy?: 'original' | 'topic-rescue' | 'authority-rescue';
  outcome: 'success' | 'empty' | 'failed';
  /** Provider result count before local authority/relevance filtering. */
  rawSourceCount?: number;
  /** Result count retained as inspectable learning evidence. */
  qualifyingSourceCount?: number;
  errorKind?: 'rate_limited' | 'authentication' | 'invalid_request' | 'upstream' | 'network';
  status?: number;
  retryable?: boolean;
  retryAfterMs?: number;
}

export interface WebSearchProvenance {
  requestedProviderId: string;
  providerId: string;
  mode: WebSearchProviderMode;
  fetchedAt: string;
  sourcePolicy: WebSearchSourcePolicy;
  attempts: WebSearchAttempt[];
  outcome?: 'ready' | 'unavailable';
  /** Present when citation metadata was durably recorded in the private learning database. */
  researchRunId?: string;
  storagePolicy: 'citation-metadata-only';
}
