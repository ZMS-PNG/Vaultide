import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SceneOutline } from '@/lib/types/generation';

const mocks = vi.hoisted(() => ({
  callLLM: vi.fn(),
  resolveModelFromRequest: vi.fn(),
  applyOutlineFallbacks: vi.fn(),
  generateSceneContent: vi.fn(),
  generateSceneActions: vi.fn(),
  buildCompleteScene: vi.fn(),
  buildVisionUserContent: vi.fn(),
  resolveVocationalActive: vi.fn(),
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
  logDebug: vi.fn(),
}));

vi.mock('@/lib/ai/llm', () => ({
  callLLM: mocks.callLLM,
}));

vi.mock('@/lib/server/resolve-model', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/resolve-model')>();
  return {
    ...actual,
    resolveModelFromRequest: mocks.resolveModelFromRequest,
  };
});

vi.mock('@/lib/config/feature-flags', () => ({
  resolveVocationalActive: mocks.resolveVocationalActive,
}));

vi.mock('@/lib/generation/generation-pipeline', () => ({
  applyOutlineFallbacks: mocks.applyOutlineFallbacks,
  generateSceneContent: mocks.generateSceneContent,
  generateSceneActions: mocks.generateSceneActions,
  buildCompleteScene: mocks.buildCompleteScene,
  buildVisionUserContent: mocks.buildVisionUserContent,
}));

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    info: mocks.logInfo,
    warn: mocks.logWarn,
    error: mocks.logError,
    debug: mocks.logDebug,
  }),
}));

const outline = {
  id: 'outline-1',
  type: 'slide',
  title: 'Retry Boundary',
  description: 'Keep retries controlled by the outer scene retry helper.',
  keyPoints: ['no retry multiplication'],
  order: 1,
} as SceneOutline;

