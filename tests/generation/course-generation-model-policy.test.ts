import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  resolveModel: vi.fn(),
}));

vi.mock('@/lib/server/resolve-model', () => ({
  resolveModel: mocks.resolveModel,
}));

import { freezeCourseGenerationPolicy } from '@/lib/generation/orchestration/model-policy';

describe('durable course generation model policy', () => {
  it('freezes the non-secret browser model choice for every durable stage', async () => {
    mocks.resolveModel.mockImplementation(async (input: Record<string, unknown>) => ({
      model: {},
      modelInfo: undefined,
      modelString: input.modelString,
      providerId: 'deepseek',
      modelId: 'deepseek-v4-pro',
      apiKey: 'server-only-not-persisted',
      thinkingConfig: input.thinkingConfig,
    }));

    const policy = await freezeCourseGenerationPolicy(
      [
        { id: 'scene-1', order: 1, type: 'slide', title: 'Source-grounded decision' },
        { id: 'scene-2', order: 2, type: 'interactive', title: 'Transfer artifact' },
      ] as never,
      {
        modelString: 'deepseek:deepseek-v4-pro',
        thinkingConfig: { mode: 'enabled', effort: 'high' },
      },
    );

    expect(mocks.resolveModel).toHaveBeenCalledTimes(3);
    for (const [request] of mocks.resolveModel.mock.calls) {
      expect(request).toMatchObject({
        modelString: 'deepseek:deepseek-v4-pro',
        thinkingConfig: { mode: 'enabled', effort: 'high' },
      });
      expect(request).not.toHaveProperty('apiKey');
      expect(request).not.toHaveProperty('baseUrl');
    }
    expect(policy.sceneActions).toMatchObject({
      modelString: 'deepseek:deepseek-v4-pro',
      providerId: 'deepseek',
      modelId: 'deepseek-v4-pro',
    });
    expect(policy.sceneContentByType.slide).toMatchObject({
      modelString: 'deepseek:deepseek-v4-pro',
    });
    expect(JSON.stringify(policy)).not.toContain('server-only-not-persisted');
  });

  it('keeps the server default route as the safe fallback when no model was selected', async () => {
    mocks.resolveModel.mockResolvedValue({
      model: {},
      modelInfo: undefined,
      modelString: 'deepseek:server-default',
      providerId: 'deepseek',
      modelId: 'server-default',
      apiKey: 'server-only-not-persisted',
    });

    await freezeCourseGenerationPolicy(
      [{ id: 'scene-1', order: 1, type: 'slide', title: 'Fallback' }] as never,
    );

    expect(mocks.resolveModel).toHaveBeenCalledWith(
      expect.objectContaining({ stage: 'scene-content:slide', modelString: undefined }),
    );
  });
});
