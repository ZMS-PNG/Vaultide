import { describe, expect, it } from 'vitest';
import {
  courseGenerationMaxOutputTokens,
  courseGenerationRuntimeModeForStep,
  courseGenerationThinkingConfig,
  normalizeCourseGenerationRuntimeMode,
} from '@/lib/generation/orchestration/runtime-policy';

describe('course generation runtime policy', () => {
  it('uses deadline recovery only after a recorded timeout or exhausted lease', () => {
    expect(courseGenerationRuntimeModeForStep({ lastErrorCode: 'QUALITY_GATE_FAILED' })).toBe(
      'standard',
    );
    expect(
      courseGenerationRuntimeModeForStep({ lastErrorCode: 'GENERATION_DEADLINE_EXCEEDED' }),
    ).toBe('deadline-recovery');
    expect(courseGenerationRuntimeModeForStep({ lastErrorCode: 'WORKER_LEASE_EXHAUSTED' })).toBe(
      'deadline-recovery',
    );
  });

  it('does not allow an unknown runtime mode', () => {
    expect(normalizeCourseGenerationRuntimeMode('deadline-recovery')).toBe('deadline-recovery');
    expect(normalizeCourseGenerationRuntimeMode('fast-and-loose')).toBe('standard');
  });

  it('turns off per-scene reasoning for the durable first pass and deadline recovery', () => {
    const route = {
      modelString: 'deepseek:deepseek-v4-pro',
      providerId: 'deepseek',
      modelId: 'deepseek-v4-pro',
      thinkingConfig: { mode: 'enabled' as const, effort: 'high' as const },
    };

    expect(
      courseGenerationThinkingConfig({
        route,
        base: route.thinkingConfig,
        mode: 'standard',
      }),
    ).toEqual(route.thinkingConfig);
    expect(
      courseGenerationThinkingConfig({
        route,
        base: route.thinkingConfig,
        mode: 'standard',
        durableFirstPass: true,
      }),
    ).toMatchObject({
      mode: 'disabled',
      effort: 'none',
      excludeReasoningOutput: true,
    });
    expect(
      courseGenerationThinkingConfig({
        route,
        base: route.thinkingConfig,
        mode: 'deadline-recovery',
      }),
    ).toMatchObject({
      mode: 'disabled',
      effort: 'none',
      excludeReasoningOutput: true,
    });
  });

  it('caps recovery output while retaining enough room for a complete scene', () => {
    expect(courseGenerationMaxOutputTokens('scene-content', 393_216, 'standard', 'slide')).toBe(
      7_000,
    );
    expect(
      courseGenerationMaxOutputTokens('scene-content', 393_216, 'standard', 'interactive'),
    ).toBe(12_000);
    expect(
      courseGenerationMaxOutputTokens('scene-content', 393_216, 'deadline-recovery', 'slide'),
    ).toBe(5_000);
    expect(courseGenerationMaxOutputTokens('scene-actions', 393_216, 'deadline-recovery')).toBe(
      3_000,
    );
  });
});
