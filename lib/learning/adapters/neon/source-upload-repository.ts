import type { DeviceTokenPrincipal } from '../../domain/device-token';
import type {
  ProjectBundleIndexState,
  SourceUploadIntent,
  SourceUploadStatusRecord,
  SourceUploadTokenPayload,
  ValidatedProjectSourceBundle,
} from '../../domain/source-upload';
import {
  PROJECT_SOURCE_INDEX_VERSION,
  type IndexedProjectSourceChunk,
} from '../../domain/project-retrieval';
import type { SourceUploadRepository } from '../../ports/source-upload-repository';
import { getLearningSql } from './client';

export class NeonSourceUploadRepository implements SourceUploadRepository {
  async beginUpload(
    principal: DeviceTokenPrincipal,
    intent: SourceUploadIntent,
    pathname: string,
    now: Date,
  ): Promise<boolean> {
    if (intent.projectId) {
      return this.beginProjectUpload(principal, intent, pathname, now);
    }
    const rows = (await getLearningSql().query(
      `
        INSERT INTO source_uploads
          (id, owner_id, device_id, vault_binding_id, manifest_hash, blob_pathname,
           source_byte_size, item_count, retention_until, status, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending', $10)
        ON CONFLICT (id) DO UPDATE
        SET status = 'pending', failure_code = NULL, created_at = EXCLUDED.created_at,
            completed_at = NULL, deleted_at = NULL, blob_url = NULL, archive_byte_size = NULL
        WHERE source_uploads.owner_id = EXCLUDED.owner_id
          AND source_uploads.device_id = EXCLUDED.device_id
          AND source_uploads.vault_binding_id = EXCLUDED.vault_binding_id
          AND source_uploads.manifest_hash = EXCLUDED.manifest_hash
          AND source_uploads.blob_pathname = EXCLUDED.blob_pathname
          AND source_uploads.source_byte_size = EXCLUDED.source_byte_size
          AND source_uploads.item_count = EXCLUDED.item_count
          AND source_uploads.retention_until = EXCLUDED.retention_until
          AND source_uploads.project_id IS NULL
          AND source_uploads.project_coverage IS NULL
          AND source_uploads.expected_project_revision IS NULL
          AND source_uploads.base_manifest_hash IS NULL
          AND source_uploads.status IN ('pending', 'rejected')
        RETURNING id
      `,
      [
        intent.bundleId,
        principal.ownerId,
        principal.deviceId,
        principal.vaultBindingId,
        intent.manifestHash,
        pathname,
        intent.sourceByteSize,
        intent.itemCount,
        intent.retentionUntil,
        now,
      ],
    )) as Array<{ id: string }>;
    return Boolean(rows[0]);
  }

  async completeUpload(
    payload: SourceUploadTokenPayload,
    blobUrl: string,
    archiveByteSize: number,
    now: Date,
    projectSources?: ValidatedProjectSourceBundle,
  ): Promise<boolean> {
    if (projectSources) {
      return this.completeProjectUpload(payload, blobUrl, archiveByteSize, now, projectSources);
    }
    const rows = (await getLearningSql().query(
      `
        WITH completed AS (
          UPDATE source_uploads
          SET blob_url = $9, archive_byte_size = $10, status = 'validated',
              failure_code = NULL, completed_at = $11
          WHERE id = $1 AND owner_id = $2 AND device_id = $3 AND vault_binding_id = $4
            AND manifest_hash = $5 AND blob_pathname = $6
            AND source_byte_size = $7 AND item_count = $8
            AND retention_until = $12
            AND project_id IS NULL
            AND status IN ('pending', 'validated')
          RETURNING owner_id, device_id
        ), audited AS (
          INSERT INTO learning_audit_events
            (id, owner_id, device_id, event_type, metadata, created_at)
          SELECT 'aud_' || replace(gen_random_uuid()::text, '-', ''), owner_id, device_id,
                 'source.upload_validated', jsonb_build_object('bundleId', $1::text), $11
          FROM completed
          RETURNING owner_id
        )
        SELECT owner_id FROM audited
      `,
      [
        payload.bundleId,
        payload.ownerId,
        payload.deviceId,
        payload.vaultBindingId,
        payload.manifestHash,
        payload.pathname,
        payload.sourceByteSize,
        payload.itemCount,
        blobUrl,
        archiveByteSize,
        now,
        payload.retentionUntil,
      ],
    )) as Array<{ owner_id: string }>;
    return Boolean(rows[0]);
  }

  async rejectUpload(
    payload: SourceUploadTokenPayload,
    failureCode: string,
    now: Date,
  ): Promise<void> {
    await getLearningSql().query(
      `
        UPDATE source_uploads
        SET status = 'rejected', failure_code = $7, completed_at = $8
        WHERE id = $1 AND owner_id = $2 AND device_id = $3 AND vault_binding_id = $4
          AND manifest_hash = $5 AND blob_pathname = $6 AND status = 'pending'
      `,
      [
        payload.bundleId,
        payload.ownerId,
        payload.deviceId,
        payload.vaultBindingId,
        payload.manifestHash,
        payload.pathname,
        failureCode,
        now,
      ],
    );
  }

