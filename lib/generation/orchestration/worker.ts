import { NextRequest } from 'next/server';
import {
  assessCompleteScene,
  assessCourseQuality,
  assessV3CourseQuality,
} from '@/lib/generation/course-quality';
import {
  describeCompletedCourseSnapshotViolation,
  isV3OutlineSet,
} from '@/lib/generation/outline-release-contract';
import { POST as generateSceneActions } from '@/lib/server/api-routes/generate/scene-actions/handler';
import { POST as generateSceneContent } from '@/lib/server/api-routes/generate/scene-content/handler';
import type { SceneOutline } from '@/lib/types/generation';
import type { Scene } from '@/lib/types/stage';
import {
  stageCourseClassroomSnapshot,
  type StagedCourseClassroomSnapshot,
} from './classroom-snapshot';
import { publishCourseGenerationStep } from './queue';
import { CourseGenerationLeaseLostError } from './repository';
import { markInternalGenerationRequest } from './internal-request';
import { isFrozenCourseModelRoute } from './model-policy';
import { selectTargetedRepairSceneOrders } from './repair-selection';
import { applyCourseStepRepairContract } from './quality-repair-contract';
import { courseGenerationRuntimeModeForStep } from './runtime-policy';
import { getCourseGenerationService } from './service';
import type {
  CourseGenerationJobRecord,
  CourseGenerationStepRecord,
  SceneActionsStepResult,
  SceneContentStepResult,
} from './types';

const LEASE_MS = 6 * 60 * 1000;

interface GenerationResponse {
  success?: boolean;
  errorCode?: string;
  error?: string;
  details?: string;
  content?: Record<string, unknown>;
  effectiveOutline?: SceneOutline;
  scene?: Scene;
  previousSpeeches?: string[];
  quality?: {
    passed: boolean;
    score: number;
    issues: Array<{
      code: string;
      message: string;
      retryInstruction: string;
      severity: 'error' | 'warning';
      sceneOrder?: number;
    }>;
    metrics: Record<string, string | number | boolean>;
  };
}

function repairedOutline(
  outline: SceneOutline,
  step: CourseGenerationStepRecord,
  languageDirective?: string,
): SceneOutline {
  return applyCourseStepRepairContract(outline, step, languageDirective);
}

function request(
  url: string,
  body: Record<string, unknown>,
  languageDirective?: string,
): NextRequest {
  return markInternalGenerationRequest(
    new NextRequest(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-user-locale': /Chinese|中文|zh-/iu.test(languageDirective ?? '') ? 'zh-CN' : 'en-US',
      },
      body: JSON.stringify(body),
    }),
  );
}

async function responseBody(response: Response): Promise<GenerationResponse> {
  const body = (await response.json().catch(() => ({}))) as GenerationResponse;
  if (!response.ok || body.success !== true) {
    const error = new Error(body.details || body.error || `generation_http_${response.status}`);
    Object.assign(error, {
      code: body.errorCode || `generation_http_${response.status}`,
      retryable:
        response.status === 408 ||
        response.status === 409 ||
        response.status === 422 ||
        response.status === 429 ||
        response.status >= 500,
      quality: body.quality,
    });
    throw error;
  }
  return body;
}

function failure(error: unknown): {
  code: string;
  detail: string;
  retryable: boolean;
  quality?: Record<string, unknown>;
  score?: number;
  repairSceneOrders?: number[];
} {
  const record =
    error && typeof error === 'object' ? (error as Record<string, unknown>) : undefined;
  const quality =
    record?.quality && typeof record.quality === 'object'
      ? (record.quality as Record<string, unknown>)
      : undefined;
  return {
    code: typeof record?.code === 'string' ? record.code : 'generation_step_failed',
    detail:
      error instanceof Error
        ? error.message
        : typeof error === 'string'
          ? error
          : 'Generation step failed.',
    retryable: record?.retryable !== false,
    ...(quality ? { quality } : {}),
    ...(quality && typeof quality.score === 'number' ? { score: quality.score } : {}),
    ...(Array.isArray(record?.repairSceneOrders)
      ? {
          repairSceneOrders: record.repairSceneOrders.filter(
            (value): value is number => Number.isInteger(value) && Number(value) >= 1,
          ),
        }
      : {}),
  };
}

