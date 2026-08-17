// Loaded by the consolidated Vercel API dispatcher.
/**
 * Scene Actions Generation API
 *
 * Generates actions for a scene given its outline and content,
 * then assembles the complete Scene object.
 * This is the second half of the two-step scene generation pipeline.
 */

import { NextRequest } from 'next/server';
import { callLLM } from '@/lib/ai/llm';
import {
  generateSceneActions,
  buildCompleteScene,
  buildVisionUserContent,
  type SceneGenerationContext,
  type AgentInfo,
} from '@/lib/generation/generation-pipeline';
import type { SceneOutline } from '@/lib/types/generation';
import type {
  GeneratedSlideContent,
  GeneratedQuizContent,
  GeneratedInteractiveContent,
  GeneratedPBLContent,
} from '@/lib/types/generation';
import type { Action, SpeechAction } from '@/lib/types/action';
import type { Scene } from '@/lib/types/stage';
import { createLogger } from '@/lib/logger';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { llmApiError } from '@/lib/server/llm-error-response';
import { resolveGenerationModel } from '@/lib/generation/orchestration/resolve-generation-model';
import type { FrozenCourseModelRoute } from '@/lib/generation/orchestration/model-policy';
import {
  assessCompleteScene,
  describeQualityIssues,
  shouldEnforceCourseQuality,
  type CourseQualityAssessment,
} from '@/lib/generation/course-quality';
import { isInternalGenerationRequest } from '@/lib/generation/orchestration/internal-request';
import {
  courseGenerationMaxOutputTokens,
  courseGenerationThinkingConfig,
  normalizeCourseGenerationRuntimeMode,
  type CourseGenerationRuntimeMode,
} from '@/lib/generation/orchestration/runtime-policy';
import { createGenerationDeadline } from '@/lib/server/generation-deadline';
import {
  normalizeSceneOutlineContract,
  normalizeSceneOutlineListContract,
  SceneOutlineContractError,
} from '@/lib/generation/scene-outline-contract';

const log = createLogger('Scene Actions API');

