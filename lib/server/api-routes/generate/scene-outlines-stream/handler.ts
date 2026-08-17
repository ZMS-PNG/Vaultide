// Loaded by the consolidated Vercel API dispatcher.
/**
 * Scene Outlines Streaming API (SSE)
 *
 * Streams outline generation via Server-Sent Events.
 * Emits individual outline objects as they're parsed from the LLM response,
 * so the frontend can display them incrementally.
 *
 * SSE events:
 *   { type: 'languageDirective', data: string }
 *   { type: 'courseTitle', data: string }
 *   { type: 'outline', data: SceneOutline, index: number }
 *   { type: 'done', outlines: SceneOutline[], languageDirective: string, courseTitle?: string }
 *   { type: 'error', error: string }
 */

import { NextRequest } from 'next/server';
import { streamLLM } from '@/lib/ai/llm';
import { buildPrompt, PROMPT_IDS } from '@/lib/prompts';
import {
  formatImageDescription,
  formatImagePlaceholder,
  buildVisionUserContent,
  uniquifyMediaElementIds,
  formatTeacherPersonaForPrompt,
} from '@/lib/generation/generation-pipeline';
import type { AgentInfo } from '@/lib/generation/generation-pipeline';
import {
  DEFAULT_LANGUAGE_DIRECTIVE,
} from '@/lib/generation/outline-generator';
import { parseJsonResponse } from '@openmaic/generation';
import { normalizeOutlineEnvelope } from '@/lib/generation/outline-envelope-normalization';
import { MAX_PDF_CONTENT_CHARS, MAX_VISION_IMAGES } from '@/lib/constants/generation';
import { nanoid } from 'nanoid';
import type {
  UserRequirements,
  PdfImage,
  SceneOutline,
  ImageMapping,
} from '@/lib/types/generation';
import { learningProjectPromptContext } from '@/lib/learning/domain/learning-project-plan';
import { apiError } from '@/lib/server/api-response';
import { createLogger } from '@/lib/logger';
import { resolveModelFromRequest } from '@/lib/server/resolve-model';
import { sortDocumentImagesForVision } from '@/lib/document/bundle';
import { resolveVocationalActive } from '@/lib/config/feature-flags';
import { isContentEngineV3Enabled } from '@/lib/config/feature-flags';
import {
} from '@/lib/generation/course-quality';
import {
} from '@/lib/generation/outline-quality-repair';
import {
} from '@/lib/generation/evidence-quality';
import { getCoursePlanningService } from '@/lib/generation/planning/service';
import {
  buildSemanticV3PlanRun,
  buildV3PlanRun,
  type V3PlanRunResult,
  V3PlanBuildError,
} from '@/lib/generation/planning/v3-plan-run';
const log = createLogger('Outlines Stream');

export const maxDuration = 300;

function semanticV3OutlineGuidance(requirements: UserRequirements): string {
  const chinese = /[\u3400-\u9fff]/u.test(requirements.requirement);
  return chinese
    ? `\n\n## V3 语义课堂蓝图（必须遵守）\n这是一次“语义优先、契约兜底”的正式课堂规划。请一次性产出 9–12 个互不重复、面向学习者的场景，而不是把来源标题或链接换个名字。\n- 每一场必须回答一个具体问题：讲清机制/数据流/论据/案例/风险/决策之一，并给出学习者要做的动作。\n- 用已提供的 [S#] 或 [V#] 标签紧贴事实性论据；不得编造标签、数字或来源。\n- 标题要短、自然、可朗读；不要出现 URL、Markdown 链接、"学习地图"、"核心模型" 这类只有模板没有主题的标题。\n- 至少包含：定位与先验诊断、系统/机制、来源案例或证据比较、应用/回忆练习、边界与失败模式、最终迁移交付。\n- 最后一场必须要求学习者对一个新的项目、决策或问题交付具体成果，并写出可观察的验收方式。\n- 只返回既定 JSON 对象；不要解释规划过程。\n`
    : `\n\n## V3 semantic classroom blueprint (mandatory)\nThis is a semantic-first, contract-backed release plan. Produce 9–12 distinct learner-facing scenes in one pass; do not merely rename source headings or URLs.\n- Every scene must answer one concrete question about a mechanism, flow, evidence, example, risk, or decision and name a learner action.\n- Keep supplied [S#] or [V#] labels beside factual claims; invent no labels, facts, or sources.\n- Titles must be short, natural, and speakable. Do not expose URLs, Markdown links, or empty template labels such as “Learning map” or “Core model”.\n- Include orientation/diagnostic, system or mechanism, source example or evidence trade-off, application/retrieval, boundary/failure mode, and a final transfer deliverable.\n- The final scene must transfer learning to a new project, decision, or problem with a concrete artifact and observable completion test.\n- Return only the required JSON object.\n`;
}

/**
 * Extract the languageDirective from the streamed wrapper JSON.
 * Matches `"languageDirective":"<value>"` in partial JSON like:
 *   {"languageDirective":"用中文授课...","outlines":[...
 */
