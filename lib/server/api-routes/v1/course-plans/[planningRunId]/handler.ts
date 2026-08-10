// Loaded by the consolidated Vercel API dispatcher.
import { type NextRequest } from 'next/server';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { getCoursePlanningService } from '@/lib/generation/planning/service';
import { buildRequestOrigin } from '@/lib/server/classroom-storage';
import { start } from 'workflow/api';
import { runCourseGenerationWorkflow } from '@/workflows/course-generation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ planningRunId: string }> },
) {
  const { planningRunId } = await params;
  const view = await getCoursePlanningService().view(planningRunId);
  if (!view) return apiError('INVALID_REQUEST', 404, 'Course planning run was not found.');
  return apiSuccess({ planningRun: view });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ planningRunId: string }> },
) {
  const { planningRunId } = await params;
  const planning = getCoursePlanningService();
  const claim = await planning.claimWorkflowResume(planningRunId);
  if (!claim) {
    const current = await planning.view(planningRunId);
    if (!current) return apiError('INVALID_REQUEST', 404, 'Course planning run was not found.');
    return apiError(
      'COURSE_WORKFLOW_NOT_RESUMABLE',
      409,
      current.workflow?.status === 'running' || current.workflow?.status === 'pending'
        ? 'Course generation is already running.'
        : 'This course planning run cannot be resumed.',
      current.error?.detail,
    );
  }

  try {
    const workflowRun = await start(runCourseGenerationWorkflow, [
      planningRunId,
      buildRequestOrigin(request),
    ]);
    await planning.attachResumedWorkflow(planningRunId, claim.claimToken, workflowRun.runId);
    const view = await planning.view(planningRunId);
    if (!view) return apiError('INTERNAL_ERROR', 500, 'Resumed course plan was not persisted.');
    return apiSuccess({ planningRun: view }, 202);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    await planning.failWorkflowResumeClaim(planningRunId, claim.claimToken, detail);
    return apiError(
      'COURSE_WORKFLOW_RESUME_FAILED',
      500,
      'Course generation could not be resumed.',
      detail,
    );
  }
}
