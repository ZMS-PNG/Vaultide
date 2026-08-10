import type {
  ProjectBundleContext,
  ProjectChunkCandidate,
  ProjectRetrievalProject,
  SaveProjectRetrievalRun,
} from '../../domain/project-retrieval';
import type { ProjectRetrievalRepository } from '../../ports/project-retrieval-repository';
import { getLearningSql } from './client';

interface ProjectContextRow {
  project_id: string;
  display_name: string;
  project_revision: string | number;
  uploaded_project_revision?: string | number;
  project_coverage?: 'partial' | 'complete';
  active_source_count: string | number;
  searchable_source_count: string | number;
  pending_source_count: string | number;
  failed_source_count: string | number;
  indexed_chunk_count: string | number;
  last_indexed_at: string | null;
}

interface ChunkRow {
  chunk_id: string;
  source_id: string;
  source_version_id: string;
  source_bundle_id: string;
  snapshot_id: string;
  title: string;
  relative_path: string;
  chunk_ordinal: string | number;
  start_char: string | number;
  end_char: string | number;
  content_hash: string;
  heading_path: unknown;
  score: string | number;
}

function headingPath(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.slice(0, 240))
    .slice(0, 6);
}

function candidate(row: ChunkRow, fallback: boolean): ProjectChunkCandidate {
  return {
    chunkId: row.chunk_id,
    sourceId: row.source_id,
    sourceVersionId: row.source_version_id,
    sourceBundleId: row.source_bundle_id,
    snapshotId: row.snapshot_id,
    title: row.title,
    relativePath: row.relative_path,
    chunkOrdinal: Number(row.chunk_ordinal),
    startChar: Number(row.start_char),
    endChar: Number(row.end_char),
    contentHash: row.content_hash,
    headingPath: headingPath(row.heading_path),
    score: Math.max(0, Number(row.score)),
    fallback,
  };
}

function project(row: ProjectContextRow): ProjectRetrievalProject {
  return {
    projectId: row.project_id,
    displayName: row.display_name,
    projectRevision: Number(row.project_revision),
    activeSourceCount: Number(row.active_source_count),
    searchableSourceCount: Number(row.searchable_source_count),
    pendingSourceCount: Number(row.pending_source_count),
    failedSourceCount: Number(row.failed_source_count),
    indexedChunkCount: Number(row.indexed_chunk_count),
    ...(row.last_indexed_at ? { lastIndexedAt: new Date(row.last_indexed_at) } : {}),
  };
}

const PROJECT_COUNTS_SQL = `
  LEFT JOIN LATERAL (
    SELECT COUNT(*)::integer AS active_source_count
    FROM learning_project_sources ps
    WHERE ps.owner_id = p.owner_id AND ps.project_id = p.id
      AND ps.removed_at IS NULL
  ) active_sources ON TRUE
  LEFT JOIN LATERAL (
    SELECT COUNT(DISTINCT ps.source_id)::integer AS searchable_source_count,
           COUNT(DISTINCT chunk.id)::integer AS indexed_chunk_count
    FROM learning_project_sources ps
    JOIN learning_source_indexes source_index
      ON source_index.owner_id = ps.owner_id
     AND source_index.source_id = ps.source_id
     AND source_index.source_version_id = ps.latest_version_id
     AND source_index.index_version = 'markdown-lexical-v1'
     AND source_index.status = 'ready'
    JOIN learning_source_chunks chunk
      ON chunk.owner_id = ps.owner_id
     AND chunk.source_id = ps.source_id
     AND chunk.source_version_id = ps.latest_version_id
     AND chunk.redacted_at IS NULL
    WHERE ps.owner_id = p.owner_id
      AND ps.project_id = p.id
      AND ps.removed_at IS NULL
      AND EXISTS (
        SELECT 1
        FROM source_bundle_items bundle_item
        JOIN source_uploads live_upload
          ON live_upload.owner_id = bundle_item.owner_id
         AND live_upload.id = bundle_item.source_bundle_id
         AND live_upload.status = 'validated'
         AND live_upload.retention_until > $3
        WHERE bundle_item.owner_id = ps.owner_id
          AND bundle_item.project_id = ps.project_id
          AND bundle_item.source_id = ps.source_id
          AND bundle_item.source_version_id = ps.latest_version_id
      )
  ) searchable_sources ON TRUE
  LEFT JOIN LATERAL (
    SELECT
      COUNT(*) FILTER (
        WHERE source_index.status IS NULL OR source_index.status = 'pending'
      )::integer AS pending_source_count,
      COUNT(*) FILTER (
        WHERE source_index.status = 'failed'
      )::integer AS failed_source_count
    FROM learning_project_sources ps
    LEFT JOIN learning_source_indexes source_index
      ON source_index.owner_id = ps.owner_id
     AND source_index.source_id = ps.source_id
     AND source_index.source_version_id = ps.latest_version_id
     AND source_index.index_version = 'markdown-lexical-v1'
    WHERE ps.owner_id = p.owner_id
      AND ps.project_id = p.id
      AND ps.removed_at IS NULL
  ) index_states ON TRUE
`;

