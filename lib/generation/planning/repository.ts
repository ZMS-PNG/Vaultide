import { randomBytes, randomUUID } from 'node:crypto';
import { getLearningSql } from '@/lib/learning/adapters/neon/client';
import type { CompiledLearningContextPack } from '@/lib/learning/domain/learning-context-pack';
import type { SceneOutline } from '@/lib/types/generation';
import type {
  CoursePlanningInput,
  CoursePlanningLease,
  CoursePlanningModelPreference,
  CoursePlanningRunRecord,
} from './types';
import type { CoursePlanningPreflight } from './preflight';

interface PlanningRow {
  id: string;
  owner_id: string;
  session_id: string;
  context_pack_id: string;
  idempotency_key: string;
  status: CoursePlanningRunRecord['status'];
  source_mode: CoursePlanningInput['sourceMode'];
  requirements_json: CoursePlanningInput['requirements'];
  source_references_json: CoursePlanningInput['sourceReferences'];
  generation_model_json: CoursePlanningModelPreference | null;
  document_text: string;
  research_text: string;
  source_context_expected_chars: number;
  preflight_json: CoursePlanningPreflight;
  outline_json: SceneOutline[] | null;
  language_directive: string | null;
  course_title: string | null;
  task_engine_mode: boolean;
  attempt_count: number;
  max_attempts: number;
  lease_token: string | null;
  lease_expires_at: Date | string | null;
  last_error_code: string | null;
  last_error_detail: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  completed_at: Date | string | null;
  workflow_run_id: string | null;
  workflow_status: CoursePlanningRunRecord['workflowStatus'];
  workflow_phase: CoursePlanningRunRecord['workflowPhase'];
  workflow_started_at: Date | string | null;
  workflow_completed_at: Date | string | null;
}

export interface PlanningCourseJobSummary {
  id: string;
  classroomId: string;
  status: 'queued' | 'running' | 'verifying' | 'ready' | 'failed' | 'cancelled';
  phase: 'content' | 'actions' | 'release' | 'completed' | 'failed';
  progress: number;
  updatedAt: Date;
}

const PLAN_SELECT = `
  SELECT id, owner_id, session_id, context_pack_id, idempotency_key, status, source_mode,
         requirements_json, source_references_json, generation_model_json, document_text, research_text,
         source_context_expected_chars, preflight_json, outline_json, language_directive,
         course_title, task_engine_mode, attempt_count, max_attempts, lease_token,
         lease_expires_at, last_error_code, last_error_detail, created_at, updated_at,
         completed_at, workflow_run_id, workflow_status, workflow_phase,
         workflow_started_at, workflow_completed_at
  FROM course_planning_runs
`;

function id(prefix: 'lsn' | 'ctx' | 'cpl'): string {
  return `${prefix}_${randomBytes(16).toString('hex')}`;
}

function date(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function optionalDate(value: Date | string | null): Date | undefined {
  return value ? date(value) : undefined;
}

function safeGenerationModel(
  value: CoursePlanningModelPreference | null,
): CoursePlanningModelPreference | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const modelString = typeof value.modelString === 'string' ? value.modelString.trim() : '';
  if (modelString.length < 3 || modelString.length > 256) return undefined;
  return {
    modelString,
    ...(value.thinkingConfig && typeof value.thinkingConfig === 'object'
      ? { thinkingConfig: value.thinkingConfig }
      : {}),
  };
}