function extractLanguageDirective(buffer: string): string | null {
  // The directive is the first key of the wrapper object, so it can only ever
  // appear in the head of the buffer. Bound the scan to keep this O(1) per
  // streamed chunk — it is called on the full, growing buffer on every chunk,
  // which is otherwise O(n²) over the stream.
  const head = buffer.length > 8192 ? buffer.slice(0, 8192) : buffer;
  const match = head.match(/"languageDirective"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (!match) return null;
  try {
    return JSON.parse(`"${match[1]}"`);
  } catch {
    return match[1];
  }
}

/**
 * Extract the courseTitle from the streamed wrapper JSON.
 * Same head-bound scan as `extractLanguageDirective` — the title is a
 * top-level key near the start of the wrapper object, so it only appears in
 * the buffer head. Returns the decoded title, or null if not yet streamed.
 */
const COURSE_TITLE_RE = /"courseTitle"\s*:\s*"((?:[^"\\]|\\.)*)"/;

// Normalize a captured title identically to the non-streaming parser
// (lib/generation/outline-generator.ts): ignore whitespace-only titles and cap
// length defensively so a hallucinating model cannot push a blank or unbounded
// value into the stage name. Returning null lets callers fall back / keep scanning.
function normalizeStreamedTitle(raw: string): string | null {
  let title: string;
  try {
    title = JSON.parse(`"${raw}"`);
  } catch {
    title = raw;
  }
  const normalized = title.trim();
  return normalized ? normalized.slice(0, 120) : null;
}

function extractCourseTitle(buffer: string): string | null {
  const head = buffer.length > 8192 ? buffer.slice(0, 8192) : buffer;
  const match = head.match(COURSE_TITLE_RE);
  return match ? normalizeStreamedTitle(match[1]) : null;
}

/**
 * Full-buffer fallback, run once after the stream completes: recovers a title
 * the model emitted after the `outlines` array or beyond the 8KB head window —
 * cases the head-bound `extractCourseTitle` scan would miss. Only invoked when
 * the streaming scan produced nothing, so the extra full-buffer regex is paid once.
 */
function extractCourseTitleFromComplete(buffer: string): string | null {
  const match = buffer.match(COURSE_TITLE_RE);
  return match ? normalizeStreamedTitle(match[1]) : null;
}

/**
 * Incremental JSON array parser.
 * Extracts complete top-level objects from a partially-streamed JSON array,
 * resuming from `scanFrom` (an index into `buffer`) so the growing buffer is
 * scanned only ONCE across the whole stream — O(n) total instead of O(n²).
 * Supports both a flat array `[{...},{...}]` and a wrapper object
 * `{"languageDirective":"...","outlines":[{...},{...}]}`, with or without a
 * markdown ```json fence (the array is located by content, not by stripping).
 * Returns newly found objects plus the index to resume scanning from next time.
 */
function extractNewOutlines(
  buffer: string,
  scanFrom: number,
): { outlines: SceneOutline[]; scanFrom: number } {
  const results: SceneOutline[] = [];

  let i: number;
  if (scanFrom > 0) {
    // Resume just past the last fully-parsed object (between array elements,
    // so not inside a string and at brace depth 0).
    i = scanFrom;
  } else {
    // Locate the outlines array opening once.
    const outlinesKeyIdx = buffer.indexOf('"outlines"');
    const arrayStart =
      outlinesKeyIdx >= 0 ? buffer.indexOf('[', outlinesKeyIdx) : buffer.indexOf('[');
    if (arrayStart === -1) return { outlines: results, scanFrom: 0 };
    i = arrayStart + 1;
  }

  let depth = 0;
  let objectStart = -1;
  let inString = false;
  let escaped = false;
  let consumed = i; // index just past the last fully-parsed object

  for (; i < buffer.length; i++) {
    const char = buffer[i];

    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\' && inString) {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (char === '{') {
      if (depth === 0) objectStart = i;
      depth++;
    } else if (char === '}') {
      depth--;
      if (depth === 0 && objectStart >= 0) {
        try {
          const recovered = normalizeOutlineEnvelope(
            JSON.parse(buffer.substring(objectStart, i + 1)),
          );
          if (recovered) results.push(...recovered.outlines);
        } catch {
          // Incomplete or invalid JSON — skip
        }
        objectStart = -1;
        consumed = i + 1;
      }
    }
  }

  return { outlines: results, scanFrom: consumed };
}

function recoverCompleteOutlineEnvelope(buffer: string): {
  outlines: SceneOutline[];
  languageDirective?: string;
  courseTitle?: string;
} | null {
  return normalizeOutlineEnvelope(parseJsonResponse<unknown>(buffer));
}

function firstString(record: Record<string, unknown>, keys: readonly string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function firstStringList(record: Record<string, unknown>, keys: readonly string[]): string[] {
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) {
      return value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean);
    }
    if (typeof value === 'string' && value.trim()) {
      return value
        .split(/\r?\n|[;；]/gu)
        .map((item) => item.replace(/^[-*•\d.)、\s]+/u, '').trim())
        .filter(Boolean);
    }
  }
  return [];
}