async function contentStep(
  job: CourseGenerationJobRecord,
  step: CourseGenerationStepRecord,
): Promise<SceneContentStepResult> {
  const input = job.input;
  const baseOutline = input.outlines.find((outline) => outline.order === step.sceneOrder);
  if (!baseOutline) throw new Error(`outline_not_found:${step.sceneOrder}`);
  const outline = repairedOutline(baseOutline, step, input.languageDirective);
  const runtimeMode = courseGenerationRuntimeModeForStep(step);
  const frozenModelPolicy =
    input.generationPolicy?.sceneContentByType[String(baseOutline.type || 'default')];
  if (!isFrozenCourseModelRoute(frozenModelPolicy)) {
    const error = new Error('frozen_scene_content_model_policy_missing');
    Object.assign(error, { code: 'MODEL_POLICY_INVALID', retryable: false });
    throw error;
  }
  const pdfImages = input.pdfImages?.map((image) => ({
    ...image,
    src: input.imageMapping?.[image.id] ?? image.src,
  }));
  const response = await generateSceneContent(
    request(
      `${input.baseUrl}/api/generate/scene-content`,
      {
        outline,
        allOutlines: input.outlines,
        pdfImages,
        imageMapping: input.imageMapping,
        stageInfo: {
          name: input.stage.name,
          description: input.stage.description,
          style: input.stage.style,
        },
        stageId: input.stage.id,
        agents: input.agents,
        languageDirective: input.languageDirective,
        requirements: input.requirements,
        sourceContext: input.sourceContext,
        learnerKnowledgeContext: input.learnerKnowledgeContext,
        enforceQualityContract: true,
        frozenModelPolicy,
        runtimeMode,
      },
      input.languageDirective,
    ),
  );
  const body = await responseBody(response);
  if (!body.content || !body.effectiveOutline || !body.quality) {
    throw new Error('scene_content_response_incomplete');
  }
  if (!body.quality.passed || body.quality.score < 90) {
    const error = new Error(`scene_content_quality_below_90:${body.quality.score}`);
    Object.assign(error, { code: 'QUALITY_GATE_FAILED', quality: body.quality, retryable: true });
    throw error;
  }
  return {
    content: body.content,
    effectiveOutline: body.effectiveOutline,
    quality: body.quality,
  };
}

async function actionStep(
  job: CourseGenerationJobRecord,
  step: CourseGenerationStepRecord,
): Promise<SceneActionsStepResult> {
  const repository = getCourseGenerationService().repositoryForWorker();
  const input = job.input;
  const baseOutline = input.outlines.find((outline) => outline.order === step.sceneOrder);
  if (!baseOutline) throw new Error(`outline_not_found:${step.sceneOrder}`);
  const content = await repository.findStep(job.ownerId, job.id, step.sceneOrder, 'content');
  const contentResult = content?.result as unknown as SceneContentStepResult | undefined;
  if (!contentResult?.content) throw new Error(`content_dependency_missing:${step.sceneOrder}`);
  const previousActionSteps = await repository.listSucceededActionSteps(job.ownerId, job.id);
  const previousSpeeches = previousActionSteps
    .filter((candidate) => candidate.sceneOrder < step.sceneOrder)
    .flatMap(
      (candidate) =>
        (candidate.result as unknown as SceneActionsStepResult | undefined)?.previousSpeeches ?? [],
    )
    .slice(-20);
  const outline = repairedOutline(
    contentResult.effectiveOutline ?? baseOutline,
    step,
    input.languageDirective,
  );
  const runtimeMode = courseGenerationRuntimeModeForStep(step);
  const frozenModelPolicy = input.generationPolicy?.sceneActions;
  if (!isFrozenCourseModelRoute(frozenModelPolicy)) {
    const error = new Error('frozen_scene_actions_model_policy_missing');
    Object.assign(error, { code: 'MODEL_POLICY_INVALID', retryable: false });
    throw error;
  }
  const response = await generateSceneActions(
    request(
      `${input.baseUrl}/api/generate/scene-actions`,
      {
        outline,
        allOutlines: input.outlines,
        content: contentResult.content,
        stageId: input.stage.id,
        agents: input.agents,
        previousSpeeches,
        userProfile: input.userProfile,
        languageDirective: input.languageDirective,
        enforceQualityContract: true,
        frozenModelPolicy,
        runtimeMode,
      },
      input.languageDirective,
    ),
  );
  const body = await responseBody(response);
  if (!body.scene || !body.quality) throw new Error('scene_actions_response_incomplete');
  const independentlyAssessed = assessCompleteScene(baseOutline, body.scene);
  if (
    !body.quality.passed ||
    body.quality.score < 90 ||
    !independentlyAssessed.passed ||
    independentlyAssessed.score < 90
  ) {
    const selected =
      independentlyAssessed.score <= body.quality.score ? independentlyAssessed : body.quality;
    const error = new Error(`scene_quality_below_90:${selected.score}`);
    Object.assign(error, { code: 'QUALITY_GATE_FAILED', quality: selected, retryable: true });
    throw error;
  }
  return {
    scene: body.scene,
    previousSpeeches: body.previousSpeeches ?? [],
    quality: independentlyAssessed,
  };
}