function mapRow(row: PlanningRow): CoursePlanningRunRecord {
  const leaseExpiresAt = optionalDate(row.lease_expires_at);
  const completedAt = optionalDate(row.completed_at);
  const workflowStartedAt = optionalDate(row.workflow_started_at);
  const workflowCompletedAt = optionalDate(row.workflow_completed_at);
  const generationModel = safeGenerationModel(row.generation_model_json);
  const storedRequirements = row.requirements_json as CoursePlanningInput['requirements'] & {
    planningClientSessionId?: string;
    planningSourceBundleId?: string;
    planningProjectId?: string;
    planningRetrievalRunId?: string;
  };
  return {
    id: row.id,
    ownerId: row.owner_id,
    sessionId: row.session_id,
    contextPackId: row.context_pack_id,
    idempotencyKey: row.idempotency_key,
    status: row.status,
    input: {
      clientSessionId: String(storedRequirements.planningClientSessionId ?? row.session_id),
      requirements: storedRequirements,
      sourceMode: row.source_mode,
      sourceReferences: Array.isArray(row.source_references_json) ? row.source_references_json : [],
      ...(generationModel ? { generationModel } : {}),
      documentText: row.document_text,
      researchText: row.research_text,
      sourceContextExpectedChars: row.source_context_expected_chars,
      ...(storedRequirements.planningSourceBundleId
        ? { sourceBundleId: storedRequirements.planningSourceBundleId }
        : {}),
      ...(storedRequirements.planningProjectId
        ? { projectId: storedRequirements.planningProjectId }
        : {}),
      ...(storedRequirements.planningRetrievalRunId
        ? { retrievalRunId: storedRequirements.planningRetrievalRunId }
        : {}),
    },
    preflight: row.preflight_json,
    ...(Array.isArray(row.outline_json) ? { outlines: row.outline_json } : {}),
    ...(row.language_directive ? { languageDirective: row.language_directive } : {}),
    ...(row.course_title ? { courseTitle: row.course_title } : {}),
    taskEngineMode: row.task_engine_mode,
    attemptCount: row.attempt_count,
    maxAttempts: row.max_attempts,
    ...(row.lease_token ? { leaseToken: row.lease_token } : {}),
    ...(leaseExpiresAt ? { leaseExpiresAt } : {}),
    ...(row.last_error_code ? { lastErrorCode: row.last_error_code } : {}),
    ...(row.last_error_detail ? { lastErrorDetail: row.last_error_detail } : {}),
    createdAt: date(row.created_at),
    updatedAt: date(row.updated_at),
    ...(completedAt ? { completedAt } : {}),
    ...(row.workflow_run_id ? { workflowRunId: row.workflow_run_id } : {}),
    workflowStatus: row.workflow_status,
    workflowPhase: row.workflow_phase,
    ...(workflowStartedAt ? { workflowStartedAt } : {}),
    ...(workflowCompletedAt ? { workflowCompletedAt } : {}),
  };
}

export class NeonCoursePlanningRepository {
  async findContextKnowledgeSnapshotId(
    ownerId: string,
    contextPackId: string,
  ): Promise<string | null> {
    const rows = (await getLearningSql().query(
      `
        SELECT knowledge_snapshot_id
        FROM learning_context_packs
        WHERE owner_id = $1 AND id = $2
      `,
      [ownerId, contextPackId],
    )) as Array<{ knowledge_snapshot_id: string | null }>;
    return rows[0]?.knowledge_snapshot_id ?? null;
  }

  async find(ownerId: string, planningRunId: string): Promise<CoursePlanningRunRecord | null> {
    const rows = (await getLearningSql().query(`${PLAN_SELECT} WHERE owner_id = $1 AND id = $2`, [
      ownerId,
      planningRunId,
    ])) as PlanningRow[];
    return rows[0] ? mapRow(rows[0]) : null;
  }

  async findByIdempotencyKey(
    ownerId: string,
    idempotencyKey: string,
  ): Promise<CoursePlanningRunRecord | null> {
    const rows = (await getLearningSql().query(
      `${PLAN_SELECT} WHERE owner_id = $1 AND idempotency_key = $2`,
      [ownerId, idempotencyKey],
    )) as PlanningRow[];
    return rows[0] ? mapRow(rows[0]) : null;
  }

  async findCourseJob(
    ownerId: string,
    planningRunId: string,
  ): Promise<PlanningCourseJobSummary | null> {
    const rows = (await getLearningSql().query(
      `
        SELECT id, classroom_id, status, current_phase, progress, updated_at
        FROM course_generation_jobs
        WHERE owner_id = $1 AND planning_run_id = $2
        LIMIT 1
      `,
      [ownerId, planningRunId],
    )) as Array<{
      id: string;
      classroom_id: string;
      status: PlanningCourseJobSummary['status'];
      current_phase: PlanningCourseJobSummary['phase'];
      progress: number;
      updated_at: Date | string;
    }>;
    const row = rows[0];
    return row
      ? {
          id: row.id,
          classroomId: row.classroom_id,
          status: row.status,
          phase: row.current_phase,
          progress: row.progress,
          updatedAt: date(row.updated_at),
        }
      : null;
  }

