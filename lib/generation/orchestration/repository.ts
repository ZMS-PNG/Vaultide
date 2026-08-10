import { createHash, randomUUID } from 'node:crypto';
import { getLearningSql } from '@/lib/learning/adapters/neon/client';
import type { CompiledLearningContextPack } from '@/lib/learning/domain/learning-context-pack';
import type {
  CourseGenerationAttemptRecord,
  CourseGenerationJobInput,
  CourseGenerationJobRecord,
  CourseGenerationStepPhase,
  CourseGenerationStepRecord,
  CourseReleaseRecord,
} from './types';
import { MAX_CLASSROOM_API_RESPONSE_BYTES } from './classroom-snapshot';

export const MAX_COURSE_STEP_ATTEMPTS = 15;
const MANUAL_REPAIR_ATTEMPT_INCREMENT = 3;

function id(prefix: 'lsn' | 'ctx' | 'cgj' | 'cgs' | 'cga' | 'crl' | 'cgd'): string {
  return `${prefix}_${randomUUID().replaceAll('-', '')}`;
}

function jsonObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function quality(value: unknown) {
  return jsonObject(value) as CourseGenerationJobRecord['qualitySummary'];
}

interface JobRow {
  id: string;
  owner_id: string;
  session_id: string;
  context_pack_id: string;
  planning_run_id: string | null;
  classroom_id: string;
  idempotency_key: string;
  status: CourseGenerationJobRecord['status'];
  current_phase: CourseGenerationJobRecord['currentPhase'];
  current_scene_order: number | null;
  outline_count: number;
  scenes_generated: number;
  progress: number;
  input_json: CourseGenerationJobInput;
  quality_summary: unknown;
  queue_message_id: string | null;
  last_error_code: string | null;
  last_error_detail: string | null;
  created_at: string | Date;
  updated_at: string | Date;
  started_at: string | Date | null;
  completed_at: string | Date | null;
}

interface StepRow {
  id: string;
  owner_id: string;
  job_id: string;
  scene_order: number;
  phase: CourseGenerationStepRecord['phase'];
  status: CourseGenerationStepRecord['status'];
  attempt_count: number;
  max_attempts: number;
  input_hash: string;
  result_json: unknown;
  quality_json: unknown;
  lease_token: string | null;
  lease_expires_at: string | Date | null;
  last_error_code: string | null;
  last_error_detail: string | null;
  created_at: string | Date;
  updated_at: string | Date;
  started_at: string | Date | null;
  completed_at: string | Date | null;
}

interface AttemptRow {
  id: string;
  owner_id: string;
  job_id: string;
  step_id: string;
  attempt_no: number;
  status: CourseGenerationAttemptRecord['status'];
  input_hash: string;
  quality_score: number | string | null;
  error_code: string | null;
  error_detail: string | null;
  started_at: string | Date;
  completed_at: string | Date | null;
}

interface ReleaseRow {
  id: string;
  owner_id: string;
  job_id: string;
  classroom_id: string;
  release_version: number;
  outline_count: number;
  scene_count: number;
  quality_score: number | string;
  quality_json: unknown;
  snapshot_sha256: string;
  created_at: string | Date;
}

function mapJob(row: JobRow): CourseGenerationJobRecord {
  return {
    id: row.id,
    ownerId: row.owner_id,
    sessionId: row.session_id,
    contextPackId: row.context_pack_id,
    ...(row.planning_run_id ? { planningRunId: row.planning_run_id } : {}),
    classroomId: row.classroom_id,
    idempotencyKey: row.idempotency_key,
    status: row.status,
    currentPhase: row.current_phase,
    ...(row.current_scene_order === null ? {} : { currentSceneOrder: row.current_scene_order }),
    outlineCount: row.outline_count,
    scenesGenerated: row.scenes_generated,
    progress: row.progress,
    input: row.input_json,
    ...(row.quality_summary ? { qualitySummary: quality(row.quality_summary) } : {}),
    ...(row.queue_message_id ? { queueMessageId: row.queue_message_id } : {}),
    ...(row.last_error_code ? { lastErrorCode: row.last_error_code } : {}),
    ...(row.last_error_detail ? { lastErrorDetail: row.last_error_detail } : {}),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    ...(row.started_at ? { startedAt: new Date(row.started_at) } : {}),
    ...(row.completed_at ? { completedAt: new Date(row.completed_at) } : {}),
  };
}

function mapStep(row: StepRow): CourseGenerationStepRecord {
  return {
    id: row.id,
    ownerId: row.owner_id,
    jobId: row.job_id,
    sceneOrder: row.scene_order,
    phase: row.phase,
    status: row.status,
    attemptCount: row.attempt_count,
    maxAttempts: row.max_attempts,
    inputHash: row.input_hash,
    ...(row.result_json ? { result: jsonObject(row.result_json) } : {}),
    ...(row.quality_json ? { quality: quality(row.quality_json) } : {}),
    ...(row.lease_token ? { leaseToken: row.lease_token } : {}),
    ...(row.lease_expires_at ? { leaseExpiresAt: new Date(row.lease_expires_at) } : {}),
    ...(row.last_error_code ? { lastErrorCode: row.last_error_code } : {}),
    ...(row.last_error_detail ? { lastErrorDetail: row.last_error_detail } : {}),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    ...(row.started_at ? { startedAt: new Date(row.started_at) } : {}),
    ...(row.completed_at ? { completedAt: new Date(row.completed_at) } : {}),
  };
}

function mapAttempt(row: AttemptRow): CourseGenerationAttemptRecord {
  return {
    id: row.id,
    ownerId: row.owner_id,
    jobId: row.job_id,
    stepId: row.step_id,
    attemptNo: row.attempt_no,
    status: row.status,
    inputHash: row.input_hash,
    ...(row.quality_score === null ? {} : { qualityScore: Number(row.quality_score) }),
    ...(row.error_code ? { errorCode: row.error_code } : {}),
    ...(row.error_detail ? { errorDetail: row.error_detail } : {}),
    startedAt: new Date(row.started_at),
    ...(row.completed_at ? { completedAt: new Date(row.completed_at) } : {}),
  };
}

function mapRelease(row: ReleaseRow): CourseReleaseRecord {
  return {
    id: row.id,
    ownerId: row.owner_id,
    jobId: row.job_id,
    classroomId: row.classroom_id,
    releaseVersion: row.release_version,
    outlineCount: row.outline_count,
    sceneCount: row.scene_count,
    qualityScore: Number(row.quality_score),
    quality: quality(row.quality_json)!,
    snapshotSha256: row.snapshot_sha256,
    createdAt: new Date(row.created_at),
  };
}

function stepHash(jobInput: CourseGenerationJobInput, sceneOrder: number, phase: string): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        classroomId: jobInput.stage.id,
        outline: jobInput.outlines.find((outline) => outline.order === sceneOrder),
        phase,
        contextHash: createHash('sha256').update(jobInput.sourceContext, 'utf8').digest('hex'),
      }),
      'utf8',
    )
    .digest('hex');
}

function stepDefinitions(jobInput: CourseGenerationJobInput): Array<{
  id: string;
  sceneOrder: number;
  phase: CourseGenerationStepPhase;
  hash: string;
}> {
  const steps: Array<{
    id: string;
    sceneOrder: number;
    phase: CourseGenerationStepPhase;
    hash: string;
  }> = [];
  for (const outline of [...jobInput.outlines].sort((left, right) => left.order - right.order)) {
    steps.push({
      id: id('cgs'),
      sceneOrder: outline.order,
      phase: 'content',
      hash: stepHash(jobInput, outline.order, 'content'),
    });
    steps.push({
      id: id('cgs'),
      sceneOrder: outline.order,
      phase: 'actions',
      hash: stepHash(jobInput, outline.order, 'actions'),
    });
  }
  steps.push({
    id: id('cgs'),
    sceneOrder: 0,
    phase: 'release',
    hash: stepHash(jobInput, 0, 'release'),
  });
  return steps;
}

