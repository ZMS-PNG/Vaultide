import type {
  KnowledgeGraphRefreshRequestRecord,
  KnowledgeGraphRefreshQueueStatus,
  KnowledgeGraphRefreshTriggerKind,
} from '../../domain/knowledge-graph-refresh';
import type {
  CompleteKnowledgeGraphRefreshInput,
  EnqueueKnowledgeGraphRefreshInput,
  KnowledgeGraphRefreshRepository,
} from '../../ports/knowledge-graph-refresh-repository';
import { getLearningSql } from './client';

interface RefreshRow {
  id: string;
  owner_id: string;
  dedupe_key: string;
  trigger_kind: KnowledgeGraphRefreshTriggerKind;
  trigger_id: string;
  classroom_id: string | null;
  project_id: string | null;
  synthesis_id: string | null;
  source_version_id: string | null;
  state: KnowledgeGraphRefreshRequestRecord['state'];
  attempt_count: number;
  available_at: string;
  lease_expires_at: string | null;
  error_detail: string | null;
  result: unknown;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

function record(row: RefreshRow): KnowledgeGraphRefreshRequestRecord {
  const result =
    row.result && typeof row.result === 'object' && !Array.isArray(row.result)
      ? (row.result as Record<string, unknown>)
      : {};
  return {
    id: row.id,
    ownerId: row.owner_id,
    dedupeKey: row.dedupe_key,
    triggerKind: row.trigger_kind,
    triggerId: row.trigger_id,
    ...(row.classroom_id ? { classroomId: row.classroom_id } : {}),
    ...(row.project_id ? { projectId: row.project_id } : {}),
    ...(row.synthesis_id ? { synthesisId: row.synthesis_id } : {}),
    ...(row.source_version_id ? { sourceVersionId: row.source_version_id } : {}),
    state: row.state,
    attemptCount: Number(row.attempt_count),
    availableAt: new Date(row.available_at),
    ...(row.lease_expires_at ? { leaseExpiresAt: new Date(row.lease_expires_at) } : {}),
    ...(row.error_detail ? { errorDetail: row.error_detail } : {}),
    result: {
      synthesisIds: Array.isArray(result.synthesisIds)
        ? result.synthesisIds.filter((value): value is string => typeof value === 'string')
        : [],
      projectionIds: Array.isArray(result.projectionIds)
        ? result.projectionIds.filter((value): value is string => typeof value === 'string')
        : [],
    },
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    ...(row.completed_at ? { completedAt: new Date(row.completed_at) } : {}),
  };
}

const REFRESH_COLUMNS = `
  id, owner_id, dedupe_key, trigger_kind, trigger_id, classroom_id,
  project_id, synthesis_id, source_version_id, state, attempt_count,
  available_at, lease_expires_at, error_detail, result, created_at,
  updated_at, completed_at
`;

export class NeonKnowledgeGraphRefreshRepository implements KnowledgeGraphRefreshRepository {
  async enqueue(
    input: EnqueueKnowledgeGraphRefreshInput,
  ): Promise<{ record: KnowledgeGraphRefreshRequestRecord; enqueued: boolean }> {
    const inserted = (await getLearningSql().query(
      `
        INSERT INTO knowledge_graph_refresh_requests
          (id, owner_id, dedupe_key, trigger_kind, trigger_id, classroom_id,
           project_id, synthesis_id, source_version_id, state, attempt_count,
           available_at, result, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending', 0, $10, '{}'::jsonb, $10, $10)
        ON CONFLICT (owner_id, dedupe_key) DO NOTHING
        RETURNING ${REFRESH_COLUMNS}
      `,
      [
        input.id,
        input.ownerId,
        input.dedupeKey,
        input.triggerKind,
        input.triggerId,
        input.classroomId ?? null,
        input.projectId ?? null,
        input.synthesisId ?? null,
        input.sourceVersionId ?? null,
        input.now,
      ],
    )) as RefreshRow[];
    if (inserted[0]) return { record: record(inserted[0]), enqueued: true };

    const existing = (await getLearningSql().query(
      `
        SELECT ${REFRESH_COLUMNS}
        FROM knowledge_graph_refresh_requests
        WHERE owner_id = $1 AND dedupe_key = $2
        LIMIT 1
      `,
      [input.ownerId, input.dedupeKey],
    )) as RefreshRow[];
    if (!existing[0]) throw new Error('knowledge_graph_refresh_enqueue_conflict');
    return { record: record(existing[0]), enqueued: false };
  }

  async claimPending(
    ownerId: string,
    now: Date,
    leaseExpiresAt: Date,
    limit: number,
  ): Promise<KnowledgeGraphRefreshRequestRecord[]> {
    const rows = (await getLearningSql().query(
      `
        WITH candidates AS (
          SELECT id
          FROM knowledge_graph_refresh_requests
          WHERE owner_id = $1
            AND attempt_count < 5
            AND (
              (state IN ('pending', 'failed') AND available_at <= $2)
              OR (state = 'processing' AND lease_expires_at < $2)
            )
          ORDER BY available_at ASC, created_at ASC
          FOR UPDATE SKIP LOCKED
          LIMIT $4
        )
        UPDATE knowledge_graph_refresh_requests request
        SET state = 'processing',
            attempt_count = request.attempt_count + 1,
            lease_expires_at = $3,
            error_detail = NULL,
            updated_at = $2
        FROM candidates
        WHERE request.owner_id = $1 AND request.id = candidates.id
        RETURNING request.id, request.owner_id, request.dedupe_key,
                  request.trigger_kind, request.trigger_id, request.classroom_id,
                  request.project_id, request.synthesis_id, request.source_version_id,
                  request.state, request.attempt_count, request.available_at,
                  request.lease_expires_at, request.error_detail, request.result,
                  request.created_at, request.updated_at, request.completed_at
      `,
      [ownerId, now, leaseExpiresAt, limit],
    )) as RefreshRow[];
    return rows.map(record);
  }