  async attachWorkflow(input: {
    ownerId: string;
    planningRunId: string;
    workflowRunId: string;
    now: Date;
  }): Promise<CoursePlanningRunRecord | null> {
    const rows = (await getLearningSql().query(
      `
        UPDATE course_planning_runs
        SET workflow_run_id = COALESCE(workflow_run_id, $3),
            workflow_status = CASE
              WHEN workflow_status IN ('completed', 'failed', 'cancelled') THEN workflow_status
              ELSE 'running'
            END,
            workflow_phase = CASE
              WHEN workflow_status IN ('completed', 'failed', 'cancelled') THEN workflow_phase
              ELSE 'preflight'
            END,
            workflow_started_at = COALESCE(workflow_started_at, $4::timestamptz),
            updated_at = $4::timestamptz
        WHERE owner_id = $1 AND id = $2
          AND (workflow_run_id IS NULL OR workflow_run_id = $3)
        RETURNING id
      `,
      [input.ownerId, input.planningRunId, input.workflowRunId, input.now],
    )) as Array<{ id: string }>;
    return rows[0] ? this.find(input.ownerId, input.planningRunId) : null;
  }

  /**
   * Atomically reserves an initial workflow slot before calling Workflow
   * World. Without this reservation, a browser reconnect or React remount can
   * observe the idempotent planning run before its workflow ID is attached and
   * start a second workflow for the same course.
   */
  async claimWorkflowStart(input: {
    ownerId: string;
    planningRunId: string;
    now: Date;
  }): Promise<{ run: CoursePlanningRunRecord; claimToken: string } | null> {
    const claimToken = `wclaim_${randomUUID().replaceAll('-', '')}`;
    const rows = (await getLearningSql().query(
      `
        UPDATE course_planning_runs
        SET workflow_run_id = $3,
            workflow_status = 'pending',
            workflow_phase = 'preflight',
            workflow_started_at = NULL,
            workflow_completed_at = NULL,
            last_error_code = NULL,
            last_error_detail = NULL,
            updated_at = $4::timestamptz
        WHERE owner_id = $1 AND id = $2
          AND workflow_run_id IS NULL
          AND workflow_status = 'pending'
          AND status IN ('frozen', 'outlining')
        RETURNING id
      `,
      [input.ownerId, input.planningRunId, claimToken, input.now],
    )) as Array<{ id: string }>;
    if (!rows[0]) return null;
    const run = await this.find(input.ownerId, input.planningRunId);
    return run ? { run, claimToken } : null;
  }

  async claimWorkflowResume(input: {
    ownerId: string;
    planningRunId: string;
    now: Date;
  }): Promise<{ run: CoursePlanningRunRecord; claimToken: string } | null> {
    const claimToken = `wclaim_${randomUUID().replaceAll('-', '')}`;
    const rows = (await getLearningSql().query(
      `
        UPDATE course_planning_runs
        SET status = CASE WHEN status = 'failed' THEN 'frozen' ELSE status END,
            workflow_run_id = $3,
            workflow_status = 'pending',
            workflow_phase = 'preflight',
            workflow_started_at = NULL,
            workflow_completed_at = NULL,
            lease_token = NULL,
            lease_expires_at = NULL,
            last_error_code = NULL,
            last_error_detail = NULL,
            completed_at = CASE WHEN outline_json IS NULL THEN NULL ELSE completed_at END,
            updated_at = $4::timestamptz
        WHERE owner_id = $1 AND id = $2
          AND workflow_status = 'failed'
          AND status <> 'cancelled'
          AND (outline_json IS NOT NULL OR attempt_count < max_attempts)
        RETURNING id
      `,
      [input.ownerId, input.planningRunId, claimToken, input.now],
    )) as Array<{ id: string }>;
    if (!rows[0]) return null;
    const run = await this.find(input.ownerId, input.planningRunId);
    return run ? { run, claimToken } : null;
  }

