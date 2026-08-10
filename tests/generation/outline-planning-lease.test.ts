import { beforeEach, describe, expect, test, vi } from 'vitest';

const planningService = vi.hoisted(() => ({
  beginOutline: vi.fn(),
  compileContext: vi.fn(),
  failOutline: vi.fn(),
  view: vi.fn(),
}));
const buildPromptMock = vi.hoisted(() => vi.fn());
const resolveModelFromRequestMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/generation/planning/service', () => ({
  getCoursePlanningService: () => planningService,
}));

vi.mock('@/lib/prompts', () => ({
  buildPrompt: buildPromptMock,
  PROMPT_IDS: {
    REQUIREMENTS_TO_OUTLINES: 'requirements-to-outlines',
    INTERACTIVE_OUTLINES: 'interactive-outlines',
    TASK_ENGINE_OUTLINES: 'task-engine-outlines',
  },
}));

vi.mock('@/lib/server/resolve-model', () => ({
  resolveModelFromRequest: resolveModelFromRequestMock,
}));

function planningRequest() {
  return {
    json: async () => ({
      planningRunId: 'cpl_0123456789abcdef0123456789abcdef',
      enforceQualityContract: false,
      outlineAttemptMode: 'single',
    }),
    headers: { get: () => null },
  };
}

function leasedPlanningRun() {
  return {
    leaseToken: 'lease-outline-1',
    reusedReadyResult: false,
    run: {
      input: {
        requirements: {
          requirement: '理解一个真实项目并生成可验证的实施评审清单',
          interactiveMode: true,
        },
        documentText: '项目原始资料'.repeat(600),
        researchText: '',
        sourceContextExpectedChars: 3_600,
      },
    },
  };
}

describe('outline planning lease lifecycle', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    planningService.beginOutline.mockResolvedValue(leasedPlanningRun());
    planningService.compileContext.mockResolvedValue({ learnerKnowledgeText: '' });
    planningService.failOutline.mockResolvedValue(true);
    resolveModelFromRequestMock.mockResolvedValue({
      model: { provider: 'test', modelId: 'model' },
      modelInfo: { capabilities: {} },
      modelString: 'test:model',
      thinkingConfig: undefined,
    });
  });

  test('releases the lease when a traced prompt asset is missing before streaming starts', async () => {
    buildPromptMock.mockReturnValue(null);
    const { POST } = await import('@/lib/server/api-routes/generate/scene-outlines-stream/handler');

    const response = await POST(planningRequest() as never);

    expect(response.status).toBe(500);
    expect(planningService.failOutline).toHaveBeenCalledTimes(1);
    expect(planningService.failOutline).toHaveBeenCalledWith({
      planningRunId: 'cpl_0123456789abcdef0123456789abcdef',
      leaseToken: 'lease-outline-1',
      errorCode: 'PROMPT_TEMPLATE_NOT_FOUND',
      errorDetail: 'Prompt template not found: interactive-outlines',
    });
  });

  test('releases the lease when pre-stream model resolution throws', async () => {
    buildPromptMock.mockReturnValue({ system: 'system', user: 'user' });
    resolveModelFromRequestMock.mockRejectedValue(new Error('provider configuration failed'));
    const { POST } = await import('@/lib/server/api-routes/generate/scene-outlines-stream/handler');

    const response = await POST(planningRequest() as never);

    expect(response.status).toBe(500);
    expect(planningService.failOutline).toHaveBeenCalledTimes(1);
    expect(planningService.failOutline).toHaveBeenCalledWith({
      planningRunId: 'cpl_0123456789abcdef0123456789abcdef',
      leaseToken: 'lease-outline-1',
      errorCode: 'OUTLINE_PRESTREAM_FAILED',
      errorDetail: 'provider configuration failed',
    });
  });
});