  async claimDeletion(
    principal: DeviceTokenPrincipal,
    bundleId: string,
  ): Promise<{ blobUrl: string | null } | null> {
    const rows = (await getLearningSql().query(
      `
        SELECT blob_url
        FROM source_uploads
        WHERE id = $1 AND owner_id = $2 AND device_id = $3 AND vault_binding_id = $4
          AND status IN ('pending', 'validated', 'rejected')
      `,
      [bundleId, principal.ownerId, principal.deviceId, principal.vaultBindingId],
    )) as Array<{ blob_url: string | null }>;
    return rows[0] ? { blobUrl: rows[0].blob_url } : null;
  }

  async markDeleted(
    principal: DeviceTokenPrincipal,
    bundleId: string,
    now: Date,
  ): Promise<boolean> {
    const rows = (await getLearningSql().query(
      `
        WITH deleted AS (
          UPDATE source_uploads
          SET status = 'deleted', deleted_at = $5, blob_url = NULL,
              chunk_index_status = CASE
                WHEN project_id IS NOT NULL THEN 'purged'
                ELSE chunk_index_status
              END,
              chunk_index_failure_code = NULL
          WHERE id = $1 AND owner_id = $2 AND device_id = $3 AND vault_binding_id = $4
            AND status <> 'deleted'
          RETURNING owner_id, device_id
        ), affected_versions AS MATERIALIZED (
          SELECT DISTINCT bundle_item.owner_id, bundle_item.source_id,
                          bundle_item.source_version_id
          FROM deleted
          JOIN source_bundle_items bundle_item
            ON bundle_item.owner_id = deleted.owner_id
           AND bundle_item.source_bundle_id = $1
        ), redacted_chunks AS (
          UPDATE learning_source_chunks chunk
          SET anchor_tokens = '', body_tokens = '', token_count = 0,
              redacted_at = $5, updated_at = $5
          FROM affected_versions affected
          WHERE chunk.owner_id = affected.owner_id
            AND chunk.source_id = affected.source_id
            AND chunk.source_version_id = affected.source_version_id
            AND chunk.redacted_at IS NULL
            AND NOT EXISTS (
              SELECT 1
              FROM source_bundle_items other_item
              JOIN source_uploads other_upload
                ON other_upload.owner_id = other_item.owner_id
               AND other_upload.id = other_item.source_bundle_id
               AND other_upload.status = 'validated'
               AND other_upload.retention_until > $5
              WHERE other_item.owner_id = affected.owner_id
                AND other_item.source_id = affected.source_id
                AND other_item.source_version_id = affected.source_version_id
            )
          RETURNING chunk.id
        ), purged_indexes AS (
          UPDATE learning_source_indexes source_index
          SET status = 'purged', failure_code = NULL, updated_at = $5
          FROM affected_versions affected
          WHERE source_index.owner_id = affected.owner_id
            AND source_index.source_id = affected.source_id
            AND source_index.source_version_id = affected.source_version_id
            AND NOT EXISTS (
              SELECT 1
              FROM source_bundle_items other_item
              JOIN source_uploads other_upload
                ON other_upload.owner_id = other_item.owner_id
               AND other_upload.id = other_item.source_bundle_id
               AND other_upload.status = 'validated'
               AND other_upload.retention_until > $5
              WHERE other_item.owner_id = affected.owner_id
                AND other_item.source_id = affected.source_id
                AND other_item.source_version_id = affected.source_version_id
            )
          RETURNING source_index.source_version_id
        ), audited AS (
          INSERT INTO learning_audit_events
            (id, owner_id, device_id, event_type, metadata, created_at)
          SELECT 'aud_' || replace(gen_random_uuid()::text, '-', ''), owner_id, device_id,
                 'source.deleted', jsonb_build_object('bundleId', $1::text), $5
          FROM deleted
          RETURNING owner_id
        )
        SELECT owner_id FROM audited
      `,
      [bundleId, principal.ownerId, principal.deviceId, principal.vaultBindingId, now],
    )) as Array<{ owner_id: string }>;
    return Boolean(rows[0]);
  }

  async listExpired(
    now: Date,
    limit: number,
  ): Promise<Array<{ bundleId: string; blobUrl: string }>> {
    const rows = (await getLearningSql().query(
      `
        SELECT id, blob_url
        FROM source_uploads
        WHERE status = 'validated' AND retention_until <= $1 AND blob_url IS NOT NULL
        ORDER BY retention_until ASC
        LIMIT $2
      `,
      [now, limit],
    )) as Array<{ id: string; blob_url: string }>;
    return rows.map((row) => ({ bundleId: row.id, blobUrl: row.blob_url }));
  }