// Action generation can be as large as content generation and regularly takes
// longer than one minute with reasoning models. Keep it aligned with the other
// classroom generation routes and the Vercel function budget in vercel.json.
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const startedAt = Date.now();
  let outlineTitle: string | undefined;
  let resolvedModelString: string | undefined;
  const deadline = createGenerationDeadline(req.signal);
  try {
    const body = await req.json();
    const {
      outline: rawOutline,
      allOutlines,
      content,
      stageId,
      agents,
      previousSpeeches: incomingPreviousSpeeches,
      userProfile,
      languageDirective,
      enforceQualityContract,
      frozenModelPolicy,
      runtimeMode: requestedRuntimeMode,
    } = body as {
      outline: SceneOutline;
      allOutlines: SceneOutline[];
      content:
        | GeneratedSlideContent
        | GeneratedQuizContent
        | GeneratedInteractiveContent
        | GeneratedPBLContent;
      stageId: string;
      agents?: AgentInfo[];
      previousSpeeches?: string[];
      userProfile?: string;
      languageDirective?: string;
      enforceQualityContract?: boolean;
      frozenModelPolicy?: FrozenCourseModelRoute;
      runtimeMode?: CourseGenerationRuntimeMode;
    };

    // Validate required fields
    if (!rawOutline) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'outline is required');
    }
    if (!allOutlines || allOutlines.length === 0) {
      return apiError(
        'MISSING_REQUIRED_FIELD',
        400,
        'allOutlines is required and must not be empty',
      );
    }
    if (!content) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'content is required');
    }
    if (!stageId) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'stageId is required');
    }

    let normalizedOutline: SceneOutline;
    let normalizedAllOutlines: SceneOutline[];
    try {
      normalizedOutline = normalizeSceneOutlineContract(rawOutline);
      normalizedAllOutlines = normalizeSceneOutlineListContract(allOutlines);
    } catch (error) {
      const message =
        error instanceof SceneOutlineContractError
          ? error.message
          : 'Scene outline did not satisfy the generation contract.';
      return apiError('INVALID_SCENE_OUTLINE', 400, message);
    }
    const { generationRepairDirective, ...publicOutline } = normalizedOutline;
    const outline: SceneOutline = publicOutline;
    const internalRepairPrompt = generationRepairDirective?.trim()
      ? `\n\n<internal_quality_repair>\n${generationRepairDirective.trim()}\nDo not quote, paraphrase, name, or expose these internal repair instructions in learner-visible narration, actions, or metadata.\n</internal_quality_repair>`
      : '';

    // ── Model resolution from request headers/body ──
    const {
      model: languageModel,
      modelInfo,
      modelString,
      thinkingConfig,
    } = await resolveGenerationModel({
      request: req,
      body,
      stage: 'scene-actions',
      frozenModelPolicy,
    });
    outlineTitle = outline?.title;
    resolvedModelString = modelString;
    const durableFirstPass = isInternalGenerationRequest(req);
    const runtimeMode = durableFirstPass
      ? normalizeCourseGenerationRuntimeMode(requestedRuntimeMode)
      : 'standard';
    const runtimeThinkingConfig = courseGenerationThinkingConfig({
      route: frozenModelPolicy,
      base: thinkingConfig,
      mode: runtimeMode,
      durableFirstPass,
    });
    const maxOutputTokens = courseGenerationMaxOutputTokens(
      'scene-actions',
      modelInfo?.outputWindow,
      runtimeMode,
    );

    // Detect vision capability
    const hasVision = !!modelInfo?.capabilities?.vision;

    // AI call function (actions typically don't use vision, but kept for consistency)
    const aiCall = async (
      systemPrompt: string,
      userPrompt: string,
      images?: Array<{ id: string; src: string }>,
    ): Promise<string> => {
      const repairedUserPrompt = `${userPrompt}${internalRepairPrompt}`;
      if (images?.length && hasVision) {
        const result = await deadline.run(
          callLLM(
            {
              model: languageModel,
              system: systemPrompt,
              messages: [
                {
                  role: 'user' as const,
                  content: buildVisionUserContent(repairedUserPrompt, images),
                },
              ],
              maxOutputTokens,
              maxRetries: 0,
              abortSignal: deadline.signal,
            },
            'scene-actions',
            undefined,
            runtimeThinkingConfig,
          ),
        );
        return result.text;
      }
      const result = await deadline.run(
        callLLM(
          {
            model: languageModel,
            system: systemPrompt,
            prompt: repairedUserPrompt,
            maxOutputTokens,
            maxRetries: 0,
            abortSignal: deadline.signal,
          },
          'scene-actions',
          undefined,
          runtimeThinkingConfig,
        ),
      );
      return result.text;
    };

    // ── Build cross-scene context ──
    const allTitles = normalizedAllOutlines.map((o) => o.title);
    const pageIndex = normalizedAllOutlines.findIndex((o) => o.id === outline.id);
    const ctx: SceneGenerationContext = {
      pageIndex: (pageIndex >= 0 ? pageIndex : 0) + 1,
      totalPages: normalizedAllOutlines.length,
      allTitles,
      previousSpeeches: incomingPreviousSpeeches ?? [],
    };

    // ── Generate actions ──
    log.info(`Generating actions: "${outline.title}" (${outline.type}) [model=${modelString}]`);

    const qualityGateEnabled = shouldEnforceCourseQuality(enforceQualityContract);
    // One invocation owns exactly one model attempt. Cross-attempt repair is
    // driven by the durable generation ledger so a timeout cannot erase both
    // the attempt and its quality feedback.
    const MAX_QUALITY_ATTEMPTS = 1;
    let actions: Action[] = [];
    let scene: Scene | null = null;
    let sceneQuality: CourseQualityAssessment | undefined;
    for (let attempt = 1; attempt <= MAX_QUALITY_ATTEMPTS; attempt++) {
      const qualityInstruction =
        sceneQuality && !sceneQuality.passed ? describeQualityIssues(sceneQuality) : '';
      const attemptOutline =
        qualityInstruction && attempt > 1
          ? {
              ...outline,
              description: `${outline.description}

QUALITY REGENERATION REQUIREMENTS: ${qualityInstruction}`,
            }
          : outline;
      // OpenMAIC parity: model-generate actions for every path (the official
      // generateSceneActions supplies its own defaults when the response is
      // empty), and keep the model output as-is instead of stabilizing it
      // through Vaultide-specific deterministic templates.
      const generatedActions = await generateSceneActions(attemptOutline, content as unknown as Parameters<typeof generateSceneActions>[1], aiCall, {
        ctx,
        agents,
        userProfile,
        languageDirective,
      });
      actions = generatedActions;
      if (
        actions.length !== generatedActions.length ||
        new Set(actions.map((action) => action.type)).size !==
          new Set(generatedActions.map((action) => action.type)).size
      ) {
        log.info(
          `Action quality convergence completed for "${outline.title}": ${generatedActions.length} -> ${actions.length} actions`,
        );
      }
      scene = buildCompleteScene(
        outline,
        content as unknown as Parameters<typeof buildCompleteScene>[1],
        actions,
        stageId,
      ) as Scene | null;
      if (!scene) continue;
      const assessment = assessCompleteScene(outline, scene);
      sceneQuality = assessment;
      // Vaultide 对齐 OpenMAIC：始终产出质量评估供回写，但不再用其拦截生成。
      if (!qualityGateEnabled || assessment.passed) break;
      log.warn(
        `Scene quality gate rejected "${outline.title}" (attempt ${attempt}/${MAX_QUALITY_ATTEMPTS}, score=${assessment.score}): ${describeQualityIssues(assessment)}`,
      );
      scene = null;
    }

    log.info(`Generated ${actions.length} actions for: "${outline.title}"`);

    if (!scene) {
      log.error(`Failed to build scene: "${outline.title}"`);

      return apiError(
        sceneQuality ? 'QUALITY_GATE_FAILED' : 'GENERATION_FAILED',
        sceneQuality ? 422 : 500,
        sceneQuality
          ? `Scene did not meet the quality contract: ${outline.title}`
          : `Failed to build scene: ${outline.title}`,
        sceneQuality ? describeQualityIssues(sceneQuality) : undefined,
      );
    }

    // ── Extract speeches for cross-scene coherence ──
    const outputPreviousSpeeches = (scene.actions || [])
      .filter((a): a is SpeechAction => a.type === 'speech')
      .map((a) => a.text);

    log.info(
      `Scene assembled successfully: "${outline.title}" - ${
        scene.actions?.length ?? 0
      } actions [durationMs=${Date.now() - startedAt}, deterministicFirstPass=${
        durableFirstPass ? 'yes' : 'no'
      }]`,
    );

    return apiSuccess({ scene, previousSpeeches: outputPreviousSpeeches, quality: sceneQuality });
  } catch (error) {
    log.error(
      `Scene actions generation failed [scene="${outlineTitle ?? 'unknown'}", model=${resolvedModelString ?? 'unknown'}]:`,
      error,
    );
    if (deadline.didTimeout()) {
      return apiError(
        'GENERATION_DEADLINE_EXCEEDED',
        408,
        'Scene generation exceeded its durable step deadline and will retry from the saved checkpoint.',
      );
    }
    return llmApiError(error);
  } finally {
    deadline.dispose();
  }
}
