import { NeonKnowledgeGraphRefreshRepository } from './adapters/neon/knowledge-graph-refresh-repository';
import { KnowledgeGraphRefreshService } from './application/knowledge-graph-refresh-service';
import { loadPairingConfig } from './config';
import { getKnowledgeGraphProjectionService } from './knowledge-graphs';

export function getKnowledgeGraphRefreshService(): KnowledgeGraphRefreshService {
  const config = loadPairingConfig();
  return new KnowledgeGraphRefreshService({
    ownerId: config.ownerId,
    repository: new NeonKnowledgeGraphRefreshRepository(),
    projections: getKnowledgeGraphProjectionService(),
  });
}