export class NeonProjectRetrievalRepository implements ProjectRetrievalRepository {
  async findBundleContext(
    ownerId: string,
    bundleId: string,
    now: Date,
  ): Promise<ProjectBundleContext | null> {
    const rows = (await getLearningSql().query(
      `
        SELECT p.id AS project_id, p.display_name, p.project_revision,
               (upload.expected_project_revision + 1) AS uploaded_project_revision,
               upload.project_coverage,
               COALESCE(active_sources.active_source_count, 0) AS active_source_count,
               COALESCE(searchable_sources.searchable_source_count, 0)
                  AS searchable_source_count,
               COALESCE(index_states.pending_source_count, 0) AS pending_source_count,
               COALESCE(index_states.failed_source_count, 0) AS failed_source_count,
               COALESCE(searchable_sources.indexed_chunk_count, 0) AS indexed_chunk_count,
               p.last_indexed_at
        FROM source_uploads upload
        JOIN learning_projects p
          ON p.owner_id = upload.owner_id AND p.id = upload.project_id
        ${PROJECT_COUNTS_SQL}
        WHERE upload.owner_id = $1
          AND upload.id = $2
          AND upload.status = 'validated'
          AND upload.retention_until > $3
          AND upload.project_id IS NOT NULL
      `,
      [ownerId, bundleId, now],
    )) as ProjectContextRow[];
    const row = rows[0];
    if (!row || row.uploaded_project_revision === undefined || !row.project_coverage) return null;
    const base = project(row);
    return {
      ...base,
      uploadedProjectRevision: Number(row.uploaded_project_revision),
      coverage: row.project_coverage,
    };
  }

  async findProject(
    ownerId: string,
    projectId: string,
    now: Date,
  ): Promise<ProjectRetrievalProject | null> {
    const rows = (await getLearningSql().query(
      `
        SELECT p.id AS project_id, p.display_name, p.project_revision,
               COALESCE(active_sources.active_source_count, 0) AS active_source_count,
               COALESCE(searchable_sources.searchable_source_count, 0)
                  AS searchable_source_count,
               COALESCE(index_states.pending_source_count, 0) AS pending_source_count,
               COALESCE(index_states.failed_source_count, 0) AS failed_source_count,
               COALESCE(searchable_sources.indexed_chunk_count, 0) AS indexed_chunk_count,
               p.last_indexed_at
        FROM learning_projects p
        ${PROJECT_COUNTS_SQL}
        WHERE p.owner_id = $1 AND p.id = $2 AND p.status = 'active'
      `,
      [ownerId, projectId, now],
    )) as ProjectContextRow[];
    return rows[0] ? project(rows[0]) : null;
  }

