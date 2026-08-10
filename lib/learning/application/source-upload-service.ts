import { createHash } from 'node:crypto';
import {
  canonicalSourceManifest,
  validateSourceArchive,
  validateSourceUploadIntent,
  type ApiErrorCode,
  type JsonObject,
  type SourceArchive,
} from '@openmaic/learning-protocol';
import type { PrivateBlobStore } from '../adapters/vercel/private-blob-store';
import type { DeviceTokenService } from './device-token-service';
import {
  MAX_SOURCE_ARCHIVE_BYTES,
  MAX_SOURCE_BYTES,
  MAX_SOURCE_ITEMS,
  PROJECT_UPLOAD_COVERAGES,
  SOURCE_ARCHIVE_CONTENT_TYPE,
  type ProjectSourceReference,
  type SourceUploadIntent,
  type SourceUploadStatusView,
  type SourceUploadTokenPayload,
  type ValidatedProjectSourceBundle,
} from '../domain/source-upload';
import type { SourceUploadRepository } from '../ports/source-upload-repository';
import { chunkMarkdownSource, deterministicProjectChunkId } from '../domain/project-retrieval';
import type { KnowledgeGraphRefreshChange } from '../domain/knowledge-graph-refresh';

const BUNDLE_ID = /^src_[a-f0-9]{32}$/;
const OWNER_ID = /^own_[a-f0-9]{32}$/;
const DEVICE_ID = /^dev_[a-f0-9]{32}$/;
const VAULT_ID = /^vlt_[a-f0-9]{32}$/;
const PROJECT_ID = /^prj_[a-f0-9]{32}$/;
const SOURCE_ID = /^sou_[a-f0-9]{32}$/;
const SNAPSHOT_ID = /^snp_[a-f0-9]{32}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const MAX_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

export class SourceUploadServiceError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    readonly status: number,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'SourceUploadServiceError';
  }
}

export class SourceUploadService {
  constructor(
    private readonly repository: SourceUploadRepository,
    private readonly tokens: DeviceTokenService,
    private readonly blobs: PrivateBlobStore,
    private readonly now: () => Date = () => new Date(),
    private readonly onKnowledgeChanged?: (
      change: KnowledgeGraphRefreshChange,
    ) => Promise<void>,
  ) {}

  async authorizeUpload(options: {
    accessToken: string;
    pathname: string;
    clientPayload: string | null;
  }): Promise<SourceUploadTokenPayload> {
    const principal = await this.tokens.authenticateAccess(options.accessToken, 'sources:write');
    const now = this.now();
    const intent = this.parseIntent(options.clientPayload, now);
    const pathname = this.pathname(principal.ownerId, principal.vaultBindingId, intent.bundleId);
    if (options.pathname !== pathname) {
      throw new SourceUploadServiceError(
        'invalid_request',
        400,
        'Blob pathname does not match the authenticated Vault.',
      );
    }
    const created = await this.repository.beginUpload(principal, intent, pathname, now);
    if (!created) {
      throw new SourceUploadServiceError(
        'conflict',
        409,
        'This SourceBundle already exists with different immutable metadata.',
      );
    }
    return { ...intent, ...principal, pathname };
  }