  async markRetentionDeleted(bundleId: string, now: Date): Promise<boolean> {
    const rows = (await getLearningSql().query(
      `
        WITH deleted AS (
          UPDATE source_uploads
          SET status = 'deleted', deleted_at = $2, blob_url = NULL,
              chunk_index_status = CASE
                WHEN project_id IS NOT NULL THEN 'purged'
                ELSE chunk_index_status
              END,
              chunk_index_failure_code = NULL
          WHERE id = $1 AND status = 'validated' AND retention_until <= $2
          RETURNING owner_id, device_id
        ), affected_versions AS MATERIALIZED (
          SELECT DISTINCT bundle_item.owner_id, bundle_item.source_id,
                          bundle_item.source_version_id
          FROM deleted
          JOIN source_bundle_items bundle_item
            ON bundle_item.owner_id = deleted.owner_id
           AND bundle_item.source_bundle_id = $1
        ), redacted_chunks AS (
          UPDATE learning_source_chunks chunk
          SET anchor_tokens = '', body_tokens = '', token_count = 0,
              redacted_at = $2, updated_at = $2
          FROM affected_versions affected
          WHERE chunk.owner_id = affected.owner_id
            AND chunk.source_id = affected.source_id
            AND chunk.source_version_id = affected.source_version_id
            AND chunk.redacted_at IS NULL
            AND NOT EXISTS (
              SELECT 1
              FROM source_bundle_items other_item
              JOIN source_uploads other_upload
                ON other_upload.owner_id = other_item.owner_id
               AND other_upload.id = other_item.source_bundle_id
               AND other_upload.status = 'validated'
               AND other_upload.retention_until > $2
              WHERE other_item.owner_id = affected.owner_id
                AND other_item.source_id = affected.source_id
                AND other_item.source_version_id = affected.source_version_id
            )
          RETURNING chunk.id
        ), purged_indexes AS (
          UPDATE learning_source_indexes source_index
          SET status = 'purged', failure_code = NULL, updated_at = $2
          FROM affected_versions affected
          WHERE source_index.owner_id = affected.owner_id
            AND source_index.source_id = affected.source_id
            AND source_index.source_version_id = affected.source_version_id
            AND NOT EXISTS (
              SELECT 1
              FROM source_bundle_items other_item
              JOIN source_uploads other_upload
                ON other_upload.owner_id = other_item.owner_id
               AND other_upload.id = other_item.source_bundle_id
               AND other_upload.status = 'validated'
               AND other_upload.retention_until > $2
              WHERE other_item.owner_id = affected.owner_id
                AND other_item.source_id = affected.source_id
                AND other_item.source_version_id = affected.source_version_id
            )
          RETURNING source_index.source_version_id
        ), audited AS (
          INSERT INTO learning_audit_events
            (id, owner_id, device_id, event_type, metadata, created_at)
          SELECT 'aud_' || replace(gen_random_uuid()::text, '-', ''), owner_id, device_id,
                 'source.retention_deleted', jsonb_build_object('bundleId', $1::text), $2
          FROM deleted
          RETURNING owner_id
        )
        SELECT owner_id FROM audited
      `,
      [bundleId, now],
    )) as Array<{ owner_id: string }>;
    return Boolean(rows[0]);
  }

  async getValidatedForOwner(
    ownerId: string,
    bundleId: string,
    now: Date,
  ): Promise<SourceUploadTokenPayload | null> {
    const rows = (await getLearningSql().query(
      `
        SELECT id, owner_id, device_id, vault_binding_id, manifest_hash, blob_pathname,
               source_byte_size, item_count, retention_until
        FROM source_uploads
        WHERE id = $1 AND owner_id = $2 AND status = 'validated' AND retention_until > $3
      `,
      [bundleId, ownerId, now],
    )) as Array<{
      id: string;
      owner_id: string;
      device_id: string;
      vault_binding_id: string;
      manifest_hash: string;
      blob_pathname: string;
      source_byte_size: number;
      item_count: number;
      retention_until: string;
    }>;
    const row = rows[0];
    return row
      ? {
          bundleId: row.id,
          ownerId: row.owner_id,
          deviceId: row.device_id,
          vaultBindingId: row.vault_binding_id,
          manifestHash: row.manifest_hash,
          pathname: row.blob_pathname,
          sourceByteSize: row.source_byte_size,
          itemCount: row.item_count,
          retentionUntil: new Date(row.retention_until),
        }
      : null;
  }

  async getStatus(
    principal: DeviceTokenPrincipal,
    bundleId: string,
  ): Promise<SourceUploadStatusRecord | null> {
    const rows = (await getLearningSql().query(
      `
        SELECT id, project_id, project_coverage, expected_project_revision,
               bundle_revision, manifest_hash, item_count, source_byte_size,
               archive_byte_size, status, failure_code, retention_until, created_at,
               completed_at, project_indexed_at, indexed_chunk_count,
               chunk_index_status, chunk_index_failure_code, chunk_indexed_at
        FROM source_uploads
        WHERE id = $1 AND owner_id = $2 AND device_id = $3 AND vault_binding_id = $4
      `,
      [bundleId, principal.ownerId, principal.deviceId, principal.vaultBindingId],
    )) as Array<Record<string, unknown>>;
    const row = rows[0];
    return row
      ? {
          bundleId: String(row.id),
          ...(typeof row.project_id === 'string' ? { projectId: row.project_id } : {}),
          ...(row.project_coverage === 'partial' || row.project_coverage === 'complete'
            ? { projectCoverage: row.project_coverage }
            : {}),
          ...(row.expected_project_revision !== null && row.expected_project_revision !== undefined
            ? { expectedProjectRevision: Number(row.expected_project_revision) }
            : {}),
          ...(row.bundle_revision !== null && row.bundle_revision !== undefined
            ? { bundleRevision: Number(row.bundle_revision) }
            : {}),
          manifestHash: String(row.manifest_hash),
          itemCount: Number(row.item_count),
          sourceByteSize: Number(row.source_byte_size),
          ...(row.archive_byte_size !== null && row.archive_byte_size !== undefined
            ? { archiveByteSize: Number(row.archive_byte_size) }
            : {}),
          status: row.status as SourceUploadStatusRecord['status'],
          ...(typeof row.failure_code === 'string' ? { failureCode: row.failure_code } : {}),
          retentionUntil: new Date(String(row.retention_until)),
          createdAt: new Date(String(row.created_at)),
          ...(row.completed_at ? { completedAt: new Date(String(row.completed_at)) } : {}),
          ...(row.project_indexed_at
            ? { projectIndexedAt: new Date(String(row.project_indexed_at)) }
            : {}),
          ...(row.indexed_chunk_count !== null && row.indexed_chunk_count !== undefined
            ? { indexedChunkCount: Number(row.indexed_chunk_count) }
            : {}),
          ...(row.chunk_index_status === 'pending' ||
          row.chunk_index_status === 'ready' ||
          row.chunk_index_status === 'failed' ||
          row.chunk_index_status === 'purged'
            ? { chunkIndexStatus: row.chunk_index_status }
            : {}),
          ...(typeof row.chunk_index_failure_code === 'string'
            ? { chunkIndexFailureCode: row.chunk_index_failure_code }
            : {}),
          ...(row.chunk_indexed_at
            ? { chunkIndexedAt: new Date(String(row.chunk_indexed_at)) }
            : {}),
        }
      : null;
  }