  async attachResumedWorkflow(input: {
    ownerId: string;
    planningRunId: string;
    claimToken: string;
    workflowRunId: string;
    now: Date;
  }): Promise<CoursePlanningRunRecord | null> {
    const rows = (await getLearningSql().query(
      `
        UPDATE course_planning_runs
        SET workflow_run_id = $4,
            workflow_status = CASE
              WHEN workflow_status = 'pending' THEN 'running'
              ELSE workflow_status
            END,
            workflow_started_at = COALESCE(workflow_started_at, $5::timestamptz),
            updated_at = $5::timestamptz
        WHERE owner_id = $1 AND id = $2 AND workflow_run_id = $3
        RETURNING id
      `,
      [input.ownerId, input.planningRunId, input.claimToken, input.workflowRunId, input.now],
    )) as Array<{ id: string }>;
    return rows[0] ? this.find(input.ownerId, input.planningRunId) : null;
  }

  async failWorkflowResumeClaim(input: {
    ownerId: string;
    planningRunId: string;
    claimToken: string;
    errorDetail: string;
    now: Date;
  }): Promise<void> {
    await getLearningSql().query(
      `
        UPDATE course_planning_runs
        SET workflow_run_id = NULL,
            workflow_status = 'failed',
            workflow_phase = 'failed',
            workflow_completed_at = $5::timestamptz,
            last_error_code = 'COURSE_WORKFLOW_RESUME_FAILED',
            last_error_detail = $4,
            updated_at = $5::timestamptz
        WHERE owner_id = $1 AND id = $2 AND workflow_run_id = $3
      `,
      [
        input.ownerId,
        input.planningRunId,
        input.claimToken,
        input.errorDetail.slice(0, 8_000),
        input.now,
      ],
    );
  }

  async updateResearch(input: {
    ownerId: string;
    planningRunId: string;
    planningInput: CoursePlanningInput;
    context: CompiledLearningContextPack;
    preflight: CoursePlanningPreflight;
    now: Date;
  }): Promise<CoursePlanningRunRecord | null> {
    const current = await this.find(input.ownerId, input.planningRunId);
    if (!current || current.status === 'cancelled' || current.status === 'consumed') return current;
    const storedRequirements = {
      ...input.planningInput.requirements,
      planningClientSessionId: input.planningInput.clientSessionId,
      planningSourceBundleId: input.planningInput.sourceBundleId,
      planningProjectId: input.planningInput.projectId,
      planningRetrievalRunId: input.planningInput.retrievalRunId,
    };
    await getLearningSql().transaction(
      (tx) => [
        tx.query(
          `
            UPDATE learning_context_packs
            SET source_manifest = $4::jsonb,
                source_text = $5,
                source_sha256 = $6,
                selected_episodes = $7::jsonb,
                exclusions = $8::jsonb,
                unresolved_items = $9::jsonb,
          frozen_at = $10::timestamptz
            WHERE owner_id = $1 AND id = $2 AND session_id = $3
          `,
          [
            input.ownerId,
            current.contextPackId,
            current.sessionId,
            JSON.stringify(input.context.sourceManifest),
            input.context.sourceText,
            input.context.sourceSha256,
            JSON.stringify(input.context.selectedEpisodes),
            JSON.stringify(input.context.exclusions),
            JSON.stringify(input.context.unresolvedItems),
            input.now,
          ],
        ),
        tx.query(
          `
            UPDATE course_planning_runs
            SET status = 'frozen',
                requirements_json = $3::jsonb,
                source_references_json = $4::jsonb,
                generation_model_json = $5::jsonb,
                research_text = $6,
                preflight_json = $7::jsonb,
                workflow_status = 'running',
                workflow_phase = 'outline',
                last_error_code = NULL,
                last_error_detail = NULL,
                updated_at = $8::timestamptz
            WHERE owner_id = $1 AND id = $2
              AND status IN ('frozen', 'failed')
          `,
          [
            input.ownerId,
            input.planningRunId,
            JSON.stringify(storedRequirements),
            JSON.stringify(input.planningInput.sourceReferences),
            input.planningInput.generationModel
              ? JSON.stringify(input.planningInput.generationModel)
              : null,
            input.planningInput.researchText,
            JSON.stringify(input.preflight),
            input.now,
          ],
        ),
        tx.query(
          `
            UPDATE learning_sessions
            SET metadata = metadata || jsonb_build_object(
                  'externalEvidenceStatus', $3::text,
                  'researchFrozenAt', $4::timestamptz
                ),
                updated_at = $4::timestamptz
            WHERE owner_id = $1 AND id = $2
          `,
          [
            input.ownerId,
            current.sessionId,
            input.planningInput.requirements.externalEvidenceStatus ?? 'not-requested',
            input.now,
          ],
        ),
      ],
      { isolationLevel: 'Serializable' },
    );
    return this.find(input.ownerId, input.planningRunId);
  }