/**
 * Treat model JSON as untrusted input. Repair common field aliases, but do not
 * invent missing instructional claims: an empty key-point list reaches the
 * quality gate as a precise repair request instead of crashing on `.join()`.
 */
function normalizeParsedOutlineContract(
  outline: SceneOutline,
  order: number,
  requirement: string,
): SceneOutline {
  const record = outline as unknown as Record<string, unknown>;
  const title =
    firstString(record, ['title', 'sceneTitle', 'name']) ||
    `Scene ${order}: ${requirement.trim().slice(0, 80)}`;
  const description = firstString(record, [
    'description',
    'teachingObjective',
    'objective',
    'summary',
  ]);
  const keyPoints = firstStringList(record, [
    'keyPoints',
    'key_points',
    'learningPoints',
    'learning_points',
    'points',
  ]);
  const type =
    record.type === 'slide' || record.type === 'quiz' || record.type === 'interactive'
      ? record.type
      : 'slide';

  const normalized = { ...outline } as SceneOutline & Record<string, unknown>;
  delete normalized.outlines;
  delete normalized.scenes;
  delete normalized.courseTitle;
  delete normalized.languageDirective;
  return {
    ...normalized,
    type,
    title,
    description,
    keyPoints,
    order,
  };
}

function normalizeTaskEngineProceduralOutline(
  outline: SceneOutline,
  requirement: string,
): SceneOutline {
  const widgetOutline = outline.widgetOutline ?? {};

  return {
    ...outline,
    type: 'interactive',
    widgetType: 'procedural-skill',
    widgetOutline: {
      ...widgetOutline,
      procedureType: widgetOutline.procedureType ?? 'inspection',
      task: widgetOutline.task || requirement,
      tools:
        widgetOutline.tools && widgetOutline.tools.length > 0
          ? widgetOutline.tools
          : ['required PPE', 'task checklist'],
      steps:
        widgetOutline.steps && widgetOutline.steps.length > 0
          ? widgetOutline.steps
          : ['Confirm task conditions', 'Select required tools', 'Complete safety check'],
      successCriteria:
        widgetOutline.successCriteria && widgetOutline.successCriteria.length > 0
          ? widgetOutline.successCriteria
          : ['Required checks completed', 'Unsafe conditions are not ignored'],
      errorConsequences:
        widgetOutline.errorConsequences && widgetOutline.errorConsequences.length > 0
          ? widgetOutline.errorConsequences
          : ['Unsafe or incorrect actions require stopping and rechecking'],
    },
  };
}

function normalizeTaskEngineSlideOutline(outline: SceneOutline): SceneOutline {
  const normalized: SceneOutline = {
    ...outline,
    type: 'slide',
  };
  delete normalized.widgetType;
  delete normalized.widgetOutline;
  delete normalized.interactiveConfig;
  return normalized;
}

const ORDINARY_WIDGET_TYPES = new Set(['simulation', 'diagram', 'code', 'game', 'visualization3d']);

function normalizeTaskEngineOutline(outline: SceneOutline, requirement: string): SceneOutline {
  if (outline.type === 'slide') {
    return normalizeTaskEngineSlideOutline(outline);
  }

  if (outline.type === 'interactive' && outline.widgetType === 'procedural-skill') {
    return normalizeTaskEngineProceduralOutline(outline, requirement);
  }

  if (
    outline.type === 'interactive' &&
    outline.widgetType &&
    ORDINARY_WIDGET_TYPES.has(outline.widgetType)
  ) {
    return outline;
  }

  return normalizeTaskEngineSlideOutline(outline);
}

function sanitizeNonTaskEngineOutline(outline: SceneOutline): SceneOutline {
  if (outline.widgetType !== 'procedural-skill') {
    return outline;
  }

  const widgetOutline = { ...(outline.widgetOutline ?? {}) };
  delete widgetOutline.procedureType;
  delete widgetOutline.task;
  delete widgetOutline.tools;
  delete widgetOutline.steps;
  delete widgetOutline.successCriteria;
  delete widgetOutline.errorConsequences;

  // procedural-skill is gated behind taskEngineMode to protect ordinary MAIC generation.
  return {
    ...outline,
    type: 'interactive',
    widgetType: 'diagram',
    description: outline.description
      ? `${outline.description} Present this as a process or structure diagram.`
      : 'Present this topic as a process or structure diagram.',
    widgetOutline,
  };
}

function ensureUniqueOutlineId(outline: SceneOutline, usedIds: Set<string>): SceneOutline {
  const candidate = typeof outline.id === 'string' && outline.id.trim() ? outline.id : undefined;
  if (candidate && !usedIds.has(candidate)) {
    usedIds.add(candidate);
    return outline;
  }

  let id = nanoid();
  while (usedIds.has(id)) {
    id = nanoid();
  }
  usedIds.add(id);
  return { ...outline, id };
}

