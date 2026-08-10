import { beforeEach, describe, expect, test, vi } from 'vitest';

const planningService = vi.hoisted(() => ({
  create: vi.fn(),
  claimWorkflowStart: vi.fn(),
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
const view = {
  id: planningRunId,
  status: 'frozen',
  phase: 'preflight',
  attemptCount: 0,
  maxAttempts: 4,
  preflight: { ready: true, issues: [], metrics: {} },
  input: {
    clientSessionId: 'session-123',
    requirements: { requirement: 'Learn the reviewed repository workflow.' },
    sourceMode: 'external' as const,
    sourceReferences: [],
    documentText: '',
    researchText: 'Reviewed official source evidence.',
  },
  taskEngineMode: false,
  executionMode: 'workflow' as const,
  workflow: { runId: 'wrun_new', status: 'running', phase: 'preflight' },
  updatedAt: new Date().toISOString(),
};

function request() {
  return {
    json: async () => ({
      clientSessionId: 'session-123',
      requirements: { requirement: 'Learn the reviewed repository workflow.' },
      sourceMode: 'external',
      sourceReferences: [],
      documentText: '',
      researchText: 'Reviewed official source evidence.',
    }),
  };
}

describe('course plan initial workflow claim', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    planningService.create.mockResolvedValue({
      id: planningRunId,
      workflowRunId: undefined,
      workflowStatus: 'pending',
    });
    planningService.claimWorkflowStart.mockResolvedValue({
      run: { id: planningRunId },
      claimToken: 'wclaim_0123456789abcdef',
    });
    planningService.attachResumedWorkflow.mockResolvedValue({
      id: planningRunId,
      workflowRunId: 'wrun_new',
      workflowStatus: 'running',
    });
    planningService.failWorkflowResumeClaim.mockResolvedValue(undefined);
    planningService.view.mockResolvedValue(view);
    startMock.mockResolvedValue({ runId: 'wrun_new' });
  });

  test('claims the new plan before starting and atomically attaches one workflow', async () => {
    const { POST } = await import('@/lib/server/api-routes/v1/course-plans/handler');
    const response = await POST(request() as never);

    expect(response.status).toBe(202);
    expect(planningService.claimWorkflowStart).toHaveBeenCalledWith(planningRunId);
    expect(startMock).toHaveBeenCalledWith(workflowMock, [
      planningRunId,
      'https://openmaic.example',
    ]);
    expect(planningService.attachResumedWorkflow).toHaveBeenCalledWith(
      planningRunId,
      'wclaim_0123456789abcdef',
      'wrun_new',
    );
  });

  test('does not start a duplicate workflow when the same idempotent plan is already claimed', async () => {
    planningService.claimWorkflowStart.mockResolvedValue(null);
    const { POST } = await import('@/lib/server/api-routes/v1/course-plans/handler');
    const response = await POST(request() as never);

    expect(response.status).toBe(202);
    expect(startMock).not.toHaveBeenCalled();
    expect(planningService.attachResumedWorkflow).not.toHaveBeenCalled();
  });
});