  async completeUpload(options: {
    blob: { url: string; pathname: string; contentType: string };
    tokenPayload: string | null | undefined;
  }): Promise<{ accepted: boolean }> {
    const payload = this.parseTokenPayload(options.tokenPayload);
    try {
      if (options.blob.pathname !== payload.pathname) {
        throw this.invalidArchive('blob_path_mismatch');
      }
      const stored = await this.blobs.read(payload.pathname);
      if (!stored) throw this.invalidArchive('blob_missing');
      if (
        stored.pathname !== payload.pathname ||
        stored.contentType !== SOURCE_ARCHIVE_CONTENT_TYPE ||
        options.blob.contentType !== SOURCE_ARCHIVE_CONTENT_TYPE ||
        stored.size > MAX_SOURCE_ARCHIVE_BYTES
      ) {
        throw this.invalidArchive('blob_metadata_invalid');
      }
      const archive = this.parseArchive(stored.text);
      this.verifyArchive(archive, payload);
      const projectSources = this.projectSources(archive, payload);
      const completed = await this.repository.completeUpload(
        payload,
        stored.url,
        stored.size,
        this.now(),
        projectSources,
      );
      if (!completed) {
        throw new SourceUploadServiceError(
          'conflict',
          409,
          'Upload completion does not match a pending SourceBundle.',
        );
      }
      if (projectSources) {
        await this.indexProjectBundle({
          ownerId: payload.ownerId,
          bundleId: payload.bundleId,
          retentionUntil: payload.retentionUntil,
          chunks: projectSources.chunks,
        });
        if (this.onKnowledgeChanged) {
          try {
            await this.onKnowledgeChanged({
              triggerKind: 'source-version',
              triggerId: payload.bundleId,
              projectId: projectSources.projectId,
            });
          } catch (error) {
            console.warn('Project source was indexed but its knowledge graph refresh was deferred.', {
              bundleId: payload.bundleId,
              projectId: projectSources.projectId,
              reason: error instanceof Error ? error.message : String(error),
            });
          }
        }
      }
      return { accepted: true };
    } catch (error) {
      if (error instanceof SourceUploadServiceError && error.code === 'learning_contract_invalid') {
        await this.repository.rejectUpload(payload, error.message, this.now());
        await this.blobs.delete(payload.pathname);
        return { accepted: false };
      }
      if (error instanceof Error && error.message === 'source_archive_too_large') {
        await this.repository.rejectUpload(payload, error.message, this.now());
        await this.blobs.delete(payload.pathname);
        return { accepted: false };
      }
      throw error;
    }
  }

  async deleteUpload(accessToken: string, bundleId: string): Promise<boolean> {
    if (!BUNDLE_ID.test(bundleId)) {
      throw new SourceUploadServiceError('invalid_request', 400, 'Invalid SourceBundle id.');
    }
    const principal = await this.tokens.authenticateAccess(accessToken, 'sources:write');
    const claimed = await this.repository.claimDeletion(principal, bundleId);
    if (!claimed) return false;
    if (claimed.blobUrl) await this.blobs.delete(claimed.blobUrl);
    return this.repository.markDeleted(principal, bundleId, this.now());
  }