  async updateWorkflowPhase(input: {
    ownerId: string;
    planningRunId: string;
    phase: CoursePlanningRunRecord['workflowPhase'];
    status?: CoursePlanningRunRecord['workflowStatus'];
    now: Date;
  }): Promise<void> {
    const status =
      input.status ??
      (input.phase === 'completed' ? 'completed' : input.phase === 'failed' ? 'failed' : 'running');
    await getLearningSql().query(
      `
        UPDATE course_planning_runs
        SET workflow_status = $3,
            workflow_phase = $4,
            workflow_started_at = COALESCE(workflow_started_at, $5),
            workflow_completed_at = CASE
              WHEN $3 IN ('completed', 'failed', 'cancelled') THEN $5
              ELSE workflow_completed_at
            END,
            updated_at = $5::timestamptz
        WHERE owner_id = $1 AND id = $2
      `,
      [input.ownerId, input.planningRunId, status, input.phase, input.now],
    );
  }

  async failWorkflow(input: {
    ownerId: string;
    planningRunId: string;
    errorCode: string;
    errorDetail: string;
    now: Date;
  }): Promise<void> {
    await getLearningSql().query(
      `
        UPDATE course_planning_runs
        SET status = CASE
              WHEN status IN ('frozen', 'outlining', 'failed') THEN 'failed'
              ELSE status
            END,
            workflow_status = 'failed',
            workflow_phase = 'failed',
            workflow_completed_at = $5::timestamptz,
            lease_token = NULL,
            lease_expires_at = NULL,
            last_error_code = $3,
            last_error_detail = $4,
            updated_at = $5::timestamptz
        WHERE owner_id = $1 AND id = $2
      `,
      [
        input.ownerId,
        input.planningRunId,
        input.errorCode.slice(0, 120),
        input.errorDetail.slice(0, 8_000),
        input.now,
      ],
    );
  }

