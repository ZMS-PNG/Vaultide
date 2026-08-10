import type { JsonObject } from '@openmaic/learning-protocol';
import type { DeviceTokenPrincipal } from '../../domain/device-token';
import type {
  LearningProjectRecord,
  ProjectBindingInput,
  ProjectStatusRecord,
  ProjectUploadSummary,
} from '../../domain/project';
import type {
  FinalizeProjectRevisionInput,
  ProjectRepository,
  ProjectRevisionCandidate,
} from '../../ports/project-repository';
import { getLearningSql } from './client';

interface ProjectRow {
  id: string;
  owner_id: string;
  vault_binding_id: string;
  kind: string;
  display_name: string;
  root_path: string;
  status: LearningProjectRecord['status'];
  binding_revision: string | number;
  project_revision: string | number;
  latest_manifest_hash: string | null;
  metadata: JsonObject;
  last_indexed_at: string | null;
  created_at: string;
  updated_at: string;
}

function project(row: ProjectRow): LearningProjectRecord {
  return {
    id: row.id,
    ownerId: row.owner_id,
    vaultBindingId: row.vault_binding_id,
    kind: row.kind,
    projectName: row.display_name,
    rootPath: row.root_path,
    status: row.status,
    bindingRevision: Number(row.binding_revision),
    projectRevision: Number(row.project_revision),
    ...(row.latest_manifest_hash ? { latestManifestHash: row.latest_manifest_hash } : {}),
    metadata: row.metadata,
    ...(row.last_indexed_at ? { lastIndexedAt: new Date(row.last_indexed_at) } : {}),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

export class NeonProjectRepository implements ProjectRepository {
  async register(
    principal: DeviceTokenPrincipal,
    input: ProjectBindingInput,
    now: Date,
  ): Promise<LearningProjectRecord | null> {
    try {
      const rows = (await getLearningSql().query(
        `
        WITH inserted AS (
          INSERT INTO learning_projects
            (id, owner_id, vault_binding_id, kind, display_name, root_path, binding_key_hash,
             status, binding_revision, project_revision, metadata, created_at, updated_at)
          SELECT $1, $2, $3, $4, $5, $6, $7, 'active', 1, 0, $8::jsonb, $9, $9
          FROM vault_bindings vb
          WHERE vb.owner_id = $2 AND vb.vault_binding_id = $3 AND vb.revoked_at IS NULL
            AND ($10::bigint IS NULL OR $10 = 0)
          ON CONFLICT DO NOTHING
          RETURNING id, owner_id, vault_binding_id, kind, display_name, root_path, status,
                    binding_revision, project_revision, latest_manifest_hash, metadata,
                    last_indexed_at, created_at, updated_at
        ), refreshed AS (
          UPDATE learning_projects p
          SET kind = $4,
              display_name = $5,
              root_path = $6,
              binding_key_hash = $7,
              metadata = $8::jsonb,
              status = 'active',
              binding_revision = p.binding_revision + 1,
              updated_at = $9
          WHERE p.id = $1 AND p.owner_id = $2 AND p.vault_binding_id = $3
            AND NOT EXISTS (SELECT 1 FROM inserted)
            AND $10::bigint IS NOT NULL AND p.binding_revision = $10
            AND NOT EXISTS (
              SELECT 1
              FROM learning_projects occupied
              WHERE occupied.owner_id = $2
                AND occupied.vault_binding_id = $3
                AND occupied.binding_key_hash = $7
                AND occupied.id <> p.id
            )
            AND (
              p.kind IS DISTINCT FROM $4
              OR p.display_name IS DISTINCT FROM $5
              OR p.root_path IS DISTINCT FROM $6
              OR p.binding_key_hash IS DISTINCT FROM $7
              OR p.metadata IS DISTINCT FROM $8::jsonb
              OR p.status <> 'active'
            )
          RETURNING p.id, p.owner_id, p.vault_binding_id, p.kind, p.display_name, p.root_path,
                    p.status, p.binding_revision, p.project_revision, p.latest_manifest_hash,
                    p.metadata, p.last_indexed_at, p.created_at, p.updated_at
        ), unchanged AS (
          SELECT p.id, p.owner_id, p.vault_binding_id, p.kind, p.display_name, p.root_path,
                 p.status, p.binding_revision, p.project_revision, p.latest_manifest_hash,
                 p.metadata, p.last_indexed_at, p.created_at, p.updated_at
          FROM learning_projects p
          WHERE p.id = $1 AND p.owner_id = $2 AND p.vault_binding_id = $3
            AND p.root_path = $6 AND p.binding_key_hash = $7
            AND p.kind = $4 AND p.display_name = $5
            AND p.metadata = $8::jsonb AND p.status = 'active'
            AND ($10::bigint IS NULL OR p.binding_revision = $10)
            AND NOT EXISTS (SELECT 1 FROM inserted)
            AND NOT EXISTS (SELECT 1 FROM refreshed)
        )
        SELECT * FROM inserted
        UNION ALL
        SELECT * FROM refreshed
        UNION ALL
        SELECT * FROM unchanged
        LIMIT 1
      `,
        [
          input.projectId,
          principal.ownerId,
          principal.vaultBindingId,
          input.kind,
          input.projectName,
          input.rootPath,
          input.bindingKeyHash,
          JSON.stringify(input.metadata),
          now,
          input.expectedBindingRevision ?? null,
        ],
      )) as ProjectRow[];
      return rows[0] ? project(rows[0]) : null;
    } catch (error) {
      const code =
        typeof error === 'object' && error !== null
          ? String((error as { code?: unknown }).code ?? '')
          : '';
      if (code === '23505') return null;
      throw error;
    }
  }

  async findStatus(
    principal: DeviceTokenPrincipal,
    projectId: string,
  ): Promise<ProjectStatusRecord | null> {
    const rows = (await getLearningSql().query(
      `
        SELECT p.id, p.owner_id, p.vault_binding_id, p.kind, p.display_name, p.root_path,
               p.status, p.binding_revision, p.project_revision,
               p.latest_manifest_hash AS project_latest_manifest_hash,
               p.metadata, p.last_indexed_at,
               p.created_at, p.updated_at,
               COALESCE(sources.active_source_count, 0)::integer AS active_source_count,
               latest.id AS latest_bundle_id,
               latest.manifest_hash AS latest_upload_manifest_hash,
               latest.status AS latest_status,
               latest.project_coverage AS latest_coverage,
               latest.bundle_revision AS latest_bundle_revision,
               latest.item_count AS latest_item_count,
               latest.created_at AS latest_created_at,
               latest.completed_at AS latest_completed_at
        FROM learning_projects p
        LEFT JOIN LATERAL (
          SELECT COUNT(*) AS active_source_count
          FROM learning_project_sources ps
          WHERE ps.owner_id = p.owner_id AND ps.project_id = p.id
            AND ps.removed_at IS NULL
        ) sources ON TRUE
        LEFT JOIN LATERAL (
          SELECT su.id, su.manifest_hash, su.status, su.project_coverage,
                 su.bundle_revision, su.item_count, su.created_at, su.completed_at
          FROM source_uploads su
          WHERE su.owner_id = p.owner_id
            AND su.vault_binding_id = p.vault_binding_id
            AND su.project_id = p.id
          ORDER BY su.created_at DESC, su.id DESC
          LIMIT 1
        ) latest ON TRUE
        WHERE p.id = $1 AND p.owner_id = $2 AND p.vault_binding_id = $3
      `,
      [projectId, principal.ownerId, principal.vaultBindingId],
    )) as Array<ProjectRow & Record<string, unknown>>;
    const row = rows[0];
    if (!row) return null;
    return {
      project: project({
        ...row,
        latest_manifest_hash:
          typeof row.project_latest_manifest_hash === 'string'
            ? row.project_latest_manifest_hash
            : null,
      } as ProjectRow),
      activeSourceCount: Number(row.active_source_count ?? 0),
      ...(typeof row.latest_bundle_id === 'string'
        ? {
            latestUpload: {
              bundleId: row.latest_bundle_id,
              manifestHash: String(row.latest_upload_manifest_hash),
              status: row.latest_status as ProjectUploadSummary['status'],
              coverage: row.latest_coverage as ProjectUploadSummary['coverage'],
              ...(row.latest_bundle_revision !== null && row.latest_bundle_revision !== undefined
                ? { bundleRevision: Number(row.latest_bundle_revision) }
                : {}),
              itemCount: Number(row.latest_item_count),
              createdAt: new Date(String(row.latest_created_at)),
              ...(row.latest_completed_at
                ? { completedAt: new Date(String(row.latest_completed_at)) }
                : {}),
            },
          }
        : {}),
    };
  }

  async listRevisionCandidates(
    principal: DeviceTokenPrincipal,
    projectId: string,
    sourceIds: readonly string[],
  ): Promise<ProjectRevisionCandidate[]> {
    if (sourceIds.length === 0) return [];
    const rows = (await getLearningSql().query(
      `
        SELECT links.source_id, links.latest_version_id,
               versions.locator->>'relativePath' AS relative_path,
               versions.content_hash, versions.source_mtime
        FROM learning_project_sources links
        JOIN learning_source_versions versions
          ON versions.owner_id = links.owner_id
         AND versions.source_id = links.source_id
         AND versions.id = links.latest_version_id
        JOIN learning_projects project
          ON project.owner_id = links.owner_id AND project.id = links.project_id
        WHERE links.owner_id = $1
          AND links.project_id = $2
          AND project.vault_binding_id = $3
          AND links.removed_at IS NULL
          AND links.source_id = ANY($4::text[])
        ORDER BY links.source_id
      `,
      [principal.ownerId, projectId, principal.vaultBindingId, [...sourceIds]],
    )) as Array<{
      source_id: string;
      latest_version_id: string;
      relative_path: string | null;
      content_hash: string;
      source_mtime: string | Date | null;
    }>;
    return rows.map((row) => ({
      sourceId: row.source_id,
      sourceVersionId: row.latest_version_id,
      relativePath: row.relative_path ?? row.source_id,
      contentHash: row.content_hash,
      ...(row.source_mtime ? { sourceMtime: new Date(row.source_mtime) } : {}),
    }));
  }

  async finalizeRevision(
    principal: DeviceTokenPrincipal,
    input: FinalizeProjectRevisionInput,
    now: Date,
  ): Promise<{ projectRevision: number; manifestId: string } | null> {
    const entries = input.entries.map((entry) => ({
      source_id: entry.sourceId,
      source_version_id: entry.sourceVersionId,
      relative_path: entry.relativePath,
      content_hash: entry.contentHash,
      source_mtime: entry.sourceMtime?.toISOString() ?? null,
    }));
    const rows = (await getLearningSql().query(
      `
        WITH locked_project AS (
          SELECT id, owner_id, vault_binding_id
          FROM learning_projects
          WHERE owner_id = $1 AND id = $4 AND vault_binding_id = $3
            AND status = 'active' AND project_revision = $5
          FOR UPDATE
        ),
        supplied_entries AS MATERIALIZED (
          SELECT *
          FROM jsonb_to_recordset($10::jsonb) AS entry(
            source_id text,
            source_version_id text,
            relative_path text,
            content_hash text,
            source_mtime timestamptz
          )
        ),
        assertion AS (
          SELECT (
            (SELECT count(*) FROM supplied_entries) = $8
            AND NOT EXISTS (
              SELECT 1
              FROM supplied_entries entry
              LEFT JOIN learning_project_sources link
                ON link.owner_id = $1
               AND link.project_id = $4
               AND link.source_id = entry.source_id
               AND link.latest_version_id = entry.source_version_id
               AND link.removed_at IS NULL
              LEFT JOIN learning_source_versions version
                ON version.owner_id = $1
               AND version.source_id = entry.source_id
               AND version.id = entry.source_version_id
               AND version.content_hash = entry.content_hash
              WHERE link.source_id IS NULL OR version.id IS NULL
            )
          ) AS ok
          FROM locked_project
        ),
        removed_links AS (
          UPDATE learning_project_sources link
          SET removed_at = $11, last_seen_at = GREATEST(link.last_seen_at, $11)
          FROM assertion
          WHERE assertion.ok
            AND link.owner_id = $1
            AND link.project_id = $4
            AND link.removed_at IS NULL
            AND NOT EXISTS (
              SELECT 1 FROM supplied_entries entry WHERE entry.source_id = link.source_id
            )
          RETURNING link.source_id
        ),
        removal_barrier AS (
          SELECT assertion.ok, count(removed_links.source_id) AS removed_count
          FROM assertion
          LEFT JOIN removed_links ON TRUE
          GROUP BY assertion.ok
        ),
        project_updated AS (
          UPDATE learning_projects project
          SET project_revision = $5 + 1,
              latest_manifest_hash = $7,
              last_indexed_at = $11,
              updated_at = $11
          FROM locked_project, removal_barrier
          WHERE removal_barrier.ok
            AND project.owner_id = locked_project.owner_id
            AND project.id = locked_project.id
            AND project.project_revision = $5
          RETURNING project.owner_id, project.id, project.project_revision
        ),
        manifest AS (
          INSERT INTO project_revision_manifests
            (id, owner_id, project_id, project_revision, manifest_sha256,
             source_count, source_bundle_id, created_at)
          SELECT $6, owner_id, id, project_revision, $7, $8, $9, $11
          FROM project_updated
          RETURNING id, owner_id, project_id, project_revision
        ),
        inserted_entries AS (
          INSERT INTO project_revision_manifest_entries
            (owner_id, manifest_id, project_id, source_id, source_version_id,
             relative_path, content_hash, source_mtime)
          SELECT manifest.owner_id, manifest.id, manifest.project_id,
                 entry.source_id, entry.source_version_id, entry.relative_path,
                 entry.content_hash, entry.source_mtime
          FROM manifest
          CROSS JOIN supplied_entries entry
          RETURNING source_id
        ),
        entry_barrier AS (
          SELECT manifest.id, manifest.project_revision,
                 count(inserted_entries.source_id) AS inserted_count
          FROM manifest
          LEFT JOIN inserted_entries ON TRUE
          GROUP BY manifest.id, manifest.project_revision
        ),
        audited AS (
          INSERT INTO learning_audit_events
            (id, owner_id, device_id, event_type, metadata, created_at)
          SELECT 'aud_' || replace(gen_random_uuid()::text, '-', ''), $1, $2,
                 'project.revision_finalized',
                 jsonb_build_object(
                   'projectId', $4::text,
                   'projectRevision', entry_barrier.project_revision,
                   'manifestId', entry_barrier.id,
                   'sourceCount', entry_barrier.inserted_count
                 ),
                 $11
          FROM entry_barrier
          WHERE entry_barrier.inserted_count = $8
          RETURNING id
        )
        SELECT entry_barrier.id, entry_barrier.project_revision
        FROM entry_barrier
        JOIN audited ON TRUE
        WHERE entry_barrier.inserted_count = $8
      `,
      [
        principal.ownerId,
        principal.deviceId,
        principal.vaultBindingId,
        input.projectId,
        input.expectedProjectRevision,
        input.manifestId,
        input.manifestSha256,
        input.entries.length,
        input.sourceBundleId ?? null,
        JSON.stringify(entries),
        now,
      ],
    )) as unknown as Array<{ id: string; project_revision: number | string }>;
    const row = rows[0];
    return row
      ? { projectRevision: Number(row.project_revision), manifestId: row.id }
      : null;
  }
}
