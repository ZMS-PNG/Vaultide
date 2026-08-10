import { beforeEach, describe, expect, test, vi } from 'vitest';

const planningService = vi.hoisted(() => ({
  claimWorkflowResume: vi.fn(),
  attachResumedWorkflow: vi.fn(),
  failWorkflowResumeClaim: vi.fn(),
  view: vi.fn(),
}));
const startMock = vi.hoisted(() => vi.fn());
const workflowMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/generation/planning/service', () => ({
  getCoursePlanningService: () => planningService,
}));

vi.mock('@/lib/server/classroom-storage', () => ({
  buildRequestOrigin: () => 'https://openmaic.example',
}));

vi.mock('workflow/api', () => ({ start: startMock }));
vi.mock('@/workflows/course-generation', () => ({
  runCourseGenerationWorkflow: workflowMock,
}));

const planningRunId = 'cpl_0123456789abcdef0123456789abcdef';
const resumedView = {
  id: planningRunId,
  status: 'frozen',
  phase: 'preflight',
  attemptCount: 1,
  maxAttempts: 4,
  preflight: { ready: true, issues: [], metrics: {} },
  input: {
    clientSessionId: 'session-1',
    requirements: { requirement: 'Resume a reviewed project course' },
    sourceMode: 'obsidian',
    sourceReferences: [],
    documentText: 'source',
    researchText: '',
  },
  taskEngineMode: false,
  executionMode: 'workflow',
  workflow: { runId: 'wrun_new', status: 'running', phase: 'preflight' },
  updatedAt: new Date().toISOString(),
};

describe('course plan durable resume route', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    planningService.claimWorkflowResume.mockResolvedValue({
      run: { id: planningRunId },
      claimToken: 'wclaim_0123456789abcdef',
    });
    planningService.attachResumedWorkflow.mockResolvedValue({ id: planningRunId });
    planningService.failWorkflowResumeClaim.mockResolvedValue(undefined);
    planningService.view.mockResolvedValue(resumedView);
    startMock.mockResolvedValue({ runId: 'wrun_new' });
  });

  test('claims the failed plan, starts one workflow, and attaches it atomically', async () => {
    const { POST } =
      await import('@/lib/server/api-routes/v1/course-plans/[planningRunId]/handler');
    const response = await POST({} as never, {
      params: Promise.resolve({ planningRunId }),
    });
    const body = await response.json();

    expect(response.status).toBe(202);
    expect(body.success).toBe(true);
    expect(startMock).toHaveBeenCalledWith(workflowMock, [
      planningRunId,
      'https://openmaic.example',
    ]);
    expect(planningService.attachResumedWorkflow).toHaveBeenCalledWith(
      planningRunId,
      'wclaim_0123456789abcdef',
      'wrun_new',
    );
    expect(planningService.failWorkflowResumeClaim).not.toHaveBeenCalled();
  });

  test('returns a conflict without starting a duplicate workflow when no claim is acquired', async () => {
    planningService.claimWorkflowResume.mockResolvedValue(null);
    planningService.view.mockResolvedValue({
      ...resumedView,
      workflow: { runId: 'wrun_active', status: 'running', phase: 'outline' },
    });
    const { POST } =
      await import('@/lib/server/api-routes/v1/course-plans/[planningRunId]/handler');
    const response = await POST({} as never, {
      params: Promise.resolve({ planningRunId }),
    });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.errorCode).toBe('COURSE_WORKFLOW_NOT_RESUMABLE');
    expect(startMock).not.toHaveBeenCalled();
  });
});