  async create(input: {
    ownerId: string;
    idempotencyKey: string;
    planningInput: CoursePlanningInput;
    context: CompiledLearningContextPack;
    preflight: CoursePlanningPreflight;
    knowledgeSnapshotId?: string;
    now: Date;
  }): Promise<CoursePlanningRunRecord> {
    const existing = await this.findByIdempotencyKey(input.ownerId, input.idempotencyKey);
    if (existing) return existing;

    const sessionId = id('lsn');
    const contextPackId = id('ctx');
    const planningRunId = id('cpl');
    const requirements = {
      ...input.planningInput.requirements,
      planningClientSessionId: input.planningInput.clientSessionId,
      planningSourceBundleId: input.planningInput.sourceBundleId,
      planningProjectId: input.planningInput.projectId,
      planningRetrievalRunId: input.planningInput.retrievalRunId,
    };

    try {
      await getLearningSql().transaction(
        (tx) => [
          tx.query(
            `
              INSERT INTO learning_sessions
                (id, owner_id, goal, source_mode, status, source_bundle_id, project_id,
                 retrieval_run_id, metadata, created_at, updated_at)
              VALUES ($1, $2, $3, $4, 'preparing', $5, $6, $7, $8::jsonb, $9, $9)
            `,
            [
              sessionId,
              input.ownerId,
              input.context.goal,
              input.context.sourceMode,
              input.planningInput.sourceBundleId ?? null,
              input.planningInput.projectId ?? null,
              input.planningInput.retrievalRunId ?? null,
              JSON.stringify({ planningRunId, preflightVersion: input.preflight.version }),
              input.now,
            ],
          ),
          tx.query(
            `
              INSERT INTO learning_context_packs
                (id, owner_id, session_id, knowledge_snapshot_id, status, source_manifest,
                 source_text, source_sha256, selected_episodes, exclusions, unresolved_items,
                 created_at, frozen_at)
              VALUES ($1, $2, $3, $4, 'frozen', $5::jsonb, $6, $7, $8::jsonb,
                      $9::jsonb, $10::jsonb, $11, $11)
            `,
            [
              contextPackId,
              input.ownerId,
              sessionId,
              input.knowledgeSnapshotId ?? null,
              JSON.stringify(input.context.sourceManifest),
              input.context.sourceText,
              input.context.sourceSha256,
              JSON.stringify(input.context.selectedEpisodes),
              JSON.stringify(input.context.exclusions),
              JSON.stringify(input.context.unresolvedItems),
              input.now,
            ],
          ),
          tx.query(
            `
              UPDATE learning_sessions
              SET current_context_pack_id = $3, updated_at = $4::timestamptz
              WHERE owner_id = $1 AND id = $2
            `,
            [input.ownerId, sessionId, contextPackId, input.now],
          ),
          tx.query(
            `
              INSERT INTO course_planning_runs
                (id, owner_id, session_id, context_pack_id, idempotency_key, status,
                 source_mode, requirements_json, source_references_json, generation_model_json,
                 document_text, research_text, source_context_expected_chars, preflight_json,
                 created_at, updated_at)
              VALUES ($1, $2, $3, $4, $5, 'frozen', $6, $7::jsonb, $8::jsonb,
                      $9::jsonb, $10, $11, $12, $13::jsonb, $14, $14)
            `,
            [
              planningRunId,
              input.ownerId,
              sessionId,
              contextPackId,
              input.idempotencyKey,
              input.planningInput.sourceMode,
              JSON.stringify(requirements),
              JSON.stringify(input.planningInput.sourceReferences),
              input.planningInput.generationModel
                ? JSON.stringify(input.planningInput.generationModel)
                : null,
              input.planningInput.documentText,
              input.planningInput.researchText,
              input.planningInput.sourceContextExpectedChars ?? 0,
              JSON.stringify(input.preflight),
              input.now,
            ],
          ),
        ],
        { isolationLevel: 'Serializable' },
      );
    } catch (error) {
      const winner = await this.findByIdempotencyKey(input.ownerId, input.idempotencyKey);
      if (winner) return winner;
      throw error;
    }

    const created = await this.find(input.ownerId, planningRunId);
    if (!created) throw new Error('course_planning_run_not_persisted');
    return created;
  }

  async beginOutline(input: {
    ownerId: string;
    planningRunId: string;
    now: Date;
    leaseExpiresAt: Date;
  }): Promise<CoursePlanningLease | null> {
    const current = await this.find(input.ownerId, input.planningRunId);
    if (!current) return null;
    if (current.status === 'ready' || current.status === 'consumed') {
      return { run: current, reusedReadyResult: true };
    }

    const leaseToken = randomUUID();
    const rows = (await getLearningSql().query(
      `
        UPDATE course_planning_runs
        SET status = 'outlining',
            workflow_status = 'running',
            workflow_phase = 'outline',
            workflow_started_at = COALESCE(workflow_started_at, $4),
            attempt_count = attempt_count + 1,
            lease_token = $3,
              lease_expires_at = $5::timestamptz,
            last_error_code = NULL,
            last_error_detail = NULL,
            completed_at = NULL,
            updated_at = $4::timestamptz
        WHERE owner_id = $1 AND id = $2
          AND attempt_count < max_attempts
          AND (
            status IN ('frozen', 'failed')
            OR (status = 'outlining' AND lease_expires_at < $4::timestamptz)
          )
        RETURNING id, owner_id, session_id, context_pack_id, idempotency_key, status,
                  source_mode, requirements_json, source_references_json, generation_model_json, document_text,
                  research_text, source_context_expected_chars, preflight_json, outline_json,
                  language_directive, course_title, task_engine_mode, attempt_count,
                  max_attempts, lease_token, lease_expires_at, last_error_code,
                  last_error_detail, created_at, updated_at, completed_at,
                  workflow_run_id, workflow_status, workflow_phase,
                  workflow_started_at, workflow_completed_at
      `,
      [input.ownerId, input.planningRunId, leaseToken, input.now, input.leaseExpiresAt],
    )) as PlanningRow[];
    return rows[0] ? { run: mapRow(rows[0]), leaseToken, reusedReadyResult: false } : null;
  }