describe('scene API retry boundary', () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) {
      mock.mockReset();
    }
    mocks.resolveModelFromRequest.mockResolvedValue({
      model: { id: 'language-model' },
      modelInfo: { outputWindow: 4096, capabilities: {} },
      modelString: 'test:model',
      thinkingConfig: undefined,
    });
    mocks.applyOutlineFallbacks.mockImplementation((value) => value);
    mocks.callLLM.mockResolvedValue({ text: 'ok' });
    mocks.resolveVocationalActive.mockReturnValue(false);
  });

  it('keeps both scene-generation halves within the production function budget', async () => {
    const contentRoute = await import('@/lib/server/api-routes/generate/scene-content/handler');
    const actionsRoute = await import('@/lib/server/api-routes/generate/scene-actions/handler');

    expect(contentRoute.maxDuration).toBe(300);
    expect(actionsRoute.maxDuration).toBe(300);
  });

  it('disables AI SDK retries for scene-content model calls', async () => {
    vi.resetModules();
    mocks.generateSceneContent.mockImplementation(async (_outline, aiCall) => {
      await aiCall('system', 'user');
      return { elements: [], remark: 'ok' };
    });

    const { POST } = await import('@/lib/server/api-routes/generate/scene-content/handler');
    const response = await POST(mockRequest());
    const body = await response.json();

    expect(body.success).toBe(true);
    expect(mocks.callLLM.mock.calls[0][0].maxRetries).toBe(0);
  });

  it('disables AI SDK retries for scene-actions model calls', async () => {
    vi.resetModules();
    mocks.generateSceneActions.mockImplementation(async (_outline, _content, aiCall) => {
      await aiCall('system', 'user');
      return [];
    });
    mocks.buildCompleteScene.mockReturnValue({
      id: 'scene-1',
      type: 'slide',
      title: outline.title,
      order: outline.order,
      content: { elements: [], remark: 'ok' },
      actions: [],
    });

    const { POST } = await import('@/lib/server/api-routes/generate/scene-actions/handler');
    const response = await POST(
      mockRequest({
        content: { elements: [], remark: 'ok' },
      }),
    );
    const body = await response.json();

    expect(body.success).toBe(true);
    expect(mocks.callLLM.mock.calls[0][0].maxRetries).toBe(0);
    const convergedActions = mocks.buildCompleteScene.mock.calls[0][2] as Array<{
      type: string;
      text?: string;
    }>;
    expect(convergedActions.length).toBeGreaterThanOrEqual(5);
    expect(
      convergedActions.filter((action) => action.type === 'speech').length,
    ).toBeGreaterThanOrEqual(3);
    expect(new Set(convergedActions.map((action) => action.type)).size).toBeGreaterThanOrEqual(2);
  });

  it('skips the second provider call for durable first-pass scene actions', async () => {
    vi.resetModules();
    mocks.generateSceneActions.mockResolvedValue([]);
    mocks.buildCompleteScene.mockImplementation((_outline, content, actions) => ({
      id: 'scene-1',
      stageId: 'stage-1',
      type: 'slide',
      title: outline.title,
      order: outline.order,
      content: { type: 'slide', canvas: { elements: content.elements } },
      actions,
    }));

    const { markInternalGenerationRequest } =
      await import('@/lib/generation/orchestration/internal-request');
    const { POST } = await import('@/lib/server/api-routes/generate/scene-actions/handler');
    const request = markInternalGenerationRequest(
      mockRequest({
        content: {
          elements: [{ id: 'title', type: 'text', content: 'A complete slide', left: 0, top: 0 }],
          remark: 'ok',
        },
      }),
    );
    const response = await POST(request);
    const body = await response.json();

    expect(body.success).toBe(true);
    expect(mocks.generateSceneActions).not.toHaveBeenCalled();
    expect(mocks.callLLM).not.toHaveBeenCalled();
    expect(mocks.buildCompleteScene.mock.calls[0][2].length).toBeGreaterThanOrEqual(5);
  });

  it('ends a slow durable slide call at the soft budget and completes without provider retries', async () => {
    vi.useFakeTimers();
    try {
      vi.resetModules();
      mocks.callLLM.mockReturnValue(new Promise(() => undefined));
      mocks.generateSceneContent.mockImplementation(async (_outline, aiCall) => {
        await aiCall('system', 'user');
        return null;
      });
      const { markInternalGenerationRequest } =
        await import('@/lib/generation/orchestration/internal-request');
      const { POST } = await import('@/lib/server/api-routes/generate/scene-content/handler');
      const responsePromise = POST(
        markInternalGenerationRequest(
          mockRequest({
            enforceQualityContract: true,
          }),
        ),
      );

      await vi.advanceTimersByTimeAsync(80_001);
      const response = await responsePromise;
      const body = await response.json();

      expect(
        response.status,
        JSON.stringify({
          body,
          errors: mocks.logError.mock.calls,
          warnings: mocks.logWarn.mock.calls,
        }),
      ).toBe(200);
      expect(body.success).toBe(true);
      expect(body.content.elements.length).toBeGreaterThanOrEqual(6);
      expect(mocks.callLLM).toHaveBeenCalledTimes(1);
      expect(mocks.callLLM.mock.calls[0][0].maxRetries).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('preserves an upstream 401 from the scene-content route', async () => {
    vi.resetModules();
    const unauthorized = Object.assign(new Error('provider key rejected'), { statusCode: 401 });
    mocks.generateSceneContent.mockImplementation(async (_outline, aiCall) => {
      await aiCall('system', 'user');
      return { elements: [], remark: 'ok' };
    });
    mocks.callLLM.mockRejectedValueOnce(unauthorized);

    const { POST } = await import('@/lib/server/api-routes/generate/scene-content/handler');
    const response = await POST(mockRequest());
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toMatchObject({
      success: false,
      errorCode: 'UPSTREAM_ERROR',
      error: 'Upstream authentication or authorization failed.',
    });
  });

  it('preserves an upstream 503 from the scene-content route', async () => {
    vi.resetModules();
    const unavailable = Object.assign(new Error('provider overloaded'), { statusCode: 503 });
    mocks.generateSceneContent.mockImplementation(async (_outline, aiCall) => {
      await aiCall('system', 'user');
      return { elements: [], remark: 'ok' };
    });
    mocks.callLLM.mockRejectedValueOnce(unavailable);

    const { POST } = await import('@/lib/server/api-routes/generate/scene-content/handler');
    const response = await POST(mockRequest());
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toMatchObject({
      success: false,
      errorCode: 'UPSTREAM_ERROR',
      error: 'Upstream model provider is temporarily unavailable. Please try again.',
    });
  });

  it('preserves an upstream 401 from the scene-actions route', async () => {
    vi.resetModules();
    const unauthorized = Object.assign(new Error('provider key rejected'), { statusCode: 401 });
    mocks.generateSceneActions.mockImplementation(async (_outline, _content, aiCall) => {
      await aiCall('system', 'user');
      return [];
    });
    mocks.callLLM.mockRejectedValueOnce(unauthorized);

    const { POST } = await import('@/lib/server/api-routes/generate/scene-actions/handler');
    const response = await POST(mockRequest({ content: { elements: [], remark: 'ok' } }));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toMatchObject({
      success: false,
      errorCode: 'UPSTREAM_ERROR',
      error: 'Upstream authentication or authorization failed.',
    });
  });

  it('preserves an upstream 503 from the scene-actions route', async () => {
    vi.resetModules();
    const unavailable = Object.assign(new Error('provider overloaded'), { statusCode: 503 });
    mocks.generateSceneActions.mockImplementation(async (_outline, _content, aiCall) => {
      await aiCall('system', 'user');
      return [];
    });
    mocks.callLLM.mockRejectedValueOnce(unavailable);

    const { POST } = await import('@/lib/server/api-routes/generate/scene-actions/handler');
    const response = await POST(mockRequest({ content: { elements: [], remark: 'ok' } }));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toMatchObject({
      success: false,
      errorCode: 'UPSTREAM_ERROR',
      error: 'Upstream model provider is temporarily unavailable. Please try again.',
    });
  });
});

function mockRequest(extraBody: Record<string, unknown> = {}) {
  return {
    json: async () => ({
      outline,
      allOutlines: [outline],
      stageId: 'stage-1',
      stageInfo: { name: 'Retry Course' },
      ...extraBody,
    }),
  } as unknown as Parameters<
    typeof import('@/lib/server/api-routes/generate/scene-content/handler').POST
  >[0];
}
