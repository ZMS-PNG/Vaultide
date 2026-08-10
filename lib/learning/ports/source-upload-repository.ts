import type { DeviceTokenPrincipal } from '../domain/device-token';
import type {
  SourceUploadIntent,
  SourceUploadStatusRecord,
  SourceUploadTokenPayload,
  ValidatedProjectSourceBundle,
  ProjectBundleIndexState,
} from '../domain/source-upload';
import type { IndexedProjectSourceChunk } from '../domain/project-retrieval';

export interface SourceUploadRepository {
  beginUpload(
    principal: DeviceTokenPrincipal,
    intent: SourceUploadIntent,
    pathname: string,
    now: Date,
  ): Promise<boolean>;
  completeUpload(
    payload: SourceUploadTokenPayload,
    blobUrl: string,
    archiveByteSize: number,
    now: Date,
    projectSources?: ValidatedProjectSourceBundle,
  ): Promise<boolean>;
  rejectUpload(payload: SourceUploadTokenPayload, failureCode: string, now: Date): Promise<void>;
  claimDeletion(
    principal: DeviceTokenPrincipal,
    bundleId: string,
  ): Promise<{ blobUrl: string | null } | null>;
  markDeleted(principal: DeviceTokenPrincipal, bundleId: string, now: Date): Promise<boolean>;
  listExpired(now: Date, limit: number): Promise<Array<{ bundleId: string; blobUrl: string }>>;
  markRetentionDeleted(bundleId: string, now: Date): Promise<boolean>;
  getValidatedForOwner(
    ownerId: string,
    bundleId: string,
    now: Date,
  ): Promise<SourceUploadTokenPayload | null>;
  getStatus(
    principal: DeviceTokenPrincipal,
    bundleId: string,
  ): Promise<SourceUploadStatusRecord | null>;
  getProjectBundleIndexState(
    ownerId: string,
    bundleId: string,
    now: Date,
  ): Promise<ProjectBundleIndexState | null>;
  indexProjectChunks(
    ownerId: string,
    bundleId: string,
    retentionUntil: Date,
    chunks: readonly IndexedProjectSourceChunk[],
    now: Date,
  ): Promise<boolean>;
  markProjectChunkIndexFailed(
    ownerId: string,
    bundleId: string,
    failureCode: string,
    now: Date,
  ): Promise<void>;
}
