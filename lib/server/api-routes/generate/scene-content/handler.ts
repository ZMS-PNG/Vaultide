// Loaded by the consolidated Vercel API dispatcher.
/**
 * Scene Content Generation API
 *
 * Generates scene content (slides/quiz/interactive/pbl) from an outline.
 * This is the first half of the two-step scene generation pipeline.
 * Does NOT generate actions — use /api/generate/scene-actions for that.
 */

import { NextRequest } from 'next/server';
import { callLLM } from '@/lib/ai/llm';
import {
  applyOutlineFallbacks,
  generateSceneContent,
  buildVisionUserContent,
} from '@/lib/generation/generation-pipeline';
import type { AgentInfo } from '@/lib/generation/generation-pipeline';
import type {
  SceneOutline,
  PdfImage,
  ImageMapping,
  UserRequirements,
} from '@/lib/types/generation';
import { createLogger } from '@/lib/logger';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { llmApiError } from '@/lib/server/llm-error-response';
import { resolveGenerationModel } from '@/lib/generation/orchestration/resolve-generation-model';
import type { FrozenCourseModelRoute } from '@/lib/generation/orchestration/model-policy';
import { resolveVocationalActive } from '@/lib/config/feature-flags';
import { sortDocumentImagesForVision } from '@/lib/document/bundle';
import {
  assessFinalSceneArtifactContract,
  assessGeneratedSceneContent,
  describeQualityIssues,
  shouldEnforceCourseQuality,
  type CourseQualityAssessment,
} from '@/lib/generation/course-quality';
import {
  assessSceneEvidenceIntegrity,
  combineQualityAssessments,
} from '@/lib/generation/evidence-quality';
import { isInternalGenerationRequest } from '@/lib/generation/orchestration/internal-request';
import {
  courseGenerationMaxOutputTokens,
  courseGenerationThinkingConfig,
  normalizeCourseGenerationRuntimeMode,
  type CourseGenerationRuntimeMode,
} from '@/lib/generation/orchestration/runtime-policy';
import { createGenerationDeadline } from '@/lib/server/generation-deadline';
import {
  convergeFinalSceneTransferDelivery,
  convergeGeneratedSceneContent,
  convergeGeneratedSceneEvidence,
  convergeUnsupportedNamedEvidenceClaims,
} from '@/lib/generation/content-quality-convergence';
import {
  normalizeSceneOutlineContract,
  normalizeSceneOutlineListContract,
  SceneOutlineContractError,
} from '@/lib/generation/scene-outline-contract';

