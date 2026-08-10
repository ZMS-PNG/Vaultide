import type {
  WebSearchAttempt,
  WebSearchProviderMode,
  WebSearchSource,
  WebSearchSourceAuthority,
  WebSearchSourcePolicy,
} from '@/lib/types/web-search';
import type { ResearchSourceAvailability, ResearchSourceHealth } from './source-quality';

export interface RecordResearchRunInput {
  ownerId: string;
  requestedProviderId: string;
  usedProviderId: string;
  providerMode: WebSearchProviderMode;
  query: string;
  sourcePolicy: WebSearchSourcePolicy;
  attempts: WebSearchAttempt[];
  responseTimeMs: number;
  fetchedAt: Date;
  sources: WebSearchSource[];
}

export interface ResearchCitationReference {
  citationId: string;
  title: string;
  url: string;
  domain: string;
  authority: WebSearchSourceAuthority;
  score: number;
  snippetHash: string;
  availability?: ResearchSourceAvailability;
  checkedAt?: string;
  httpStatus?: number;
  finalUrl?: string;
  errorKind?: string;
}

export interface RecordedResearchRun {
  id: string;
  citations: ResearchCitationReference[];
}

export interface ResearchRepository {
  record(input: RecordResearchRunInput): Promise<RecordedResearchRun>;
  sourceHealth?(ownerId: string, runId: string): Promise<ResearchSourceHealth[]>;
  updateSourceHealth?(
    ownerId: string,
    runId: string,
    results: readonly ResearchSourceHealth[],
  ): Promise<ResearchSourceHealth[]>;
}