  async searchChunks(
    ownerId: string,
    projectId: string,
    now: Date,
    query: string,
    limit: number,
  ): Promise<ProjectChunkCandidate[]> {
    const rows = (await getLearningSql().query(
      `
        WITH query_value AS MATERIALIZED (
          SELECT to_tsquery('simple', $4) AS value
        ), live_versions AS MATERIALIZED (
          SELECT ps.source_id, ps.latest_version_id,
                 live.source_bundle_id, live.snapshot_id
          FROM learning_project_sources ps
          JOIN LATERAL (
            SELECT bundle_item.source_bundle_id, bundle_item.snapshot_id
            FROM source_bundle_items bundle_item
            JOIN source_uploads live_upload
              ON live_upload.owner_id = bundle_item.owner_id
             AND live_upload.id = bundle_item.source_bundle_id
             AND live_upload.status = 'validated'
             AND live_upload.retention_until > $3
            WHERE bundle_item.owner_id = ps.owner_id
              AND bundle_item.project_id = ps.project_id
              AND bundle_item.source_id = ps.source_id
              AND bundle_item.source_version_id = ps.latest_version_id
            ORDER BY live_upload.completed_at DESC, bundle_item.source_bundle_id DESC
            LIMIT 1
          ) live ON TRUE
          WHERE ps.owner_id = $1 AND ps.project_id = $2 AND ps.removed_at IS NULL
        ), scored AS MATERIALIZED (
          SELECT chunk.id AS chunk_id, version.source_id, version.id AS source_version_id,
                 live.source_bundle_id, live.snapshot_id, version.title,
                 COALESCE(version.locator->>'relativePath', version.title) AS relative_path,
                 chunk.ordinal AS chunk_ordinal, chunk.start_char, chunk.end_char,
                 chunk.content_hash, chunk.heading_path,
                 ts_rank_cd(
                   ARRAY[0.05, 0.1, 0.4, 1.0]::real[],
                   chunk.search_document,
                   query_value.value,
                   32
                 )::double precision AS score
          FROM live_versions live
          JOIN learning_source_versions version
            ON version.owner_id = $1
           AND version.source_id = live.source_id
           AND version.id = live.latest_version_id
          JOIN learning_source_chunks chunk
            ON chunk.owner_id = version.owner_id
           AND chunk.source_id = version.source_id
           AND chunk.source_version_id = version.id
           AND chunk.index_version = 'markdown-lexical-v1'
           AND chunk.redacted_at IS NULL
          JOIN learning_source_indexes source_index
            ON source_index.owner_id = version.owner_id
           AND source_index.source_id = version.source_id
           AND source_index.source_version_id = version.id
           AND source_index.index_version = chunk.index_version
           AND source_index.status = 'ready'
          CROSS JOIN query_value
          WHERE chunk.search_document @@ query_value.value
        ), ranked AS (
          SELECT scored.*,
                 row_number() OVER (
                   PARTITION BY scored.source_id
                   ORDER BY scored.score DESC, scored.chunk_ordinal ASC
                 ) AS source_rank
          FROM scored
        )
        SELECT chunk_id, source_id, source_version_id, source_bundle_id, snapshot_id,
               title, relative_path, chunk_ordinal, start_char, end_char, content_hash,
               heading_path, score
        FROM ranked
        WHERE source_rank <= 8
        ORDER BY score DESC, relative_path ASC, chunk_ordinal ASC
        LIMIT $5
      `,
      [ownerId, projectId, now, query, limit],
    )) as ChunkRow[];
    return rows.map((row) => candidate(row, false));
  }

  async listFallbackChunks(
    ownerId: string,
    projectId: string,
    now: Date,
    limit: number,
  ): Promise<ProjectChunkCandidate[]> {
    const rows = (await getLearningSql().query(
      `
        WITH live_versions AS MATERIALIZED (
          SELECT ps.source_id, ps.latest_version_id,
                 live.source_bundle_id, live.snapshot_id
          FROM learning_project_sources ps
          JOIN LATERAL (
            SELECT bundle_item.source_bundle_id, bundle_item.snapshot_id
            FROM source_bundle_items bundle_item
            JOIN source_uploads live_upload
              ON live_upload.owner_id = bundle_item.owner_id
             AND live_upload.id = bundle_item.source_bundle_id
             AND live_upload.status = 'validated'
             AND live_upload.retention_until > $3
            WHERE bundle_item.owner_id = ps.owner_id
              AND bundle_item.project_id = ps.project_id
              AND bundle_item.source_id = ps.source_id
              AND bundle_item.source_version_id = ps.latest_version_id
            ORDER BY live_upload.completed_at DESC, bundle_item.source_bundle_id DESC
            LIMIT 1
          ) live ON TRUE
          WHERE ps.owner_id = $1 AND ps.project_id = $2 AND ps.removed_at IS NULL
        )
        SELECT chunk.id AS chunk_id, version.source_id,
               version.id AS source_version_id, live.source_bundle_id, live.snapshot_id,
               version.title,
               COALESCE(version.locator->>'relativePath', version.title) AS relative_path,
               chunk.ordinal AS chunk_ordinal, chunk.start_char, chunk.end_char,
               chunk.content_hash, chunk.heading_path,
               (
                 CASE
                   WHEN lower(COALESCE(version.locator->>'relativePath', version.title))
                     ~ '(^|/)(readme|index|overview|summary|项目说明|总览|目录)(\\.|/|$)'
                     THEN 0.04
                   ELSE 0.01
                 END
               )::double precision AS score
        FROM live_versions live
        JOIN learning_source_versions version
          ON version.owner_id = $1
         AND version.source_id = live.source_id
         AND version.id = live.latest_version_id
        JOIN learning_source_chunks chunk
          ON chunk.owner_id = version.owner_id
         AND chunk.source_id = version.source_id
         AND chunk.source_version_id = version.id
         AND chunk.index_version = 'markdown-lexical-v1'
         AND chunk.redacted_at IS NULL
         AND chunk.ordinal = 1
        JOIN learning_source_indexes source_index
          ON source_index.owner_id = version.owner_id
         AND source_index.source_id = version.source_id
         AND source_index.source_version_id = version.id
         AND source_index.index_version = chunk.index_version
         AND source_index.status = 'ready'
        ORDER BY score DESC, relative_path ASC
        LIMIT $4
      `,
      [ownerId, projectId, now, limit],
    )) as ChunkRow[];
    return rows.map((row) => candidate(row, true));
  }