const log = createLogger('Scene Content API');

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const startedAt = Date.now();
  let outlineTitle: string | undefined;
  let resolvedModelString: string | undefined;
  let usedDeterministicConvergence = false;
  const deadline = createGenerationDeadline(req.signal);
  let providerDeadline: ReturnType<typeof createGenerationDeadline> | undefined;
  try {
    const body = await req.json();
    const {
      outline: rawOutline,
      allOutlines,
      pdfImages,
      imageMapping,
      stageInfo: _stageInfo,
      stageId,
      agents,
      languageDirective,
      requirements,
      sourceContext,
      learnerKnowledgeContext,
      enforceQualityContract,
      frozenModelPolicy,
      runtimeMode: requestedRuntimeMode,
    } = body as {
      outline: SceneOutline;
      allOutlines: SceneOutline[];
      pdfImages?: PdfImage[];
      imageMapping?: ImageMapping;
      stageInfo: {
        name: string;
        description?: string;
        style?: string;
      };
      stageId: string;
      agents?: AgentInfo[];
      languageDirective?: string;
      requirements?: UserRequirements;
      sourceContext?: string;
      learnerKnowledgeContext?: string;
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
      ? `\n\n<internal_quality_repair>\n${generationRepairDirective.trim()}\nDo not quote, paraphrase, name, or expose these internal repair instructions in learner-visible content or metadata.\n</internal_quality_repair>`
      : '';

    // ── Model resolution from request headers/body ──
    // Route per scene-content type (e.g. `scene-content:quiz`); getStageModel
    // falls back to the base `scene-content` route when the type is unrouted.
    const stage = outline.type ? (`scene-content:${outline.type}` as const) : 'scene-content';
    const {
      model: languageModel,
      modelInfo,
      modelString,
      thinkingConfig,
    } = await resolveGenerationModel({
      request: req,
      body,
      stage,
      frozenModelPolicy,
    });
    outlineTitle = outline.title;
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
      'scene-content',
      modelInfo?.outputWindow,
      runtimeMode,
      outline.type,
    );
    if (durableFirstPass) {
      const providerBudgetMs =
        outline.type === 'pbl' ? 120_000 : outline.type === 'interactive' ? 100_000 : 80_000;
      providerDeadline = createGenerationDeadline(deadline.signal, providerBudgetMs);
    }
    const activeProviderDeadline = providerDeadline ?? deadline;

    // Detect vision capability
    const hasVision = !!modelInfo?.capabilities?.vision;

    // Vision-aware AI call function
    const aiCall = async (
      systemPrompt: string,
      userPrompt: string,
      images?: Array<{ id: string; src: string }>,
    ): Promise<string> => {
      const repairedUserPrompt = `${userPrompt}${internalRepairPrompt}`;
      if (images?.length && hasVision) {
        const result = await activeProviderDeadline.run(
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
              abortSignal: activeProviderDeadline.signal,
            },
            'scene-content',
            undefined,
            runtimeThinkingConfig,
          ),
        );
        return result.text;
      }
      const result = await activeProviderDeadline.run(
        callLLM(
          {
            model: languageModel,
            system: systemPrompt,
            prompt: repairedUserPrompt,
            maxOutputTokens,
            maxRetries: 0,
            abortSignal: activeProviderDeadline.signal,
          },
          'scene-content',
          undefined,
          runtimeThinkingConfig,
        ),
      );
      return result.text;
    };

    // ── Apply fallbacks ──
    const vocationalActive = resolveVocationalActive(requirements);
    const effectiveOutline = applyOutlineFallbacks(outline, !!languageModel, {
      allowProceduralSkill: vocationalActive,
    });

    // ── Filter images assigned to this outline ──
    let assignedImages: PdfImage[] | undefined;
    if (
      pdfImages &&
      pdfImages.length > 0 &&
      effectiveOutline.suggestedImageIds &&
      effectiveOutline.suggestedImageIds.length > 0
    ) {
      const suggestedIds = new Set(effectiveOutline.suggestedImageIds);
      assignedImages = sortDocumentImagesForVision(
        pdfImages.filter((img) => suggestedIds.has(img.id)),
      );
    }

    // ── Media generation is handled client-side in parallel (media-orchestrator.ts) ──
    // The content generator receives placeholder IDs (gen_img_1, gen_vid_1) as-is.
    // resolveImageIds() in generation-pipeline.ts will keep these placeholders in elements.
    const generatedMediaMapping: ImageMapping = {};

    // ── Generate content ──
    log.info(
      `Generating content: "${effectiveOutline.title}" (${effectiveOutline.type}) [model=${modelString}]`,
    );

    const userLocale = req.headers?.get('x-user-locale') ?? '';

    const qualityGateEnabled = shouldEnforceCourseQuality(enforceQualityContract);
    // One invocation owns exactly one model attempt. Durable orchestration
    // persists rejection feedback and schedules a fresh invocation; retrying
    // twice inside one Vercel Function is what previously produced 300s/504
    // failures and unobservable partial courses.
    const MAX_QUALITY_ATTEMPTS = 1;
    let content: Awaited<ReturnType<typeof generateSceneContent>> = null;
    let contentQuality: CourseQualityAssessment | undefined;
    for (let attempt = 1; attempt <= MAX_QUALITY_ATTEMPTS; attempt++) {
      const qualityInstruction =
        contentQuality && !contentQuality.passed ? describeQualityIssues(contentQuality) : '';
      const attemptOutline =
        qualityInstruction && attempt > 1
          ? {
              ...effectiveOutline,
              description: `${effectiveOutline.description}

QUALITY REGENERATION REQUIREMENTS: ${qualityInstruction}`,
            }
          : effectiveOutline;
      try {
        content = await deadline.run(
          generateSceneContent(attemptOutline, aiCall, {
            assignedImages,
            imageMapping,
            languageModel: effectiveOutline.type === 'pbl' ? languageModel : undefined,
            visionEnabled: hasVision,
            generatedMediaMapping,
            agents,
            languageDirective,
            thinkingConfig: runtimeThinkingConfig,
            targetLanguage: userLocale || undefined,
            userRequirements: requirements,
            sourceContext,
            learnerKnowledgeContext,
            allowProceduralSkill: vocationalActive,
            durableFirstPass,
            abortSignal: activeProviderDeadline.signal,
            maxOutputTokens,
          }),
        );
      } catch (error) {
        if (
          !durableFirstPass ||
          deadline.didTimeout() ||
          (effectiveOutline.type === 'pbl' && !providerDeadline?.didTimeout())
        ) {
          throw error;
        }
        log.warn(
          `First-pass provider output failed for "${effectiveOutline.title}"; converging from the approved outline without another model call: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        content = null;
      }
      if (durableFirstPass && effectiveOutline.type !== 'pbl') {
        const before = content
          ? assessGeneratedSceneContent(effectiveOutline, content).passed
          : false;
        content = convergeGeneratedSceneContent(
          effectiveOutline,
          content as Parameters<typeof convergeGeneratedSceneContent>[1],
          languageDirective,
        );
        if (!before) {
          usedDeterministicConvergence = true;
          log.info(
            `Deterministic content convergence completed for "${effectiveOutline.title}" (${effectiveOutline.type})`,
          );
        }
        const beforeNamedEvidenceConvergence = content;
        content = convergeUnsupportedNamedEvidenceClaims(
          effectiveOutline,
          content,
          sourceContext,
          languageDirective,
        );
        if (content !== beforeNamedEvidenceConvergence) {
          usedDeterministicConvergence = true;
          log.warn(
            `Unsupported named evidence claim converged from the approved outline for "${effectiveOutline.title}" without a provider retry`,
          );
        }
        const evidenceBefore = assessSceneEvidenceIntegrity(
          sourceContext,
          effectiveOutline,
          content,
        );
        if (!evidenceBefore.passed) {
          content = convergeGeneratedSceneEvidence(
            effectiveOutline,
            content,
            languageDirective,
          );
          const evidenceAfter = assessSceneEvidenceIntegrity(
            sourceContext,
            effectiveOutline,
            content,
          );
          if (evidenceAfter.passed) {
            usedDeterministicConvergence = true;
            log.info(
              `Deterministic evidence convergence completed for "${effectiveOutline.title}" (${effectiveOutline.type})`,
            );
          }
        }
    const finalOrder = Math.max(...normalizedAllOutlines.map((candidate) => candidate.order));
        if (effectiveOutline.order === finalOrder) {
          content = convergeFinalSceneTransferDelivery(
            effectiveOutline,
            content,
            languageDirective,
          );
        }
      }
      if (!content) continue;
      if (!qualityGateEnabled) break;
      const assessment = combineQualityAssessments(
        assessGeneratedSceneContent(effectiveOutline, content),
        assessSceneEvidenceIntegrity(sourceContext, effectiveOutline, content),
        assessFinalSceneArtifactContract(effectiveOutline, content),
      );
      contentQuality = assessment;
      if (assessment.passed) break;
      log.warn(
        `Content quality gate rejected "${effectiveOutline.title}" (attempt ${attempt}/${MAX_QUALITY_ATTEMPTS}, score=${assessment.score}): ${describeQualityIssues(assessment)}`,
      );
      log.warn(
        `[Scene Content API] Rejection metrics for "${effectiveOutline.title}": ${JSON.stringify({
          issues: assessment.issues.map((entry) => entry.code),
          metrics: assessment.metrics,
        })}`,
      );
      content = null;
    }

    if (!content) {
      log.error(`Failed to generate content for: "${effectiveOutline.title}"`);

      return apiError(
        contentQuality ? 'QUALITY_GATE_FAILED' : 'GENERATION_FAILED',
        contentQuality ? 422 : 500,
        contentQuality
          ? `Scene did not meet the quality contract: ${effectiveOutline.title}`
          : `Failed to generate content: ${effectiveOutline.title}`,
        contentQuality ? describeQualityIssues(contentQuality) : undefined,
      );
    }

    log.info(
      `Content generated successfully: "${effectiveOutline.title}" [quality=${
        contentQuality?.score ?? 'n/a'
      }, durationMs=${Date.now() - startedAt}, maxOutputTokens=${maxOutputTokens}, deterministicConvergence=${
        usedDeterministicConvergence ? 'yes' : 'no'
      }]`,
    );

    return apiSuccess({ content, effectiveOutline, quality: contentQuality });
  } catch (error) {
    log.error(
      `Scene content generation failed [scene="${outlineTitle ?? 'unknown'}", model=${resolvedModelString ?? 'unknown'}]:`,
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
    providerDeadline?.dispose();
    deadline.dispose();
  }
}