  async findAffectedSynthesisIds(
    ownerId: string,
    request: KnowledgeGraphRefreshRequestRecord,
    limit: number,
  ): Promise<string[]> {
    const rows = (await getLearningSql().query(
      `
        WITH matching AS (
          SELECT run.id, run.created_at,
                 row_number() OVER (
                   PARTITION BY COALESCE(
                     run.schedule_id,
                     'manual:' || run.mode || ':' || md5(run.scope::text)
                   )
                   ORDER BY run.created_at DESC, run.id DESC
                 ) AS freshness
          FROM synthesis_runs run
          WHERE run.owner_id = $1
            AND (
              ($2::text IS NOT NULL AND run.id = $2)
              OR (
                $2::text IS NULL
                AND (
                  ($3::text IS NOT NULL AND (
                    COALESCE(run.scope -> 'classroomIds', '[]'::jsonb) ? $3
                    OR EXISTS (
                      SELECT 1
                      FROM jsonb_array_elements(COALESCE(run.graph -> 'nodes', '[]'::jsonb)) node
                      WHERE node ->> 'classroomId' = $3
                    )
                  ))
                  OR ($4::text IS NOT NULL AND (
                    run.project_id = $4
                    OR COALESCE(run.scope -> 'projectIds', '[]'::jsonb) ? $4
                    OR EXISTS (
                      SELECT 1
                      FROM jsonb_array_elements(COALESCE(run.graph -> 'nodes', '[]'::jsonb)) node
                      WHERE node ->> 'projectId' = $4
                    )
                  ))
                )
              )
            )
        )
        SELECT id
        FROM matching
        WHERE freshness = 1
        ORDER BY created_at DESC, id DESC
        LIMIT $5
      `,
      [
        ownerId,
        request.synthesisId ?? null,
        request.classroomId ?? null,
        request.projectId ?? null,
        limit,
      ],
    )) as Array<{ id: string }>;
    return rows.map((row) => row.id);
  }

  async queueStatus(ownerId: string): Promise<KnowledgeGraphRefreshQueueStatus> {
    const rows = (await getLearningSql().query(
      `
        SELECT
          COUNT(*) FILTER (WHERE state = 'pending')::integer AS pending,
          COUNT(*) FILTER (WHERE state = 'processing')::integer AS processing,
          COUNT(*) FILTER (WHERE state = 'failed')::integer AS failed,
          COUNT(*) FILTER (WHERE state = 'succeeded')::integer AS succeeded,
          COUNT(*) FILTER (WHERE state = 'skipped')::integer AS skipped,
          COUNT(*) FILTER (
            WHERE attempt_count >= 5 AND state IN ('pending', 'processing', 'failed')
          )::integer AS exhausted,
          MIN(available_at) FILTER (
            WHERE state IN ('pending', 'processing', 'failed') AND attempt_count < 5
          ) AS oldest_available_at
        FROM knowledge_graph_refresh_requests
        WHERE owner_id = $1
      `,
      [ownerId],
    )) as Array<{
      pending: number;
      processing: number;
      failed: number;
      succeeded: number;
      skipped: number;
      exhausted: number;
      oldest_available_at: string | null;
    }>;
    const row = rows[0];
    return {
      pending: Number(row?.pending ?? 0),
      processing: Number(row?.processing ?? 0),
      failed: Number(row?.failed ?? 0),
      succeeded: Number(row?.succeeded ?? 0),
      skipped: Number(row?.skipped ?? 0),
      exhausted: Number(row?.exhausted ?? 0),
      ...(row?.oldest_available_at ? { oldestAvailableAt: new Date(row.oldest_available_at) } : {}),
    };
  }

  async complete(input: CompleteKnowledgeGraphRefreshInput): Promise<void> {
    await getLearningSql().query(
      `
        UPDATE knowledge_graph_refresh_requests
        SET state = $3,
            result = $4::jsonb,
            error_detail = $5,
            available_at = COALESCE($6, available_at),
            lease_expires_at = NULL,
            completed_at = CASE
              WHEN $3 IN ('succeeded', 'skipped') THEN $7::timestamptz
              ELSE NULL::timestamptz
            END,
            updated_at = $7
        WHERE owner_id = $1 AND id = $2 AND state = 'processing'
      `,
      [
        input.ownerId,
        input.requestId,
        input.state,
        JSON.stringify({
          synthesisIds: input.synthesisIds,
          projectionIds: input.projectionIds,
        }),
        input.errorDetail ?? null,
        input.retryAt ?? null,
        input.now,
      ],
    );
  }
}