async function releaseStep(
  job: CourseGenerationJobRecord,
  step: CourseGenerationStepRecord,
): Promise<{
  quality: ReturnType<typeof assessCourseQuality>;
  snapshot: StagedCourseClassroomSnapshot;
}> {
  const repository = getCourseGenerationService().repositoryForWorker();
  const actionSteps = await repository.listSucceededActionSteps(job.ownerId, job.id);
  const scenes = actionSteps
    .map((step) => (step.result as unknown as SceneActionsStepResult | undefined)?.scene)
    .filter((scene): scene is Scene => Boolean(scene))
    .sort((left, right) => left.order - right.order);
  const completionViolation = describeCompletedCourseSnapshotViolation({
    outlines: job.input.outlines,
    sceneOrders: scenes.map((scene) => scene.order),
    taskEngineMode: job.input.stage.taskEngineMode === true,
  });
  if (completionViolation) {
    const error = new Error(completionViolation);
    Object.assign(error, { code: 'COURSE_INCOMPLETE', retryable: false });
    throw error;
  }
  const quality = isV3OutlineSet(job.input.outlines)
    ? assessV3CourseQuality(job.input.outlines, scenes)
    : assessCourseQuality(job.input.outlines, scenes);
  const sceneScores = job.input.outlines.map((outline) => {
    const scene = scenes.find((candidate) => candidate.order === outline.order);
    return scene ? assessCompleteScene(outline, scene).score : 0;
  });
  const average = sceneScores.reduce((sum, score) => sum + score, 0) / sceneScores.length;
  if (
    !quality.passed ||
    quality.score < 93 ||
    average < 93 ||
    sceneScores.some((score) => score < 90)
  ) {
    const repairSceneOrders = selectTargetedRepairSceneOrders({
      outlines: job.input.outlines,
      quality,
      sceneScores,
    });
    const error = new Error(
      `course_release_quality_rejected: course=${quality.score}, average=${average.toFixed(1)}, minimum=${Math.min(...sceneScores)}`,
    );
    Object.assign(error, {
      code: 'QUALITY_GATE_FAILED',
      quality: {
        ...quality,
        metrics: {
          ...quality.metrics,
          averageSceneScore: Number(average.toFixed(1)),
          minimumSceneScore: Math.min(...sceneScores),
        },
      },
      retryable: true,
      repairSceneOrders,
    });
    throw error;
  }
  const snapshot = await stageCourseClassroomSnapshot({
    job,
    releaseStep: step,
    scenes,
  });
  return { quality, snapshot };
}

export interface CourseWorkerResult {
  jobId: string;
  outcome: 'advanced' | 'ready' | 'failed' | 'idle';
  step?: { phase: CourseGenerationStepRecord['phase']; sceneOrder: number };
}

export interface CourseWorkerRecoveryGuard {
  sceneOrder: number;
  phase: CourseGenerationStepRecord['phase'];
  attemptCount: number;
}