  async getProjectBundleIndexState(
    ownerId: string,
    bundleId: string,
    now: Date,
  ): Promise<ProjectBundleIndexState | null> {
    const rows = (await getLearningSql().query(
      `
        SELECT upload.id, upload.project_id, upload.retention_until,
               upload.chunk_index_status, item.snapshot_id, item.source_id
        FROM source_uploads upload
        JOIN source_bundle_items item
          ON item.owner_id = upload.owner_id AND item.source_bundle_id = upload.id
        WHERE upload.owner_id = $1 AND upload.id = $2
          AND upload.status = 'validated' AND upload.retention_until > $3
          AND upload.project_id IS NOT NULL
        ORDER BY item.ordinal ASC
      `,
      [ownerId, bundleId, now],
    )) as Array<Record<string, unknown>>;
    const first = rows[0];
    if (!first || typeof first.project_id !== 'string') return null;
    const status =
      first.chunk_index_status === 'pending' ||
      first.chunk_index_status === 'ready' ||
      first.chunk_index_status === 'failed' ||
      first.chunk_index_status === 'purged'
        ? first.chunk_index_status
        : undefined;
    return {
      bundleId: String(first.id),
      projectId: first.project_id,
      retentionUntil: new Date(String(first.retention_until)),
      ...(status ? { status } : {}),
      sources: rows.map((row) => ({
        snapshotId: String(row.snapshot_id),
        sourceId: String(row.source_id),
      })),
    };
  }

