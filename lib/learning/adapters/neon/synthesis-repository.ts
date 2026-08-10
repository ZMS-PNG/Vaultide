import type { JsonObject } from '@openmaic/learning-protocol';
import type {
  KnowledgeGraph,
  SaveSynthesisRunInput,
  SynthesisClassroomRecord,
  SynthesisDelta,
  SynthesisEvidenceFingerprint,
  SynthesisMode,
  SynthesisResearchSource,
  SynthesisScheduleRecord,
  SynthesisScheduleRunRecord,
  SynthesisRunRecord,
  SynthesisScope,
  SynthesisTaskCandidate,
} from '../../domain/synthesis';
import type {
  ClaimSynthesisScheduleRunInput,
  CompleteSynthesisScheduleRunInput,
  CreateSynthesisScheduleInput,
  SynthesisRepository,
  UpdateSynthesisScheduleInput,
} from '../../ports/synthesis-repository';
import { getLearningSql } from './client';

interface SynthesisRow {
  id: string;
  owner_id: string;
  project_id: string | null;
  project_name: string | null;
  mode: SynthesisMode;
  title: string;
  scope: SynthesisScope;
  summary_markdown: string;
  graph: KnowledgeGraph;
  graph_hash: string;
  classroom_count: number;
  schedule_id?: string | null;
  baseline_synthesis_id?: string | null;
  incremental?: boolean | null;
  evidence_manifest?: unknown;
  delta?: unknown;
  task_candidates?: unknown;
  created_at: string;
  updated_at: string;
}

interface ScheduleRow {
  id: string;
  owner_id: string;
  name: string;
  period_kind: SynthesisScheduleRecord['period'];
  interval_minutes: number;
  timezone: string;
  mode: SynthesisMode;
  scope: SynthesisScope;
  scope_hash: string;
  status: SynthesisScheduleRecord['status'];
  next_run_at: string;
  last_success_at: string | null;
  last_synthesis_id: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

interface ScheduleRunRow {
  id: string;
  owner_id: string;
  schedule_id: string;
  scheduled_for: string;
  state: SynthesisScheduleRunRecord['state'];
  synthesis_id: string | null;
  baseline_synthesis_id: string | null;
  evidence_manifest: unknown;
  error_detail: string | null;
  started_at: string;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

function evidenceManifest(value: unknown): SynthesisEvidenceFingerprint[] {
  return Array.isArray(value) ? (value as SynthesisEvidenceFingerprint[]) : [];
}

function taskCandidates(value: unknown): SynthesisTaskCandidate[] {
  return Array.isArray(value) ? (value as SynthesisTaskCandidate[]) : [];
}

function delta(value: unknown): SynthesisDelta | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as SynthesisDelta)
    : undefined;
}