export async function processCourseGenerationStep(
  jobId: string,
  recovery?: CourseWorkerRecoveryGuard,
): Promise<CourseWorkerResult> {
  const service = getCourseGenerationService();
  const repository = service.repositoryForWorker();
  const ownerId = service.ownerId();
  const job = await repository.find(ownerId, jobId);
  if (!job) throw new Error('course_generation_job_not_found');
  if (job.status === 'ready') return { jobId, outcome: 'ready' };
  if (job.status === 'failed' || job.status === 'cancelled') return { jobId, outcome: 'failed' };
  if (recovery) {
    const guardedStep = await repository.findStep(
      ownerId,
      jobId,
      recovery.sceneOrder,
      recovery.phase,
    );
    if (
      !guardedStep ||
      guardedStep.attemptCount !== recovery.attemptCount ||
      guardedStep.status === 'succeeded' ||
      guardedStep.status === 'failed' ||
      guardedStep.status === 'cancelled'
    ) {
      return { jobId, outcome: 'idle' };
    }
  }

  const now = new Date();
  const step = await repository.leaseNextStep({
    ownerId,
    jobId,
    leaseToken: service.newLeaseToken(),
    leaseExpiresAt: new Date(now.getTime() + LEASE_MS),
    now,
  });
  if (!step) return { jobId, outcome: 'idle' };
  const attempt = await repository.beginAttempt(ownerId, step, now);
  try {
    await publishCourseGenerationStep({
      jobId,
      baseUrl: job.input.baseUrl,
      delaySeconds: Math.ceil(LEASE_MS / 1_000) + 30,
      deduplicationId: `course-recovery:${jobId}:${step.id}:${step.attemptCount}`,
      recovery: {
        sceneOrder: step.sceneOrder,
        phase: step.phase,
        attemptCount: step.attemptCount,
      },
    });
  } catch (error) {
    // The active attempt still proceeds. Browser resume and QStash delivery
    // retries remain valid fallbacks; a watchdog publish failure must not turn
    // a healthy model response into a rejected generation.
    console.warn('Course generation recovery watchdog could not be scheduled.', {
      jobId,
      stepId: step.id,
      reason: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    if (step.phase === 'content') {
      const result = await contentStep(job, step);
      await repository.completeStep({
        ownerId,
        step,
        attemptId: attempt.id,
        result: result as unknown as Record<string, unknown>,
        quality: result.quality as unknown as Record<string, unknown>,
        qualityScore: result.quality.score,
        now: new Date(),
      });
      return {
        jobId,
        outcome: 'advanced',
        step: { phase: step.phase, sceneOrder: step.sceneOrder },
      };
    }
    if (step.phase === 'actions') {
      const result = await actionStep(job, step);
      await repository.completeStep({
        ownerId,
        step,
        attemptId: attempt.id,
        result: result as unknown as Record<string, unknown>,
        quality: result.quality as unknown as Record<string, unknown>,
        qualityScore: result.quality.score,
        now: new Date(),
      });
      return {
        jobId,
        outcome: 'advanced',
        step: { phase: step.phase, sceneOrder: step.sceneOrder },
      };
    }

    const result = await releaseStep(job, step);
    await repository.finalizeRelease({
      ownerId,
      jobId,
      step,
      attemptId: attempt.id,
      classroomId: job.classroomId,
      outlineCount: job.outlineCount,
      sceneCount: job.outlineCount,
      qualityScore: result.quality.score,
      quality: result.quality as unknown as Record<string, unknown>,
      snapshotSha256: result.snapshot.snapshotSha256,
      snapshotByteSize: result.snapshot.snapshotByteSize,
      ...(result.snapshot.snapshotBlobPathname
        ? { snapshotBlobPathname: result.snapshot.snapshotBlobPathname }
        : {}),
      ...(result.snapshot.snapshotBlobUrl
        ? { snapshotBlobUrl: result.snapshot.snapshotBlobUrl }
        : {}),
      now: new Date(),
    });
    return { jobId, outcome: 'ready', step: { phase: step.phase, sceneOrder: step.sceneOrder } };
  } catch (error) {
    if (error instanceof CourseGenerationLeaseLostError) {
      return { jobId, outcome: 'idle', step: { phase: step.phase, sceneOrder: step.sceneOrder } };
    }
    const rejected = failure(error);
    if (
      step.phase === 'release' &&
      rejected.retryable &&
      rejected.repairSceneOrders &&
      rejected.repairSceneOrders.length > 0
    ) {
      const reopened = await repository.reopenWeakScenesForRepair({
        ownerId,
        jobId,
        step,
        attemptId: attempt.id,
        sceneOrders: rejected.repairSceneOrders,
        quality: rejected.quality ?? {},
        ...(rejected.score === undefined ? {} : { qualityScore: rejected.score }),
        errorDetail: rejected.detail,
        now: new Date(),
      });
      if (reopened) {
        return {
          jobId,
          outcome: 'advanced',
          step: { phase: step.phase, sceneOrder: step.sceneOrder },
        };
      }
    }
    const applied = await repository.rejectStep({
      ownerId,
      step,
      attemptId: attempt.id,
      errorCode: rejected.code,
      errorDetail: rejected.detail,
      ...(rejected.quality ? { quality: rejected.quality } : {}),
      ...(rejected.score !== undefined ? { qualityScore: rejected.score } : {}),
      retryable: rejected.retryable,
      now: new Date(),
    });
    if (!applied) {
      const current = await repository.find(ownerId, jobId);
      if (current?.status === 'ready') {
        return {
          jobId,
          outcome: 'ready',
          step: { phase: step.phase, sceneOrder: step.sceneOrder },
        };
      }
      if (current?.status === 'failed' || current?.status === 'cancelled') {
        return {
          jobId,
          outcome: 'failed',
          step: { phase: step.phase, sceneOrder: step.sceneOrder },
        };
      }
      return { jobId, outcome: 'idle', step: { phase: step.phase, sceneOrder: step.sceneOrder } };
    }
    const updated = await repository.find(ownerId, jobId);
    return {
      jobId,
      outcome: updated?.status === 'failed' ? 'failed' : 'advanced',
      step: { phase: step.phase, sceneOrder: step.sceneOrder },
    };
  }
}