const JOB_SELECT = `
  SELECT id, owner_id, session_id, context_pack_id, planning_run_id, classroom_id, idempotency_key,
         status, current_phase, current_scene_order, outline_count, scenes_generated,
         progress, input_json, quality_summary, queue_message_id, last_error_code,
         last_error_detail, created_at, updated_at, started_at, completed_at
  FROM course_generation_jobs
`;

const STEP_SELECT = `
  SELECT id, owner_id, job_id, scene_order, phase, status, attempt_count, max_attempts,
         input_hash, result_json, quality_json, lease_token, lease_expires_at,
         last_error_code, last_error_detail, created_at, updated_at, started_at, completed_at
  FROM course_generation_steps
`;

export class CourseGenerationLeaseLostError extends Error {
  readonly code = 'LEASE_LOST';

  constructor(readonly stepId: string) {
    super(`Course generation lease was lost for step ${stepId}.`);
    this.name = 'CourseGenerationLeaseLostError';
  }
}

export interface CourseGenerationDispatchLease {
  id: string;
  jobId: string;
  dispatchSeq: number;
  leaseToken: string;
}

export class NeonCourseGenerationRepository {
  async create(input: {
    ownerId: string;
    idempotencyKey: string;
    context: CompiledLearningContextPack;
    jobInput: CourseGenerationJobInput;
    knowledgeSnapshotId?: string;
    planning?: {
      id: string;
      sessionId: string;
      contextPackId: string;
    };
    now: Date;
  }): Promise<CourseGenerationJobRecord> {
    const existing = await this.findByIdempotencyKey(input.ownerId, input.idempotencyKey);
    if (existing) {
      await this.ensureSteps(existing, input.now);
      await this.ensurePendingDispatch(existing.ownerId, existing.id, input.now);
      return existing;
    }

    const sessionId = input.planning?.sessionId ?? id('lsn');
    const contextPackId = input.planning?.contextPackId ?? id('ctx');
    const jobId = id('cgj');
    const sql = getLearningSql();
    const steps = stepDefinitions(input.jobInput);
    const initialDispatchId = id('cgd');

    try {
      await sql.transaction(
        (tx) => [
          ...(!input.planning
            ? [
                tx.query(
            `
        INSERT INTO learning_sessions
          (id, owner_id, goal, source_mode, status, source_bundle_id, project_id,
           retrieval_run_id, metadata, created_at, updated_at)
        VALUES ($1, $2, $3, $4, 'generating', $5, $6, $7, $8::jsonb, $9, $9)
      `,
            [
              sessionId,
              input.ownerId,
              input.context.goal,
              input.context.sourceMode,
              input.jobInput.stage.learningContext?.sourceBundleId ?? null,
              input.jobInput.stage.learningContext?.projectId ?? null,
              input.jobInput.stage.learningContext?.retrievalRunId ?? null,
              JSON.stringify({
                classroomId: input.jobInput.stage.id,
                learningProject: input.jobInput.stage.learningContext?.learningProject ?? null,
              }),
              input.now,
            ],
                ),
                tx.query(
            `
        INSERT INTO learning_context_packs
          (id, owner_id, session_id, knowledge_snapshot_id, status, source_manifest, source_text, source_sha256,
           selected_episodes, exclusions, unresolved_items, created_at, frozen_at)
        VALUES ($1, $2, $3, $4, 'frozen', $5::jsonb, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb, $11, $11)
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
              ]
            : [
                tx.query(
                  `
                    UPDATE learning_sessions
                    SET status = 'generating',
                        metadata = metadata || jsonb_build_object(
                          'classroomId', $3::text,
                          'planningRunId', $4::text
                        ),
                        updated_at = $5::timestamptz
                    WHERE owner_id = $1 AND id = $2
                  `,
                  [
                    input.ownerId,
                    sessionId,
                    input.jobInput.stage.id,
                    input.planning.id,
                    input.now,
                  ],
                ),
              ]),
          input.planning
            ? tx.query(
                `
                  INSERT INTO course_generation_jobs
                    (id, owner_id, session_id, context_pack_id, planning_run_id,
                     classroom_id, idempotency_key, status, current_phase,
                     current_scene_order, outline_count, scenes_generated,
                     progress, input_json, created_at, updated_at)
                  SELECT $1, $2, plan.session_id, plan.context_pack_id, plan.id,
                         $4, $5, 'queued', 'content', 1, $6, 0, 0, $7::jsonb, $8, $8
                  FROM course_planning_runs plan
                  WHERE plan.owner_id = $2 AND plan.id = $3 AND plan.status = 'ready'
                    AND plan.session_id = $9 AND plan.context_pack_id = $10
                `,
                [
                  jobId,
                  input.ownerId,
                  input.planning.id,
                  input.jobInput.stage.id,
                  input.idempotencyKey,
                  input.jobInput.outlines.length,
                  JSON.stringify(input.jobInput),
                  input.now,
                  sessionId,
                  contextPackId,
                ],
              )
            : tx.query(
                `
                  INSERT INTO course_generation_jobs
                    (id, owner_id, session_id, context_pack_id, planning_run_id,
                     classroom_id, idempotency_key, status, current_phase,
                     current_scene_order, outline_count, scenes_generated,
                     progress, input_json, created_at, updated_at)
                  VALUES ($1, $2, $3, $4, NULL, $5, $6, 'queued', 'content', 1,
                          $7, 0, 0, $8::jsonb, $9, $9)
                `,
                [
                  jobId,
                  input.ownerId,
                  sessionId,
                  contextPackId,
                  input.jobInput.stage.id,
                  input.idempotencyKey,
                  input.jobInput.outlines.length,
                  JSON.stringify(input.jobInput),
                  input.now,
                ],
              ),
          ...(input.planning
            ? [
                tx.query(
                  `
                    UPDATE course_planning_runs
                    SET status = 'consumed', updated_at = $3::timestamptz
                    WHERE owner_id = $1 AND id = $2 AND status = 'ready'
                  `,
                  [input.ownerId, input.planning.id, input.now],
                ),
              ]
            : []),
          ...steps.map((step) =>
            tx.query(
              `
                INSERT INTO course_generation_steps
                  (id, owner_id, job_id, scene_order, phase, status, attempt_count,
                   max_attempts, input_hash, created_at, updated_at)
                VALUES ($1, $2, $3, $4, $5, 'pending', 0, 5, $6, $7, $7)
              `,
              [step.id, input.ownerId, jobId, step.sceneOrder, step.phase, step.hash, input.now],
            ),
          ),
          tx.query(
            `
              INSERT INTO course_generation_dispatches
                (id, owner_id, job_id, dispatch_seq, status, not_before,
                 attempt_count, created_at, updated_at)
              VALUES ($1, $2, $3, 1, 'pending', $4, 0, $4, $4)
            `,
            [initialDispatchId, input.ownerId, jobId, input.now],
          ),
        ],
        { isolationLevel: 'Serializable' },
      );
    } catch (error) {
      // Two create requests with the same idempotency key may race. The
      // losing serializable transaction is fully rolled back, so no orphan
      // session/context rows survive; return the winner after it becomes
      // visible.
      const raced = await this.findByIdempotencyKey(input.ownerId, input.idempotencyKey);
      if (raced) {
        await this.ensureSteps(raced, input.now);
        await this.ensurePendingDispatch(raced.ownerId, raced.id, input.now);
        return raced;
      }
      if (input.planning) {
        const adopted = await this.findByPlanningRunId(input.ownerId, input.planning.id);
        if (adopted) {
          await this.ensureSteps(adopted, input.now);
          await this.ensurePendingDispatch(adopted.ownerId, adopted.id, input.now);
          return adopted;
        }
      }
      throw error;
    }

    const created = await this.find(input.ownerId, jobId);
    if (!created) throw new Error('course_generation_job_not_created');
    return created;
  }

  private async ensureSteps(job: CourseGenerationJobRecord, now: Date): Promise<void> {
    for (const step of stepDefinitions(job.input)) {
      await getLearningSql().query(
        `
          INSERT INTO course_generation_steps
            (id, owner_id, job_id, scene_order, phase, status, attempt_count,
             max_attempts, input_hash, created_at, updated_at)
          VALUES ($1, $2, $3, $4, $5, 'pending', 0, 5, $6, $7, $7)
          ON CONFLICT (owner_id, job_id, scene_order, phase) DO NOTHING
        `,
        [step.id, job.ownerId, job.id, step.sceneOrder, step.phase, step.hash, now],
      );
    }
  }

  private async ensurePendingDispatch(ownerId: string, jobId: string, now: Date): Promise<void> {
    await getLearningSql().query(
      `
        INSERT INTO course_generation_dispatches
          (id, owner_id, job_id, dispatch_seq, status, not_before,
           attempt_count, created_at, updated_at)
        SELECT $1, $2, $3,
               COALESCE(
                 (SELECT max(dispatch_seq) + 1
                  FROM course_generation_dispatches
                  WHERE owner_id = $2 AND job_id = $3),
                 1
               ),
               'pending', $4, 0, $4, $4
        FROM course_generation_jobs job
        WHERE job.owner_id = $2 AND job.id = $3
          AND job.status IN ('queued', 'running', 'verifying')
          AND NOT EXISTS (
            SELECT 1
            FROM course_generation_dispatches dispatch
            WHERE dispatch.owner_id = $2 AND dispatch.job_id = $3
          )
        ON CONFLICT (owner_id, job_id, dispatch_seq) DO NOTHING
      `,
      [id('cgd'), ownerId, jobId, now],
    );
  }

  async find(ownerId: string, jobId: string): Promise<CourseGenerationJobRecord | null> {
    const rows = (await getLearningSql().query(`${JOB_SELECT} WHERE owner_id = $1 AND id = $2`, [
      ownerId,
      jobId,
    ])) as JobRow[];
    return rows[0] ? mapJob(rows[0]) : null;
  }

  async findByIdempotencyKey(
    ownerId: string,
    idempotencyKey: string,
  ): Promise<CourseGenerationJobRecord | null> {
    const rows = (await getLearningSql().query(
      `${JOB_SELECT} WHERE owner_id = $1 AND idempotency_key = $2`,
      [ownerId, idempotencyKey],
    )) as JobRow[];
    return rows[0] ? mapJob(rows[0]) : null;
  }

  async findByPlanningRunId(
    ownerId: string,
    planningRunId: string,
  ): Promise<CourseGenerationJobRecord | null> {
    const rows = (await getLearningSql().query(
      `${JOB_SELECT} WHERE owner_id = $1 AND planning_run_id = $2`,
      [ownerId, planningRunId],
    )) as JobRow[];
    return rows[0] ? mapJob(rows[0]) : null;
  }

  async ensureDispatch(ownerId: string, jobId: string, now: Date): Promise<void> {
    await this.ensurePendingDispatch(ownerId, jobId, now);
  }

  async claimPendingDispatch(input: {
    ownerId: string;
    jobId: string;
    leaseToken: string;
    now: Date;
    leaseExpiresAt: Date;
    publishedRecoveryBefore: Date;
  }): Promise<CourseGenerationDispatchLease | null> {
    const rows = (await getLearningSql().query(
      `
        WITH candidate AS (
          SELECT id
          FROM course_generation_dispatches
          WHERE owner_id = $1
            AND job_id = $2
            AND attempt_count < 100
            AND EXISTS (
              SELECT 1
              FROM course_generation_jobs job
              WHERE job.owner_id = course_generation_dispatches.owner_id
                AND job.id = course_generation_dispatches.job_id
                AND job.status IN ('queued', 'running', 'verifying')
            )
            AND (
              (status = 'pending' AND not_before <= $4)
              OR (status = 'publishing' AND lease_expires_at < $4::timestamptz)
              OR (
                status = 'published'
                AND published_at <= $6::timestamptz
                AND NOT EXISTS (
                  SELECT 1
                  FROM course_generation_dispatches later
                  WHERE later.owner_id = course_generation_dispatches.owner_id
                    AND later.job_id = course_generation_dispatches.job_id
                    AND later.dispatch_seq > course_generation_dispatches.dispatch_seq
                )
                AND NOT EXISTS (
                  SELECT 1
                  FROM course_generation_steps active
                  WHERE active.owner_id = course_generation_dispatches.owner_id
                    AND active.job_id = course_generation_dispatches.job_id
                    AND active.status = 'leased'
                    AND active.lease_expires_at >= $4::timestamptz
                )
              )
            )
          ORDER BY dispatch_seq
          LIMIT 1
          FOR UPDATE SKIP LOCKED
        )
        UPDATE course_generation_dispatches dispatch
        SET status = 'publishing',
            lease_token = $3,
            lease_expires_at = $5::timestamptz,
            attempt_count = dispatch.attempt_count + 1,
            updated_at = $4::timestamptz
        FROM candidate
        WHERE dispatch.id = candidate.id
        RETURNING dispatch.id, dispatch.job_id, dispatch.dispatch_seq
      `,
      [
        input.ownerId,
        input.jobId,
        input.leaseToken,
        input.now,
        input.leaseExpiresAt,
        input.publishedRecoveryBefore,
      ],
    )) as unknown as Array<{ id: string; job_id: string; dispatch_seq: number }>;
    const row = rows[0];
    return row
      ? {
          id: row.id,
          jobId: row.job_id,
          dispatchSeq: Number(row.dispatch_seq),
          leaseToken: input.leaseToken,
        }
      : null;
  }

  async markDispatchPublished(input: {
    ownerId: string;
    dispatch: CourseGenerationDispatchLease;
    queueMessageId?: string;
    now: Date;
  }): Promise<boolean> {
    const rows = (await getLearningSql().query(
      `
        WITH published AS (
          UPDATE course_generation_dispatches
          SET status = 'published',
              queue_message_id = $4,
              attempt_count = 0,
              lease_token = NULL,
              lease_expires_at = NULL,
              last_error = NULL,
              published_at = $5::timestamptz,
              updated_at = $5::timestamptz
          WHERE owner_id = $1
            AND id = $2
            AND job_id = $3
            AND status = 'publishing'
            AND lease_token = $6
          RETURNING job_id
        ),
        updated_job AS (
          UPDATE course_generation_jobs job
          SET queue_message_id = COALESCE($4, job.queue_message_id), updated_at = $5::timestamptz
          FROM published
          WHERE job.owner_id = $1 AND job.id = published.job_id
          RETURNING job.id
        )
        SELECT job_id FROM published
      `,
      [
        input.ownerId,
        input.dispatch.id,
        input.dispatch.jobId,
        input.queueMessageId ?? null,
        input.now,
        input.dispatch.leaseToken,
      ],
    )) as unknown as Array<{ job_id: string }>;
    return rows.length === 1;
  }

  async releaseDispatch(input: {
    ownerId: string;
    dispatch: CourseGenerationDispatchLease;
    error: string;
    retryAt: Date;
    now: Date;
  }): Promise<boolean> {
    const rows = (await getLearningSql().query(
      `
        WITH released_dispatch AS (
          UPDATE course_generation_dispatches
          SET status = CASE WHEN attempt_count >= 100 THEN 'failed' ELSE 'pending' END,
              not_before = $5,
              lease_token = NULL,
              lease_expires_at = NULL,
              last_error = $4,
              updated_at = $6::timestamptz
          WHERE owner_id = $1
            AND id = $2
            AND job_id = $3
            AND status = 'publishing'
            AND lease_token = $7
          RETURNING id, job_id, status
        ),
        failed_job AS (
          UPDATE course_generation_jobs job
          SET status = 'failed',
              current_phase = 'failed',
              last_error_code = 'QUEUE_DISPATCH_EXHAUSTED',
              last_error_detail = 'The durable queue dispatch exhausted its recovery budget.',
              completed_at = $6::timestamptz,
              updated_at = $6::timestamptz
          FROM released_dispatch dispatch
          WHERE job.owner_id = $1
            AND job.id = dispatch.job_id
            AND dispatch.status = 'failed'
            AND job.status IN ('queued', 'running', 'verifying')
          RETURNING job.session_id
        ),
        failed_session AS (
          UPDATE learning_sessions session
          SET status = 'preparing', updated_at = $6::timestamptz
          FROM failed_job
          WHERE session.owner_id = $1 AND session.id = failed_job.session_id
          RETURNING session.id
        )
        SELECT id FROM released_dispatch
      `,
      [
        input.ownerId,
        input.dispatch.id,
        input.dispatch.jobId,
        input.error.slice(0, 4_000),
        input.retryAt,
        input.now,
        input.dispatch.leaseToken,
      ],
    )) as unknown as Array<{ id: string }>;
    return rows.length === 1;
  }

  async listDispatchRecoveryJobIds(
    ownerId: string,
    now: Date,
    publishedRecoveryBefore: Date,
    limit = 25,
  ): Promise<string[]> {
    const rows = (await getLearningSql().query(
      `
        SELECT DISTINCT dispatch.job_id
        FROM course_generation_dispatches dispatch
        JOIN course_generation_jobs job
          ON job.owner_id = dispatch.owner_id AND job.id = dispatch.job_id
        WHERE dispatch.owner_id = $1
          AND job.status IN ('queued', 'running', 'verifying')
          AND (
            (dispatch.status = 'pending' AND dispatch.not_before <= $2)
            OR (dispatch.status = 'publishing' AND dispatch.lease_expires_at < $2::timestamptz)
            OR (
              dispatch.status = 'published'
              AND dispatch.published_at <= $3::timestamptz
              AND NOT EXISTS (
                SELECT 1
                FROM course_generation_dispatches later
                WHERE later.owner_id = dispatch.owner_id
                  AND later.job_id = dispatch.job_id
                  AND later.dispatch_seq > dispatch.dispatch_seq
              )
              AND NOT EXISTS (
                SELECT 1
                FROM course_generation_steps active
                WHERE active.owner_id = dispatch.owner_id
                  AND active.job_id = dispatch.job_id
                  AND active.status = 'leased'
                  AND active.lease_expires_at >= $2::timestamptz
              )
            )
          )
        ORDER BY dispatch.job_id
        LIMIT $4
      `,
      [ownerId, now, publishedRecoveryBefore, Math.max(1, Math.min(100, Math.trunc(limit)))],
    )) as unknown as Array<{ job_id: string }>;
    return rows.map((row) => row.job_id);
  }

  async leaseNextStep(input: {
    ownerId: string;
    jobId: string;
    leaseToken: string;
    leaseExpiresAt: Date;
    now: Date;
  }): Promise<CourseGenerationStepRecord | null> {
    await this.failExpiredExhaustedSteps(input.ownerId, input.jobId, input.now);
    const rows = (await getLearningSql().query(
      `
        WITH candidate AS (
          SELECT step.id, step.status AS previous_status, step.attempt_count
          FROM course_generation_steps step
          JOIN course_generation_jobs job
            ON job.owner_id = step.owner_id AND job.id = step.job_id
          WHERE step.owner_id = $1
            AND step.job_id = $2
            AND job.status IN ('queued', 'running', 'verifying')
            AND step.attempt_count < step.max_attempts
            AND NOT EXISTS (
              SELECT 1
              FROM course_generation_steps active
              WHERE active.owner_id = step.owner_id
                AND active.job_id = step.job_id
                AND active.status = 'leased'
                AND active.lease_expires_at >= $3::timestamptz
            )
            AND (
              step.status IN ('pending', 'retryable')
              OR (step.status = 'leased' AND step.lease_expires_at < $3::timestamptz)
            )
            AND (
              (
                step.phase = 'content'
                AND NOT EXISTS (
                  SELECT 1
                  FROM course_generation_steps previous
                  WHERE previous.owner_id = step.owner_id
                    AND previous.job_id = step.job_id
                    AND previous.phase = 'actions'
                    AND previous.scene_order < step.scene_order
                    AND previous.status <> 'succeeded'
                )
              )
              OR (
                step.phase = 'actions'
                AND EXISTS (
                  SELECT 1
                  FROM course_generation_steps dependency
                  WHERE dependency.owner_id = step.owner_id
                    AND dependency.job_id = step.job_id
                    AND dependency.scene_order = step.scene_order
                    AND dependency.phase = 'content'
                    AND dependency.status = 'succeeded'
                )
              )
              OR (
                step.phase = 'release'
                AND (
                  SELECT count(*)
                  FROM course_generation_steps completed_actions
                  WHERE completed_actions.owner_id = step.owner_id
                    AND completed_actions.job_id = step.job_id
                    AND completed_actions.phase = 'actions'
                    AND completed_actions.status = 'succeeded'
                ) = job.outline_count
              )
            )
          ORDER BY
            CASE WHEN step.phase = 'release' THEN 1 ELSE step.scene_order END,
            CASE step.phase WHEN 'content' THEN 0 WHEN 'actions' THEN 1 ELSE 2 END
          LIMIT 1
          FOR UPDATE SKIP LOCKED
        ),
        expired_attempt AS (
          UPDATE course_generation_attempts attempt
          SET status = 'failed',
              error_code = 'WORKER_LEASE_EXPIRED',
              error_detail = 'The worker lease expired before the attempt committed a result.',
               completed_at = $3::timestamptz
          FROM candidate
          WHERE attempt.owner_id = $1
            AND attempt.step_id = candidate.id
            AND attempt.attempt_no = candidate.attempt_count
            AND attempt.status = 'running'
            AND candidate.previous_status = 'leased'
          RETURNING attempt.id
        ),
        leased_step AS (
          UPDATE course_generation_steps step
          SET status = 'leased',
              attempt_count = step.attempt_count + 1,
              lease_token = $4,
              lease_expires_at = $5::timestamptz,
              started_at = COALESCE(step.started_at, $3::timestamptz),
              updated_at = $3::timestamptz
          FROM candidate
          WHERE step.id = candidate.id
          RETURNING step.id, step.owner_id, step.job_id, step.scene_order, step.phase,
                    step.status, step.attempt_count, step.max_attempts, step.input_hash,
                    step.result_json, step.quality_json, step.lease_token, step.lease_expires_at,
                    step.last_error_code, step.last_error_detail, step.created_at,
                    step.updated_at, step.started_at, step.completed_at
        ),
        running_job AS (
          UPDATE course_generation_jobs job
          SET status = CASE WHEN leased.phase = 'release' THEN 'verifying' ELSE 'running' END,
              current_phase = leased.phase,
              current_scene_order = CASE WHEN leased.scene_order = 0 THEN NULL ELSE leased.scene_order END,
              started_at = COALESCE(job.started_at, $3::timestamptz),
              updated_at = $3::timestamptz
          FROM leased_step leased
          WHERE job.owner_id = $1 AND job.id = leased.job_id
          RETURNING job.id
        )
        SELECT id, owner_id, job_id, scene_order, phase, status, attempt_count,
               max_attempts, input_hash, result_json, quality_json, lease_token,
               lease_expires_at, last_error_code, last_error_detail, created_at,
               updated_at, started_at, completed_at
        FROM leased_step
      `,
      [input.ownerId, input.jobId, input.now, input.leaseToken, input.leaseExpiresAt],
    )) as StepRow[];
    const row = rows[0];
    if (!row) return null;
    return mapStep(row);
  }

  private async failExpiredExhaustedSteps(
    ownerId: string,
    jobId: string,
    now: Date,
  ): Promise<void> {
    await getLearningSql().query(
      `
        WITH failed_steps AS (
          UPDATE course_generation_steps
          SET status = 'failed', lease_token = NULL, lease_expires_at = NULL,
              last_error_code = 'WORKER_LEASE_EXHAUSTED',
              last_error_detail = 'The worker lease expired after the recovery budget was exhausted.',
               completed_at = $3::timestamptz, updated_at = $3::timestamptz
          WHERE owner_id = $1 AND job_id = $2 AND status = 'leased'
            AND lease_expires_at < $3::timestamptz AND attempt_count >= max_attempts
          RETURNING id, job_id, attempt_count
        ),
        failed_attempts AS (
          UPDATE course_generation_attempts attempt
          SET status = 'failed',
              error_code = 'WORKER_LEASE_EXHAUSTED',
              error_detail = 'The worker lease expired after the recovery budget was exhausted.',
               completed_at = $3::timestamptz
          FROM failed_steps step
          WHERE attempt.owner_id = $1
            AND attempt.step_id = step.id
            AND attempt.attempt_no = step.attempt_count
            AND attempt.status = 'running'
          RETURNING attempt.id
        ),
        failed_job AS (
          UPDATE course_generation_jobs job
          SET status = 'failed', current_phase = 'failed',
              last_error_code = 'WORKER_LEASE_EXHAUSTED',
              last_error_detail = 'A generation step exhausted its durable recovery budget.',
               completed_at = $3::timestamptz, updated_at = $3::timestamptz
          WHERE job.owner_id = $1 AND job.id = $2
            AND job.status IN ('queued', 'running', 'verifying')
            AND EXISTS (SELECT 1 FROM failed_steps)
          RETURNING job.session_id
        ),
        failed_session AS (
          UPDATE learning_sessions session
          SET status = 'preparing', updated_at = $3::timestamptz
          FROM failed_job
          WHERE session.owner_id = $1 AND session.id = failed_job.session_id
          RETURNING session.id
        )
        SELECT id FROM failed_steps
      `,
      [ownerId, jobId, now],
    );
  }

  async beginAttempt(
    ownerId: string,
    step: CourseGenerationStepRecord,
    now: Date,
  ): Promise<CourseGenerationAttemptRecord> {
    if (!step.leaseToken) throw new CourseGenerationLeaseLostError(step.id);
    const attemptId = id('cga');
    const rows = (await getLearningSql().query(
      `
        INSERT INTO course_generation_attempts
          (id, owner_id, job_id, step_id, attempt_no, status, input_hash, started_at)
        SELECT $1, $2, $3, $4, $5, 'running', $6, $7
        FROM course_generation_steps step
        WHERE step.owner_id = $2
          AND step.id = $4
          AND step.job_id = $3
          AND step.status = 'leased'
          AND step.lease_token = $8
          AND step.attempt_count = $5
        ON CONFLICT (owner_id, step_id, attempt_no) DO UPDATE
        SET status = 'running', error_code = NULL, error_detail = NULL,
            quality_score = NULL, started_at = EXCLUDED.started_at, completed_at = NULL
        RETURNING id, owner_id, job_id, step_id, attempt_no, status, input_hash,
                  quality_score, error_code, error_detail, started_at, completed_at
      `,
      [
        attemptId,
        ownerId,
        step.jobId,
        step.id,
        step.attemptCount,
        step.inputHash,
        now,
        step.leaseToken,
      ],
    )) as AttemptRow[];
    const row = rows[0];
    if (!row) throw new CourseGenerationLeaseLostError(step.id);
    return mapAttempt(row);
  }

  async completeStep(input: {
    ownerId: string;
    step: CourseGenerationStepRecord;
    attemptId: string;
    result: Record<string, unknown>;
    quality: Record<string, unknown>;
    qualityScore: number;
    now: Date;
  }): Promise<void> {
    const dispatchId = id('cgd');
    const stepRows = (await getLearningSql().query(
      `
        WITH attempt_guard AS (
          SELECT id
          FROM course_generation_attempts
          WHERE owner_id = $1
            AND id = $7
            AND step_id = $2
            AND attempt_no = $10
            AND status = 'running'
          FOR UPDATE
        ),
        completed_step AS (
          UPDATE course_generation_steps
          SET status = 'succeeded', result_json = $4::jsonb, quality_json = $5::jsonb,
              lease_token = NULL, lease_expires_at = NULL, last_error_code = NULL,
              last_error_detail = NULL, completed_at = $6::timestamptz, updated_at = $6::timestamptz
          WHERE owner_id = $1
            AND id = $2
            AND job_id = $8
            AND status = 'leased'
            AND lease_token = $3
            AND attempt_count = $10
            AND EXISTS (SELECT 1 FROM attempt_guard)
            AND EXISTS (
              SELECT 1
              FROM course_generation_jobs job
              WHERE job.owner_id = $1
                AND job.id = $8
                AND job.status IN ('queued', 'running', 'verifying')
            )
          RETURNING id, job_id
        ),
        completed_attempt AS (
          UPDATE course_generation_attempts attempt
           SET status = 'succeeded', quality_score = $9, completed_at = $6::timestamptz
          FROM completed_step step
          WHERE attempt.owner_id = $1
            AND attempt.id = $7
            AND attempt.step_id = step.id
          RETURNING attempt.id
        ),
        updated_job AS (
          UPDATE course_generation_jobs job
          SET scenes_generated =
                progress.actions_succeeded + CASE WHEN $12 = 'actions' THEN 1 ELSE 0 END,
              progress = LEAST(
                99,
                floor(
                  (((progress.steps_succeeded + 1)::numeric / (job.outline_count * 2 + 1)) * 100)
                )::integer
              ),
              updated_at = $6::timestamptz
          FROM (
            SELECT
              count(*) FILTER (WHERE status = 'succeeded')::integer AS steps_succeeded,
              count(*) FILTER (WHERE phase = 'actions' AND status = 'succeeded')::integer
                AS actions_succeeded
            FROM course_generation_steps
            WHERE owner_id = $1 AND job_id = $8
          ) progress
          WHERE job.owner_id = $1
            AND job.id = $8
            AND job.status IN ('queued', 'running', 'verifying')
            AND EXISTS (SELECT 1 FROM completed_step)
            AND EXISTS (SELECT 1 FROM completed_attempt)
          RETURNING job.id
        ),
        queued_dispatch AS (
          INSERT INTO course_generation_dispatches
            (id, owner_id, job_id, dispatch_seq, status, not_before,
             attempt_count, created_at, updated_at)
          SELECT $11, $1, $8,
                 COALESCE(
                   (SELECT max(dispatch_seq) + 1
                    FROM course_generation_dispatches
                    WHERE owner_id = $1 AND job_id = $8),
                   1
                 ),
                 'pending', $6, 0, $6, $6
          FROM updated_job
          WHERE NOT EXISTS (
            SELECT 1
            FROM course_generation_dispatches outstanding
            WHERE outstanding.owner_id = $1
              AND outstanding.job_id = $8
              AND outstanding.status IN ('pending', 'publishing')
          )
          ON CONFLICT (owner_id, job_id, dispatch_seq) DO NOTHING
          RETURNING id
        )
        SELECT id FROM completed_step
        WHERE EXISTS (SELECT 1 FROM completed_attempt)
      `,
      [
        input.ownerId,
        input.step.id,
        input.step.leaseToken,
        JSON.stringify(input.result),
        JSON.stringify(input.quality),
        input.now,
        input.attemptId,
        input.step.jobId,
        input.qualityScore,
        input.step.attemptCount,
        dispatchId,
        input.step.phase,
      ],
    )) as unknown as Array<{ id: string }>;
    if (stepRows.length !== 1) throw new CourseGenerationLeaseLostError(input.step.id);
  }

  async rejectStep(input: {
    ownerId: string;
    step: CourseGenerationStepRecord;
    attemptId: string;
    errorCode: string;
    errorDetail: string;
    quality?: Record<string, unknown>;
    qualityScore?: number;
    retryable: boolean;
    now: Date;
  }): Promise<boolean> {
    const exhausted = input.step.attemptCount >= input.step.maxAttempts;
    const retryable = input.retryable && !exhausted;
    const sql = getLearningSql();
    const nextStatus = retryable ? 'retryable' : 'failed';
    const dispatchId = id('cgd');
    const [stepRows] = (await sql.transaction((tx) => [
      tx.query(
        `
          UPDATE course_generation_steps
          SET status = $4::text, quality_json = COALESCE($5::jsonb, quality_json),
              lease_token = NULL, lease_expires_at = NULL, last_error_code = $6,
              last_error_detail = $7,
              completed_at = CASE
                WHEN $4::text = 'failed' THEN $8::timestamptz
                ELSE NULL::timestamptz
              END,
              updated_at = $8::timestamptz
          WHERE owner_id = $1 AND id = $2 AND status = 'leased' AND lease_token = $3
            AND attempt_count = $9
            AND EXISTS (
              SELECT 1
              FROM course_generation_attempts attempt
              WHERE attempt.owner_id = $1
                AND attempt.id = $10
                AND attempt.step_id = $2
                AND attempt.attempt_no = $9
                AND attempt.status = 'running'
            )
          RETURNING id
        `,
        [
          input.ownerId,
          input.step.id,
          input.step.leaseToken,
          nextStatus,
          input.quality ? JSON.stringify(input.quality) : null,
          input.errorCode,
          input.errorDetail.slice(0, 8_000),
          input.now,
          input.step.attemptCount,
          input.attemptId,
        ],
      ),
      tx.query(
        `
          INSERT INTO course_generation_dispatches
            (id, owner_id, job_id, dispatch_seq, status, not_before,
             attempt_count, created_at, updated_at)
          SELECT $1, $2, $3,
                 COALESCE(
                   (SELECT max(dispatch_seq) + 1
                    FROM course_generation_dispatches
                    WHERE owner_id = $2 AND job_id = $3),
                   1
                 ),
                 'pending', $4::timestamptz, 0, $4::timestamptz, $4::timestamptz
          WHERE $5::boolean = true
            AND EXISTS (
              SELECT 1
              FROM course_generation_steps step
              WHERE step.owner_id = $2 AND step.id = $6
                AND step.status = 'retryable' AND step.updated_at = $4::timestamptz
            )
            AND NOT EXISTS (
              SELECT 1
              FROM course_generation_dispatches outstanding
              WHERE outstanding.owner_id = $2
                AND outstanding.job_id = $3
                AND outstanding.status IN ('pending', 'publishing')
            )
          ON CONFLICT (owner_id, job_id, dispatch_seq) DO NOTHING
        `,
        [dispatchId, input.ownerId, input.step.jobId, input.now, retryable, input.step.id],
      ),
      tx.query(
        `
          UPDATE course_generation_attempts attempt
          SET status = $4, quality_score = $5, error_code = $6,
              error_detail = $7, completed_at = $8::timestamptz
          WHERE owner_id = $1 AND id = $2 AND step_id = $3
            AND EXISTS (
              SELECT 1 FROM course_generation_steps step
              WHERE step.owner_id = attempt.owner_id AND step.id = attempt.step_id
                AND step.status = $9 AND step.updated_at = $8::timestamptz
            )
        `,
        [
          input.ownerId,
          input.attemptId,
          input.step.id,
          input.quality ? 'rejected' : 'failed',
          input.qualityScore ?? null,
          input.errorCode,
          input.errorDetail.slice(0, 8_000),
          input.now,
          nextStatus,
        ],
      ),
      tx.query(
        `
          UPDATE course_generation_jobs
          SET status = 'failed', current_phase = 'failed', last_error_code = $3,
              last_error_detail = $4, completed_at = $5::timestamptz,
              updated_at = $5::timestamptz
          WHERE owner_id = $1 AND id = $2
            AND $6::boolean = true
            AND EXISTS (
              SELECT 1 FROM course_generation_steps step
              WHERE step.owner_id = $1 AND step.id = $7
                AND step.status = 'failed' AND step.updated_at = $5::timestamptz
            )
        `,
        [
          input.ownerId,
          input.step.jobId,
          input.errorCode,
          input.errorDetail.slice(0, 8_000),
          input.now,
          !retryable,
          input.step.id,
        ],
      ),
      tx.query(
        `
          UPDATE learning_sessions session
          SET status = 'preparing', updated_at = $3::timestamptz
          FROM course_generation_jobs job
          WHERE job.owner_id = $1 AND job.id = $2
            AND job.status = 'failed'
            AND session.owner_id = job.owner_id AND session.id = job.session_id
        `,
        [input.ownerId, input.step.jobId, input.now],
      ),
    ])) as unknown as [Array<{ id: string }>, ...unknown[]];
    return stepRows.length === 1;
  }

  async reopenFailedJobForRepair(input: {
    ownerId: string;
    jobId: string;
    now: Date;
  }): Promise<CourseGenerationJobRecord | null> {
    const dispatchId = id('cgd');
    const rows = (await getLearningSql().query(
      `
        WITH failed_step AS (
          SELECT step.id, step.scene_order, step.phase, step.attempt_count
          FROM course_generation_steps step
          JOIN course_generation_jobs job
            ON job.owner_id = step.owner_id AND job.id = step.job_id
          WHERE step.owner_id = $1
            AND step.job_id = $2
            AND step.status = 'failed'
            AND step.attempt_count < ${MAX_COURSE_STEP_ATTEMPTS}
            AND job.status = 'failed'
            AND (
              step.last_error_code IN (
                'QUALITY_GATE_FAILED',
                'GENERATION_FAILED',
                'generation_step_failed',
                'GENERATION_DEADLINE_EXCEEDED',
                'WORKER_LEASE_EXHAUSTED'
              )
              OR step.last_error_code LIKE 'generation_http_%'
            )
          ORDER BY step.updated_at DESC
          LIMIT 1
        ),
        reopened_step AS (
          UPDATE course_generation_steps step
          SET status = 'retryable',
              max_attempts = LEAST(
                ${MAX_COURSE_STEP_ATTEMPTS},
                GREATEST(
                  step.max_attempts,
                  step.attempt_count + ${MANUAL_REPAIR_ATTEMPT_INCREMENT}
                )
              ),
              lease_token = NULL,
              lease_expires_at = NULL,
              completed_at = NULL,
              updated_at = $3::timestamptz
          FROM failed_step failed
          WHERE step.owner_id = $1
            AND step.id = failed.id
            AND step.status = 'failed'
          RETURNING step.scene_order, step.phase
        ),
        resumed_job AS (
          UPDATE course_generation_jobs job
          SET status = 'running',
              current_phase = reopened.phase,
              current_scene_order = CASE
                WHEN reopened.phase = 'release' THEN NULL
                ELSE reopened.scene_order
              END,
              progress = CASE
                WHEN reopened.phase = 'release' THEN 98
                ELSE job.progress
              END,
              last_error_code = 'QUALITY_REPAIR_RESUMED',
              last_error_detail = 'Resuming from the failed durable scene with its saved quality evidence.',
              completed_at = NULL,
              updated_at = $3::timestamptz
          FROM reopened_step reopened
          WHERE job.owner_id = $1 AND job.id = $2 AND job.status = 'failed'
          RETURNING job.id, job.session_id
        ),
        resumed_session AS (
          UPDATE learning_sessions session
          SET status = 'generating', updated_at = $3::timestamptz
          FROM resumed_job job
          WHERE session.owner_id = $1 AND session.id = job.session_id
          RETURNING session.id
        ),
        queued_dispatch AS (
          INSERT INTO course_generation_dispatches
            (id, owner_id, job_id, dispatch_seq, status, not_before,
             attempt_count, created_at, updated_at)
          SELECT $4, $1, $2,
                 COALESCE(
                   (SELECT max(dispatch_seq) + 1
                    FROM course_generation_dispatches
                    WHERE owner_id = $1 AND job_id = $2),
                   1
                 ),
                 'pending', $3::timestamptz, 0, $3::timestamptz, $3::timestamptz
          FROM resumed_job
          WHERE NOT EXISTS (
            SELECT 1
            FROM course_generation_dispatches outstanding
            WHERE outstanding.owner_id = $1
              AND outstanding.job_id = $2
              AND outstanding.status IN ('pending', 'publishing')
          )
          ON CONFLICT (owner_id, job_id, dispatch_seq) DO NOTHING
          RETURNING id
        )
        SELECT id FROM resumed_job
      `,
      [input.ownerId, input.jobId, input.now, dispatchId],
    )) as Array<{ id: string }>;
    if (rows.length !== 1) return null;
    return this.find(input.ownerId, input.jobId);
  }

  async findStep(
    ownerId: string,
    jobId: string,
    sceneOrder: number,
    phase: CourseGenerationStepPhase,
  ): Promise<CourseGenerationStepRecord | null> {
    const rows = (await getLearningSql().query(
      `${STEP_SELECT}
       WHERE owner_id = $1 AND job_id = $2 AND scene_order = $3 AND phase = $4`,
      [ownerId, jobId, sceneOrder, phase],
    )) as StepRow[];
    return rows[0] ? mapStep(rows[0]) : null;
  }

  async listSucceededActionSteps(
    ownerId: string,
    jobId: string,
  ): Promise<CourseGenerationStepRecord[]> {
    const rows = (await getLearningSql().query(
      `${STEP_SELECT}
       WHERE owner_id = $1 AND job_id = $2 AND phase = 'actions' AND status = 'succeeded'
       ORDER BY scene_order`,
      [ownerId, jobId],
    )) as StepRow[];
    return rows.map(mapStep);
  }

  async finalizeRelease(input: {
    ownerId: string;
    jobId: string;
    step: CourseGenerationStepRecord;
    attemptId: string;
    classroomId: string;
    outlineCount: number;
    sceneCount: number;
    qualityScore: number;
    quality: Record<string, unknown>;
    snapshotSha256: string;
    snapshotByteSize: number;
    snapshotBlobPathname?: string;
    snapshotBlobUrl?: string;
    now: Date;
  }): Promise<CourseReleaseRecord> {
    const hasBlobPathname = Boolean(input.snapshotBlobPathname);
    const hasBlobUrl = Boolean(input.snapshotBlobUrl);
    if (
      input.sceneCount !== input.outlineCount ||
      input.outlineCount < 9 ||
      input.outlineCount > 12 ||
      !Number.isFinite(input.qualityScore) ||
      input.qualityScore < 93 ||
      !/^[a-f0-9]{64}$/.test(input.snapshotSha256) ||
      !Number.isInteger(input.snapshotByteSize) ||
      input.snapshotByteSize <= 0 ||
      input.snapshotByteSize > MAX_CLASSROOM_API_RESPONSE_BYTES ||
      hasBlobPathname !== hasBlobUrl
    ) {
      throw new Error('invalid_course_release_snapshot_metadata');
    }
    const releaseId = id('crl');
    const releaseResult = {
      releaseId,
      classroomId: input.classroomId,
      snapshotSha256: input.snapshotSha256,
      snapshotByteSize: input.snapshotByteSize,
      sceneCount: input.sceneCount,
      qualityScore: input.qualityScore,
    };
    const rows = (await getLearningSql().query(
      `
        WITH attempt_guard AS (
          SELECT id
          FROM course_generation_attempts
          WHERE owner_id = $1
            AND id = $6
            AND step_id = $4
            AND attempt_no = $15
            AND status = 'running'
          FOR UPDATE
        ),
        completed_step AS (
          UPDATE course_generation_steps
          SET status = 'succeeded',
              result_json = $12::jsonb,
              quality_json = $9::jsonb,
              lease_token = NULL,
              lease_expires_at = NULL,
              last_error_code = NULL,
              last_error_detail = NULL,
              completed_at = $11::timestamptz,
              updated_at = $11::timestamptz
          WHERE owner_id = $1
            AND id = $4
            AND job_id = $2
            AND phase = 'release'
            AND status = 'leased'
            AND lease_token = $5
            AND attempt_count = $15
            AND EXISTS (SELECT 1 FROM attempt_guard)
            AND (
              SELECT count(*)
              FROM course_generation_steps completed_actions
              WHERE completed_actions.owner_id = $1
                AND completed_actions.job_id = $2
                AND completed_actions.phase = 'actions'
                AND completed_actions.status = 'succeeded'
            ) = $10
            AND (
              NOT EXISTS (
                SELECT 1
                FROM course_releases existing
                WHERE existing.owner_id = $1 AND existing.job_id = $2
              )
              OR EXISTS (
                SELECT 1
                FROM course_releases existing
                WHERE existing.owner_id = $1
                  AND existing.job_id = $2
                  AND existing.classroom_id = $7
                  AND existing.outline_count = $10
                  AND existing.scene_count = $13
                  AND existing.quality_score = $8
                  AND existing.quality_json = $9::jsonb
                  AND existing.snapshot_sha256 = $14
              )
            )
          RETURNING id, job_id
        ),
        completed_attempt AS (
          UPDATE course_generation_attempts
           SET status = 'succeeded', quality_score = $8, completed_at = $11::timestamptz
          WHERE owner_id = $1 AND id = $6 AND step_id = $4
            AND EXISTS (SELECT 1 FROM completed_step)
          RETURNING id
        ),
        classroom_snapshot AS (
          INSERT INTO learning_classrooms
            (owner_id, classroom_id, revision, snapshot_blob_pathname, snapshot_blob_url,
             snapshot_sha256, snapshot_byte_size, scene_count, created_at, updated_at)
           SELECT $1, $7, 1, $16, $17, $14, $18, $13, $11::timestamptz, $11::timestamptz
          FROM completed_attempt
          WHERE $16::text IS NOT NULL AND $17::text IS NOT NULL
          ON CONFLICT (owner_id, classroom_id) DO UPDATE
          SET revision = CASE
                WHEN learning_classrooms.snapshot_sha256 = EXCLUDED.snapshot_sha256
                  THEN learning_classrooms.revision
                ELSE learning_classrooms.revision + 1
              END,
              snapshot_blob_pathname = EXCLUDED.snapshot_blob_pathname,
              snapshot_blob_url = EXCLUDED.snapshot_blob_url,
              snapshot_sha256 = EXCLUDED.snapshot_sha256,
              snapshot_byte_size = EXCLUDED.snapshot_byte_size,
              scene_count = EXCLUDED.scene_count,
              updated_at = EXCLUDED.updated_at
          RETURNING classroom_id
        ),
        published_release AS (
          INSERT INTO course_releases
            (id, owner_id, job_id, classroom_id, release_version, outline_count,
             scene_count, quality_score, quality_json, snapshot_sha256, created_at)
           SELECT $3, $1, $2, $7, 1, $10, $13, $8, $9::jsonb, $14, $11::timestamptz
          FROM completed_attempt
          WHERE ($16::text IS NULL OR EXISTS (SELECT 1 FROM classroom_snapshot))
            AND (
              SELECT count(*)
              FROM course_generation_steps completed_actions
              WHERE completed_actions.owner_id = $1
                AND completed_actions.job_id = $2
                AND completed_actions.phase = 'actions'
                AND completed_actions.status = 'succeeded'
            ) = $10
          ON CONFLICT (owner_id, job_id) DO UPDATE
          SET snapshot_sha256 = course_releases.snapshot_sha256
          WHERE course_releases.classroom_id = EXCLUDED.classroom_id
            AND course_releases.outline_count = EXCLUDED.outline_count
            AND course_releases.scene_count = EXCLUDED.scene_count
            AND course_releases.quality_score = EXCLUDED.quality_score
            AND course_releases.quality_json = EXCLUDED.quality_json
            AND course_releases.snapshot_sha256 = EXCLUDED.snapshot_sha256
          RETURNING id, owner_id, job_id, classroom_id, release_version, outline_count,
                    scene_count, quality_score, quality_json, snapshot_sha256, created_at
        ),
        ready_job AS (
          UPDATE course_generation_jobs
          SET status = 'ready',
              current_phase = 'completed',
              current_scene_order = NULL,
              scenes_generated = outline_count,
              progress = 100,
              quality_summary = $9::jsonb,
              last_error_code = NULL,
              last_error_detail = NULL,
              completed_at = $11::timestamptz,
              updated_at = $11::timestamptz
          WHERE owner_id = $1 AND id = $2
            AND status IN ('queued', 'running', 'verifying')
            AND EXISTS (SELECT 1 FROM published_release)
          RETURNING session_id
        ),
        ready_session AS (
          UPDATE learning_sessions session
          SET status = 'ready', updated_at = $11::timestamptz
          FROM ready_job
          WHERE session.owner_id = $1 AND session.id = ready_job.session_id
          RETURNING session.id
        )
        SELECT id, owner_id, job_id, classroom_id, release_version, outline_count,
               scene_count, quality_score, quality_json, snapshot_sha256, created_at
        FROM published_release
      `,
      [
        input.ownerId,
        input.jobId,
        releaseId,
        input.step.id,
        input.step.leaseToken,
        input.attemptId,
        input.classroomId,
        input.qualityScore,
        JSON.stringify(input.quality),
        input.outlineCount,
        input.now,
        JSON.stringify(releaseResult),
        input.sceneCount,
        input.snapshotSha256,
        input.step.attemptCount,
        input.snapshotBlobPathname ?? null,
        input.snapshotBlobUrl ?? null,
        input.snapshotByteSize,
      ],
    )) as ReleaseRow[];
    const row = rows[0];
    if (!row) throw new CourseGenerationLeaseLostError(input.step.id);
    return mapRelease(row);
  }

  async findRelease(ownerId: string, jobId: string): Promise<CourseReleaseRecord | null> {
    const rows = (await getLearningSql().query(
      `
        SELECT id, owner_id, job_id, classroom_id, release_version, outline_count,
               scene_count, quality_score, quality_json, snapshot_sha256, created_at
        FROM course_releases
        WHERE owner_id = $1 AND job_id = $2
      `,
      [ownerId, jobId],
    )) as ReleaseRow[];
    return rows[0] ? mapRelease(rows[0]) : null;
  }

  async reopenWeakScenesForRepair(input: {
    ownerId: string;
    jobId: string;
    step: CourseGenerationStepRecord;
    attemptId: string;
    sceneOrders: readonly number[];
    quality: Record<string, unknown>;
    qualityScore?: number;
    errorDetail: string;
    now: Date;
  }): Promise<boolean> {
    const sceneOrders = [
      ...new Set(
        input.sceneOrders
          .filter((order) => Number.isInteger(order) && order >= 1)
          .map((order) => Math.trunc(order)),
      ),
    ].slice(0, 4);
    if (
      sceneOrders.length === 0 ||
      input.step.attemptCount >= input.step.maxAttempts ||
      !input.step.leaseToken
    ) {
      return false;
    }
    const rows = (await getLearningSql().query(
      `
        WITH repair_budget AS (
          SELECT count(*)::integer AS step_count,
                 bool_and(attempt_count < max_attempts) AS available
          FROM course_generation_steps
          WHERE owner_id = $1
            AND job_id = $2
            AND scene_order = ANY($6::integer[])
            AND phase IN ('content', 'actions')
            AND status = 'succeeded'
        ),
        rejected_release AS (
          UPDATE course_generation_steps
          SET status = 'retryable',
              quality_json = $8::jsonb,
              lease_token = NULL,
              lease_expires_at = NULL,
              last_error_code = 'COURSE_TARGETED_REPAIR',
              last_error_detail = $7,
              completed_at = NULL,
              updated_at = $9::timestamptz
          WHERE owner_id = $1
            AND id = $3
            AND job_id = $2
            AND phase = 'release'
            AND status = 'leased'
            AND lease_token = $4
            AND attempt_count = $12
            AND EXISTS (
              SELECT 1
              FROM course_generation_attempts attempt
              WHERE attempt.owner_id = $1
                AND attempt.id = $5
                AND attempt.step_id = $3
                AND attempt.attempt_no = $12
                AND attempt.status = 'running'
            )
            AND EXISTS (
              SELECT 1
              FROM repair_budget
              WHERE available = true AND step_count = cardinality($6::integer[]) * 2
            )
          RETURNING id
        ),
        rejected_attempt AS (
          UPDATE course_generation_attempts
          SET status = 'rejected',
              quality_score = $10,
              error_code = 'COURSE_TARGETED_REPAIR',
              error_detail = $7,
              completed_at = $9::timestamptz
          WHERE owner_id = $1 AND id = $5 AND step_id = $3
            AND EXISTS (SELECT 1 FROM rejected_release)
          RETURNING id
        ),
        reopened_steps AS (
          UPDATE course_generation_steps
          SET status = 'retryable',
              result_json = NULL,
              quality_json = $8::jsonb,
              lease_token = NULL,
              lease_expires_at = NULL,
              last_error_code = 'COURSE_TARGETED_REPAIR',
              last_error_detail = $7,
              completed_at = NULL,
              updated_at = $9::timestamptz
          WHERE owner_id = $1
            AND job_id = $2
            AND scene_order = ANY($6::integer[])
            AND phase IN ('content', 'actions')
            AND status = 'succeeded'
            AND EXISTS (SELECT 1 FROM rejected_release)
          RETURNING id
        ),
        resumed_job AS (
          UPDATE course_generation_jobs
          SET status = 'running',
              current_phase = 'content',
              current_scene_order = (SELECT min(value) FROM unnest($6::integer[]) AS value),
              scenes_generated = GREATEST(0, outline_count - cardinality($6::integer[])),
              progress = LEAST(
                98,
                floor(
                  (
                    ((outline_count * 2 - cardinality($6::integer[]) * 2)::numeric /
                      (outline_count * 2 + 1)) * 100
                  )
                )::integer
              ),
              last_error_code = 'COURSE_TARGETED_REPAIR',
              last_error_detail = $7,
              completed_at = NULL,
              updated_at = $9::timestamptz
          WHERE owner_id = $1 AND id = $2
            AND EXISTS (SELECT 1 FROM rejected_release)
          RETURNING session_id
        ),
        resumed_session AS (
          UPDATE learning_sessions session
          SET status = 'generating', updated_at = $9::timestamptz
          FROM resumed_job
          WHERE session.owner_id = $1 AND session.id = resumed_job.session_id
          RETURNING session.id
        ),
        queued_dispatch AS (
          INSERT INTO course_generation_dispatches
            (id, owner_id, job_id, dispatch_seq, status, not_before,
             attempt_count, created_at, updated_at)
          SELECT $11, $1, $2,
                 COALESCE(
                   (SELECT max(dispatch_seq) + 1
                    FROM course_generation_dispatches
                    WHERE owner_id = $1 AND job_id = $2),
                   1
                 ),
                 'pending', $9, 0, $9, $9
          FROM rejected_release
          WHERE NOT EXISTS (
            SELECT 1
            FROM course_generation_dispatches outstanding
            WHERE outstanding.owner_id = $1
              AND outstanding.job_id = $2
              AND outstanding.status IN ('pending', 'publishing')
          )
          ON CONFLICT (owner_id, job_id, dispatch_seq) DO NOTHING
          RETURNING id
        )
        SELECT id FROM rejected_release
      `,
      [
        input.ownerId,
        input.jobId,
        input.step.id,
        input.step.leaseToken,
        input.attemptId,
        sceneOrders,
        input.errorDetail.slice(0, 8_000),
        JSON.stringify(input.quality),
        input.now,
        input.qualityScore ?? null,
        id('cgd'),
        input.step.attemptCount,
      ],
    )) as unknown as Array<{ id: string }>;
    return rows.length === 1;
  }
}
