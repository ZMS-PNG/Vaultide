import type { NextRequest } from 'next/server';
import type { LlmStage } from '@/lib/server/model-routes';
import {
  resolveModel,
  resolveModelFromRequest,
  type ResolvedModel,
} from '@/lib/server/resolve-model';
import { isInternalGenerationRequest } from './internal-request';
import {
  isFrozenCourseModelRoute,
  type FrozenCourseModelRoute,
} from './model-policy';

export async function resolveGenerationModel(input: {
  request: NextRequest;
  body: unknown;
  stage: LlmStage;
  frozenModelPolicy?: FrozenCourseModelRoute;
}): Promise<ResolvedModel> {
  if (
    isInternalGenerationRequest(input.request) &&
    isFrozenCourseModelRoute(input.frozenModelPolicy)
  ) {
    const resolved = await resolveModel({
      modelString: input.frozenModelPolicy.modelString,
      thinkingConfig: input.frozenModelPolicy.thinkingConfig,
    });
    if (
      resolved.providerId !== input.frozenModelPolicy.providerId ||
      resolved.modelId !== input.frozenModelPolicy.modelId
    ) {
      throw new Error('Frozen model policy no longer resolves to the same provider and model.');
    }
    return resolved;
  }
  return resolveModelFromRequest(input.request, input.body, input.stage);
}
