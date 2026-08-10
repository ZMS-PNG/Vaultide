import { resolveModel, type ResolvedModel } from '@/lib/server/resolve-model';
import type { ThinkingConfig } from '@/lib/types/provider';
import type { SceneOutline } from '@/lib/types/generation';
import type { LlmStage } from '@/lib/server/model-routes';
import type { CoursePlanningModelPreference } from '@/lib/generation/planning/types';

export const COURSE_WORKER_VERSION = 'vaultide-worker-v3';
export const COURSE_PROMPT_CONTRACT_VERSION = 'vaultide-course-prompts-v4';
export const COURSE_QUALITY_CONTRACT_VERSION = 'vaultide-course-quality-v3';

export interface FrozenCourseModelRoute {
  modelString: string;
  providerId: string;
  modelId: string;
  thinkingConfig?: ThinkingConfig;
}

export interface FrozenCourseGenerationPolicy {
  version: 'vaultide-generation-policy-v1';
  workerVersion: typeof COURSE_WORKER_VERSION;
  promptContractVersion: typeof COURSE_PROMPT_CONTRACT_VERSION;
  qualityContractVersion: typeof COURSE_QUALITY_CONTRACT_VERSION;
  sceneActions: FrozenCourseModelRoute;
  sceneContentByType: Record<string, FrozenCourseModelRoute>;
}

function frozenRoute(resolved: ResolvedModel): FrozenCourseModelRoute {
  return {
    modelString: resolved.modelString,
    providerId: resolved.providerId,
    modelId: resolved.modelId,
    ...(resolved.thinkingConfig ? { thinkingConfig: resolved.thinkingConfig } : {}),
  };
}

export async function freezeCourseGenerationPolicy(
  outlines: readonly SceneOutline[],
  modelPreference?: CoursePlanningModelPreference,
): Promise<FrozenCourseGenerationPolicy> {
  const sceneTypes = [
    ...new Set(outlines.map((outline) => String(outline.type || 'default'))),
  ].sort();
  const sceneContentByType: Record<string, FrozenCourseModelRoute> = {};
  for (const sceneType of sceneTypes) {
    const stage = (
      sceneType === 'default' ? 'scene-content' : `scene-content:${sceneType}`
    ) as LlmStage;
    sceneContentByType[sceneType] = frozenRoute(
      await resolveModel({
        stage,
        modelString: modelPreference?.modelString,
        thinkingConfig: modelPreference?.thinkingConfig,
      }),
    );
  }
  return {
    version: 'vaultide-generation-policy-v1',
    workerVersion: COURSE_WORKER_VERSION,
    promptContractVersion: COURSE_PROMPT_CONTRACT_VERSION,
    qualityContractVersion: COURSE_QUALITY_CONTRACT_VERSION,
    sceneActions: frozenRoute(
      await resolveModel({
        stage: 'scene-actions',
        modelString: modelPreference?.modelString,
        thinkingConfig: modelPreference?.thinkingConfig,
      }),
    ),
    sceneContentByType,
  };
}

export function isFrozenCourseModelRoute(value: unknown): value is FrozenCourseModelRoute {
  if (!value || typeof value !== 'object') return false;
  const route = value as Partial<FrozenCourseModelRoute>;
  return (
    typeof route.modelString === 'string' &&
    route.modelString.length >= 3 &&
    typeof route.providerId === 'string' &&
    route.providerId.length >= 1 &&
    typeof route.modelId === 'string' &&
    route.modelId.length >= 1
  );
}
