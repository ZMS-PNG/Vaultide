import { NeonLearningProgressRepository } from './adapters/neon/learning-progress-repository';
import { NeonKnowledgeAssetRepository } from './adapters/neon/knowledge-asset-repository';
import { NeonProjectLearningIndexRepository } from './adapters/neon/project-learning-index-repository';
import { NeonKnowledgeSnapshotRepository } from './adapters/neon/knowledge-snapshot-repository';
import { LearningProgressService } from './application/learning-progress-service';
import { loadPairingConfig } from './config';
import { getSourceUploadService } from './source-uploads';
import type { ClassroomLearningSnapshot } from './domain/learning-progress';
import { readClassroom } from '@/lib/server/classroom-storage';
import { getKnowledgeGraphRefreshService } from './knowledge-graph-refresh';

export function getLearningProgressService(): LearningProgressService {
  const config = loadPairingConfig();
  const sourceUploads = getSourceUploadService();
  const graphRefresh = getKnowledgeGraphRefreshService();
  return new LearningProgressService({
    ownerId: config.ownerId,
    repository: new NeonLearningProgressRepository(),
    knowledgeSnapshots: new NeonKnowledgeSnapshotRepository(),
    knowledgeAssets: new NeonKnowledgeAssetRepository(),
    projectLearningIndexes: new NeonProjectLearningIndexRepository(),
    readClassroom: async (classroomId) =>
      (await readClassroom(classroomId)) as ClassroomLearningSnapshot | null,
    readSourceArchive: (ownerId, bundleId) =>
      sourceUploads.readValidatedArchiveForLearning(ownerId, bundleId),
    onKnowledgeChanged: (change) => graphRefresh.enqueueAndProcess(change).then(() => undefined),
  });
}
