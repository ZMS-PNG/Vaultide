import { NeonKnowledgeSpaceEvidenceRepository } from './adapters/neon/knowledge-space-evidence-repository';
import { NeonLearningProgressRepository } from './adapters/neon/learning-progress-repository';
import { NeonSynthesisRepository } from './adapters/neon/synthesis-repository';
import { SynthesisService } from './application/synthesis-service';
import { loadPairingConfig } from './config';
import { getKnowledgeGraphRefreshService } from './knowledge-graph-refresh';
import { getLearningProgressService } from './learning-progress';

export function getSynthesisService(): SynthesisService {
  const config = loadPairingConfig();
  const graphRefresh = getKnowledgeGraphRefreshService();
  return new SynthesisService({
    ownerId: config.ownerId,
    repository: new NeonSynthesisRepository(),
    knowledgeSpaceEvidenceRepository: new NeonKnowledgeSpaceEvidenceRepository(),
    learningProgressRepository: new NeonLearningProgressRepository(),
    approveWritebackDraft: (draftId, revision) =>
      getLearningProgressService().approveWritebackDraft(draftId, revision),
    onKnowledgeChanged: (change) => graphRefresh.enqueueAndProcess(change).then(() => undefined),
  });
}