  async listSourceChunks(
    ownerId: string,
    projectId: string,
    now: Date,
    sourceIds: string[],
    limitPerSource: number,
  ): Promise<ProjectChunkCandidate[]> {
    if (sourceIds.length === 0) return [];
    const rows = (await getLearningSql().query(
      `
        WITH live_versions AS MATERIALIZED (
          SELECT ps.source_id, ps.latest_version_id,
                 live.source_bundle_id, live.snapshot_id
          FROM learning_project_sources ps
          JOIN LATERAL (
            SELECT bundle_item.source_bundle_id, bundle_item.snapshot_id
            FROM source_bundle_items bundle_item
            JOIN source_uploads live_upload
              ON live_upload.owner_id = bundle_item.owner_id
             AND live_upload.id = bundle_item.source_bundle_id
             AND live_upload.status = 'validated'
             AND live_upload.retention_until > $3
            WHERE bundle_item.owner_id = ps.owner_id
              AND bundle_item.project_id = ps.project_id
              AND bundle_item.source_id = ps.source_id
              AND bundle_item.source_version_id = ps.latest_version_id
            ORDER BY live_upload.completed_at DESC, bundle_item.source_bundle_id DESC
            LIMIT 1
          ) live ON TRUE
          WHERE ps.owner_id = $1
            AND ps.project_id = $2
            AND ps.removed_at IS NULL
            AND ps.source_id = ANY($4::text[])
        ), ranked AS (
          SELECT chunk.id AS chunk_id, version.source_id,
                 version.id AS source_version_id, live.source_bundle_id, live.snapshot_id,
                 version.title,
                 COALESCE(version.locator->>'relativePath', version.title) AS relative_path,
                 chunk.ordinal AS chunk_ordinal, chunk.start_char, chunk.end_char,
                 chunk.content_hash, chunk.heading_path,
                 0::double precision AS score,
                 row_number() OVER (
                   PARTITION BY version.source_id ORDER BY chunk.ordinal ASC
                 ) AS source_rank
          FROM live_versions live
          JOIN learning_source_versions version
            ON version.owner_id = $1
           AND version.source_id = live.source_id
           AND version.id = live.latest_version_id
          JOIN learning_source_chunks chunk
            ON chunk.owner_id = version.owner_id
           AND chunk.source_id = version.source_id
           AND chunk.source_version_id = version.id
           AND chunk.index_version = 'markdown-lexical-v1'
           AND chunk.redacted_at IS NULL
          JOIN learning_source_indexes source_index
            ON source_index.owner_id = version.owner_id
           AND source_index.source_id = version.source_id
           AND source_index.source_version_id = version.id
           AND source_index.index_version = chunk.index_version
           AND source_index.status = 'ready'
        )
        SELECT chunk_id, source_id, source_version_id, source_bundle_id, snapshot_id,
               title, relative_path, chunk_ordinal, start_char, end_char, content_hash,
               heading_path, score
        FROM ranked
        WHERE source_rank <= $5
        ORDER BY relative_path ASC, chunk_ordinal ASC
      `,
      [ownerId, projectId, now, sourceIds, limitPerSource],
    )) as ChunkRow[];
    return rows.map((row) => candidate(row, false));
  }

