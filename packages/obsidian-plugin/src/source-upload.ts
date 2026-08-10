import { upload } from '@vercel/blob/client';
import {
  LEARNING_PROTOCOL_VERSION,
  stampSourceUploadIntent,
  validateSourceUploadIntent,
  type ProjectSourceReference,
  type ProjectUploadCoverage,
  type SourceArchive,
  type SourceUploadIntent,
} from '@openmaic/learning-protocol';
import { normalizeServerUrl } from './server-url';

const SOURCE_ARCHIVE_CONTENT_TYPE = 'application/vnd.openmaic.source-archive+json';

export function buildProjectSourceUploadIntent(options: {
  archive: SourceArchive;
  projectId: string;
  expectedProjectRevision: number;
  baseManifestHash?: string;
  coverage: ProjectUploadCoverage;
  sources: ProjectSourceReference[];
}): SourceUploadIntent {
  const { bundle } = options.archive;
  const intent = stampSourceUploadIntent({
    bundleId: bundle.id,
    manifestHash: bundle.manifestHash,
    sourceByteSize: bundle.byteSize,
    itemCount: bundle.itemCount,
    retentionUntil: bundle.retentionUntil,
    project: {
      projectId: options.projectId,
      expectedProjectRevision: options.expectedProjectRevision,
      baseManifestHash: options.baseManifestHash,
      coverage: options.coverage,
      sources: options.sources,
    },
  });
  const validation = validateSourceUploadIntent(intent);
  if (!validation.valid) {
    throw new Error(
      `Project upload intent is invalid (${validation.errors[0]?.path ?? '/'}).`,
    );
  }
  const bundleSnapshotIds = new Set(bundle.snapshots.map((snapshot) => snapshot.id));
  if (
    intent.project.sources.some((source) => !bundleSnapshotIds.has(source.snapshotId)) ||
    bundleSnapshotIds.size !== intent.project.sources.length
  ) {
    throw new Error('Project upload intent does not map every SourceBundle snapshot.');
  }
  return intent;
}

export async function uploadSourceArchive(options: {
  serverUrl: string;
  accessToken: string;
  archive: SourceArchive;
  uploadIntent?: SourceUploadIntent;
}): Promise<{ url: string; pathname: string }> {
  const serverUrl = normalizeServerUrl(options.serverUrl);
  const { bundle } = options.archive;
  const first = bundle.snapshots[0];
  if (!first || first.origin !== 'obsidian') {
    throw new Error('An Obsidian SourceArchive requires at least one Obsidian snapshot.');
  }
  const vaultBindingId = first.locator.vaultBindingId;
  if (
    bundle.snapshots.some(
      (snapshot) =>
        snapshot.origin !== 'obsidian' || snapshot.locator.vaultBindingId !== vaultBindingId,
    )
  ) {
    throw new Error('Every source in one upload must belong to the paired Vault.');
  }
  if (options.uploadIntent) {
    const validation = validateSourceUploadIntent(options.uploadIntent);
    if (!validation.valid) {
      throw new Error(`Source upload intent failed validation at ${validation.errors[0]?.path ?? '/'}.`);
    }
    if (
      options.uploadIntent.bundleId !== bundle.id ||
      options.uploadIntent.manifestHash !== bundle.manifestHash ||
      options.uploadIntent.sourceByteSize !== bundle.byteSize ||
      options.uploadIntent.itemCount !== bundle.itemCount ||
      options.uploadIntent.retentionUntil !== bundle.retentionUntil
    ) {
      throw new Error('Source upload intent does not match its SourceArchive.');
    }
    const snapshotIds = new Set(bundle.snapshots.map((snapshot) => snapshot.id));
    const referenceIds = new Set(
      options.uploadIntent.project.sources.map((source) => source.snapshotId),
    );
    if (
      snapshotIds.size !== referenceIds.size ||
      [...snapshotIds].some((snapshotId) => !referenceIds.has(snapshotId))
    ) {
      throw new Error('Source upload intent does not map every SourceBundle snapshot.');
    }
  }
  const pathname = `learning-sources/${bundle.ownerId}/${vaultBindingId}/${bundle.id}.json`;
  const blob = await upload(pathname, JSON.stringify(options.archive), {
    access: 'private',
    handleUploadUrl: `${serverUrl}/api/v1/source-uploads`,
    headers: {
      Authorization: `Bearer ${options.accessToken}`,
      'X-MAIC-Protocol-Version': LEARNING_PROTOCOL_VERSION,
    },
    clientPayload: JSON.stringify(
      options.uploadIntent ?? {
        bundleId: bundle.id,
        manifestHash: bundle.manifestHash,
        sourceByteSize: bundle.byteSize,
        itemCount: bundle.itemCount,
        retentionUntil: bundle.retentionUntil,
      },
    ),
    contentType: SOURCE_ARCHIVE_CONTENT_TYPE,
    multipart: false,
  });
  return { url: blob.url, pathname: blob.pathname };
}
