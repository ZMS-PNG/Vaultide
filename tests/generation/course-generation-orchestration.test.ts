import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CourseQualityAssessment } from '@/lib/generation/course-quality';
import type {
  CourseGenerationJobRecord,
  CourseGenerationStepRecord,
} from '@/lib/generation/orchestration/types';
import type { PersistedClassroomData } from '@/lib/server/classroom-storage';
import type { SceneOutline } from '@/lib/types/generation';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('@/lib/learning/adapters/neon/client', () => ({
  getLearningSql: () => ({
    query: mocks.query,
    transaction: mocks.transaction,
  }),
}));

import {
  assertClassroomSnapshotFitsFunctionResponse,
  buildDeterministicClassroomSnapshot,
  CourseClassroomSnapshotTooLargeError,
  MAX_CLASSROOM_API_RESPONSE_BYTES,
} from '@/lib/generation/orchestration/classroom-snapshot';
import {
  CourseGenerationLeaseLostError,
  NeonCourseGenerationRepository,
} from '@/lib/generation/orchestration/repository';
import { selectTargetedRepairSceneOrders } from '@/lib/generation/orchestration/repair-selection';

const OWNER_ID = `own_${'1'.repeat(32)}`;
const JOB_ID = `cgj_${'2'.repeat(32)}`;
const STEP_ID = `cgs_${'3'.repeat(32)}`;
const ATTEMPT_ID = `cga_${'4'.repeat(32)}`;
const CLASSROOM_ID = 'durable-course-test';
const LEASE_TOKEN = 'lease-token-1';
const NOW = new Date('2026-07-28T12:00:00.000Z');

function step(overrides: Partial<CourseGenerationStepRecord> = {}): CourseGenerationStepRecord {
  return {
    id: STEP_ID,
    ownerId: OWNER_ID,
    jobId: JOB_ID,
    sceneOrder: 1,
    phase: 'content',
    status: 'leased',
    attemptCount: 1,
    maxAttempts: 5,
    inputHash: 'a'.repeat(64),
    leaseToken: LEASE_TOKEN,
    leaseExpiresAt: new Date(NOW.getTime() + 60_000),
    createdAt: NOW,
    updatedAt: NOW,
    startedAt: NOW,
    ...overrides,
  };
}

function stepRow(overrides: Record<string, unknown> = {}) {
  return {
    id: STEP_ID,
    owner_id: OWNER_ID,
    job_id: JOB_ID,
    scene_order: 1,
    phase: 'content',
    status: 'leased',
    attempt_count: 1,
    max_attempts: 5,
    input_hash: 'a'.repeat(64),
    result_json: null,
    quality_json: null,
    lease_token: LEASE_TOKEN,
    lease_expires_at: new Date(NOW.getTime() + 60_000),
    last_error_code: null,
    last_error_detail: null,
    created_at: NOW,
    updated_at: NOW,
    started_at: NOW,
    completed_at: null,
    ...overrides,
  };
}

function attemptRow() {
  return {
    id: ATTEMPT_ID,
    owner_id: OWNER_ID,
    job_id: JOB_ID,
    step_id: STEP_ID,
    attempt_no: 1,
    status: 'running',
    input_hash: 'a'.repeat(64),
    quality_score: null,
    error_code: null,
    error_detail: null,
    started_at: NOW,
    completed_at: null,
  };
}

function releaseRow() {
  return {
    id: `crl_${'5'.repeat(32)}`,
    owner_id: OWNER_ID,
    job_id: JOB_ID,
    classroom_id: CLASSROOM_ID,
    release_version: 1,
    outline_count: 9,
    scene_count: 9,
    quality_score: 95,
    quality_json: { passed: true, score: 95, issues: [], metrics: {} },
    snapshot_sha256: 'b'.repeat(64),
    created_at: NOW,
  };
}