  async indexProjectChunks(
    ownerId: string,
    bundleId: string,
    retentionUntil: Date,
    chunks: readonly IndexedProjectSourceChunk[],
    now: Date,
  ): Promise<boolean> {
    if (chunks.length === 0) return false;
    const prepared = (await getLearningSql().query(
      `
        INSERT INTO learning_source_indexes
          (owner_id, source_id, source_version_id, index_version, status,
           source_bundle_id, snapshot_id, chunk_count, retention_until,
           failure_code, created_at, updated_at, completed_at)
        SELECT item.owner_id, item.source_id, item.source_version_id, $4, 'pending',
               item.source_bundle_id, item.snapshot_id, 0, $3, NULL, $5, $5, NULL
        FROM source_bundle_items item
        JOIN source_uploads upload
          ON upload.owner_id = item.owner_id AND upload.id = item.source_bundle_id
        WHERE item.owner_id = $1 AND item.source_bundle_id = $2
          AND upload.status = 'validated' AND upload.project_id IS NOT NULL
          AND upload.retention_until = $3
        ON CONFLICT (owner_id, source_version_id, index_version) DO UPDATE
        SET source_bundle_id = EXCLUDED.source_bundle_id,
            snapshot_id = EXCLUDED.snapshot_id,
            status = 'pending',
            retention_until = GREATEST(
              learning_source_indexes.retention_until,
              EXCLUDED.retention_until
            ),
            failure_code = NULL,
            updated_at = EXCLUDED.updated_at,
            completed_at = NULL
        WHERE learning_source_indexes.source_id = EXCLUDED.source_id
        RETURNING source_id, source_version_id
      `,
      [ownerId, bundleId, retentionUntil, PROJECT_SOURCE_INDEX_VERSION, now],
    )) as Array<{ source_id: string; source_version_id: string }>;
    const expectedSources = new Set(chunks.map((chunk) => chunk.sourceId));
    if (prepared.length !== expectedSources.size) return false;

    const records = chunks.map((chunk) => ({
      chunk_id: chunk.chunkId,
      snapshot_id: chunk.snapshotId,
      source_id: chunk.sourceId,
      ordinal: chunk.ordinal,
      start_char: chunk.startChar,
      end_char: chunk.endChar,
      char_count: chunk.charCount,
      content_hash: chunk.contentHash,
      heading_path: chunk.headingPath,
      anchor_tokens: chunk.anchorTokens,
      body_tokens: chunk.bodyTokens,
      token_count: chunk.tokenCount,
    }));
    const rows = (await getLearningSql().query(
      `
        WITH chunk_input AS MATERIALIZED (
          SELECT input.*
          FROM jsonb_to_recordset($6::jsonb) AS input(
            chunk_id text,
            snapshot_id text,
            source_id text,
            ordinal integer,
            start_char integer,
            end_char integer,
            char_count integer,
            content_hash text,
            heading_path jsonb,
            anchor_tokens text,
            body_tokens text,
            token_count integer
          )
        ), resolved AS MATERIALIZED (
          SELECT index.owner_id, index.source_version_id, input.*
          FROM learning_source_indexes index
          JOIN chunk_input input
            ON input.source_id = index.source_id
           AND input.snapshot_id = index.snapshot_id
          WHERE index.owner_id = $1
            AND index.source_bundle_id = $2
            AND index.index_version = $4
            AND index.status IN ('pending', 'failed', 'ready')
            AND index.retention_until >= $3
        ), upserted_chunks AS (
          INSERT INTO learning_source_chunks
            (id, owner_id, source_id, source_version_id, index_version, ordinal,
             offset_unit, start_char, end_char, char_count, content_hash,
             heading_path, anchor_tokens, body_tokens, token_count, redacted_at,
             created_at, updated_at)
          SELECT chunk_id, owner_id, source_id, source_version_id, $4, ordinal,
                 'utf16', start_char, end_char, char_count, content_hash,
                 heading_path, anchor_tokens, body_tokens, token_count, NULL, $5, $5
          FROM resolved
          ON CONFLICT (id) DO UPDATE
          SET start_char = EXCLUDED.start_char,
              end_char = EXCLUDED.end_char,
              char_count = EXCLUDED.char_count,
              content_hash = EXCLUDED.content_hash,
              heading_path = EXCLUDED.heading_path,
              anchor_tokens = EXCLUDED.anchor_tokens,
              body_tokens = EXCLUDED.body_tokens,
              token_count = EXCLUDED.token_count,
              redacted_at = NULL,
              updated_at = EXCLUDED.updated_at
          WHERE learning_source_chunks.owner_id = EXCLUDED.owner_id
            AND learning_source_chunks.source_id = EXCLUDED.source_id
            AND learning_source_chunks.source_version_id = EXCLUDED.source_version_id
            AND learning_source_chunks.index_version = EXCLUDED.index_version
            AND learning_source_chunks.ordinal = EXCLUDED.ordinal
          RETURNING owner_id, source_id, source_version_id
        ), chunk_assertion AS (
          SELECT 1 / CASE
            WHEN (SELECT COUNT(*) FROM resolved) = jsonb_array_length($6::jsonb)
             AND (SELECT COUNT(*) FROM upserted_chunks) = jsonb_array_length($6::jsonb)
            THEN 1 ELSE 0
          END AS ok
        ), summaries AS MATERIALIZED (
          SELECT owner_id, source_id, source_version_id, COUNT(*)::integer AS chunk_count
          FROM resolved
          GROUP BY owner_id, source_id, source_version_id
        ), ready_indexes AS (
          UPDATE learning_source_indexes index
          SET status = 'ready', chunk_count = summary.chunk_count,
              failure_code = NULL, updated_at = $5, completed_at = $5
          FROM summaries summary, chunk_assertion assertion
          WHERE assertion.ok = 1
            AND index.owner_id = summary.owner_id
            AND index.source_id = summary.source_id
            AND index.source_version_id = summary.source_version_id
            AND index.index_version = $4
          RETURNING index.owner_id, index.source_version_id
        ), ready_assertion AS (
          SELECT 1 / CASE
            WHEN COUNT(*) = (SELECT COUNT(*) FROM summaries)
            THEN 1 ELSE 0
          END AS ok
          FROM ready_indexes
        ), indexed_upload AS (
          UPDATE source_uploads upload
          SET chunk_index_status = 'ready',
              chunk_index_failure_code = NULL,
              chunk_indexed_at = $5,
              indexed_chunk_count = jsonb_array_length($6::jsonb)
          FROM ready_assertion assertion
          WHERE assertion.ok = 1
            AND upload.owner_id = $1
            AND upload.id = $2
            AND upload.status = 'validated'
            AND upload.retention_until = $3
          RETURNING upload.owner_id, upload.device_id, upload.project_id
        ), audited AS (
          INSERT INTO learning_audit_events
            (id, owner_id, device_id, event_type, metadata, created_at)
          SELECT 'aud_' || replace(gen_random_uuid()::text, '-', ''),
                 owner_id, device_id, 'source.project_chunk_index_ready',
                 jsonb_build_object(
                   'bundleId', $2::text,
                   'projectId', project_id,
                   'indexVersion', $4::text,
                   'indexedChunkCount', jsonb_array_length($6::jsonb)
                 ),
                 $5
          FROM indexed_upload
          RETURNING owner_id
        )
        SELECT owner_id FROM audited
      `,
      [
        ownerId,
        bundleId,
        retentionUntil,
        PROJECT_SOURCE_INDEX_VERSION,
        now,
        JSON.stringify(records),
      ],
    )) as Array<{ owner_id: string }>;
    return Boolean(rows[0]);
  }

  async markProjectChunkIndexFailed(
    ownerId: string,
    bundleId: string,
    failureCode: string,
    now: Date,
  ): Promise<void> {
    await getLearningSql().query(
      `
        WITH failed_upload AS (
          UPDATE source_uploads
          SET chunk_index_status = 'failed',
              chunk_index_failure_code = $3,
              chunk_indexed_at = NULL,
              indexed_chunk_count = NULL
          WHERE owner_id = $1 AND id = $2 AND status = 'validated'
          RETURNING owner_id
        )
        UPDATE learning_source_indexes index
        SET status = 'failed', failure_code = $3, updated_at = $4, completed_at = NULL
        FROM failed_upload
        WHERE index.owner_id = failed_upload.owner_id
          AND index.source_bundle_id = $2
          AND index.index_version = $5
      `,
      [ownerId, bundleId, failureCode.slice(0, 160), now, PROJECT_SOURCE_INDEX_VERSION],
    );
  }

