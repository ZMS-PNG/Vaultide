import { NeonProjectRetrievalRepository } from './adapters/neon/project-retrieval-repository';
import { ProjectRetrievalService } from './application/project-retrieval-service';
import { loadPairingConfig } from './config';
import { getSourceUploadService } from './source-uploads';

export function getProjectRetrievalService(): ProjectRetrievalService {
  return new ProjectRetrievalService({
    ownerId: loadPairingConfig().ownerId,
    repository: new NeonProjectRetrievalRepository(),
    readArchive: (ownerId, bundleId) =>
      getSourceUploadService().readValidatedArchive(ownerId, bundleId),
  });
}
