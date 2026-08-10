import { sleep } from 'workflow';
import {
  advanceCourseJobStep,
  createCourseJobStep,
  failCourseWorkflowStep,
  generateCourseOutlineStep,
  prepareCoursePlanningStep,
} from './steps';

export interface CourseGenerationWorkflowResult {
  planningRunId: string;
  status: 'ready' | 'failed';
  jobId?: string;
  classroomId?: string;
  error?: string;
}

const MAX_DURABLE_ADVANCES = 64;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function runCourseGenerationWorkflow(
  planningRunId: string,
  baseUrl: string,
): Promise<CourseGenerationWorkflowResult> {
  'use workflow';

  try {
    await prepareCoursePlanningStep(planningRunId, baseUrl);
    await generateCourseOutlineStep(planningRunId, baseUrl);
    const created = await createCourseJobStep(planningRunId, baseUrl);

    if (created.status === 'ready') {
      return {
        planningRunId,
        status: 'ready',
        jobId: created.jobId,
        classroomId: created.classroomId,
      };
    }
    if (created.status === 'failed' || created.status === 'cancelled') {
      const detail = created.errorDetail || 'course_generation_job_failed_before_processing';
      await failCourseWorkflowStep(
        planningRunId,
        created.errorCode || 'COURSE_GENERATION_FAILED',
        detail,
      );
      return { planningRunId, status: 'failed', jobId: created.jobId, error: detail };
    }

    for (let advance = 0; advance < MAX_DURABLE_ADVANCES; advance++) {
      const state = await advanceCourseJobStep(planningRunId, created.jobId);
      if (state.status === 'ready' || state.outcome === 'ready') {
        return {
          planningRunId,
          status: 'ready',
          jobId: state.jobId,
          classroomId: state.classroomId,
        };
      }
      if (
        state.status === 'failed' ||
        state.status === 'cancelled' ||
        state.outcome === 'failed'
      ) {
        const detail = state.errorDetail || 'course_generation_job_failed';
        await failCourseWorkflowStep(
          planningRunId,
          state.errorCode || 'COURSE_GENERATION_FAILED',
          detail,
        );
        return { planningRunId, status: 'failed', jobId: state.jobId, error: detail };
      }
      if (state.outcome === 'idle') await sleep('2s');
    }

    const detail = `course_workflow_advance_budget_exhausted:${MAX_DURABLE_ADVANCES}`;
    await failCourseWorkflowStep(planningRunId, 'WORKFLOW_ADVANCE_BUDGET_EXHAUSTED', detail);
    return { planningRunId, status: 'failed', jobId: created.jobId, error: detail };
  } catch (error) {
    const detail = errorMessage(error).slice(0, 8_000);
    await failCourseWorkflowStep(planningRunId, 'COURSE_WORKFLOW_FAILED', detail);
    return { planningRunId, status: 'failed', error: detail };
  }
}