  private async beginProjectUpload(
    principal: DeviceTokenPrincipal,
    intent: SourceUploadIntent,
    pathname: string,
    now: Date,
  ): Promise<boolean> {
    if (
      !intent.projectId ||
      !intent.projectCoverage ||
      intent.expectedProjectRevision === undefined ||
      !intent.projectSources ||
      intent.projectSources.length !== intent.itemCount
    ) {
      return false;
    }
    const rows = (await getLearningSql().query(
      `
        INSERT INTO source_uploads
          (id, owner_id, device_id, vault_binding_id, manifest_hash, blob_pathname,
           source_byte_size, item_count, retention_until, status, project_id,
           project_coverage, expected_project_revision, base_manifest_hash, created_at)
        SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending', p.id, $10, $11, $12, $13
        FROM learning_projects p
        WHERE p.id = $14 AND p.owner_id = $2 AND p.vault_binding_id = $4
          AND p.status = 'active'
          AND p.project_revision = $11
          AND ($12::text IS NULL OR p.latest_manifest_hash = $12)
        ON CONFLICT (id) DO UPDATE
        SET status = 'pending', failure_code = NULL, created_at = EXCLUDED.created_at,
            completed_at = NULL, deleted_at = NULL, blob_url = NULL,
            archive_byte_size = NULL, bundle_revision = NULL, project_indexed_at = NULL,
            indexed_chunk_count = NULL, chunk_index_status = NULL,
            chunk_index_failure_code = NULL, chunk_indexed_at = NULL
        WHERE source_uploads.owner_id = EXCLUDED.owner_id
          AND source_uploads.device_id = EXCLUDED.device_id
          AND source_uploads.vault_binding_id = EXCLUDED.vault_binding_id
          AND source_uploads.manifest_hash = EXCLUDED.manifest_hash
          AND source_uploads.blob_pathname = EXCLUDED.blob_pathname
          AND source_uploads.source_byte_size = EXCLUDED.source_byte_size
          AND source_uploads.item_count = EXCLUDED.item_count
          AND source_uploads.retention_until = EXCLUDED.retention_until
          AND source_uploads.project_id = EXCLUDED.project_id
          AND source_uploads.project_coverage = EXCLUDED.project_coverage
          AND source_uploads.expected_project_revision = EXCLUDED.expected_project_revision
          AND source_uploads.base_manifest_hash IS NOT DISTINCT FROM EXCLUDED.base_manifest_hash
          AND source_uploads.status IN ('pending', 'rejected')
        RETURNING id
      `,
      [
        intent.bundleId,
        principal.ownerId,
        principal.deviceId,
        principal.vaultBindingId,
        intent.manifestHash,
        pathname,
        intent.sourceByteSize,
        intent.itemCount,
        intent.retentionUntil,
        intent.projectCoverage,
        intent.expectedProjectRevision,
        intent.baseManifestHash ?? null,
        now,
        intent.projectId,
      ],
    )) as Array<{ id: string }>;
    return Boolean(rows[0]);
  }