  async completeOutline(input: {
    ownerId: string;
    planningRunId: string;
    leaseToken: string;
    outlines: SceneOutline[];
    languageDirective?: string;
    courseTitle?: string;
    taskEngineMode: boolean;
    now: Date;
  }): Promise<CoursePlanningRunRecord | null> {
    const rows = (await getLearningSql().query(
      `
        WITH completed_plan AS (
          UPDATE course_planning_runs
          SET status = 'ready',
              outline_json = $4::jsonb,
              language_directive = $5,
              course_title = $6,
              task_engine_mode = $7,
              lease_token = NULL,
              lease_expires_at = NULL,
              last_error_code = NULL,
              last_error_detail = NULL,
              completed_at = $8::timestamptz,
              updated_at = $8::timestamptz
          WHERE owner_id = $1 AND id = $2 AND status = 'outlining'
            AND lease_token = $3 AND lease_expires_at >= $8::timestamptz
          RETURNING *
        ), updated_session AS (
          UPDATE learning_sessions session
          SET metadata = session.metadata || jsonb_build_object(
                'planningRunId', $2::text,
                'outlineCount', jsonb_array_length($4::jsonb),
                'planningReadyAt', $8::timestamptz
              ),
                updated_at = $8::timestamptz
          FROM completed_plan plan
          WHERE session.owner_id = plan.owner_id AND session.id = plan.session_id
          RETURNING session.id
        )
        SELECT id, owner_id, session_id, context_pack_id, idempotency_key, status,
               source_mode, requirements_json, source_references_json, generation_model_json, document_text,
               research_text, source_context_expected_chars, preflight_json, outline_json,
               language_directive, course_title, task_engine_mode, attempt_count,
               max_attempts, lease_token, lease_expires_at, last_error_code,
               last_error_detail, created_at, updated_at, completed_at,
               workflow_run_id, workflow_status, workflow_phase,
               workflow_started_at, workflow_completed_at
        FROM completed_plan
      `,
      [
        input.ownerId,
        input.planningRunId,
        input.leaseToken,
        JSON.stringify(input.outlines),
        input.languageDirective ?? null,
        input.courseTitle ?? null,
        input.taskEngineMode,
        input.now,
      ],
    )) as PlanningRow[];
    return rows[0] ? mapRow(rows[0]) : null;
  }

  async failOutline(input: {
    ownerId: string;
    planningRunId: string;
    leaseToken: string;
    errorCode: string;
    errorDetail: string;
    now: Date;
  }): Promise<boolean> {
    const rows = (await getLearningSql().query(
      `
        UPDATE course_planning_runs
        SET status = 'failed',
            lease_token = NULL,
            lease_expires_at = NULL,
            last_error_code = $4,
            last_error_detail = $5,
            updated_at = $6::timestamptz
        WHERE owner_id = $1 AND id = $2 AND status = 'outlining' AND lease_token = $3
        RETURNING id
      `,
      [
        input.ownerId,
        input.planningRunId,
        input.leaseToken,
        input.errorCode.slice(0, 120),
        input.errorDetail.slice(0, 8_000),
        input.now,
      ],
    )) as Array<{ id: string }>;
    return rows.length === 1;
  }

  async markConsumed(input: { ownerId: string; planningRunId: string; now: Date }): Promise<void> {
    await getLearningSql().query(
      `
        UPDATE course_planning_runs
        SET status = 'consumed', updated_at = $3::timestamptz
        WHERE owner_id = $1 AND id = $2 AND status IN ('ready', 'consumed')
      `,
      [input.ownerId, input.planningRunId, input.now],
    );
  }
}
