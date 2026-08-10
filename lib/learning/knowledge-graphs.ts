import { NeonKnowledgeGraphV2Repository } from './adapters/neon/knowledge-graph-v2-repository';
import { NeonSynthesisRepository } from './adapters/neon/synthesis-repository';
import { KnowledgeGraphProjectionService } from './application/knowledge-graph-projection-service';
import { loadPairingConfig } from './config';
import { knowledgeGraphV2Flags } from './knowledge-graph-v2-flags';

export function getKnowledgeGraphProjectionService(): KnowledgeGraphProjectionService {
  const config = loadPairingConfig();
  return new KnowledgeGraphProjectionService({
    ownerId: config.ownerId,
    synthesisRepository: new NeonSynthesisRepository(),
    repository: new NeonKnowledgeGraphV2Repository(),
    flags: knowledgeGraphV2Flags(),
  });
}