  private async completeProjectUpload(
    payload: SourceUploadTokenPayload,
    blobUrl: string,
    archiveByteSize: number,
    now: Date,
    projectSources: ValidatedProjectSourceBundle,
  ): Promise<boolean> {
    if (
      !payload.projectId ||
      !payload.projectCoverage ||
      payload.expectedProjectRevision === undefined ||
      !payload.projectSources ||
      payload.projectId !== projectSources.projectId ||
      payload.projectCoverage !== projectSources.coverage ||
      payload.expectedProjectRevision !== projectSources.expectedProjectRevision ||
      payload.baseManifestHash !== projectSources.baseManifestHash ||
      projectSources.nextProjectRevision !== projectSources.expectedProjectRevision + 1 ||
      projectSources.items.length !== payload.itemCount ||
      projectSources.chunks.length < projectSources.items.length
    ) {
      return false;
    }
    const items = projectSources.items.map((item) => ({
      ordinal: item.ordinal,
      snapshot_id: item.snapshotId,
      source_id: item.sourceId,
      origin: item.origin,
      identity_key_hash: item.identityKeyHash,
      title: item.title,
      content_hash: item.contentHash,
      mime_type: item.mimeType,
      byte_size: item.byteSize,
      locator: item.locator,
      metadata: item.metadata,
      source_mtime: item.sourceMtime?.toISOString() ?? null,
    }));
    try {
      const rows = (await getLearningSql().query(
        `
          WITH candidate_upload AS MATERIALIZED (
            SELECT su.id, su.owner_id, su.device_id, su.vault_binding_id, su.project_id
            FROM source_uploads su
            JOIN learning_projects p
              ON p.owner_id = su.owner_id
             AND p.id = su.project_id
             AND p.vault_binding_id = su.vault_binding_id
            WHERE su.id = $1 AND su.owner_id = $2 AND su.device_id = $3
              AND su.vault_binding_id = $4 AND su.manifest_hash = $5
              AND su.blob_pathname = $6 AND su.source_byte_size = $7
              AND su.item_count = $8 AND su.retention_until = $12
              AND su.project_id = $13 AND su.project_coverage = $14
              AND su.expected_project_revision = $15
              AND su.base_manifest_hash IS NOT DISTINCT FROM $16::text
              AND su.status = 'pending'
              AND p.status = 'active'
              AND p.project_revision = $15
              AND ($16::text IS NULL OR p.latest_manifest_hash = $16)
            FOR UPDATE OF su, p
          ), source_items AS MATERIALIZED (
            SELECT candidate.owner_id, candidate.vault_binding_id,
                   candidate.project_id, item.*
            FROM candidate_upload candidate
            CROSS JOIN jsonb_to_recordset($19::jsonb) AS item(
              ordinal integer,
              snapshot_id text,
              source_id text,
              origin text,
              identity_key_hash text,
              title text,
              content_hash text,
              mime_type text,
              byte_size integer,
              locator jsonb,
              metadata jsonb,
              source_mtime timestamptz
            )
          ), upserted_sources AS (
            INSERT INTO learning_sources
              (id, owner_id, vault_binding_id, origin, identity_key_hash, title,
               mime_type, status, created_at, updated_at)
            SELECT source_id, owner_id, vault_binding_id, origin, identity_key_hash,
                   title, mime_type, 'active', $11, $11
            FROM source_items
            ON CONFLICT (id) DO UPDATE
            SET title = EXCLUDED.title,
                mime_type = EXCLUDED.mime_type,
                status = 'active',
                updated_at = EXCLUDED.updated_at
            WHERE learning_sources.owner_id = EXCLUDED.owner_id
              AND learning_sources.vault_binding_id = EXCLUDED.vault_binding_id
              AND learning_sources.origin = EXCLUDED.origin
              AND learning_sources.identity_key_hash = EXCLUDED.identity_key_hash
            RETURNING id, owner_id, vault_binding_id
          ), resolved_items AS MATERIALIZED (
            SELECT item.*
            FROM source_items item
            JOIN upserted_sources source
              ON source.id = item.source_id
             AND source.owner_id = item.owner_id
             AND source.vault_binding_id = item.vault_binding_id
          ), upserted_versions AS (
            INSERT INTO learning_source_versions
              (id, owner_id, source_id, content_hash, title, mime_type, byte_size,
               locator, metadata, source_mtime, observed_bundle_revision,
               observed_project_revision, first_seen_at, last_seen_at)
            SELECT 'svr_' || replace(gen_random_uuid()::text, '-', ''),
                   owner_id, source_id, content_hash, title, mime_type, byte_size,
                   locator, metadata, source_mtime, $17, $18, $11, $11
            FROM resolved_items
            ON CONFLICT (owner_id, source_id, content_hash) DO UPDATE
            SET title = EXCLUDED.title,
                mime_type = EXCLUDED.mime_type,
                byte_size = EXCLUDED.byte_size,
                locator = EXCLUDED.locator,
                metadata = EXCLUDED.metadata,
                source_mtime = EXCLUDED.source_mtime,
                observed_bundle_revision = GREATEST(
                  learning_source_versions.observed_bundle_revision,
                  EXCLUDED.observed_bundle_revision
                ),
                observed_project_revision = GREATEST(
                  learning_source_versions.observed_project_revision,
                  EXCLUDED.observed_project_revision
                ),
                last_seen_at = GREATEST(
                  learning_source_versions.last_seen_at,
                  EXCLUDED.last_seen_at
                )
            RETURNING id, owner_id, source_id, content_hash
          ), registered_items AS MATERIALIZED (
            SELECT item.*, version.id AS source_version_id
            FROM resolved_items item
            JOIN upserted_versions version
              ON version.owner_id = item.owner_id
             AND version.source_id = item.source_id
             AND version.content_hash = item.content_hash
          ), item_assertion AS (
            SELECT 1 / CASE WHEN
              (SELECT COUNT(*) FROM source_items) = $8
              AND (SELECT COUNT(*) FROM upserted_sources) = $8
              AND (SELECT COUNT(*) FROM registered_items) = $8
              THEN 1 ELSE COUNT(*) - COUNT(*) END AS ok
            FROM candidate_upload candidate
            GROUP BY candidate.id
          ), project_links AS (
            INSERT INTO learning_project_sources
              (owner_id, project_id, vault_binding_id, source_id, latest_version_id,
               first_seen_bundle_id, last_seen_bundle_id, first_seen_at, last_seen_at,
               removed_at)
            SELECT item.owner_id, item.project_id, item.vault_binding_id, item.source_id,
                   item.source_version_id, $1, $1, $11, $11, NULL
            FROM registered_items item
            CROSS JOIN item_assertion assertion
            WHERE assertion.ok = 1
            ON CONFLICT (owner_id, project_id, source_id) DO UPDATE
            SET latest_version_id = EXCLUDED.latest_version_id,
                last_seen_bundle_id = EXCLUDED.last_seen_bundle_id,
                last_seen_at = EXCLUDED.last_seen_at,
                removed_at = NULL
            RETURNING owner_id, project_id, source_id
          ), bundle_items AS (
            INSERT INTO source_bundle_items
              (owner_id, source_bundle_id, project_id, vault_binding_id, ordinal,
               snapshot_id, source_id, source_version_id, created_at)
            SELECT item.owner_id, $1, item.project_id, item.vault_binding_id, item.ordinal,
                   item.snapshot_id, item.source_id, item.source_version_id, $11
            FROM registered_items item
            JOIN project_links link
              ON link.owner_id = item.owner_id
             AND link.project_id = item.project_id
             AND link.source_id = item.source_id
            ON CONFLICT (owner_id, source_bundle_id, ordinal) DO UPDATE
            SET created_at = source_bundle_items.created_at
            WHERE source_bundle_items.project_id = EXCLUDED.project_id
              AND source_bundle_items.vault_binding_id = EXCLUDED.vault_binding_id
              AND source_bundle_items.snapshot_id = EXCLUDED.snapshot_id
              AND source_bundle_items.source_id = EXCLUDED.source_id
              AND source_bundle_items.source_version_id = EXCLUDED.source_version_id
            RETURNING owner_id, source_bundle_id
          ), link_assertion AS (
            SELECT 1 / CASE WHEN
              (SELECT COUNT(*) FROM project_links) = $8
              AND (SELECT COUNT(*) FROM bundle_items) = $8
              THEN 1 ELSE COUNT(*) - COUNT(*) END AS ok
            FROM item_assertion assertion
            GROUP BY assertion.ok
          ), removed_links AS (
            UPDATE learning_project_sources existing
            SET removed_at = $11,
                last_seen_at = GREATEST(existing.last_seen_at, $11)
            FROM candidate_upload candidate, link_assertion assertion
            WHERE assertion.ok = 1
              AND $14::text = 'complete'
              AND existing.owner_id = candidate.owner_id
              AND existing.project_id = candidate.project_id
              AND existing.removed_at IS NULL
              AND NOT EXISTS (
                SELECT 1
                FROM registered_items current_item
                WHERE current_item.owner_id = existing.owner_id
                  AND current_item.project_id = existing.project_id
                  AND current_item.source_id = existing.source_id
              )
            RETURNING existing.owner_id
          ), removal_barrier AS (
            SELECT assertion.ok, COUNT(removed.owner_id) AS removed_count
            FROM link_assertion assertion
            LEFT JOIN removed_links removed ON TRUE
            GROUP BY assertion.ok
          ), project_updated AS (
            UPDATE learning_projects project
            SET project_revision = $18,
                latest_manifest_hash = $5,
                last_indexed_at = $11,
                updated_at = $11
            FROM candidate_upload candidate, removal_barrier barrier
            WHERE barrier.ok = 1
              AND project.owner_id = candidate.owner_id
              AND project.id = candidate.project_id
              AND project.vault_binding_id = candidate.vault_binding_id
              AND project.project_revision = $15
            RETURNING project.owner_id, project.id
          ), completed AS (
            UPDATE source_uploads upload
            SET blob_url = $9,
                archive_byte_size = $10,
                status = 'validated',
                failure_code = NULL,
                completed_at = $11,
                bundle_revision = $17,
                project_indexed_at = $11,
                chunk_index_status = 'pending',
                chunk_index_failure_code = NULL,
                chunk_indexed_at = NULL,
                indexed_chunk_count = NULL
            FROM candidate_upload candidate
            JOIN project_updated project
              ON project.owner_id = candidate.owner_id
             AND project.id = candidate.project_id
            WHERE upload.id = candidate.id
              AND upload.owner_id = candidate.owner_id
              AND upload.vault_binding_id = candidate.vault_binding_id
            RETURNING upload.owner_id, upload.device_id
          ), audited AS (
            INSERT INTO learning_audit_events
              (id, owner_id, device_id, event_type, metadata, created_at)
            SELECT 'aud_' || replace(gen_random_uuid()::text, '-', ''),
                   owner_id,
                   device_id,
                   'source.project_upload_validated',
                   jsonb_build_object(
                     'bundleId', $1::text,
                     'projectId', $13::text,
                     'bundleRevision', $17::bigint,
                     'projectRevision', $18::bigint,
                     'coverage', $14::text,
                     'chunkIndexStatus', 'pending'
                   ),
                   $11
            FROM completed
            RETURNING owner_id
          )
          SELECT owner_id FROM audited
        `,
        [
          payload.bundleId,
          payload.ownerId,
          payload.deviceId,
          payload.vaultBindingId,
          payload.manifestHash,
          payload.pathname,
          payload.sourceByteSize,
          payload.itemCount,
          blobUrl,
          archiveByteSize,
          now,
          payload.retentionUntil,
          payload.projectId,
          payload.projectCoverage,
          payload.expectedProjectRevision,
          payload.baseManifestHash ?? null,
          projectSources.bundleRevision,
          projectSources.nextProjectRevision,
          JSON.stringify(items),
        ],
      )) as Array<{ owner_id: string }>;
      if (rows[0]) return true;
    } catch (error) {
      const code =
        typeof error === 'object' && error !== null && 'code' in error
          ? String((error as { code?: unknown }).code)
          : '';
      if (code !== '22012' && code !== '23505') throw error;
      return false;
    }
    const completed = (await getLearningSql().query(
      `
        SELECT id
        FROM source_uploads
        WHERE id = $1 AND owner_id = $2 AND device_id = $3 AND vault_binding_id = $4
          AND manifest_hash = $5 AND blob_pathname = $6
          AND source_byte_size = $7 AND item_count = $8
          AND retention_until = $9 AND project_id = $10
          AND project_coverage = $11 AND expected_project_revision = $12
          AND base_manifest_hash IS NOT DISTINCT FROM $13::text
          AND bundle_revision = $14 AND status = 'validated'
          AND project_indexed_at IS NOT NULL
      `,
      [
        payload.bundleId,
        payload.ownerId,
        payload.deviceId,
        payload.vaultBindingId,
        payload.manifestHash,
        payload.pathname,
        payload.sourceByteSize,
        payload.itemCount,
        payload.retentionUntil,
        payload.projectId,
        payload.projectCoverage,
        payload.expectedProjectRevision,
        payload.baseManifestHash ?? null,
        projectSources.bundleRevision,
      ],
    )) as Array<{ id: string }>;
    return Boolean(completed[0]);
  }
}