  async purgeExpired(limit = 25): Promise<{ deleted: number; failed: number }> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new Error('Retention purge limit must be between 1 and 100.');
    }
    const now = this.now();
    const expired = await this.repository.listExpired(now, limit);
    let deleted = 0;
    let failed = 0;
    for (const item of expired) {
      try {
        await this.blobs.delete(item.blobUrl);
        if (await this.repository.markRetentionDeleted(item.bundleId, now)) deleted += 1;
        else failed += 1;
      } catch {
        failed += 1;
      }
    }
    return { deleted, failed };
  }

  async readValidatedArchive(ownerId: string, bundleId: string): Promise<SourceArchive | null> {
    if (!OWNER_ID.test(ownerId) || !BUNDLE_ID.test(bundleId)) {
      throw new SourceUploadServiceError('invalid_request', 400, 'Invalid SourceBundle identity.');
    }
    const payload = await this.repository.getValidatedForOwner(ownerId, bundleId, this.now());
    if (!payload) return null;
    const stored = await this.blobs.read(payload.pathname);
    if (
      !stored ||
      stored.pathname !== payload.pathname ||
      stored.contentType !== SOURCE_ARCHIVE_CONTENT_TYPE
    ) {
      throw new SourceUploadServiceError(
        'dependency_unavailable',
        503,
        'The private source snapshot is unavailable.',
        true,
      );
    }
    const archive = this.parseArchive(stored.text);
    this.verifyArchive(archive, payload);
    return archive;
  }

  async readValidatedArchiveForLearning(
    ownerId: string,
    bundleId: string,
  ): Promise<SourceArchive | null> {
    const archive = await this.readValidatedArchive(ownerId, bundleId);
    if (!archive) return null;
    await this.ensureProjectBundleIndex(ownerId, bundleId, archive);
    const state = await this.repository.getProjectBundleIndexState(
      ownerId,
      bundleId,
      this.now(),
    );
    if (!state) return archive;

    // The immutable archive is uploaded before the server registers stable
    // sou_ identities. Enrich only this verified in-memory learning view; the
    // stored archive and its manifest hash remain untouched.
    const sourceIds = new Map(
      state.sources.map((source) => [source.snapshotId, source.sourceId]),
    );
    return {
      ...archive,
      bundle: {
        ...archive.bundle,
        snapshots: archive.bundle.snapshots.map((snapshot) => {
          if (snapshot.origin !== 'obsidian' || snapshot.locator.sourceId) return snapshot;
          const sourceId = sourceIds.get(snapshot.id);
          if (!sourceId) return snapshot;
          return {
            ...snapshot,
            locator: {
              ...snapshot.locator,
              sourceId,
            },
          };
        }),
      },
    };
  }

  async uploadStatus(accessToken: string, bundleId: string): Promise<SourceUploadStatusView> {
    if (!BUNDLE_ID.test(bundleId)) {
      throw new SourceUploadServiceError('invalid_request', 400, 'Invalid SourceBundle id.');
    }
    const principal = await this.tokens.authenticateAccess(accessToken, 'sources:write');
    let status = await this.repository.getStatus(principal, bundleId);
    if (!status) {
      throw new SourceUploadServiceError('invalid_request', 404, 'Source upload was not found.');
    }
    if (status.status === 'validated' && status.projectId && status.chunkIndexStatus !== 'ready') {
      try {
        await this.readValidatedArchiveForLearning(principal.ownerId, bundleId);
        status = (await this.repository.getStatus(principal, bundleId)) ?? status;
      } catch (error) {
        console.warn('Project index retry from upload status did not complete.', {
          bundleId,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return {
      bundleId: status.bundleId,
      ...(status.projectId ? { projectId: status.projectId } : {}),
      ...(status.projectCoverage ? { coverage: status.projectCoverage } : {}),
      ...(status.status === 'validated' && status.expectedProjectRevision !== undefined
        ? { projectRevision: status.expectedProjectRevision + 1 }
        : status.expectedProjectRevision !== undefined
          ? { expectedProjectRevision: status.expectedProjectRevision }
          : {}),
      ...(status.bundleRevision !== undefined ? { bundleRevision: status.bundleRevision } : {}),
      manifestHash: status.manifestHash,
      itemCount: status.itemCount,
      sourceByteSize: status.sourceByteSize,
      ...(status.archiveByteSize !== undefined ? { archiveByteSize: status.archiveByteSize } : {}),
      status: status.status,
      ...(status.failureCode ? { failureCode: status.failureCode } : {}),
      retentionUntil: status.retentionUntil.toISOString(),
      createdAt: status.createdAt.toISOString(),
      ...(status.completedAt ? { completedAt: status.completedAt.toISOString() } : {}),
      ...(status.projectIndexedAt
        ? { projectIndexedAt: status.projectIndexedAt.toISOString() }
        : {}),
      ...(status.indexedChunkCount !== undefined
        ? { indexedChunkCount: status.indexedChunkCount }
        : {}),
      ...(status.chunkIndexStatus ? { chunkIndexStatus: status.chunkIndexStatus } : {}),
      ...(status.chunkIndexFailureCode
        ? { chunkIndexFailureCode: status.chunkIndexFailureCode }
        : {}),
      ...(status.chunkIndexedAt ? { chunkIndexedAt: status.chunkIndexedAt.toISOString() } : {}),
    };
  }

  private parseIntent(value: string | null, now: Date): SourceUploadIntent {
    let record: Record<string, unknown>;
    try {
      const parsed = JSON.parse(value ?? '');
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error();
      record = parsed as Record<string, unknown>;
    } catch {
      throw new SourceUploadServiceError('invalid_request', 400, 'Invalid upload metadata.');
    }
    const validation = validateSourceUploadIntent(record);
    if (!validation.valid) {
      throw new SourceUploadServiceError(
        'learning_contract_invalid',
        422,
        `Source upload intent is invalid: ${validation.errors[0]?.path ?? '/'}.`,
      );
    }
    return this.normalizeIntent(record, now);
  }

  private normalizeIntent(record: Record<string, unknown>, now: Date): SourceUploadIntent {
    const retentionUntil = new Date(String(record.retentionUntil));
    const nested = this.record(record.project);
    const projectIdValue = nested ? nested.projectId : record.projectId;
    const expectedProjectRevisionValue = nested
      ? nested.expectedProjectRevision
      : record.expectedProjectRevision;
    const baseManifestHashValue = nested ? nested.baseManifestHash : record.baseManifestHash;
    const coverageValue = nested ? nested.coverage : record.projectCoverage;
    const sourcesValue = nested ? nested.sources : record.projectSources;
    const projectId =
      typeof projectIdValue === 'string' && projectIdValue.length > 0 ? projectIdValue : undefined;
    const hasProjectContext =
      nested !== undefined ||
      projectIdValue !== undefined ||
      expectedProjectRevisionValue !== undefined ||
      baseManifestHashValue !== undefined ||
      coverageValue !== undefined ||
      sourcesValue !== undefined;
    if (
      !BUNDLE_ID.test(String(record.bundleId)) ||
      !SHA256.test(String(record.manifestHash)) ||
      !Number.isInteger(record.sourceByteSize) ||
      Number(record.sourceByteSize) < 0 ||
      Number(record.sourceByteSize) > MAX_SOURCE_BYTES ||
      !Number.isInteger(record.itemCount) ||
      Number(record.itemCount) < 1 ||
      Number(record.itemCount) > MAX_SOURCE_ITEMS ||
      Number.isNaN(retentionUntil.getTime()) ||
      retentionUntil <= now ||
      retentionUntil.getTime() > now.getTime() + MAX_RETENTION_MS
    ) {
      throw new SourceUploadServiceError('invalid_request', 400, 'Upload metadata is invalid.');
    }
    const base: SourceUploadIntent = {
      bundleId: String(record.bundleId),
      manifestHash: String(record.manifestHash),
      sourceByteSize: Number(record.sourceByteSize),
      itemCount: Number(record.itemCount),
      retentionUntil,
    };
    if (!hasProjectContext) return base;
    if (
      !projectId ||
      !PROJECT_ID.test(projectId) ||
      !Number.isSafeInteger(expectedProjectRevisionValue) ||
      Number(expectedProjectRevisionValue) < 0 ||
      Number(expectedProjectRevisionValue) >= Number.MAX_SAFE_INTEGER ||
      !PROJECT_UPLOAD_COVERAGES.includes(
        coverageValue as (typeof PROJECT_UPLOAD_COVERAGES)[number],
      ) ||
      (baseManifestHashValue !== undefined && !SHA256.test(String(baseManifestHashValue)))
    ) {
      throw new SourceUploadServiceError(
        'invalid_request',
        400,
        'Project upload metadata is invalid.',
      );
    }
    return {
      ...base,
      projectId,
      expectedProjectRevision: Number(expectedProjectRevisionValue),
      ...(baseManifestHashValue !== undefined
        ? { baseManifestHash: String(baseManifestHashValue) }
        : {}),
      projectCoverage: coverageValue as (typeof PROJECT_UPLOAD_COVERAGES)[number],
      projectSources: this.projectReferences(sourcesValue, base.itemCount),
    };
  }

  private parseTokenPayload(value: string | null | undefined): SourceUploadTokenPayload {
    let record: Record<string, unknown>;
    try {
      const parsed = JSON.parse(value ?? '');
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error();
      record = parsed as Record<string, unknown>;
    } catch {
      throw new SourceUploadServiceError('invalid_request', 400, 'Invalid signed upload payload.');
    }
    const intent = this.normalizeIntent(record, this.now());
    if (
      !OWNER_ID.test(String(record.ownerId)) ||
      !DEVICE_ID.test(String(record.deviceId)) ||
      !VAULT_ID.test(String(record.vaultBindingId)) ||
      typeof record.pathname !== 'string'
    ) {
      throw new SourceUploadServiceError('invalid_request', 400, 'Invalid signed upload identity.');
    }
    const expectedPath = this.pathname(
      String(record.ownerId),
      String(record.vaultBindingId),
      intent.bundleId,
    );
    if (record.pathname !== expectedPath) {
      throw new SourceUploadServiceError('invalid_request', 400, 'Invalid signed upload pathname.');
    }
    return {
      ...intent,
      ownerId: String(record.ownerId),
      deviceId: String(record.deviceId),
      vaultBindingId: String(record.vaultBindingId),
      pathname: expectedPath,
    };
  }

  private parseArchive(text: string): SourceArchive {
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      throw this.invalidArchive('archive_json_invalid');
    }
    const result = validateSourceArchive(value);
    if (!result.valid) throw this.invalidArchive(`archive_schema:${result.errors[0]?.code}`);
    return value as SourceArchive;
  }

  private verifyArchive(archive: SourceArchive, payload: SourceUploadTokenPayload): void {
    const bundle = archive.bundle;
    if (
      bundle.id !== payload.bundleId ||
      bundle.ownerId !== payload.ownerId ||
      bundle.manifestHash !== payload.manifestHash ||
      bundle.byteSize !== payload.sourceByteSize ||
      bundle.itemCount !== payload.itemCount ||
      bundle.retentionUntil !== payload.retentionUntil.toISOString() ||
      bundle.snapshots.some(
        (snapshot) =>
          snapshot.origin !== 'obsidian' ||
          snapshot.locator.vaultBindingId !== payload.vaultBindingId,
      )
    ) {
      throw this.invalidArchive('archive_identity_mismatch');
    }
    if (this.sha256(canonicalSourceManifest(bundle)) !== bundle.manifestHash) {
      throw this.invalidArchive('manifest_hash_mismatch');
    }
    const snapshots = new Map(bundle.snapshots.map((snapshot) => [snapshot.id, snapshot]));
    for (const content of archive.contents) {
      const snapshot = snapshots.get(content.snapshotId);
      if (!snapshot || this.sha256(content.utf8Content) !== snapshot.contentHash) {
        throw this.invalidArchive('content_hash_mismatch');
      }
    }
  }

  private projectSources(
    archive: SourceArchive,
    payload: SourceUploadTokenPayload,
  ): ValidatedProjectSourceBundle | undefined {
    if (!payload.projectId) return undefined;
    if (
      !payload.projectCoverage ||
      payload.expectedProjectRevision === undefined ||
      !payload.projectSources
    ) {
      throw this.invalidArchive('project_upload_context_missing');
    }
    if (!Number.isSafeInteger(archive.bundle.revision)) {
      throw this.invalidArchive('bundle_revision_invalid');
    }
    const sourceReferences = new Map(
      payload.projectSources.map((reference) => [reference.snapshotId, reference.sourceId]),
    );
    if (
      sourceReferences.size !== payload.projectSources.length ||
      sourceReferences.size !== archive.bundle.snapshots.length
    ) {
      throw this.invalidArchive('project_source_reference_mismatch');
    }
    const identities = new Set<string>();
    const contents = new Map(
      archive.contents.map((content) => [content.snapshotId, content.utf8Content]),
    );
    const items = archive.bundle.snapshots.map((snapshot, index) => {
      if (snapshot.origin !== 'obsidian') {
        throw this.invalidArchive('project_source_origin_invalid');
      }
      const sourceId = sourceReferences.get(snapshot.id);
      if (!sourceId) {
        throw this.invalidArchive('project_source_reference_missing');
      }
      const path = snapshot.locator.relativePath
        .normalize('NFC')
        .replaceAll('\\', '/')
        .replace(/\/+/g, '/')
        .replace(/^\/+/, '');
      const stableLocator = snapshot.locator.noteId
        ? { noteId: snapshot.locator.noteId }
        : { relativePath: path };
      const identityKeyHash = this.sha256(
        JSON.stringify({
          origin: snapshot.origin,
          vaultBindingId: payload.vaultBindingId,
          ...stableLocator,
        }),
      );
      if (identities.has(identityKeyHash)) {
        throw this.invalidArchive('project_source_identity_duplicate');
      }
      identities.add(identityKeyHash);
      const metadata = this.jsonObject({
        ...(snapshot.headings ? { headings: snapshot.headings } : {}),
        ...(snapshot.tags ? { tags: snapshot.tags } : {}),
        ...(snapshot.outboundLinks ? { outboundLinks: snapshot.outboundLinks } : {}),
        ...(snapshot.citationAnchors ? { citationAnchors: snapshot.citationAnchors } : {}),
      });
      const sourceMtime = snapshot.locator.sourceMtime
        ? new Date(snapshot.locator.sourceMtime)
        : undefined;
      return {
        ordinal: index + 1,
        snapshotId: snapshot.id,
        sourceId,
        origin: snapshot.origin,
        identityKeyHash,
        title: snapshot.title.trim().slice(0, 500) || path.split('/').at(-1) || 'Untitled source',
        contentHash: snapshot.contentHash,
        mimeType: snapshot.mimeType.slice(0, 255),
        byteSize: snapshot.byteSize,
        locator: this.jsonObject(snapshot.locator),
        metadata,
        ...(sourceMtime && !Number.isNaN(sourceMtime.getTime()) ? { sourceMtime } : {}),
      };
    });
    const chunks = items.flatMap((item) => {
      const content = contents.get(item.snapshotId);
      if (content === undefined) {
        throw this.invalidArchive('project_source_content_missing');
      }
      const relativePath =
        typeof item.locator.relativePath === 'string' ? item.locator.relativePath : item.title;
      return chunkMarkdownSource({
        content,
        title: item.title,
        relativePath,
      }).map((chunk) => ({
        ...chunk,
        chunkId: deterministicProjectChunkId({
          sourceId: item.sourceId,
          sourceContentHash: item.contentHash,
          ordinal: chunk.ordinal,
          chunkContentHash: chunk.contentHash,
        }),
        sourceId: item.sourceId,
        snapshotId: item.snapshotId,
      }));
    });
    return {
      projectId: payload.projectId,
      coverage: payload.projectCoverage,
      expectedProjectRevision: payload.expectedProjectRevision,
      nextProjectRevision: payload.expectedProjectRevision + 1,
      ...(payload.baseManifestHash ? { baseManifestHash: payload.baseManifestHash } : {}),
      bundleRevision: archive.bundle.revision,
      items,
      chunks,
    };
  }

  private async ensureProjectBundleIndex(
    ownerId: string,
    bundleId: string,
    archive: SourceArchive,
  ): Promise<void> {
    const state = await this.repository.getProjectBundleIndexState(ownerId, bundleId, this.now());
    if (!state || state.status === 'ready') return;
    const sourceIds = new Map(state.sources.map((source) => [source.snapshotId, source.sourceId]));
    const contents = new Map(
      archive.contents.map((content) => [content.snapshotId, content.utf8Content]),
    );
    const chunks = archive.bundle.snapshots.flatMap((snapshot) => {
      if (snapshot.origin !== 'obsidian') return [];
      const sourceId = sourceIds.get(snapshot.id);
      const content = contents.get(snapshot.id);
      if (!sourceId || content === undefined) return [];
      return chunkMarkdownSource({
        content,
        title: snapshot.title,
        relativePath: snapshot.locator.relativePath,
      }).map((chunk) => ({
        ...chunk,
        chunkId: deterministicProjectChunkId({
          sourceId,
          sourceContentHash: snapshot.contentHash,
          ordinal: chunk.ordinal,
          chunkContentHash: chunk.contentHash,
        }),
        sourceId,
        snapshotId: snapshot.id,
      }));
    });
    if (chunks.length < archive.bundle.itemCount) {
      await this.repository.markProjectChunkIndexFailed(
        ownerId,
        bundleId,
        'chunk_index_source_mapping_incomplete',
        this.now(),
      );
      return;
    }
    await this.indexProjectBundle({
      ownerId,
      bundleId,
      retentionUntil: state.retentionUntil,
      chunks,
    });
  }

  private async indexProjectBundle(options: {
    ownerId: string;
    bundleId: string;
    retentionUntil: Date;
    chunks: ValidatedProjectSourceBundle['chunks'];
  }): Promise<void> {
    try {
      const indexed = await this.repository.indexProjectChunks(
        options.ownerId,
        options.bundleId,
        options.retentionUntil,
        options.chunks,
        this.now(),
      );
      if (indexed) return;
      await this.repository.markProjectChunkIndexFailed(
        options.ownerId,
        options.bundleId,
        'chunk_index_contract_mismatch',
        this.now(),
      );
    } catch (error) {
      try {
        await this.repository.markProjectChunkIndexFailed(
          options.ownerId,
          options.bundleId,
          'chunk_index_dependency_failure',
          this.now(),
        );
      } catch {
        // Upload validation remains authoritative even when the optional
        // retriever index and its failure marker are temporarily unavailable.
      }
      console.error('Project source chunk indexing did not complete.', {
        bundleId: options.bundleId,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private projectReferences(value: unknown, itemCount: number): ProjectSourceReference[] {
    if (!Array.isArray(value) || value.length !== itemCount) {
      throw new SourceUploadServiceError(
        'invalid_request',
        400,
        'Project source references do not match the upload.',
      );
    }
    const snapshotIds = new Set<string>();
    const sourceIds = new Set<string>();
    const references = value.map((item) => {
      const source = this.record(item);
      const snapshotId = String(source?.snapshotId ?? '');
      const sourceId = String(source?.sourceId ?? '');
      if (
        !source ||
        Object.keys(source).some((key) => key !== 'snapshotId' && key !== 'sourceId') ||
        !SNAPSHOT_ID.test(snapshotId) ||
        !SOURCE_ID.test(sourceId) ||
        snapshotIds.has(snapshotId) ||
        sourceIds.has(sourceId)
      ) {
        throw new SourceUploadServiceError(
          'invalid_request',
          400,
          'Project source reference is invalid.',
        );
      }
      snapshotIds.add(snapshotId);
      sourceIds.add(sourceId);
      return { snapshotId, sourceId };
    });
    return references;
  }

  private record(value: unknown): Record<string, unknown> | undefined {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  }

  private jsonObject(value: unknown): JsonObject {
    return JSON.parse(JSON.stringify(value)) as JsonObject;
  }

  private pathname(ownerId: string, vaultBindingId: string, bundleId: string): string {
    return `learning-sources/${ownerId}/${vaultBindingId}/${bundleId}.json`;
  }

  private sha256(value: string): string {
    return createHash('sha256').update(value, 'utf8').digest('hex');
  }

  private invalidArchive(reason: string): SourceUploadServiceError {
    return new SourceUploadServiceError('learning_contract_invalid', 422, reason);
  }
}