function synthesis(row: SynthesisRow): SynthesisRunRecord {
  return {
    id: row.id,
    ownerId: row.owner_id,
    ...(row.schedule_id ? { scheduleId: row.schedule_id } : {}),
    projectId: row.project_id ?? undefined,
    projectName: row.project_name ?? undefined,
    mode: row.mode,
    title: row.title,
    scope: row.scope,
    summaryMarkdown: row.summary_markdown,
    graph: row.graph,
    graphHash: row.graph_hash,
    classroomCount: row.classroom_count,
    ...(row.baseline_synthesis_id ? { baselineSynthesisId: row.baseline_synthesis_id } : {}),
    incremental: row.incremental === true,
    evidenceManifest: evidenceManifest(row.evidence_manifest),
    ...(delta(row.delta) ? { delta: delta(row.delta) } : {}),
    taskCandidates: taskCandidates(row.task_candidates),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

function schedule(row: ScheduleRow): SynthesisScheduleRecord {
  return {
    id: row.id,
    ownerId: row.owner_id,
    name: row.name,
    period: row.period_kind,
    ...(row.period_kind === 'custom' ? { intervalMinutes: row.interval_minutes } : {}),
    timezone: row.timezone,
    mode: row.mode,
    scope: row.scope,
    scopeHash: row.scope_hash,
    status: row.status,
    nextRunAt: new Date(row.next_run_at),
    ...(row.last_success_at ? { lastSuccessAt: new Date(row.last_success_at) } : {}),
    ...(row.last_synthesis_id ? { lastSynthesisId: row.last_synthesis_id } : {}),
    ...(row.last_error ? { lastError: row.last_error } : {}),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

function scheduleRun(row: ScheduleRunRow): SynthesisScheduleRunRecord {
  return {
    id: row.id,
    ownerId: row.owner_id,
    scheduleId: row.schedule_id,
    scheduledFor: new Date(row.scheduled_for),
    state: row.state,
    ...(row.synthesis_id ? { synthesisId: row.synthesis_id } : {}),
    ...(row.baseline_synthesis_id ? { baselineSynthesisId: row.baseline_synthesis_id } : {}),
    evidenceManifest: evidenceManifest(row.evidence_manifest),
    ...(row.error_detail ? { errorDetail: row.error_detail } : {}),
    startedAt: new Date(row.started_at),
    ...(row.completed_at ? { completedAt: new Date(row.completed_at) } : {}),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

export class NeonSynthesisRepository implements SynthesisRepository {
  async listClassroomInputs(ownerId: string, limit: number): Promise<SynthesisClassroomRecord[]> {
    const rows = (await getLearningSql().query(
      `
        SELECT lc.classroom_id, lc.created_at, lc.updated_at,
               s.id AS sprint_id, s.source_bundle_id, s.research_run_id,
               s.project_id, p.display_name AS project_name, s.project_revision,
               COALESCE(s.goal, '') AS goal,
               COALESCE(events.active_learning_event_count, 0)::integer
                 AS active_learning_event_count,
               COALESCE(events.practice_payloads, '[]'::jsonb) AS practice_payloads,
               COALESCE(sources.items, '[]'::jsonb) AS research_sources
        FROM learning_classrooms lc
        LEFT JOIN learning_sprints s
          ON s.owner_id = lc.owner_id AND s.classroom_id = lc.classroom_id
        LEFT JOIN learning_projects p
          ON p.owner_id = s.owner_id AND p.id = s.project_id
        LEFT JOIN LATERAL (
          SELECT COUNT(*) FILTER (WHERE e.event_type IN (
                   'diagnosisAnswered', 'retrievalAttempted', 'explanationSubmitted',
                   'practiceSubmitted', 'whiteboardNoteAdded', 'discussionParticipated',
                   'evidenceSubmitted', 'evidenceEvaluated', 'transferTaskCompleted',
                   'reviewCompleted'
                 ))::integer AS active_learning_event_count,
                 COALESCE(
                   jsonb_agg(e.payload ORDER BY e.server_seq)
                     FILTER (WHERE e.event_type = 'practiceSubmitted'),
                   '[]'::jsonb
                 ) AS practice_payloads
          FROM learning_events e
          WHERE e.owner_id = lc.owner_id AND e.sprint_id = s.id
        ) events ON TRUE
        LEFT JOIN LATERAL (
          SELECT jsonb_agg(
                   jsonb_build_object(
                     'citationId', rs.citation_id,
                     'title', rs.title,
                     'url', rs.url,
                     'domain', rs.domain,
                     'authority', rs.authority,
                     'score', rs.score
                   ) ORDER BY rs.ordinal
                 ) AS items
          FROM research_sources rs
          WHERE rs.owner_id = lc.owner_id AND rs.run_id = s.research_run_id
        ) sources ON TRUE
        WHERE lc.owner_id = $1
        ORDER BY lc.created_at DESC
        LIMIT $2
      `,
      [ownerId, limit],
    )) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      classroomId: String(row.classroom_id),
      sprintId: typeof row.sprint_id === 'string' ? row.sprint_id : undefined,
      projectId: typeof row.project_id === 'string' ? row.project_id : undefined,
      projectName: typeof row.project_name === 'string' ? row.project_name : undefined,
      projectRevision:
        row.project_revision === null || row.project_revision === undefined
          ? undefined
          : Number(row.project_revision),
      sourceBundleId: typeof row.source_bundle_id === 'string' ? row.source_bundle_id : undefined,
      researchRunId: typeof row.research_run_id === 'string' ? row.research_run_id : undefined,
      goal: String(row.goal ?? ''),
      createdAt: new Date(String(row.created_at)),
      updatedAt: new Date(String(row.updated_at)),
      activeLearningEventCount: Number(row.active_learning_event_count ?? 0),
      practicePayloads: Array.isArray(row.practice_payloads)
        ? (row.practice_payloads as JsonObject[])
        : [],
      researchSources: Array.isArray(row.research_sources)
        ? (row.research_sources as SynthesisResearchSource[])
        : [],
    }));
  }

  async save(input: SaveSynthesisRunInput): Promise<SynthesisRunRecord> {
    const rows = (await getLearningSql().query(
      `
        WITH inserted AS (
          INSERT INTO synthesis_runs
            (id, owner_id, project_id, mode, title, scope, summary_markdown, graph, graph_hash,
             classroom_count, node_count, edge_count, schedule_id, baseline_synthesis_id,
             incremental, evidence_manifest, delta, task_candidates, created_at, updated_at)
          VALUES (
            $1, $2,
            (SELECT id FROM learning_projects WHERE id = $3 AND owner_id = $2),
            $4, $5, $6::jsonb, $7, $8::jsonb, $9,
            $10, $11, $12, $13, $14, $15, $16::jsonb, $17::jsonb, $18::jsonb, $19, $19
          )
          RETURNING id, owner_id, project_id, mode, title, scope, summary_markdown, graph,
                    graph_hash, classroom_count, schedule_id, baseline_synthesis_id, incremental,
                    evidence_manifest, delta, task_candidates, created_at, updated_at
        )
         SELECT i.id, i.owner_id, i.project_id, p.display_name AS project_name,
                  i.mode, i.title, i.scope, i.summary_markdown, i.graph,
                 i.graph_hash, i.classroom_count, i.schedule_id, i.baseline_synthesis_id,
                 i.incremental, i.evidence_manifest, i.delta, i.task_candidates,
                 i.created_at, i.updated_at
        FROM inserted i
        LEFT JOIN learning_projects p
          ON p.owner_id = i.owner_id AND p.id = i.project_id
      `,
      [
        input.id,
        input.ownerId,
        input.projectId ?? null,
        input.mode,
        input.title,
        JSON.stringify(input.scope),
        input.summaryMarkdown,
        JSON.stringify(input.graph),
        input.graphHash,
        input.classroomCount,
        input.graph.nodes.length,
        input.graph.edges.length,
        input.scheduleId ?? null,
        input.baselineSynthesisId ?? null,
        input.incremental,
        JSON.stringify(input.evidenceManifest),
        input.delta ? JSON.stringify(input.delta) : null,
        JSON.stringify(input.taskCandidates),
        input.createdAt,
      ],
    )) as SynthesisRow[];
    if (!rows[0]) throw new Error('synthesis_run_not_created');
    return synthesis(rows[0]);
  }

  async find(ownerId: string, synthesisId: string): Promise<SynthesisRunRecord | null> {
    const rows = (await getLearningSql().query(
      `
        SELECT s.id, s.owner_id, s.project_id, p.display_name AS project_name,
               s.mode, s.title, s.scope, s.summary_markdown, s.graph,
               s.graph_hash, s.classroom_count, s.schedule_id, s.baseline_synthesis_id,
               s.incremental, s.evidence_manifest, s.delta, s.task_candidates,
               s.created_at, s.updated_at
        FROM synthesis_runs s
        LEFT JOIN learning_projects p
          ON p.owner_id = s.owner_id AND p.id = s.project_id
        WHERE s.owner_id = $1 AND s.id = $2
      `,
      [ownerId, synthesisId],
    )) as SynthesisRow[];
    return rows[0] ? synthesis(rows[0]) : null;
  }

  async list(ownerId: string, limit: number): Promise<SynthesisRunRecord[]> {
    const rows = (await getLearningSql().query(
      `
        SELECT s.id, s.owner_id, s.project_id, p.display_name AS project_name,
               s.mode, s.title, s.scope, s.summary_markdown, s.graph,
               s.graph_hash, s.classroom_count, s.schedule_id, s.baseline_synthesis_id,
               s.incremental, s.evidence_manifest, s.delta, s.task_candidates,
               s.created_at, s.updated_at
        FROM synthesis_runs s
        LEFT JOIN learning_projects p
          ON p.owner_id = s.owner_id AND p.id = s.project_id
        WHERE s.owner_id = $1
        ORDER BY s.created_at DESC
        LIMIT $2
      `,
      [ownerId, limit],
    )) as SynthesisRow[];
    return rows.map(synthesis);
  }

  async listBySchedule(
    ownerId: string,
    scheduleId: string,
    limit: number,
  ): Promise<SynthesisRunRecord[]> {
    const rows = (await getLearningSql().query(
      `
        SELECT s.id, s.owner_id, s.project_id, p.display_name AS project_name,
               s.mode, s.title, s.scope, s.summary_markdown, s.graph,
               s.graph_hash, s.classroom_count, s.schedule_id, s.baseline_synthesis_id,
               s.incremental, s.evidence_manifest, s.delta, s.task_candidates,
               s.created_at, s.updated_at
        FROM synthesis_runs s
        LEFT JOIN learning_projects p
          ON p.owner_id = s.owner_id AND p.id = s.project_id
        WHERE s.owner_id = $1 AND s.schedule_id = $2
        ORDER BY s.created_at DESC
        LIMIT $3
      `,
      [ownerId, scheduleId, limit],
    )) as SynthesisRow[];
    return rows.map(synthesis);
  }

  async createSchedule(input: CreateSynthesisScheduleInput): Promise<SynthesisScheduleRecord> {
    const rows = (await getLearningSql().query(
      `
        INSERT INTO synthesis_schedules
          (id, owner_id, name, period_kind, interval_minutes, timezone, mode, scope, scope_hash,
           status, next_run_at, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, 'active', $10, $11, $11)
        ON CONFLICT (owner_id, scope_hash, period_kind, interval_minutes) DO UPDATE
        SET updated_at = synthesis_schedules.updated_at
        RETURNING id, owner_id, name, period_kind, interval_minutes, timezone, mode, scope,
                  scope_hash, status, next_run_at, last_success_at, last_synthesis_id, last_error,
                  created_at, updated_at
      `,
      [
        input.id,
        input.ownerId,
        input.name,
        input.period,
        input.period === 'custom' ? input.intervalMinutes ?? 60 : 0,
        input.timezone,
        input.mode,
        JSON.stringify(input.scope),
        input.scopeHash,
        input.nextRunAt,
        input.now,
      ],
    )) as ScheduleRow[];
    const row = rows[0];
    if (!row) throw new Error('synthesis_schedule_not_created');
    return schedule(row);
  }

  async findSchedule(ownerId: string, scheduleId: string): Promise<SynthesisScheduleRecord | null> {
    const rows = (await getLearningSql().query(
      `
        SELECT id, owner_id, name, period_kind, interval_minutes, timezone, mode, scope,
               scope_hash, status, next_run_at, last_success_at, last_synthesis_id, last_error,
               created_at, updated_at
        FROM synthesis_schedules
        WHERE owner_id = $1 AND id = $2
      `,
      [ownerId, scheduleId],
    )) as ScheduleRow[];
    return rows[0] ? schedule(rows[0]) : null;
  }

  async listSchedules(ownerId: string, limit: number): Promise<SynthesisScheduleRecord[]> {
    const rows = (await getLearningSql().query(
      `
        SELECT id, owner_id, name, period_kind, interval_minutes, timezone, mode, scope,
               scope_hash, status, next_run_at, last_success_at, last_synthesis_id, last_error,
               created_at, updated_at
        FROM synthesis_schedules
        WHERE owner_id = $1
        ORDER BY status ASC, next_run_at ASC, created_at DESC
        LIMIT $2
      `,
      [ownerId, limit],
    )) as ScheduleRow[];
    return rows.map(schedule);
  }

  async updateSchedule(
    input: UpdateSynthesisScheduleInput,
  ): Promise<SynthesisScheduleRecord | null> {
    const rows = (await getLearningSql().query(
      `
        UPDATE synthesis_schedules
        SET name = $3,
            period_kind = $4,
            interval_minutes = $5,
            timezone = $6,
            mode = $7,
            scope = $8::jsonb,
            scope_hash = $9,
            status = $10,
            next_run_at = $11,
            last_error = CASE WHEN $10 = 'active' THEN NULL ELSE last_error END,
            updated_at = $12
        WHERE owner_id = $1 AND id = $2
        RETURNING id, owner_id, name, period_kind, interval_minutes, timezone, mode, scope,
                  scope_hash, status, next_run_at, last_success_at, last_synthesis_id, last_error,
                  created_at, updated_at
      `,
      [
        input.ownerId,
        input.scheduleId,
        input.name,
        input.period,
        input.period === 'custom' ? input.intervalMinutes ?? 60 : 0,
        input.timezone,
        input.mode,
        JSON.stringify(input.scope),
        input.scopeHash,
        input.status,
        input.nextRunAt,
        input.now,
      ],
    )) as ScheduleRow[];
    return rows[0] ? schedule(rows[0]) : null;
  }

  async listDueSchedules(
    ownerId: string,
    now: Date,
    limit: number,
  ): Promise<SynthesisScheduleRecord[]> {
    const rows = (await getLearningSql().query(
      `
        SELECT id, owner_id, name, period_kind, interval_minutes, timezone, mode, scope,
               scope_hash, status, next_run_at, last_success_at, last_synthesis_id, last_error,
               created_at, updated_at
        FROM synthesis_schedules
        WHERE owner_id = $1 AND status = 'active' AND next_run_at <= $2
        ORDER BY next_run_at ASC
        LIMIT $3
      `,
      [ownerId, now, limit],
    )) as ScheduleRow[];
    return rows.map(schedule);
  }

  async claimScheduleRun(
    input: ClaimSynthesisScheduleRunInput,
  ): Promise<SynthesisScheduleRunRecord | null> {
    const rows = (await getLearningSql().query(
      `
        INSERT INTO synthesis_schedule_runs
          (id, owner_id, schedule_id, scheduled_for, state, evidence_manifest,
           started_at, created_at, updated_at)
        VALUES ($1, $2, $3, $4, 'running', '[]'::jsonb, $5, $5, $5)
        ON CONFLICT (owner_id, schedule_id, scheduled_for) DO UPDATE
        SET state = 'running',
            error_detail = NULL,
            started_at = EXCLUDED.started_at,
            completed_at = NULL,
            updated_at = EXCLUDED.updated_at
        WHERE synthesis_schedule_runs.state = 'failed'
        RETURNING id, owner_id, schedule_id, scheduled_for, state, synthesis_id,
                  baseline_synthesis_id, evidence_manifest, error_detail, started_at,
                  completed_at, created_at, updated_at
      `,
      [input.id, input.ownerId, input.scheduleId, input.scheduledFor, input.now],
    )) as ScheduleRunRow[];
    return rows[0] ? scheduleRun(rows[0]) : null;
  }

  async completeScheduleRun(input: CompleteSynthesisScheduleRunInput): Promise<void> {
    await getLearningSql().query(
      `
        UPDATE synthesis_schedule_runs
        SET state = $4,
            synthesis_id = $5,
            baseline_synthesis_id = $6,
            evidence_manifest = $7::jsonb,
            error_detail = $8,
            completed_at = $9,
            updated_at = $9
        WHERE owner_id = $1 AND schedule_id = $2 AND id = $3 AND state = 'running'
      `,
      [
        input.ownerId,
        input.schedule.id,
        input.runId,
        input.state,
        input.synthesisId ?? null,
        input.baselineSynthesisId ?? null,
        JSON.stringify(input.evidenceManifest),
        input.errorDetail ?? null,
        input.now,
      ],
    );
    if (input.state === 'failed') {
      await getLearningSql().query(
        `
          UPDATE synthesis_schedules
          SET last_error = $3, updated_at = $4
          WHERE owner_id = $1 AND id = $2 AND status = 'active'
        `,
        [input.ownerId, input.schedule.id, input.errorDetail ?? 'Synthesis schedule failed.', input.now],
      );
      return;
    }
    await getLearningSql().query(
      `
        UPDATE synthesis_schedules
        SET last_success_at = $3,
            last_synthesis_id = COALESCE($4, last_synthesis_id),
            last_error = NULL,
            next_run_at = $5,
            updated_at = $3
        WHERE owner_id = $1 AND id = $2 AND status = 'active'
      `,
      [input.ownerId, input.schedule.id, input.now, input.synthesisId ?? null, input.nextRunAt ?? input.now],
    );
  }
}
