import { getCatalogThinkingCapability } from '@/lib/ai/model-metadata';
import { normalizeThinkingConfig } from '@/lib/ai/thinking-config';
import type { SceneOutline } from '@/lib/types/generation';
import type { ThinkingConfig } from '@/lib/types/provider';
import type { FrozenCourseModelRoute } from './model-policy';
import type { CourseGenerationStepRecord } from './types';

export type CourseGenerationRuntimeMode = 'standard' | 'deadline-recovery';
export type CourseGenerationRuntimeStage = 'scene-content' | 'scene-actions';

const DEADLINE_RECOVERY_CODES = new Set([
  'GENERATION_DEADLINE_EXCEEDED',
  'WORKER_LEASE_EXHAUSTED',
  'generation_http_408',
  'generation_http_504',
]);

const OUTPUT_TOKEN_LIMITS: Record<
  CourseGenerationRuntimeMode,
  Record<CourseGenerationRuntimeStage, number>
> = {
  standard: {
    'scene-content': 12_000,
    'scene-actions': 4_000,
  },
  'deadline-recovery': {
    'scene-content': 8_000,
    'scene-actions': 3_000,
  },
};

const SCENE_CONTENT_TOKEN_LIMITS: Record<
  CourseGenerationRuntimeMode,
  Record<SceneOutline['type'], number>
> = {
  standard: {
    slide: 7_000,
    quiz: 6_000,
    interactive: 12_000,
    pbl: 10_000,
  },
  'deadline-recovery': {
    slide: 5_000,
    quiz: 4_500,
    interactive: 8_000,
    pbl: 7_000,
  },
};

export function normalizeCourseGenerationRuntimeMode(value: unknown): CourseGenerationRuntimeMode {
  return value === 'deadline-recovery' ? value : 'standard';
}

export function courseGenerationRuntimeModeForStep(
  step: Pick<CourseGenerationStepRecord, 'lastErrorCode'>,
): CourseGenerationRuntimeMode {
  return step.lastErrorCode && DEADLINE_RECOVERY_CODES.has(step.lastErrorCode)
    ? 'deadline-recovery'
    : 'standard';
}

export function courseGenerationMaxOutputTokens(
  stage: CourseGenerationRuntimeStage,
  providerOutputWindow: number | undefined,
  mode: CourseGenerationRuntimeMode,
  sceneType?: SceneOutline['type'],
): number {
  const limit =
    stage === 'scene-content' && sceneType
      ? SCENE_CONTENT_TOKEN_LIMITS[mode][sceneType]
      : OUTPUT_TOKEN_LIMITS[mode][stage];
  return Math.min(
    typeof providerOutputWindow === 'number' && providerOutputWindow > 0
      ? providerOutputWindow
      : limit,
    limit,
  );
}

export function courseGenerationThinkingConfig(input: {
  route?: FrozenCourseModelRoute;
  base?: ThinkingConfig;
  mode: CourseGenerationRuntimeMode;
  /**
   * Durable scene generation already receives an approved outline, a frozen
   * evidence window, and an explicit output contract. Spending another long
   * reasoning pass on every page increases latency and deadline risk without
   * improving the renderer contract, so reasoning is reserved for the one
   * course-level outline/design pass.
   */
  durableFirstPass?: boolean;
}): ThinkingConfig | undefined {
  if ((!input.durableFirstPass && input.mode === 'standard') || !input.route) {
    return input.base;
  }

  const capability = getCatalogThinkingCapability(input.route.providerId, input.route.modelId);
  if (!capability) return input.base;

  const normalized = normalizeThinkingConfig(capability, {
    mode: 'disabled',
    enabled: false,
    effort: 'none',
    level: 'minimal',
    budgetTokens: capability.budgetRange?.disableValue ?? capability.budgetRange?.min,
  });

  return normalized ? { ...normalized, excludeReasoningOutput: true } : input.base;
}
