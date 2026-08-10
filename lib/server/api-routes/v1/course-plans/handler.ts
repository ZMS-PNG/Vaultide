// Loaded by the consolidated Vercel API dispatcher.
import { type NextRequest } from 'next/server';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { getCoursePlanningService } from '@/lib/generation/planning/service';
import type { CoursePlanningInput } from '@/lib/generation/planning/types';
import { buildRequestOrigin } from '@/lib/server/classroom-storage';
import { createLogger } from '@/lib/logger';
import { start } from 'workflow/api';
import { runCourseGenerationWorkflow } from '@/workflows/course-generation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;
const log = createLogger('CoursePlans');

function validInput(value: unknown): value is CoursePlanningInput {
  if (!value || typeof value !== 'object') return false;
  const input = value as Partial<CoursePlanningInput>;
  const generationModel = input.generationModel;
  const validGenerationModel =
    generationModel === undefined ||
    (typeof generationModel === 'object' &&
      generationModel !== null &&
      typeof (generationModel as { modelString?: unknown }).modelString === 'string' &&
      (generationModel as { modelString: string }).modelString.trim().length >= 3 &&
      (generationModel as { modelString: string }).modelString.length <= 256);
  return (
    typeof input.clientSessionId === 'string' &&
    Boolean(input.requirements && typeof input.requirements === 'object') &&
    (input.sourceMode === 'external' ||
      input.sourceMode === 'obsidian' ||
      input.sourceMode === 'hybrid') &&
    Array.isArray(input.sourceReferences) &&
    typeof input.documentText === 'string' &&
    typeof input.researchText === 'string' &&
    validGenerationModel
  );
}

export async function POST(request: NextRequest) {
  try {
    const input = (await request.json()) as unknown;
    if (!validInput(input)) {
      return apiError('INVALID_REQUEST', 400, 'Course planning input is invalid.');
    }
    const planning = getCoursePlanningService();
    let run = await planning.create(input);
    if (!run.workflowRunId && run.workflowStatus !== 'completed') {
      // Reserve the run before invoking Workflow World. A duplicate POST can
      // legitimately occur after a browser abort/reload; it must attach to the
      // same durable run instead of creating a competing workflow.
      const claim = await planning.claimWorkflowStart(run.id);
      if (claim) {
        try {
          const workflowRun = await start(runCourseGenerationWorkflow, [
            run.id,
            buildRequestOrigin(request),
          ]);
          run = await planning.attachResumedWorkflow(run.id, claim.claimToken, workflowRun.runId);
        } catch (workflowError) {
          const detail = workflowError instanceof Error ? workflowError.message : String(workflowError);
          await planning.failWorkflowResumeClaim(run.id, claim.claimToken, detail);
          // The source bundle and course plan remain frozen and resumable; no
          // second browser request is allowed to race the failed start claim.
          log.error('Durable workflow start failed after reserving the planning run.', {
            planningRunId: run.id,
            error: detail,
          });
        }
      }
    }
    const view = await planning.view(run.id);
    if (!view) return apiError('INTERNAL_ERROR', 500, 'Course planning run was not persisted.');
    return apiSuccess({ planningRun: view }, view.executionMode === 'workflow' ? 202 : 201);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (detail.startsWith('planning_preflight_rejected:')) {
      return apiError(
        'QUALITY_GATE_FAILED',
        422,
        '生成前检查未通过，尚未调用课程规划模型。',
        detail,
      );
    }
    return apiError('INVALID_REQUEST', 400, 'Course planning run could not be created.', detail);
  }
}