describe('durable course generation orchestration contracts', () => {
  beforeEach(() => {
    mocks.query.mockReset();
    mocks.transaction.mockReset();
  });

  it('fails closed before publishing a classroom response near the Vercel payload ceiling', () => {
    const small = {
      id: CLASSROOM_ID,
      stage: { id: CLASSROOM_ID },
      scenes: [],
      createdAt: NOW.toISOString(),
    } as unknown as PersistedClassroomData;
    expect(assertClassroomSnapshotFitsFunctionResponse(small)).toBeLessThan(
      MAX_CLASSROOM_API_RESPONSE_BYTES,
    );

    const oversized = {
      ...small,
      stage: {
        id: CLASSROOM_ID,
        description: 'x'.repeat(MAX_CLASSROOM_API_RESPONSE_BYTES),
      },
    } as unknown as PersistedClassroomData;
    expect(() => assertClassroomSnapshotFitsFunctionResponse(oversized)).toThrow(
      CourseClassroomSnapshotTooLargeError,
    );
  });

  it('builds byte-stable release snapshots across crash retries', () => {
    const releaseStep = step({ sceneOrder: 0, phase: 'release' });
    const job = {
      id: JOB_ID,
      ownerId: OWNER_ID,
      sessionId: `lsn_${'6'.repeat(32)}`,
      contextPackId: `ctx_${'7'.repeat(32)}`,
      classroomId: CLASSROOM_ID,
      createdAt: new Date('2026-07-28T10:00:00.000Z'),
      startedAt: new Date('2026-07-28T10:01:00.000Z'),
      input: {
        stage: { id: CLASSROOM_ID, updatedAt: 0 },
        outlines: [],
      },
    } as unknown as CourseGenerationJobRecord;
    const left = buildDeterministicClassroomSnapshot({ job, releaseStep, scenes: [] });
    const right = buildDeterministicClassroomSnapshot({ job, releaseStep, scenes: [] });
    expect(JSON.stringify(left)).toBe(JSON.stringify(right));
    expect(left.stage.updatedAt).toBe(NOW.getTime());
  });

  it('repairs only explicitly identified release issue scenes', () => {
    const outlines = Array.from(
      { length: 9 },
      (_, index) => ({ order: index + 1 }) as SceneOutline,
    );
    const quality: CourseQualityAssessment = {
      passed: false,
      score: 88,
      issues: [
        {
          code: 'course_near_duplicate',
          message: 'duplicate',
          retryInstruction: 'repair scene 8',
          severity: 'error',
          sceneOrder: 8,
        },
      ],
      metrics: {},
    };
    expect(
      selectTargetedRepairSceneOrders({
        outlines,
        quality,
        sceneScores: [94, 94, 89, 94, 92, 94, 94, 95, 94],
      }),
    ).toEqual([8]);
  });

  it('uses weak-score fallback only when release quality has no explicit scene order', () => {
    const outlines = Array.from(
      { length: 5 },
      (_, index) => ({ order: index + 1 }) as SceneOutline,
    );
    const quality: CourseQualityAssessment = {
      passed: false,
      score: 88,
      issues: [
        {
          code: 'course_structure',
          message: 'course structure is weak',
          retryInstruction: 'repair the weakest scenes',
          severity: 'error',
        },
      ],
      metrics: {},
    };
    expect(
      selectTargetedRepairSceneOrders({
        outlines,
        quality,
        sceneScores: [94, 91, 89, 95, 92],
        limit: 3,
      }),
    ).toEqual([3, 2, 5]);
  });

  it('preserves whole-course quality feedback on targeted scene repair steps', async () => {
    mocks.query.mockResolvedValueOnce([{ id: STEP_ID }]);
    const repository = new NeonCourseGenerationRepository();
    const quality: CourseQualityAssessment = {
      passed: false,
      score: 85.89,
      issues: [
        {
          code: 'course_final_transfer_not_delivered',
          message: 'final transfer was not delivered',
          retryInstruction: 'repair scene 10',
          severity: 'error',
          sceneOrder: 10,
        },
      ],
      metrics: {},
    };

    await expect(
      repository.reopenWeakScenesForRepair({
        ownerId: OWNER_ID,
        jobId: JOB_ID,
        step: step({
          sceneOrder: 0,
          phase: 'release',
          attemptCount: 2,
          maxAttempts: 5,
        }),
        attemptId: ATTEMPT_ID,
        sceneOrders: [10],
        quality: quality as unknown as Record<string, unknown>,
        qualityScore: quality.score,
        errorDetail: 'Repair the final transfer scene.',
        now: NOW,
      }),
    ).resolves.toBe(true);

    const sql = String(mocks.query.mock.calls[0]?.[0]);
    expect(sql.match(/quality_json = \$8::jsonb/g)).toHaveLength(2);
    expect(sql).not.toContain('quality_json = NULL');
    expect(mocks.query.mock.calls[0]?.[1]?.[5]).toEqual([10]);
  });

  it('fences attempt creation with the current lease token and attempt number', async () => {
    mocks.query.mockResolvedValueOnce([attemptRow()]);
    const repository = new NeonCourseGenerationRepository();
    await repository.beginAttempt(OWNER_ID, step(), NOW);
    const [sql, values] = mocks.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("step.status = 'leased'");
    expect(sql).toContain('step.lease_token = $8');
    expect(sql).toContain('step.attempt_count = $5');
    expect(values[7]).toBe(LEASE_TOKEN);

    mocks.query.mockReset();
    mocks.query.mockResolvedValueOnce([]);
    await expect(repository.beginAttempt(OWNER_ID, step(), NOW)).rejects.toBeInstanceOf(
      CourseGenerationLeaseLostError,
    );
  });

  it('leases, expires the prior attempt, and updates job state in one fenced statement', async () => {
    mocks.query.mockResolvedValueOnce([]).mockResolvedValueOnce([stepRow()]);
    const repository = new NeonCourseGenerationRepository();
    await repository.leaseNextStep({
      ownerId: OWNER_ID,
      jobId: JOB_ID,
      leaseToken: LEASE_TOKEN,
      now: NOW,
      leaseExpiresAt: new Date(NOW.getTime() + 60_000),
    });
    const exhaustedSql = String(mocks.query.mock.calls[0]?.[0]);
    const leaseSql = String(mocks.query.mock.calls[1]?.[0]);
    expect(exhaustedSql).toContain('WITH failed_steps AS');
    expect(exhaustedSql).toContain('failed_job AS');
    expect(leaseSql).toContain('expired_attempt AS');
    expect(leaseSql).toContain('running_job AS');
    expect(leaseSql).toContain('lease_token = $4');
  });

  it('completes a step, its attempt, progress, and one outbox wakeup atomically', async () => {
    mocks.query.mockResolvedValueOnce([{ id: STEP_ID }]);
    const repository = new NeonCourseGenerationRepository();
    await repository.completeStep({
      ownerId: OWNER_ID,
      step: step(),
      attemptId: ATTEMPT_ID,
      result: { content: true },
      quality: { passed: true, score: 95 },
      qualityScore: 95,
      now: NOW,
    });
    expect(mocks.transaction).not.toHaveBeenCalled();
    const sql = String(mocks.query.mock.calls[0]?.[0]);
    expect(sql).toContain('attempt_guard AS');
    expect(sql).toContain('completed_step AS');
    expect(sql).toContain('completed_attempt AS');
    expect(sql).toContain('queued_dispatch AS');
    expect(sql).toContain("outstanding.status IN ('pending', 'publishing')");
    expect(sql).toContain('lease_token = $3');
  });

  it('keeps retry timestamps explicitly typed when a quality rejection is persisted', async () => {
    const transactionQueries: Array<[string, unknown[]]> = [];
    mocks.transaction.mockImplementationOnce(
      async (
        callback: (tx: {
          query: (sql: string, values: unknown[]) => Promise<Array<{ id: string }>>;
        }) => Array<Promise<Array<{ id: string }>>>,
      ) => {
        const results = callback({
          query: async (sql, values) => {
            transactionQueries.push([sql, values]);
            return transactionQueries.length === 1 ? [{ id: STEP_ID }] : [];
          },
        });
        return Promise.all(results);
      },
    );

    const repository = new NeonCourseGenerationRepository();
    await expect(
      repository.rejectStep({
        ownerId: OWNER_ID,
        step: step(),
        attemptId: ATTEMPT_ID,
        errorCode: 'QUALITY_GATE_FAILED',
        errorDetail: 'The scene needs a deeper source-grounded example.',
        quality: { passed: false, score: 92.9 },
        qualityScore: 92.9,
        retryable: true,
        now: NOW,
      }),
    ).resolves.toBe(true);

    const stepUpdateSql = transactionQueries[0]?.[0] ?? '';
    expect(stepUpdateSql).toContain("WHEN $4::text = 'failed' THEN $8::timestamptz");
    expect(stepUpdateSql).toContain('ELSE NULL::timestamptz');
    expect(stepUpdateSql).toContain('updated_at = $8::timestamptz');
  });

  it('reopens only the failed durable step without discarding completed scenes', async () => {
    mocks.query.mockResolvedValueOnce([]);
    const repository = new NeonCourseGenerationRepository();

    await expect(
      repository.reopenFailedJobForRepair({
        ownerId: OWNER_ID,
        jobId: JOB_ID,
        now: NOW,
      }),
    ).resolves.toBeNull();

    const sql = String(mocks.query.mock.calls[0]?.[0]);
    expect(sql).toContain("step.status = 'failed'");
    expect(sql).toContain("SET status = 'retryable'");
    expect(sql).toContain('step.attempt_count + 3');
    expect(sql).toContain('LEAST(');
    expect(sql).toContain('step.attempt_count < 15');
    expect(sql).toMatch(/LEAST\(\s*15,/);
    expect(sql).toContain("'GENERATION_DEADLINE_EXCEEDED'");
    expect(sql).toContain("'WORKER_LEASE_EXHAUSTED'");
    expect(sql).not.toContain('result_json = NULL');
    expect(sql).toContain("job.status = 'failed'");
    expect(sql).toContain("SET status = 'running'");
    expect(sql).toContain('queued_dispatch AS');
  });

  it('reclaims only stale latest published dispatches and preserves the dedup sequence', async () => {
    mocks.query.mockResolvedValueOnce([
      { id: `cgd_${'8'.repeat(32)}`, job_id: JOB_ID, dispatch_seq: 7 },
    ]);
    const repository = new NeonCourseGenerationRepository();
    const dispatch = await repository.claimPendingDispatch({
      ownerId: OWNER_ID,
      jobId: JOB_ID,
      leaseToken: LEASE_TOKEN,
      now: NOW,
      leaseExpiresAt: new Date(NOW.getTime() + 60_000),
      publishedRecoveryBefore: new Date(NOW.getTime() - 11 * 60_000),
    });
    expect(dispatch?.dispatchSeq).toBe(7);
    const sql = String(mocks.query.mock.calls[0]?.[0]);
    expect(sql).toContain("status = 'published'");
    expect(sql).toContain('published_at <= $6');
    expect(sql).toContain('later.dispatch_seq > course_generation_dispatches.dispatch_seq');
    expect(sql).toContain("active.status = 'leased'");
  });

  it('atomically binds cloud snapshot metadata to the immutable release', async () => {
    mocks.query.mockResolvedValueOnce([releaseRow()]);
    const repository = new NeonCourseGenerationRepository();
    await repository.finalizeRelease({
      ownerId: OWNER_ID,
      jobId: JOB_ID,
      step: step({ sceneOrder: 0, phase: 'release' }),
      attemptId: ATTEMPT_ID,
      classroomId: CLASSROOM_ID,
      outlineCount: 9,
      sceneCount: 9,
      qualityScore: 95,
      quality: { passed: true, score: 95, issues: [], metrics: {} },
      snapshotSha256: 'b'.repeat(64),
      snapshotByteSize: 100_000,
      snapshotBlobPathname: `classrooms/${OWNER_ID}/${CLASSROOM_ID}/snapshots/${'b'.repeat(64)}.json`,
      snapshotBlobUrl: 'https://blob.example/snapshot.json',
      now: NOW,
    });
    const sql = String(mocks.query.mock.calls[0]?.[0]);
    expect(sql).toContain('attempt_guard AS');
    expect(sql).toContain('classroom_snapshot AS');
    expect(sql).toContain('INSERT INTO learning_classrooms');
    expect(sql).toContain('published_release AS');
    expect(sql).toContain('ready_job AS');
    expect(sql).toContain('ready_session AS');
    expect(sql).toContain('course_releases.snapshot_sha256 = EXCLUDED.snapshot_sha256');
  });

  it('does not expose legacy methods that can bypass atomic release', () => {
    const repository = new NeonCourseGenerationRepository() as unknown as Record<string, unknown>;
    expect(repository.markReady).toBeUndefined();
    expect(repository.setQueueMessage).toBeUndefined();
    expect(repository.refreshJobProgress).toBeUndefined();
  });
});
