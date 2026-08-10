import type { WebSearchProvenance, WebSearchResult } from '@/lib/types/web-search';
import { NeonResearchRepository } from './adapters/neon/research-repository';
import { learningProgressIsConfigured, loadPairingConfig } from './config';
import type { RecordedResearchRun, ResearchRepository } from './domain/research';

export async function recordResearchRunIfConfigured(
  result: WebSearchResult,
  provenance: WebSearchProvenance,
  repository: ResearchRepository = new NeonResearchRepository(),
): Promise<RecordedResearchRun | undefined> {
  if (!learningProgressIsConfigured() || result.sources.length === 0) return undefined;
  const config = loadPairingConfig();
  return repository.record({
    ownerId: config.ownerId,
    requestedProviderId: provenance.requestedProviderId,
    usedProviderId: provenance.providerId,
    providerMode: provenance.mode,
    query: result.query,
    sourcePolicy: provenance.sourcePolicy,
    attempts: provenance.attempts,
    responseTimeMs: result.responseTime * 1000,
    fetchedAt: new Date(provenance.fetchedAt),
    sources: result.sources,
  });
}