  async saveRun(run: SaveProjectRetrievalRun): Promise<boolean> {
    const items = run.citations.map((citation, index) => ({
      ordinal: index + 1,
      citation_id: citation.citationId,
      source_chunk_id: citation.chunkId,
      source_id: citation.sourceId,
      source_version_id: citation.sourceVersionId,
      source_bundle_id: citation.sourceBundleId,
      snapshot_id: citation.snapshotId,
      score: citation.score,
      locator_snapshot: {
        title: citation.title,
        relativePath: citation.relativePath,
        headingPath: citation.headingPath,
        chunkOrdinal: citation.chunkOrdinal,
        matchedTerms: citation.matchedTerms,
        selectionReason: citation.selectionReason,
      },
      quoted_hash: citation.contentHash,
      selected_char_count: citation.excerptChars,
    }));
    const rows = (await getLearningSql().query(
      `
        WITH inserted_run AS (
          INSERT INTO project_retrieval_runs
            (id, owner_id, project_id, project_revision, anchor_bundle_id, goal,
             goal_hash, strategy, max_context_chars, context_char_count,
             candidate_chunk_count, selected_chunk_count, selected_source_count,
             metrics, created_at)
          SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
                 $14::jsonb, $15
          FROM learning_projects project
          WHERE project.owner_id = $2 AND project.id = $3
            AND project.status = 'active' AND project.project_revision = $4
             AND (
               $5::text IS NULL OR EXISTS (
                 SELECT 1
                 FROM source_uploads upload
                WHERE upload.owner_id = $2 AND upload.id = $5
                   AND upload.project_id = $3 AND upload.status = 'validated'
               )
             )
             AND jsonb_array_length($16::jsonb) = $12
           ON CONFLICT (id) DO NOTHING
           RETURNING id, owner_id
         ), inserted_items AS (
          INSERT INTO project_retrieval_items
            (owner_id, retrieval_run_id, ordinal, citation_id, source_chunk_id,
             source_id, source_version_id, source_bundle_id, snapshot_id, score,
             locator_snapshot, quoted_hash, selected_char_count, created_at)
          SELECT $2, inserted_run.id, item.ordinal, item.citation_id,
                 item.source_chunk_id, item.source_id, item.source_version_id,
                 item.source_bundle_id, item.snapshot_id, item.score,
                 item.locator_snapshot, item.quoted_hash, item.selected_char_count, $15
          FROM inserted_run
          CROSS JOIN jsonb_to_recordset($16::jsonb) AS item(
            ordinal integer,
            citation_id text,
            source_chunk_id text,
            source_id text,
            source_version_id text,
            source_bundle_id text,
            snapshot_id text,
            score double precision,
            locator_snapshot jsonb,
            quoted_hash text,
            selected_char_count integer
           )
           RETURNING retrieval_run_id
         ), audited AS (
           INSERT INTO learning_audit_events
             (id, owner_id, device_id, event_type, metadata, created_at)
           SELECT 'aud_' || replace(gen_random_uuid()::text, '-', ''), $2, NULL,
                  'project.retrieval_completed',
                  jsonb_build_object(
                    'retrievalRunId', inserted_run.id,
                    'projectId', $3::text,
                    'projectRevision', $4::bigint,
                    'selectedChunkCount', $12::integer,
                   'selectedSourceCount', $13::integer,
                   'strategy', $8::text
                  ),
                  $15
           FROM inserted_run
           RETURNING owner_id
         )
        SELECT owner_id FROM audited
      `,
      [
        run.id,
        run.ownerId,
        run.projectId,
        run.projectRevision,
        run.anchorBundleId ?? null,
        run.goal,
        run.goalHash,
        run.strategy,
        run.maxContextChars,
        run.contextCharCount,
        run.candidateChunkCount,
        run.selectedChunkCount,
        run.selectedSourceCount,
        JSON.stringify(run.metrics),
        run.createdAt,
        JSON.stringify(items),
      ],
    )) as Array<{ owner_id: string }>;
    return Boolean(rows[0]);
  }
}
