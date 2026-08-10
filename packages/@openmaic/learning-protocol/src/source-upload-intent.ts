import type { LearningProtocolVersion } from './version.js';
import {
  LEARNING_PROTOCOL_VERSION,
  SOURCE_UPLOAD_INTENT_SCHEMA_VERSION,
} from './version.js';

export type ProjectUploadCoverage = 'complete' | 'partial';

export interface ProjectSourceReference {
  snapshotId: string;
  sourceId: string;
}

export interface ProjectUploadContext {
  projectId: string;
  expectedProjectRevision: number;
  baseManifestHash?: string;
  coverage: ProjectUploadCoverage;
  sources: ProjectSourceReference[];
}

/** Exact clientPayload emitted by the 0.4 plugin. */
export interface LegacySourceUploadIntent {
  bundleId: string;
  manifestHash: string;
  sourceByteSize: number;
  itemCount: number;
  retentionUntil: string;
}

/**
 * Signed Vercel Blob client payload for a project-aware SourceArchive upload.
 * SourceBundle/1 remains unchanged; this separate intent associates immutable
 * snapshots with stable project/source identities.
 */
export interface SourceUploadIntent {
  protocolVersion: LearningProtocolVersion;
  schemaVersion: typeof SOURCE_UPLOAD_INTENT_SCHEMA_VERSION;
  bundleId: string;
  manifestHash: string;
  sourceByteSize: number;
  itemCount: number;
  retentionUntil: string;
  project: ProjectUploadContext;
}

/** Descriptive alias used by server code that accepts legacy and v0.5 intents side by side. */
export type ProjectAwareSourceUploadIntent = SourceUploadIntent;

export function stampSourceUploadIntent(
  intent: Omit<SourceUploadIntent, 'protocolVersion' | 'schemaVersion'>,
): SourceUploadIntent {
  return {
    ...intent,
    protocolVersion: LEARNING_PROTOCOL_VERSION,
    schemaVersion: SOURCE_UPLOAD_INTENT_SCHEMA_VERSION,
  };
}