export async function POST(req: NextRequest) {
  let requirementSnippet: string | undefined;
  let resolvedModelString: string | undefined;
  let planningRunId: string | undefined;
  let planningLeaseToken: string | undefined;
  let learnerKnowledgeContext = '';
  const releasePlanningLease = async (errorCode: string, errorDetail: string) => {
    if (!planningRunId || !planningLeaseToken) return;
    const leaseToken = planningLeaseToken;
    // Clear first so a secondary persistence failure cannot cause a duplicate
    // release attempt from an outer catch path.
    planningLeaseToken = undefined;
    await getCoursePlanningService().failOutline({
      planningRunId,
      leaseToken,
      errorCode,
      errorDetail,
    });
  };
  try {
    const body = await req.json();
    planningRunId =
      typeof body.planningRunId === 'string' && body.planningRunId.trim()
        ? body.planningRunId.trim()
        : undefined;

    if (!body.requirements && !planningRunId) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'Requirements are required');
    }

    const parsedBody = body as {
      requirements: UserRequirements;
      pdfText?: string;
      pdfImages?: PdfImage[];
      imageMapping?: ImageMapping;
      researchContext?: string;
      agents?: AgentInfo[];
      enforceQualityContract?: boolean;
      outlineAttemptMode?: 'single' | 'legacy';
      outlineRepairFeedback?: string;
      sourceContextExpectedChars?: number;
    };
    let { requirements, pdfText, researchContext } = parsedBody;
    const {
      pdfImages,
      imageMapping,
      agents,
      outlineAttemptMode,
      outlineRepairFeedback,
    } = parsedBody;
    if (planningRunId) {
      const planningLease = await getCoursePlanningService().beginOutline(planningRunId);
      if (!planningLease) {
        const current = await getCoursePlanningService().view(planningRunId);
        return apiError(
          'GENERATION_FAILED',
          409,
          current?.attemptCount === current?.maxAttempts
            ? '课程规划尝试次数已用尽。'
            : '同一课程规划正在另一个请求中执行，请稍后恢复。',
          current?.error?.detail,
        );
      }
      const persisted = planningLease.run;
      requirements = persisted.input.requirements;
      pdfText = persisted.input.documentText;
      researchContext = persisted.input.researchText;
      planningLeaseToken = planningLease.leaseToken;
      const compiledContext = await getCoursePlanningService().compileContext(persisted);
      learnerKnowledgeContext = compiledContext.learnerKnowledgeText;
      if (isContentEngineV3Enabled() && requirements.learningContract) {
        // The V3 planner consumes exactly the frozen context pack. It never
        // reconstructs source text from browser payloads or a mutable vault.
        pdfText = compiledContext.sourceText;
        researchContext = '';
      }

      if (planningLease.reusedReadyResult && persisted.outlines?.length) {
        const doneEvent = JSON.stringify({
          type: 'done',
          outlines: persisted.outlines,
          languageDirective: persisted.languageDirective || DEFAULT_LANGUAGE_DIRECTIVE,
          courseTitle: persisted.courseTitle,
          taskEngineMode: persisted.taskEngineMode,
          restoredFromPlanningRun: true,
        });
        return new Response(`data: ${doneEvent}\n\n`, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
          },
        });
      }
      if (!planningLeaseToken) {
        return apiError('GENERATION_FAILED', 409, '课程规划租约未建立，尚未调用模型。');
      }
    }

    requirementSnippet = requirements?.requirement?.substring(0, 60);


    const contentEngineV3Active =
      isContentEngineV3Enabled() && Boolean(requirements.learningContract);
    let v3FallbackPlan: V3PlanRunResult | undefined;
    if (contentEngineV3Active) {
      try {
        // Build a fully valid, deterministic plan before the semantic model is
        // contacted.  It is not the preferred learner experience; it is the
        // durable no-error fallback if the one semantic pass is malformed or
        // under-specifies the learning arc.
        v3FallbackPlan = buildV3PlanRun({
          requirements,
          sourceContext: [pdfText, researchContext].filter(Boolean).join('\n\n'),
        });
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        const code = error instanceof V3PlanBuildError ? error.code : 'PLAN_INVALID';
        await releasePlanningLease(code, detail);
        return apiError(
          code === 'SOURCE_INSUFFICIENT' ? 'QUALITY_GATE_FAILED' : 'GENERATION_FAILED',
          422,
          code === 'SOURCE_INSUFFICIENT'
            ? 'The reviewed source set is not sufficient for the requested learning contract.'
            : 'The V3 learning plan could not be validated.',
          detail,
        );
      }
    }

    // The single semantic pass comes only after the source set and its durable
    // fallback are frozen. This prevents model instability from becoming a
    // user-visible “retry the whole course” failure.
    const {
      model: languageModel,
      modelInfo,
      modelString,
      thinkingConfig,
    } = await resolveModelFromRequest(req, body, 'scene-outlines-stream');
    resolvedModelString = modelString;

    // Build user profile string for language inference context
    const learnerContext = [
      requirements.userNickname || requirements.userBio
        ? `## Student Profile\n\nStudent: ${requirements.userNickname || 'Unknown'}${requirements.userBio ? ` — ${requirements.userBio}` : ''}\n\nConsider this student's background when designing the course. Adapt difficulty, examples, and teaching approach accordingly.\n\n---`
        : '',
      requirements.learningProject
        ? learningProjectPromptContext(requirements.learningProject, {
            mode: requirements.externalEvidenceMode,
            status: requirements.externalEvidenceStatus,
            warning: requirements.externalEvidenceWarning,
          })
        : '',
      learnerKnowledgeContext
        ? `## Frozen verified learner state (non-canonical)\n\n${learnerKnowledgeContext}\n\nUse this state only to avoid repeating mastered material, explicitly repair known misconceptions, revisit unresolved questions, and set the next difficulty. It is not source evidence: never cite it or let it override the frozen source set.`
        : '',
    ]
      .filter(Boolean)
      .join('\n\n');

    // Detect vision capability
    const hasVision = !!modelInfo?.capabilities?.vision;

    // Build prompt (same logic as generateSceneOutlinesFromRequirements)
    let availableImagesText = 'No images available';
    let visionImages: Array<{ id: string; src: string }> | undefined;

    if (pdfImages && pdfImages.length > 0) {
      if (hasVision && imageMapping) {
        // Vision mode: split into vision images (first N) and text-only (rest)
        const sortedImages = sortDocumentImagesForVision(pdfImages);
        const allWithSrc = sortedImages.filter((img) => imageMapping[img.id]);
        const visionSlice = allWithSrc.slice(0, MAX_VISION_IMAGES);
        const textOnlySlice = allWithSrc.slice(MAX_VISION_IMAGES);
        const noSrcImages = sortedImages.filter((img) => !imageMapping[img.id]);

        const visionDescriptions = visionSlice.map((img) => formatImagePlaceholder(img));
        const textDescriptions = [...textOnlySlice, ...noSrcImages].map((img) =>
          formatImageDescription(img),
        );
        availableImagesText = [...visionDescriptions, ...textDescriptions].join('\n');

        visionImages = visionSlice.map((img) => ({
          id: img.id,
          src: imageMapping[img.id],
          width: img.width,
          height: img.height,
        }));
      } else {
        // Text-only mode: full descriptions
        availableImagesText = pdfImages.map((img) => formatImageDescription(img)).join('\n');
      }
    }

    // Build media snippet conditions based on enabled flags.
    const imageGenerationEnabled = req.headers.get('x-image-generation-enabled') === 'true';
    const videoGenerationEnabled = req.headers.get('x-video-generation-enabled') === 'true';
    const mediaGenerationEnabled = imageGenerationEnabled || videoGenerationEnabled;
    const hasSourceImages = (pdfImages?.length ?? 0) > 0;

    // Build teacher context from agents (if available)
    const teacherContext = formatTeacherPersonaForPrompt(agents);

    // Check if Interactive Mode or server-enabled Task Engine mode is enabled.
    const interactiveMode = requirements.interactiveMode ?? false;
    const taskEngineMode = resolveVocationalActive(requirements);
    const promptId = taskEngineMode
      ? PROMPT_IDS.TASK_ENGINE_OUTLINES
      : interactiveMode
        ? PROMPT_IDS.INTERACTIVE_OUTLINES
        : PROMPT_IDS.REQUIREMENTS_TO_OUTLINES;

    const prompts = buildPrompt(promptId, {
      requirement: requirements.requirement,
      pdfContent: pdfText ? pdfText.substring(0, MAX_PDF_CONTENT_CHARS) : 'None',
      availableImages: availableImagesText,
      researchContext: researchContext || 'None',
      hasSourceImages,
      imageEnabled: imageGenerationEnabled,
      videoEnabled: videoGenerationEnabled,
      mediaEnabled: mediaGenerationEnabled,
      teacherContext,
      userProfile: learnerContext,
    });

    if (!prompts) {
      await releasePlanningLease(
        'PROMPT_TEMPLATE_NOT_FOUND',
        `Prompt template not found: ${promptId}`,
      );
      return apiError('INTERNAL_ERROR', 500, 'Prompt template not found');
    }

    log.info(
      `Generating outlines: "${requirements.requirement.substring(0, 50)}" [model=${modelString}]`,
    );

    // Create SSE stream with heartbeat to prevent connection timeout
    const encoder = new TextEncoder();
    const HEARTBEAT_INTERVAL_MS = 15_000;
    const stream = new ReadableStream({
      async start(controller) {
        // Heartbeat: periodically send SSE comments to keep the connection alive.
        let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
        const startHeartbeat = () => {
          stopHeartbeat();
          heartbeatTimer = setInterval(() => {
            try {
              controller.enqueue(encoder.encode(`:heartbeat\n\n`));
            } catch {
              stopHeartbeat();
            }
          }, HEARTBEAT_INTERVAL_MS);
        };
        const stopHeartbeat = () => {
          if (heartbeatTimer) {
            clearInterval(heartbeatTimer);
            heartbeatTimer = null;
          }
        };
        const releaseInterruptedPlanningLease = async () => {
          if (!planningRunId || !planningLeaseToken) return;
          await getCoursePlanningService()
            .failOutline({
              planningRunId,
              leaseToken: planningLeaseToken,
              errorCode: 'OUTLINE_REQUEST_INTERRUPTED',
              errorDetail: 'The outline request ended before a complete result was persisted.',
            })
            .catch((error) => log.error('Failed to release interrupted planning lease:', error));
        };

        // A DeepSeek attempt can legitimately take two to three minutes.
        // Retrying three times inside one Vercel invocation crosses the Hobby
        // 300 second ceiling. The production browser therefore performs one
        // attempt per request and carries repair feedback into a fresh request.
        // V3 has a validated deterministic release fallback. One semantic
        // attempt is therefore the complete time budget; retrying the same
        // outline model only hides instability and makes the learner wait.
        const MAX_STREAM_RETRIES = contentEngineV3Active
          ? 0
          : outlineAttemptMode === 'single'
            ? 0
            : 1;
        // Hard ceiling on the accumulated stream buffer. Legitimate outline
        // JSON is small (tens of KB); anything past this is a runaway/degenerate
        // generation and must not be allowed to grow the heap unbounded.
        const MAX_OUTLINE_STREAM_BYTES = 512 * 1024;

        try {
          startHeartbeat();

          const buildStreamParams = (userPrompt: string) =>
            visionImages?.length
              ? {
                  model: languageModel,
                  system: prompts.system,
                  messages: [
                    {
                      role: 'user' as const,
                      content: buildVisionUserContent(userPrompt, visionImages),
                    },
                  ],
                  maxOutputTokens: modelInfo?.outputWindow,
                  // Tear down the upstream LLM request when the client disconnects,
                  // instead of letting it run to completion for a dead connection.
                  abortSignal: req.signal,
                }
              : {
                  model: languageModel,
                  system: prompts.system,
                  prompt: userPrompt,
                  maxOutputTokens: modelInfo?.outputWindow,
                  abortSignal: req.signal,
                };

          let parsedOutlines: SceneOutline[] = [];
          let languageDirective: string | null = null;
          let courseTitle: string | null = null;
          let lastError: string | undefined;
          let planningMode: 'semantic-v3' | 'deterministic-v3-fallback' | undefined;
          const qualityFeedback =
            typeof outlineRepairFeedback === 'string'
              ? outlineRepairFeedback.trim().slice(0, 4_000)
              : '';
          let lastFailureReason: 'quality' | 'parse' | 'provider' = 'provider';

          for (let attempt = 1; attempt <= MAX_STREAM_RETRIES + 1; attempt++) {
            try {
              let fullText = '';
              let scanFrom = 0;
              parsedOutlines = [];
              languageDirective = null;
              courseTitle = null;
              const usedOutlineIds = new Set<string>();
              const semanticPrompt = contentEngineV3Active
                ? `${prompts.user}${semanticV3OutlineGuidance(requirements)}`
                : prompts.user;
              const attemptUserPrompt = qualityFeedback
                ? `${semanticPrompt}

## Mandatory quality repair from the previous attempt
${qualityFeedback}

Return a completely revised outline. Do not merely rename the previous scenes.`
                : semanticPrompt;
              const textStream = streamLLM(
                buildStreamParams(attemptUserPrompt),
                'scene-outlines-stream',
                thinkingConfig,
              ).textStream;

              for await (const chunk of textStream) {
                // Stop doing work the moment the client goes away — otherwise
                // generation keeps running and buffering for a dead connection.
                if (req.signal?.aborted) {
                  stopHeartbeat();
                  await releaseInterruptedPlanningLease();
                  return;
                }

                fullText += chunk;

                if (fullText.length > MAX_OUTLINE_STREAM_BYTES) {
                  log.warn(
                    `Outline stream exceeded ${MAX_OUTLINE_STREAM_BYTES} bytes (len=${fullText.length}); stopping read and finalizing with ${parsedOutlines.length} outline(s)`,
                  );
                  break;
                }

                // Try to extract language directive early
                if (!languageDirective) {
                  languageDirective = extractLanguageDirective(fullText);
                  if (languageDirective && !contentEngineV3Active) {
                    const ldEvent = JSON.stringify({
                      type: 'languageDirective',
                      data: languageDirective,
                    });
                    controller.enqueue(encoder.encode(`data: ${ldEvent}\n\n`));
                  }
                }

                // Try to extract course title early (same pattern as languageDirective)
                if (!courseTitle) {
                  courseTitle = extractCourseTitle(fullText);
                  if (courseTitle && !contentEngineV3Active) {
                    const ctEvent = JSON.stringify({
                      type: 'courseTitle',
                      data: courseTitle,
                    });
                    controller.enqueue(encoder.encode(`data: ${ctEvent}\n\n`));
                  }
                }

                // Try to extract new outlines from the accumulated text,
                // resuming the scan from where the previous chunk left off.
                const { outlines: newOutlines, scanFrom: nextScanFrom } = extractNewOutlines(
                  fullText,
                  scanFrom,
                );
                scanFrom = nextScanFrom;
                for (const outline of newOutlines) {
                  // Ensure ID and order
                  const enrichedBase = normalizeParsedOutlineContract(
                    outline,
                    parsedOutlines.length + 1,
                    requirements.requirement,
                  );
                  const normalized = taskEngineMode
                    ? normalizeTaskEngineOutline(enrichedBase, requirements.requirement)
                    : sanitizeNonTaskEngineOutline(enrichedBase);
                  const enriched = ensureUniqueOutlineId(normalized, usedOutlineIds);
                  parsedOutlines.push(enriched);

                  // V3 first normalizes the full semantic arc against the
                  // frozen activity/evidence contract. Streaming raw model
                  // scenes would make the UI briefly show content that may be
                  // replaced by that safe normalization.
                  if (!contentEngineV3Active) {
                    const event = JSON.stringify({
                      type: 'outline',
                      data: enriched,
                      index: parsedOutlines.length - 1,
                    });
                    controller.enqueue(encoder.encode(`data: ${event}\n\n`));
                  }
                }
              }

              // Incremental extraction is deliberately strict so only complete
              // objects reach the browser. Once the response is complete, run
              // the shared repair parser over the entire envelope. This
              // recovers common model JSON defects that previously produced
              // outlines=0 despite a substantial, otherwise usable response.
              if (fullText.trim()) {
                const recovered = recoverCompleteOutlineEnvelope(fullText);
                if (recovered && recovered.outlines.length > parsedOutlines.length) {
                  const recoveredIds = new Set<string>();
                  parsedOutlines = recovered.outlines.map((outline, index) => {
                    const enrichedBase = normalizeParsedOutlineContract(
                      outline,
                      index + 1,
                      requirements.requirement,
                    );
                    const normalized = taskEngineMode
                      ? normalizeTaskEngineOutline(enrichedBase, requirements.requirement)
                      : sanitizeNonTaskEngineOutline(enrichedBase);
                    return ensureUniqueOutlineId(normalized, recoveredIds);
                  });
                  languageDirective = recovered.languageDirective ?? languageDirective;
                  courseTitle = recovered.courseTitle ?? courseTitle;
                  log.info(
                    `Complete-response repair recovered ${parsedOutlines.length} outline(s).`,
                  );
                }
              }

              // Validate: got outlines?
              if (parsedOutlines.length > 0) {
                if (!courseTitle) {
                  // The head-bound streaming scan can miss a title the model
                  // placed after the outlines array or past the 8KB head window;
                  // recover it from the now-complete response before finalizing.
                  courseTitle = extractCourseTitleFromComplete(fullText);
                }
                if (contentEngineV3Active && v3FallbackPlan) {
                  try {
                    const semanticPlan = buildSemanticV3PlanRun({
                      requirements,
                      sourceContext: [pdfText, researchContext].filter(Boolean).join('\n\n'),
                      semanticOutlines: parsedOutlines,
                      courseTitle,
                      languageDirective,
                    });
                    // Vaultide 对齐 OpenMAIC：语义 V3 大纲不再被质量门拒绝。
                    parsedOutlines = semanticPlan.outlines;
                    languageDirective = semanticPlan.languageDirective;
                    courseTitle = semanticPlan.courseTitle;
                    planningMode = 'semantic-v3';
                    log.info(`Semantic V3 outline accepted (scenes=${parsedOutlines.length}).`);
                    break;
                  } catch (error) {
                    // One high-quality semantic attempt is the time budget. A
                    // malformed or shallow model plan is contained here; the
                    // already-valid baseline is published below rather than
                    // making the learner wait through opaque retries.
                    lastError = error instanceof Error ? error.message : String(error);
                    lastFailureReason = 'quality';
                    parsedOutlines = [];
                    log.warn(
                      `Semantic V3 outline declined; withholding deterministic template: ${lastError}`,
                    );
                    break;
                  }
                }
              // OpenMAIC parity: no quality gate, outline repair, or evidence
              // convergence. Keep the parsed outlines as-is and exit the loop.
              break;
              }

              // Empty result — retry if we have attempts left
              lastError = fullText.trim()
                ? 'LLM response could not be parsed into outlines'
                : 'LLM returned empty response';
              lastFailureReason = 'parse';
              log.warn(
                `Outlines attempt ${attempt} diagnostics: textLen=${fullText.length}, outlines=${parsedOutlines.length}, languageDirective=${languageDirective ? 'yes' : 'no'}, preview=${JSON.stringify(fullText.slice(0, 240))}`,
              );

              if (attempt <= MAX_STREAM_RETRIES) {
                log.warn(
                  `Empty outlines (attempt ${attempt}/${MAX_STREAM_RETRIES + 1}), retrying...`,
                );
                // Notify client a retry is happening
                const retryEvent = JSON.stringify({
                  type: 'retry',
                  attempt,
                  maxAttempts: MAX_STREAM_RETRIES + 1,
                });
                controller.enqueue(encoder.encode(`data: ${retryEvent}\n\n`));
              }
            } catch (error) {
              // Client disconnected (AbortError from the now-propagated signal):
              // stop immediately, don't burn retries re-running generation.
              if (req.signal?.aborted) {
                stopHeartbeat();
                await releaseInterruptedPlanningLease();
                return;
              }
              lastError = error instanceof Error ? error.message : String(error);
              lastFailureReason = 'provider';
              log.warn(
                `Outlines stream error detail (attempt ${attempt}/${MAX_STREAM_RETRIES + 1}): ${lastError}`,
              );

              if (attempt <= MAX_STREAM_RETRIES) {
                log.warn(
                  `Stream error (attempt ${attempt}/${MAX_STREAM_RETRIES + 1}), retrying...`,
                  error,
                );
                const retryEvent = JSON.stringify({
                  type: 'retry',
                  attempt,
                  maxAttempts: MAX_STREAM_RETRIES + 1,
                });
                controller.enqueue(encoder.encode(`data: ${retryEvent}\n\n`));
                continue;
              }
            }
          }

          const fallbackToDeterministicV3 =
            parsedOutlines.length === 0 && contentEngineV3Active && Boolean(v3FallbackPlan);
          if (fallbackToDeterministicV3 && v3FallbackPlan) {
            // A source/contract-safe template is useful for internal diagnosis,
            // but it is not a substitute for the topic-specific classroom the
            // learner asked for. Do not silently publish it when the semantic
            // arc could not be parsed or released; retain the frozen plan only
            // as a durable audit reference and return a precise retry state.
            lastError =
              lastError ??
              'The semantic learning arc could not be validated against the frozen source set.';
            log.warn(
              `Semantic V3 outline unavailable; withholding deterministic template: ${lastError}`,
            );
          }

          if (parsedOutlines.length > 0) {
            const qualityOutlines = parsedOutlines;
            // Replace sequential gen_img_N/gen_vid_N with globally unique IDs
            const uniquifiedOutlines = uniquifyMediaElementIds(qualityOutlines);
            if (planningRunId && planningLeaseToken) {
              const completedPlan = await getCoursePlanningService().completeOutline({
                planningRunId,
                leaseToken: planningLeaseToken,
                outlines: uniquifiedOutlines,
                languageDirective: languageDirective || DEFAULT_LANGUAGE_DIRECTIVE,
                ...(courseTitle ? { courseTitle } : {}),
                taskEngineMode,
              });
              if (!completedPlan) {
                throw new Error('course_planning_result_persistence_failed');
              }
            }
            // Send done event with all outlines
            const doneEvent = JSON.stringify({
              type: 'done',
              outlines: uniquifiedOutlines,
              languageDirective: languageDirective || DEFAULT_LANGUAGE_DIRECTIVE,
              courseTitle: courseTitle || undefined,
              taskEngineMode,
              ...(planningMode ? { planningMode } : {}),
            });
            controller.enqueue(encoder.encode(`data: ${doneEvent}\n\n`));
          } else {
            // All retries exhausted, no outlines produced
            log.error(
              `Outline generation failed after ${MAX_STREAM_RETRIES + 1} attempts: ${lastError}`,
            );
            if (planningRunId && planningLeaseToken) {
              await getCoursePlanningService().failOutline({
                planningRunId,
                leaseToken: planningLeaseToken,
                errorCode: `OUTLINE_${lastFailureReason.toUpperCase()}_FAILED`,
                errorDetail: lastError || 'Failed to generate outlines',
              });
            }
            const errorEvent = JSON.stringify({
              type: 'error',
              error: lastError || 'Failed to generate outlines',
              retryable: true,
              reason: lastFailureReason,
              repairFeedback:
                qualityFeedback ||
                (lastFailureReason === 'parse'
                  ? 'Return one strict JSON object with a complete outlines array. Use 9-12 distinct, source-grounded scenes and do not include prose outside JSON.'
                  : 'Retry the complete outline generation without reducing scene count or source coverage.'),
            });
            controller.enqueue(encoder.encode(`data: ${errorEvent}\n\n`));
          }
        } catch (error) {
          if (planningRunId && planningLeaseToken) {
            await getCoursePlanningService()
              .failOutline({
                planningRunId,
                leaseToken: planningLeaseToken,
                errorCode: req.signal?.aborted
                  ? 'OUTLINE_REQUEST_INTERRUPTED'
                  : 'OUTLINE_GENERATION_FAILED',
                errorDetail: error instanceof Error ? error.message : String(error),
              })
              .catch((persistenceError) =>
                log.error('Failed to persist outline failure state:', persistenceError),
              );
          }
          const errorEvent = JSON.stringify({
            type: 'error',
            error: error instanceof Error ? error.message : String(error),
          });
          controller.enqueue(encoder.encode(`data: ${errorEvent}\n\n`));
        } finally {
          stopHeartbeat();
          // The controller may already be closed if the client disconnected.
          try {
            controller.close();
          } catch {
            // already closed — ignore
          }
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (error) {
    if (planningRunId && planningLeaseToken) {
      await releasePlanningLease(
        'OUTLINE_PRESTREAM_FAILED',
        error instanceof Error ? error.message : String(error),
      ).catch((persistenceError) =>
        log.error('Failed to release pre-stream planning lease:', persistenceError),
      );
    }
    log.error(
      `Outline streaming failed [requirement="${requirementSnippet ?? 'unknown'}...", model=${resolvedModelString ?? 'unknown'}]:`,
      error,
    );
    return apiError('INTERNAL_ERROR', 500, error instanceof Error ? error.message : String(error));
  }
}
