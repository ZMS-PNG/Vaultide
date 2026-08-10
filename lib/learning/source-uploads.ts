import { NeonSourceUploadRepository } from './adapters/neon/source-upload-repository';
import { VercelPrivateBlobStore } from './adapters/vercel/private-blob-store';
import { SourceUploadService } from './application/source-upload-service';
import { getDeviceTokenService } from './device-tokens';
import { getKnowledgeGraphRefreshService } from './knowledge-graph-refresh';

export function getSourceUploadService(): SourceUploadService {
  const graphRefresh = getKnowledgeGraphRefreshService();
  return new SourceUploadService(
    new NeonSourceUploadRepository(),
    getDeviceTokenService(),
    new VercelPrivateBlobStore(),
    undefined,
    (change) => graphRefresh.enqueueAndProcess(change).then(() => undefined),
  );
}
