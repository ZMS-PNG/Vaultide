import type { JsonObject, SourceOrigin } from '@openmaic/learning-protocol';
import type { DeviceTokenPrincipal } from './device-token';
import type { IndexedProjectSourceChunk } from './project-retrieval';

export const SOURCE_ARCHIVE_CONTENT_TYPE = 'application/vnd.openmaic.source-archive+json';
export const MAX_SOURCE_BYTES = 8_000_000;
export const MAX_SOURCE_ARCHIVE_BYTES = 10_000_000;
export const MAX_SOURCE_ITEMS = 50;
export const PROJECT_UPLOAD_COVERAGES = ['partial', 'complete'] as const;

export type ProjectUploadCoverage = (typeof PROJECT_UPLOAD_COVERAGES)[number];

export interface ProjectSourceReference {
  snapshotId: string;
  sourceId: string;
}

export interface SourceUploadIntent {
  bundleId: string;
  manifestHash: string;
  sourceByteSize: number;
  itemCount: number;
  retentionUntil: Date;
  projectId?: string;
  expectedProjectRevision?: number;
  baseManifestHash?: string;
  projectCoverage?: ProjectUploadCoverage;
  projectSources?: ProjectSourceReference[];
}

export interface SourceUploadTokenPayload extends SourceUploadIntent {
  ownerId: string;
  deviceId: string;
  vaultBindingId: string;
  pathname: string;
}

export interface ValidatedProjectSourceItem {
  ordinal: number;
  snapshotId: string;
  sourceId: string;
  origin: SourceOrigin;
  identityKeyHash: string;
  title: string;
  contentHash: string;
  mimeType: string;
  byteSize: number;
  locator: JsonObject;
  metadata: JsonObject;
  sourceMtime?: Date;
}

export interface ValidatedProjectSourceBundle {
  projectId: string;
  coverage: ProjectUploadCoverage;
  expectedProjectRevision: number;
  nextProjectRevision: number;
  baseManifestHash?: string;
  bundleRevision: number;
  items: ValidatedProjectSourceItem[];
  chunks: IndexedProjectSourceChunk[];
}

export interface SourceUploadStatusRecord {
  bundleId: string;
  projectId?: string;
  projectCoverage?: ProjectUploadCoverage;
  expectedProjectRevision?: number;
  bundleRevision?: number;
  manifestHash: string;
  itemCount: number;
  sourceByteSize: number;
  archiveByteSize?: number;
  status: 'pending' | 'validated' | 'rejected' | 'deleted';
  failureCode?: string;
  retentionUntil: Date;
  createdAt: Date;
  completedAt?: Date;
  projectIndexedAt?: Date;
  indexedChunkCount?: number;
  chunkIndexStatus?: 'pending' | 'ready' | 'failed' | 'purged';
  chunkIndexFailureCode?: string;
  chunkIndexedAt?: Date;
}

export interface SourceUploadStatusView {
  bundleId: string;
  projectId?: string;
  coverage?: ProjectUploadCoverage;
  expectedProjectRevision?: number;
  projectRevision?: number;
  bundleRevision?: number;
  manifestHash: string;
  itemCount: number;
  sourceByteSize: number;
  archiveByteSize?: number;
  status: SourceUploadStatusRecord['status'];
  failureCode?: string;
  retentionUntil: string;
  createdAt: string;
  completedAt?: string;
  projectIndexedAt?: string;
  indexedChunkCount?: number;
  chunkIndexStatus?: 'pending' | 'ready' | 'failed' | 'purged';
  chunkIndexFailureCode?: string;
  chunkIndexedAt?: string;
}

export interface ProjectBundleIndexState {
  bundleId: string;
  projectId: string;
  retentionUntil: Date;
  status?: 'pending' | 'ready' | 'failed' | 'purged';
  sources: ProjectSourceReference[];
}

export interface SourceUploadStatusLookup {
  principal: DeviceTokenPrincipal;
  bundleId: string;
}
