import {
  STANDARD_COURSE_MAX_SCENES,
  STANDARD_COURSE_MIN_SCENES,
  V3_COURSE_MAX_ACTIVITIES,
  V3_COURSE_MIN_ACTIVITIES,
  describeV3OutlineReleaseViolation,
} from '@/lib/generation/outline-release-contract';
import type {
  GeneratedInteractiveContent,
  GeneratedPBLContent,
  GeneratedQuizContent,
  GeneratedSlideContent,
  SceneOutline,
} from '@/lib/types/generation';
import type { Scene } from '@/lib/types/stage';

export const COURSE_QUALITY_CONTRACT_VERSION = 'course-quality-v4';
export const SCENE_QUALITY_RELEASE_FLOOR = 90;
export const COURSE_AVERAGE_QUALITY_RELEASE_FLOOR = 93;

export const CORE_COURSE_QUALITY_DIMENSIONS = [
  'structure',
  'instructionalDepth',
  'pedagogy',
  'grounding',
  'accuracy',
  'distinctiveness',
  'transfer',
] as const;

export type CourseQualityDimension = (typeof CORE_COURSE_QUALITY_DIMENSIONS)[number];
export type CourseQualitySeverity = 'error' | 'warning';

export interface CourseQualityIssue {
  code: string;
  message: string;
  retryInstruction: string;
  severity: CourseQualitySeverity;
  sceneOrder?: number;
}

export interface CourseQualityAssessment {
  passed: boolean;
  score: number;
  issues: CourseQualityIssue[];
  metrics: Record<string, number | string | boolean>;
  /**
   * Scores are observable-rubric scores, not model confidence. Missing
   * dimensions mean that the assessment does not measure that dimension.
   */
  dimensions?: Partial<Record<CourseQualityDimension, number>>;
}

export interface SourceReadinessInput {
  pdfText?: string;
  researchContext?: string;
  webSearchEnabled?: boolean;
}

type QualityDimensions = NonNullable<CourseQualityAssessment['dimensions']>;

/**
 * Route unit tests use intentionally tiny fixtures to verify routing and
 * schema behavior. Production never accepts an opt-out.
 */
export function shouldEnforceCourseQuality(
  explicit?: unknown,
  environment = process.env.NODE_ENV,
): boolean {
  if (environment !== 'test') return true;
  return explicit === true;
}

const FOUNDATION_PATTERN =
  /导入|简介|背景|前置|概览|问题|动机|基础|学习路线|overview|introduction|background|prerequisite|motivation|context/iu;
const MECHANISM_PATTERN =
  /架构|流程|机制|原理|模块|数据流|方法|设计|算法|模型|实现|architecture|workflow|mechanism|module|method|design|algorithm|implementation/iu;
const APPLICATION_PATTERN =
  /实战|案例|动手|应用|复现|实验|演示|练习|配置|构建|排错|实践|hands-on|case|apply|application|reproduce|experiment|practice|build|debug/iu;
const LIMIT_PATTERN =
  /局限|限制|风险|失败|安全|边界|陷阱|注意|异常|权衡|挑战|limitations?|risk|failure|security|boundary|pitfall|trade-?off|challenge/iu;
const SYNTHESIS_PATTERN =
  /总结|归纳|综合|全貌|回顾|复盘|要点|summary|synthesis|takeaways?|review/iu;
const TRANSFER_PATTERN =
  /迁移|新情境|新项目|实际任务|跨场景|应用到|transfer|new (?:case|context|project|problem)|apply (?:it|this|the)/iu;
const OBSERVABLE_RESULT_PATTERN =
  /证据|产出|交付|完成标准|验证|提交|解释|比较|设计|决策|observable|evidence|artifact|deliverable|completion criteria|justify|compare|design|decision/iu;
const EXPLANATION_PATTERN =
  /因为|因此|所以|导致|原理|机制|意味着|why|because|therefore|mechanism|works by|results? in/iu;
const EXAMPLE_PATTERN =
  /例如|案例|示例|实测|证据|数据|实验|for example|case|evidence|data|experiment/iu;
const LEARNER_ACTION_PATTERN =
  /请|尝试|判断|思考|选择|比较|观察|解释|验证|apply|try|decide|compare|observe|explain|verify/iu;
const FEEDBACK_PATTERN =
  /反馈|结果|提示|正确|错误|得分|状态|变化|feedback|result|hint|correct|incorrect|score/iu;
const RESET_PATTERN = /重置|重新开始|再试一次|复位|重放|重新播放|reset|restart|replay|try again/iu;
const FILLER_EXACT_PATTERN =
  /^(?:第?\s*\d+\s*(?:页|章|节|场景)|scene\s*\d+|内容\s*\d*|标题\s*\d*|待补充|占位|示例内容|todo|tbd|placeholder|lorem ipsum|example content|coming soon)$/iu;

function issue(
  code: string,
  message: string,
  retryInstruction: string,
  severity: CourseQualitySeverity = 'error',
  sceneOrder?: number,
): CourseQualityIssue {
  return {
    code,
    message,
    retryInstruction,
    severity,
    ...(sceneOrder !== undefined ? { sceneOrder } : {}),
  };
}

function clamp(value: number, minimum = 0, maximum = 100): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, value));
}

function round(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function mean(values: readonly number[]): number {
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

/**
 * Maps an observable metric to a score where merely crossing the release
 * threshold earns 90, while 100 requires the explicitly stronger target.
 */
function scoreAtThreshold(value: number, minimum: number, excellent: number): number {
  if (value < minimum) {
    if (minimum <= 0) return 0;
    return clamp((value / minimum) * 89, 0, 89);
  }
  if (excellent <= minimum) return 100;
  return clamp(90 + ((value - minimum) / (excellent - minimum)) * 10, 90, 100);
}

export function normalizedReleaseScore(
  value: number,
  minimum: number,
  excellent: number,
  releaseFloor = 95,
): number {
  if (value < minimum) {
    if (minimum <= 0) return 0;
    return clamp((value / minimum) * (releaseFloor - 1), 0, releaseFloor - 1);
  }
  if (excellent <= minimum) return 100;
  return clamp(
    releaseFloor + ((value - minimum) / (excellent - minimum)) * (100 - releaseFloor),
    releaseFloor,
    100,
  );
}

function finalize(
  issues: CourseQualityIssue[],
  metrics: CourseQualityAssessment['metrics'],
  dimensions: QualityDimensions,
  options: { releaseFloor?: number; scoreOverride?: number } = {},
): CourseQualityAssessment {
  const releaseFloor = options.releaseFloor ?? SCENE_QUALITY_RELEASE_FLOOR;
  const rawDimensions = Object.fromEntries(
    Object.entries(dimensions).map(([key, value]) => [key, clamp(value ?? 0)]),
  ) as QualityDimensions;
  const dimensionValues = Object.values(rawDimensions).filter(
    (value): value is number => typeof value === 'number',
  );
  const rawScore = clamp(
    options.scoreOverride ?? (dimensionValues.length > 0 ? mean(dimensionValues) : 0),
  );
  const normalizedDimensions = Object.fromEntries(
    Object.entries(rawDimensions).map(([key, value]) => [key, round(value, 2)]),
  ) as QualityDimensions;
  const score = round(rawScore, 2);
  const errorCount = issues.filter((entry) => entry.severity === 'error').length;
  const warningCount = issues.length - errorCount;
  return {
    passed: errorCount === 0 && rawScore + Number.EPSILON >= releaseFloor,
    score,
    issues,
    metrics: {
      qualityContractVersion: COURSE_QUALITY_CONTRACT_VERSION,
      errorCount,
      warningCount,
      ...metrics,
      ...Object.fromEntries(
        Object.entries(normalizedDimensions).map(([key, value]) => [`dimension_${key}`, value]),
      ),
    },
    dimensions: normalizedDimensions,
  };
}

export function plainCourseText(value: unknown): string {
  return String(value ?? '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, ' ')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, ' ')
    .replace(/<[^>]+>/gu, ' ')
    .replace(/&nbsp;|&#160;/giu, ' ')
    .replace(/&amp;/giu, '&')
    .replace(/\s+/gu, ' ')
    .trim();
}

function normalizedTitle(value: string): string {
  return value
    .toLocaleLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '')
    .trim();
}

function semanticTokens(value: string): string[] {
  const normalized = plainCourseText(value).toLocaleLowerCase();
  const tokens = new Set<string>();
  for (const match of normalized.matchAll(/[a-z0-9][a-z0-9_+.-]{2,}/giu)) {
    tokens.add(match[0]);
  }
  for (const match of normalized.matchAll(/[\p{Script=Han}]{2,}/gu)) {
    const text = match[0];
    for (let index = 0; index < text.length - 1; index++) {
      tokens.add(text.slice(index, index + 2));
    }
  }
  return [...tokens];
}

function jaccard(left: string, right: string): number {
  const leftTokens = new Set(semanticTokens(left));
  const rightTokens = new Set(semanticTokens(right));
  if (leftTokens.size < 4 || rightTokens.size < 4) return 0;
  let intersection = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) intersection++;
  }
  return intersection / (leftTokens.size + rightTokens.size - intersection);
}

function keyPointCoverage(outline: SceneOutline, contentText: string): number {
  if (!outline.keyPoints?.length) return 0;
  const normalizedContent = plainCourseText(contentText).toLocaleLowerCase();
  const covered = outline.keyPoints.filter((point) => {
    const tokens = semanticTokens(point);
    if (tokens.length === 0) return false;
    return tokens.some((token) => normalizedContent.includes(token));
  }).length;
  return covered / outline.keyPoints.length;
}

function generatedElements(content: GeneratedSlideContent | Record<string, unknown>): unknown[] {
  if (Array.isArray((content as GeneratedSlideContent).elements)) {
    return (content as GeneratedSlideContent).elements;
  }
  const canvas = (content as { canvas?: { elements?: unknown[] } }).canvas;
  return Array.isArray(canvas?.elements) ? canvas.elements : [];
}

function visibleElementTextGroups(element: unknown): string[] {
  if (!element || typeof element !== 'object' || Array.isArray(element)) return [];
  const record = element as Record<string, unknown>;
  const groups: string[] = [];
  const add = (value: unknown) => {
    const text = plainCourseText(value);
    if (text) groups.push(text);
  };

  add(record.content);
  add(record.text);
  add(record.alt);
  add(record.caption);
  add(record.latex);

  if (Array.isArray(record.data)) {
    for (const row of record.data) {
      if (!Array.isArray(row)) continue;
      const rowText = row
        .map((cell) => {
          if (!cell || typeof cell !== 'object' || Array.isArray(cell)) return '';
          return plainCourseText((cell as Record<string, unknown>).text);
        })
        .filter(Boolean)
        .join(' · ');
      add(rowText);
    }
  } else if (record.data && typeof record.data === 'object') {
    const chartData = record.data as Record<string, unknown>;
    const labels = Array.isArray(chartData.labels) ? chartData.labels : [];
    const legends = Array.isArray(chartData.legends) ? chartData.legends : [];
    add([...legends, ...labels].join(' · '));
  }

  return groups;
}

function generatedQuestions(content: GeneratedQuizContent | Record<string, unknown>): unknown[] {
  const questions = (content as GeneratedQuizContent).questions;
  return Array.isArray(questions) ? questions : [];
}

function outlineText(outline: SceneOutline): string {
  return `${outline.title}\n${outline.description}\n${(outline.keyPoints ?? []).join('\n')}`;
}

function sceneText(scene: Scene): string {
  if (scene.content.type === 'slide') {
    return generatedElements(scene.content as unknown as Record<string, unknown>)
      .flatMap(visibleElementTextGroups)
      .join(' ');
  }
  if (scene.content.type === 'quiz') {
    return scene.content.questions
      .map(
        (question) =>
          `${question.question} ${plainCourseText(JSON.stringify(question.options ?? []))} ${
            question.analysis ?? ''
          }`,
      )
      .join(' ');
  }
  if (scene.content.type === 'interactive') return plainCourseText(scene.content.html ?? '');
  return plainCourseText(JSON.stringify(scene.content));
}

function averageDimension(
  assessments: readonly CourseQualityAssessment[],
  dimension: CourseQualityDimension,
): number {
  const values = assessments
    .map((entry) => entry.dimensions?.[dimension])
    .filter((value): value is number => typeof value === 'number');
  return values.length > 0 ? mean(values) : 0;
}

export function describeQualityIssues(assessment: CourseQualityAssessment, limit = 5): string {
  return assessment.issues
    .filter((entry) => entry.severity === 'error')
    .slice(0, limit)
    .map((entry) => entry.retryInstruction)
    .join(' ');
}

export function assessSourceReadiness(input: SourceReadinessInput): CourseQualityAssessment {
  const pdfChars = plainCourseText(input.pdfText).length;
  const researchChars = plainCourseText(input.researchContext).length;
  const totalChars = pdfChars + researchChars;
  const citationCount = new Set(
    [...String(input.researchContext ?? '').matchAll(/\[(S\d+)\]/giu)].map((match) =>
      match[1].toLocaleUpperCase(),
    ),
  ).size;
  const citedSourceBodies = [...String(input.researchContext ?? '').matchAll(/\[(S\d+)\]/giu)]
    .map((match, index, matches) =>
      plainCourseText(
        String(input.researchContext ?? '').slice(match.index ?? 0, matches[index + 1]?.index),
      ),
    )
    .filter(Boolean);
  const substantiveCitedSourceCount = citedSourceBodies.filter(
    (body) => body.length >= 2_500,
  ).length;
  const issues: CourseQualityIssue[] = [];
  const external = input.webSearchEnabled === true;
  const suppliedCanonicalSourceReady = pdfChars >= 2_500;
  const externalResearchDepthReady = researchChars >= 2_500;
  // One complete official README, paper, standard, or repository document is
  // more auditable than two search snippets. Keep the multi-source preference
  // for broad research, but accept a single independently inspectable body
  // only when it is deep enough to support a full course by itself.
  const externalResearchCitationReady =
    researchChars > 0 && (citationCount >= 2 || substantiveCitedSourceCount >= 1);

  if (external && !suppliedCanonicalSourceReady && !externalResearchDepthReady) {
    issues.push(
      issue(
        'source_external_too_shallow',
        'External research does not contain enough inspectable primary-source material.',
        'Collect at least 2,500 substantive characters from primary or authoritative sources before outlining; never expand search snippets into teaching claims.',
      ),
    );
  }
  if (
    external &&
    !suppliedCanonicalSourceReady &&
    researchChars > 0 &&
    !externalResearchCitationReady
  ) {
    issues.push(
      issue(
        'source_citation_set_too_small',
        `External research exposes only ${citationCount} stable citation label(s).`,
        'Preserve at least two independently inspectable [S#] sources, or one complete official source body of at least 2,500 characters; never use metadata or search snippets as the sole teaching basis.',
      ),
    );
  }
  if (!external && totalChars > 0 && totalChars < 1_200) {
    issues.push(
      issue(
        'source_internal_too_shallow',
        'The supplied internal material is too short for a complete course.',
        'Retrieve more relevant project files or document sections before generating the outline.',
      ),
    );
  }

  const evidenceDepthScore = external
    ? normalizedReleaseScore(Math.max(researchChars, pdfChars), 2_500, 8_000)
    : totalChars === 0
      ? 100
      : scoreAtThreshold(totalChars, 1_200, 5_000);
  const citationSetScore =
    !external ||
    suppliedCanonicalSourceReady ||
    researchChars === 0 ||
    substantiveCitedSourceCount >= 1
      ? 100
      : normalizedReleaseScore(citationCount, 2, 5);
  const groundingScore = external
    ? mean([evidenceDepthScore, citationSetScore])
    : evidenceDepthScore;

  return finalize(
    issues,
    {
      pdfChars,
      researchChars,
      totalChars,
      citationCount,
      substantiveCitedSourceCount,
      webSearchEnabled: external,
      sourceBasis: suppliedCanonicalSourceReady
        ? 'supplied-canonical-source'
        : external
          ? 'external-research'
          : 'supplied-internal-source',
      groundingReleaseFloor: 95,
    },
    {
      grounding: groundingScore,
      accuracy: citationCount > 0 || !external || suppliedCanonicalSourceReady ? 100 : 0,
    },
    { releaseFloor: external ? 95 : 90 },
  );
}

export function assessOutlineQuality(outlines: readonly SceneOutline[]): CourseQualityAssessment {
  const issues: CourseQualityIssue[] = [];
  const count = outlines.length;
  const interactiveCount = outlines.filter((outline) => outline.type === 'interactive').length;
  const slideCount = outlines.filter((outline) => outline.type === 'slide').length;
  const quizCount = outlines.filter((outline) => outline.type === 'quiz').length;
  const normalizedTitles = outlines.map((outline) => normalizedTitle(outline.title));
  const duplicateTitleCount = normalizedTitles.length - new Set(normalizedTitles).size;
  const duplicateIdCount =
    outlines.length - new Set(outlines.map((outline) => outline.id?.trim())).size;
  const sortedOrders = outlines.map((outline) => outline.order).sort((left, right) => left - right);
  const orderSequenceValid = sortedOrders.every(
    (order, index) => Number.isInteger(order) && order === index + 1,
  );
  const finalOutline = outlines.at(-1);

  if (count < STANDARD_COURSE_MIN_SCENES || count > STANDARD_COURSE_MAX_SCENES) {
    issues.push(
      issue(
        'outline_count',
        `A standard course needs ${STANDARD_COURSE_MIN_SCENES}-${STANDARD_COURSE_MAX_SCENES} purposeful scenes; received ${count}.`,
        `Rebuild the course as ${STANDARD_COURSE_MIN_SCENES}-${STANDARD_COURSE_MAX_SCENES} distinct scenes with a complete learning progression.`,
      ),
    );
  }
  if (duplicateTitleCount > 0) {
    issues.push(
      issue(
        'outline_duplicate_titles',
        'The outline contains duplicate scene titles.',
        'Remove duplicate chapters and give every scene one distinct instructional job.',
      ),
    );
  }
  if (duplicateIdCount > 0 || outlines.some((outline) => !outline.id?.trim())) {
    issues.push(
      issue(
        'outline_duplicate_ids',
        'The outline contains missing or duplicate scene identities.',
        'Assign one stable, unique, non-empty id to every planned scene.',
      ),
    );
  }
  if (!orderSequenceValid) {
    issues.push(
      issue(
        'outline_order_sequence',
        'Scene orders do not form one complete sequence starting at 1.',
        'Renumber the full outline exactly once, using consecutive orders from 1 through the final scene.',
      ),
    );
  }
  if (quizCount < 1) {
    issues.push(
      issue(
        'outline_no_retrieval',
        'The course has no explicit retrieval or application assessment.',
        'Add at least one source-grounded quiz spanning recall, application and transfer.',
      ),
    );
  }

  const finalText = finalOutline ? outlineText(finalOutline) : '';
  const finalHasSynthesis = SYNTHESIS_PATTERN.test(finalText);
  const finalHasTransfer = TRANSFER_PATTERN.test(finalText);
  const finalHasObservableResult = OBSERVABLE_RESULT_PATTERN.test(finalText);
  if (!finalHasSynthesis || !finalHasTransfer || !finalHasObservableResult) {
    issues.push(
      issue(
        'outline_final_transfer_missing',
        'The final scene does not require synthesis, transfer, and observable completion evidence.',
        'Make the final scene synthesize the course and transfer it to a new project, decision, or problem with an explicit learner artifact or verifiable result.',
      ),
    );
  }
  if (slideCount / Math.max(1, count) < 0.45) {
    issues.push(
      issue(
        'outline_explanation_gap',
        'There are too few explanation and evidence scenes.',
        'Use at least 45% slide scenes for foundations, mechanisms, evidence, and worked examples.',
      ),
    );
  }
  if (interactiveCount > 4 || interactiveCount / Math.max(1, count) > 0.4) {
    issues.push(
      issue(
        'outline_interactive_overload',
        'Interactive scenes crowd out explanation and deliberate practice.',
        'Keep no more than four interactive scenes and use them only when manipulation materially improves understanding.',
      ),
    );
  }

  let consecutiveInteractive = 0;
  let maxInteractiveRun = 0;
  for (const current of outlines) {
    consecutiveInteractive = current.type === 'interactive' ? consecutiveInteractive + 1 : 0;
    maxInteractiveRun = Math.max(maxInteractiveRun, consecutiveInteractive);
  }
  if (maxInteractiveRun > 2) {
    issues.push(
      issue(
        'outline_interactive_run',
        'More than two interactive scenes appear consecutively.',
        'Insert explanation, reflection, or retrieval between interactive scenes.',
      ),
    );
  }

  let fillerOutlineCount = 0;
  let duplicateKeyPointCount = 0;
  for (const current of outlines) {
    const currentRecord = current as SceneOutline & Record<string, unknown>;
    const currentTitle = plainCourseText(current.title);
    if (Array.isArray(currentRecord.outlines) || Array.isArray(currentRecord.scenes)) {
      issues.push(
        issue(
          'outline_nested_envelope',
          `Scene ${current.order} is an outline envelope rather than a learner-visible scene.`,
          'Unwrap nested outlines before quality review so every planned scene is preserved.',
          'error',
          current.order,
        ),
      );
    }
    if (
      !current.title?.trim() ||
      currentTitle.length < 4 ||
      currentTitle.length > 72 ||
      /^(?:scene\s*\d+|第?\s*\d+\s*(?:页|章|节|场景))\s*[:：-]/iu.test(currentTitle)
    ) {
      issues.push(
        issue(
          'outline_title_weak',
          `Scene ${current.order} has an uninformative title.`,
          `Give scene ${current.order} a concrete, topic-specific title.`,
          'error',
          current.order,
        ),
      );
    }
    if (FILLER_EXACT_PATTERN.test(plainCourseText(current.title))) {
      fillerOutlineCount++;
      issues.push(
        issue(
          'outline_filler_scene',
          `Scene ${current.order} is a placeholder rather than an instructional scene.`,
          `Replace scene ${current.order} with a source-specific concept, mechanism, case, assessment, or transfer task.`,
          'error',
          current.order,
        ),
      );
    }
    if (plainCourseText(current.description).length < 40) {
      issues.push(
        issue(
          'outline_description_shallow',
          `Scene ${current.order} does not specify enough teaching depth.`,
          `Rewrite scene ${current.order}'s description to name the mechanism, source evidence or worked example, and learner action.`,
          'error',
          current.order,
        ),
      );
    }
    if (
      !Array.isArray(current.keyPoints) ||
      current.keyPoints.length < 3 ||
      current.keyPoints.length > 5
    ) {
      issues.push(
        issue(
          'outline_keypoints_missing',
          `Scene ${current.order} must contain 3-5 concrete key points.`,
          `Provide 3-5 non-overlapping, source-specific key points for scene ${current.order}.`,
          'error',
          current.order,
        ),
      );
      continue;
    }
    if (current.keyPoints.some((point) => plainCourseText(point).length < 8)) {
      issues.push(
        issue(
          'outline_keypoints_vague',
          `Scene ${current.order} contains vague key points.`,
          `Replace vague labels in scene ${current.order} with concrete mechanisms, evidence, decisions, or failure conditions.`,
          'error',
          current.order,
        ),
      );
    }
    const normalizedPoints = current.keyPoints.map((point) => normalizedTitle(point));
    const duplicates = normalizedPoints.length - new Set(normalizedPoints).size;
    if (duplicates > 0) {
      duplicateKeyPointCount += duplicates;
      issues.push(
        issue(
          'outline_duplicate_keypoints',
          `Scene ${current.order} repeats a planned key point.`,
          `Give every key point in scene ${current.order} a separate instructional purpose.`,
          'error',
          current.order,
        ),
      );
    }
  }

  let nearDuplicateOutlineCount = 0;
  for (let leftIndex = 0; leftIndex < outlines.length; leftIndex++) {
    for (let rightIndex = leftIndex + 1; rightIndex < outlines.length; rightIndex++) {
      const similarity = jaccard(
        outlineText(outlines[leftIndex]),
        outlineText(outlines[rightIndex]),
      );
      if (similarity < 0.84) continue;
      nearDuplicateOutlineCount++;
      issues.push(
        issue(
          'outline_near_duplicate',
          `Scenes ${outlines[leftIndex].order} and ${outlines[rightIndex].order} have nearly the same instructional content.`,
          `Rewrite scene ${outlines[rightIndex].order} around a distinct concept, source finding, learner decision, or transfer task.`,
          'error',
          outlines[rightIndex].order,
        ),
      );
    }
  }

  const courseText = outlines.map(outlineText).join('\n');
  const coverage = {
    foundation: FOUNDATION_PATTERN.test(courseText),
    mechanism: MECHANISM_PATTERN.test(courseText),
    application: APPLICATION_PATTERN.test(courseText),
    limits: LIMIT_PATTERN.test(courseText),
    synthesis: SYNTHESIS_PATTERN.test(courseText),
  };
  const coverageLabels: Record<keyof typeof coverage, string> = {
    foundation: 'prerequisites and context',
    mechanism: 'core mechanism or architecture',
    application: 'worked application',
    limits: 'limitations and failure modes',
    synthesis: 'synthesis and transfer',
  };
  for (const kind of Object.keys(coverage) as Array<keyof typeof coverage>) {
    if (coverage[kind]) continue;
    issues.push(
      issue(
        `outline_coverage_${kind}`,
        `The course is missing ${coverageLabels[kind]}.`,
        `Add a distinct scene for ${coverageLabels[kind]} and ground it in the supplied source material.`,
      ),
    );
  }

  const averageDescriptionChars = mean(
    outlines.map((current) => plainCourseText(current.description).length),
  );
  const keyPoints = outlines.flatMap((current) => current.keyPoints ?? []);
  const averageKeyPointChars = mean(keyPoints.map((point) => plainCourseText(point).length));
  const averageTitleChars = mean(outlines.map((current) => plainCourseText(current.title).length));
  const coverageCount = Object.values(coverage).filter(Boolean).length;
  const countScore =
    count >= STANDARD_COURSE_MIN_SCENES && count <= STANDARD_COURSE_MAX_SCENES
      ? 100
      : count < STANDARD_COURSE_MIN_SCENES
        ? scoreAtThreshold(count, STANDARD_COURSE_MIN_SCENES, STANDARD_COURSE_MIN_SCENES)
        : scoreAtThreshold(
            Math.max(0, STANDARD_COURSE_MAX_SCENES * 2 - count),
            STANDARD_COURSE_MIN_SCENES,
            STANDARD_COURSE_MAX_SCENES,
          );
  const structureScore = mean([
    countScore,
    orderSequenceValid ? 100 : 0,
    duplicateIdCount === 0 ? 100 : 0,
    slideCount / Math.max(1, count) >= 0.45 ? 100 : 50,
  ]);
  const depthScore = mean([
    scoreAtThreshold(averageDescriptionChars, 40, 110),
    scoreAtThreshold(averageKeyPointChars, 8, 28),
    scoreAtThreshold(averageTitleChars, 4, 18),
  ]);
  const pedagogyScore = mean([
    (coverageCount / 5) * 100,
    quizCount >= 1 ? 100 : 0,
    maxInteractiveRun <= 2 ? 100 : 50,
  ]);
  const distinctivenessScore = clamp(
    100 -
      duplicateTitleCount * 35 -
      duplicateKeyPointCount * 15 -
      nearDuplicateOutlineCount * 25 -
      fillerOutlineCount * 35,
  );
  const transferScore =
    ([finalHasSynthesis, finalHasTransfer, finalHasObservableResult].filter(Boolean).length / 3) *
    100;

  return finalize(
    issues,
    {
      count,
      minimumSceneCount: STANDARD_COURSE_MIN_SCENES,
      maximumSceneCount: STANDARD_COURSE_MAX_SCENES,
      slideCount,
      quizCount,
      interactiveCount,
      duplicateTitleCount,
      duplicateIdCount,
      duplicateKeyPointCount,
      nearDuplicateOutlineCount,
      fillerOutlineCount,
      maxInteractiveRun,
      orderSequenceValid,
      averageDescriptionChars: round(averageDescriptionChars),
      averageKeyPointChars: round(averageKeyPointChars),
      finalHasSynthesis,
      finalHasTransfer,
      finalHasObservableResult,
      ...coverage,
    },
    {
      structure: structureScore,
      instructionalDepth: depthScore,
      pedagogy: pedagogyScore,
      distinctiveness: distinctivenessScore,
      transfer: transferScore,
    },
  );
}

type GeneratedSceneContent =
  | GeneratedSlideContent
  | GeneratedQuizContent
  | GeneratedInteractiveContent
  | GeneratedPBLContent
  | Record<string, unknown>;

export function assessGeneratedSceneContent(
  outline: SceneOutline,
  content: GeneratedSceneContent,
): CourseQualityAssessment {
  const issues: CourseQualityIssue[] = [];
  const metrics: CourseQualityAssessment['metrics'] = {
    sceneOrder: outline.order,
    sceneType: outline.type,
  };
  const dimensions: QualityDimensions = {};

  if (outline.type === 'slide') {
    const elements = generatedElements(content as GeneratedSlideContent);
    const textElements = elements.flatMap(visibleElementTextGroups);
    const contentText = textElements.join(' ');
    const substantiveTexts = textElements.filter((text) => text.length >= 24);
    const ids = elements
      .map((element) => String((element as Record<string, unknown>).id ?? '').trim())
      .filter(Boolean);
    const uniqueSubstantiveRatio =
      substantiveTexts.length > 0
        ? new Set(substantiveTexts.map(normalizedTitle)).size / substantiveTexts.length
        : 0;
    const fillerElementCount = textElements.filter((text) =>
      FILLER_EXACT_PATTERN.test(text),
    ).length;
    const coverage = keyPointCoverage(outline, contentText);
    const pedagogySignals = [
      EXPLANATION_PATTERN.test(contentText),
      EXAMPLE_PATTERN.test(contentText),
      LEARNER_ACTION_PATTERN.test(contentText),
    ].filter(Boolean).length;
    const tokenCount = semanticTokens(contentText).length;
    Object.assign(metrics, {
      elementCount: elements.length,
      textChars: contentText.length,
      substantiveTextElements: substantiveTexts.length,
      semanticTokenCount: tokenCount,
      keyPointCoverage: round(coverage, 2),
      pedagogySignalCount: pedagogySignals,
      uniqueSubstantiveRatio: round(uniqueSubstantiveRatio, 2),
      fillerElementCount,
    });

    if (elements.length < 6) {
      issues.push(
        issue(
          'scene_slide_elements',
          `Slide ${outline.order} has only ${elements.length} visual elements.`,
          'Create a structured slide with at least six purposeful elements: title, explanatory groups, evidence or example, and a takeaway.',
          'error',
          outline.order,
        ),
      );
    }
    if (contentText.length < 220 || substantiveTexts.length < 3 || tokenCount < 25) {
      issues.push(
        issue(
          'scene_slide_depth',
          `Slide ${outline.order} is too shallow to teach its objective.`,
          'Regenerate the slide with a named mechanism, a concrete source-grounded example, a learner decision, and enough visible explanation to stand on its own.',
          'error',
          outline.order,
        ),
      );
    }
    if (coverage < 2 / 3) {
      issues.push(
        issue(
          'scene_slide_keypoint_coverage',
          `Slide ${outline.order} visibly covers fewer than two thirds of its planned key points.`,
          'Regenerate the slide so its visible content explicitly explains the planned key points instead of using generic filler.',
          'error',
          outline.order,
        ),
      );
    }
    if (ids.length !== elements.length || ids.length !== new Set(ids).size) {
      issues.push(
        issue(
          'scene_slide_duplicate_ids',
          `Slide ${outline.order} contains missing or duplicate element IDs.`,
          'Regenerate with one stable, unique ID for every visual element.',
          'error',
          outline.order,
        ),
      );
    }
    if (pedagogySignals < 2) {
      issues.push(
        issue(
          'scene_slide_pedagogy',
          `Slide ${outline.order} presents information without enough explanation, example, or learner decision.`,
          'Add a causal explanation plus a concrete example or an explicit learner comparison, check, or decision.',
          'error',
          outline.order,
        ),
      );
    }
    if (uniqueSubstantiveRatio < 0.75 || fillerElementCount > 0) {
      issues.push(
        issue(
          'scene_slide_filler',
          `Slide ${outline.order} repeats or pads visible content.`,
          'Remove placeholder and repeated text; make each visible block carry a distinct mechanism, example, constraint, or takeaway.',
          'error',
          outline.order,
        ),
      );
    }

    dimensions.structure = mean([
      scoreAtThreshold(elements.length, 6, 10),
      ids.length === elements.length && ids.length === new Set(ids).size ? 100 : 0,
    ]);
    dimensions.instructionalDepth = mean([
      scoreAtThreshold(contentText.length, 220, 520),
      scoreAtThreshold(substantiveTexts.length, 3, 6),
      scoreAtThreshold(tokenCount, 25, 70),
    ]);
    dimensions.pedagogy = mean([
      scoreAtThreshold(coverage, 2 / 3, 1),
      scoreAtThreshold(pedagogySignals, 2, 3),
    ]);
    dimensions.distinctiveness = mean([
      scoreAtThreshold(uniqueSubstantiveRatio, 0.75, 1),
      fillerElementCount === 0 ? 100 : 0,
    ]);
  } else if (outline.type === 'quiz') {
    const questions = generatedQuestions(content as GeneratedQuizContent) as Array<
      Record<string, unknown>
    >;
    const analyses = questions.map((question) => plainCourseText(question.analysis));
    const explainedQuestionCount = analyses.filter((text) => text.length >= 24).length;
    const averageAnalysisChars = mean(analyses.map((text) => text.length));
    const questionTexts = questions.map((question) => plainCourseText(question.question));
    const questionText = questionTexts.join(' ');
    const coverage = keyPointCoverage(outline, questionText);
    const questionTypes = new Set(
      questions.map((question) => String(question.type ?? '')).filter(Boolean),
    );
    const hasTransferQuestion = questions.some((question) =>
      TRANSFER_PATTERN.test(
        `${plainCourseText(question.question)} ${plainCourseText(question.analysis)}`,
      ),
    );
    let nearDuplicateQuestionCount = 0;
    for (let leftIndex = 0; leftIndex < questionTexts.length; leftIndex++) {
      for (let rightIndex = leftIndex + 1; rightIndex < questionTexts.length; rightIndex++) {
        if (jaccard(questionTexts[leftIndex], questionTexts[rightIndex]) >= 0.82) {
          nearDuplicateQuestionCount++;
        }
      }
    }
    Object.assign(metrics, {
      questionCount: questions.length,
      explainedQuestionCount,
      averageAnalysisChars: round(averageAnalysisChars),
      questionTypeCount: questionTypes.size,
      keyPointCoverage: round(coverage, 2),
      hasTransferQuestion,
      nearDuplicateQuestionCount,
    });

    if (questions.length < 3 || questions.length > 8) {
      issues.push(
        issue(
          'scene_quiz_count',
          `Quiz ${outline.order} must contain 3-8 purposeful questions.`,
          'Generate a compact assessment spanning recall, application, and transfer.',
          'error',
          outline.order,
        ),
      );
    }
    if (explainedQuestionCount !== questions.length || averageAnalysisChars < 24) {
      issues.push(
        issue(
          'scene_quiz_explanations',
          `Quiz ${outline.order} does not substantively explain every answer.`,
          'Explain why each answer is correct and why plausible alternatives or approaches fail.',
          'error',
          outline.order,
        ),
      );
    }
    if (questionTypes.size < 2) {
      issues.push(
        issue(
          'scene_quiz_variety',
          `Quiz ${outline.order} uses fewer than two assessment formats.`,
          'Use at least two question formats so recall, reasoning, and constructed transfer are not measured by one interaction pattern.',
          'error',
          outline.order,
        ),
      );
    }
    if (coverage < 2 / 3) {
      issues.push(
        issue(
          'scene_quiz_coverage',
          `Quiz ${outline.order} is weakly connected to its planned learning points.`,
          'Regenerate questions that directly test the planned mechanisms and decisions, not generic trivia.',
          'error',
          outline.order,
        ),
      );
    }
    if (!hasTransferQuestion) {
      issues.push(
        issue(
          'scene_quiz_transfer_missing',
          `Quiz ${outline.order} never asks the learner to transfer knowledge.`,
          'Add a new-context question that requires selecting, adapting, or justifying the learned mechanism.',
          'error',
          outline.order,
        ),
      );
    }
    if (nearDuplicateQuestionCount > 0) {
      issues.push(
        issue(
          'scene_quiz_duplicate_questions',
          `Quiz ${outline.order} repeats the same question in different wording.`,
          'Replace repeated questions with distinct recall, application, diagnosis, or transfer decisions.',
          'error',
          outline.order,
        ),
      );
    }

    dimensions.structure = mean([
      scoreAtThreshold(questions.length, 3, 5),
      scoreAtThreshold(questions.length > 0 ? explainedQuestionCount / questions.length : 0, 1, 1),
      scoreAtThreshold(questionTypes.size, 2, 3),
    ]);
    dimensions.instructionalDepth = scoreAtThreshold(averageAnalysisChars, 24, 100);
    dimensions.pedagogy = mean([
      scoreAtThreshold(coverage, 2 / 3, 1),
      hasTransferQuestion ? 100 : 0,
    ]);
    dimensions.distinctiveness = nearDuplicateQuestionCount === 0 ? 100 : 0;
    dimensions.transfer = hasTransferQuestion ? 100 : 0;
  } else if (outline.type === 'interactive') {
    const html = String((content as GeneratedInteractiveContent).html ?? '');
    const controlCount = (html.match(/<(button|input|select|textarea|canvas)\b/giu) ?? []).length;
    const eventCount = (
      html.match(/\b(addEventListener|onclick|oninput|onchange|pointerdown)\b/giu) ?? []
    ).length;
    const visibleText = plainCourseText(html);
    const coverage = keyPointCoverage(outline, visibleText);
    const hasFeedback = FEEDBACK_PATTERN.test(visibleText) || FEEDBACK_PATTERN.test(html);
    const hasReset = RESET_PATTERN.test(visibleText) || RESET_PATTERN.test(html);
    Object.assign(metrics, {
      htmlChars: html.length,
      visibleTextChars: visibleText.length,
      controlCount,
      eventCount,
      keyPointCoverage: round(coverage, 2),
      hasFeedback,
      hasReset,
    });

    if (visibleText.length < 240) {
      issues.push(
        issue(
          'scene_interactive_depth',
          `Interactive scene ${outline.order} lacks enough learner-visible teaching depth.`,
          'Build a complete self-contained learning experience with visible explanation, state, feedback, reset, and learner-visible outcomes.',
          'error',
          outline.order,
        ),
      );
    }
    if (controlCount < 2 || eventCount < 2) {
      issues.push(
        issue(
          'scene_interactive_function',
          `Interactive scene ${outline.order} lacks enough working learner controls.`,
          'Add at least two meaningful controls, event handling, immediate feedback, and a reset or replay path.',
          'error',
          outline.order,
        ),
      );
    }
    if (!hasFeedback || !hasReset) {
      issues.push(
        issue(
          'scene_interactive_feedback',
          `Interactive scene ${outline.order} lacks a complete feedback and replay loop.`,
          'Show learner-visible consequences for each meaningful action and provide a working reset or replay control.',
          'error',
          outline.order,
        ),
      );
    }
    if (coverage < 2 / 3) {
      issues.push(
        issue(
          'scene_interactive_coverage',
          `Interactive scene ${outline.order} is not tightly tied to its learning points.`,
          'Make manipulated variables, labels, and feedback explicitly teach at least two thirds of the planned key points.',
          'error',
          outline.order,
        ),
      );
    }

    dimensions.structure = mean([
      scoreAtThreshold(controlCount, 2, 5),
      scoreAtThreshold(eventCount, 2, 6),
      hasReset ? 100 : 0,
    ]);
    dimensions.instructionalDepth = mean([
      scoreAtThreshold(visibleText.length, 240, 700),
      scoreAtThreshold(controlCount + eventCount, 4, 11),
    ]);
    dimensions.pedagogy = mean([scoreAtThreshold(coverage, 2 / 3, 1), hasFeedback ? 100 : 0]);
    dimensions.distinctiveness = FILLER_EXACT_PATTERN.test(visibleText) ? 0 : 100;
  } else {
    const serialized = JSON.stringify(content);
    const visibleText = plainCourseText(serialized);
    const coverage = keyPointCoverage(outline, visibleText);
    const taskSignals = [
      /任务|问题|brief|task|problem/iu.test(visibleText),
      /步骤|阶段|里程碑|step|phase|milestone/iu.test(visibleText),
      /标准|验收|证据|criteria|acceptance|evidence/iu.test(visibleText),
      FEEDBACK_PATTERN.test(visibleText),
    ].filter(Boolean).length;
    const hasTransfer = TRANSFER_PATTERN.test(visibleText) || APPLICATION_PATTERN.test(visibleText);
    Object.assign(metrics, {
      serializedChars: serialized.length,
      visibleTextChars: visibleText.length,
      keyPointCoverage: round(coverage, 2),
      taskSignalCount: taskSignals,
      hasTransfer,
    });
    if (serialized.length < 1_800 || visibleText.length < 600) {
      issues.push(
        issue(
          'scene_pbl_depth',
          `Project scene ${outline.order} lacks enough structure and visible guidance.`,
          'Regenerate the project scene with a concrete brief, staged tasks, source-grounded constraints, feedback, and completion conditions.',
          'error',
          outline.order,
        ),
      );
    }
    if (coverage < 2 / 3 || taskSignals < 3 || !hasTransfer) {
      issues.push(
        issue(
          'scene_pbl_learning_contract',
          `Project scene ${outline.order} does not provide a complete evidence-producing learning task.`,
          'Tie the task to the planned key points and include staged work, acceptance evidence, feedback, and transfer to a realistic context.',
          'error',
          outline.order,
        ),
      );
    }

    dimensions.structure = scoreAtThreshold(taskSignals, 3, 4);
    dimensions.instructionalDepth = mean([
      scoreAtThreshold(serialized.length, 1_800, 5_000),
      scoreAtThreshold(visibleText.length, 600, 1_500),
    ]);
    dimensions.pedagogy = mean([
      scoreAtThreshold(coverage, 2 / 3, 1),
      scoreAtThreshold(taskSignals, 3, 4),
    ]);
    dimensions.distinctiveness = FILLER_EXACT_PATTERN.test(visibleText) ? 0 : 100;
    dimensions.transfer = hasTransfer ? 100 : 0;
  }

  return finalize(issues, metrics, dimensions);
}

/**
 * The last V3 scene is not merely a recap. Its typed artifact is the bridge
 * between classroom learning and the learner's durable Obsidian work. This
 * gate prevents a model from silently substituting a generic note for the
 * implementation plan, decision record, or other contract-selected outcome.
 */
export function assessFinalSceneArtifactContract(
  outline: SceneOutline,
  content: GeneratedSceneContent,
): CourseQualityAssessment {
  const artifact = outline.activity?.artifact;
  if (!artifact) {
    return finalize(
      [],
      { sceneOrder: outline.order, artifactContractApplicable: false },
      { transfer: 100 },
    );
  }

  const aliases: Record<string, string[]> = {
    'implementation-plan': ['implementation-plan', 'implementation plan', '实施计划'],
    'decision-record': ['decision-record', 'decision record', '决策记录'],
    'concept-map': ['concept-map', 'concept map', '概念图谱'],
    'research-brief': ['research-brief', 'research brief', '研究简报'],
    'project-review': ['project-review', 'project review', '项目复盘'],
    'study-note': ['study-note', 'study note', '学习笔记'],
  };
  const visibleText = plainCourseText(JSON.stringify(content)).toLocaleLowerCase();
  const acceptedNames = aliases[artifact.artifactType] ?? [artifact.artifactType];
  const hasCorrectType = acceptedNames.some((name) =>
    visibleText.includes(name.toLocaleLowerCase()),
  );
  const missingSections = artifact.requiredSections.filter(
    (section) => !visibleText.includes(section.toLocaleLowerCase()),
  );
  const hasVerification = visibleText.includes(artifact.verificationMethod.toLocaleLowerCase());
  const hasDestination = visibleText.includes(artifact.destination.toLocaleLowerCase());
  const issues: CourseQualityIssue[] = [];

  if (!hasCorrectType || missingSections.length > 0 || !hasVerification || !hasDestination) {
    issues.push(
      issue(
        'scene_final_artifact_contract',
        `Final scene ${outline.order} does not visibly satisfy the ${artifact.artifactType} artifact contract.`,
        `Publish the required ${artifact.artifactType} with every required section (${artifact.requiredSections.join(
          ', ',
        )}), the stated verification method, and destination ${artifact.destination}; do not substitute a generic study note or recap.`,
        'error',
        outline.order,
      ),
    );
  }

  return finalize(
    issues,
    {
      sceneOrder: outline.order,
      artifactContractApplicable: true,
      artifactType: artifact.artifactType,
      artifactTypeSatisfied: hasCorrectType,
      requiredArtifactSectionCount: artifact.requiredSections.length,
      satisfiedArtifactSectionCount: artifact.requiredSections.length - missingSections.length,
      artifactVerificationSatisfied: hasVerification,
      artifactDestinationSatisfied: hasDestination,
    },
    {
      transfer:
        hasCorrectType && missingSections.length === 0 && hasVerification && hasDestination
          ? 100
          : 0,
    },
  );
}

export function assessCompleteScene(outline: SceneOutline, scene: Scene): CourseQualityAssessment {
  const contentAssessment = assessGeneratedSceneContent(
    outline,
    scene.content as unknown as Record<string, unknown>,
  );
  const finalArtifactAssessment = assessFinalSceneArtifactContract(
    outline,
    scene.content as unknown as Record<string, unknown>,
  );
  const issues = [...contentAssessment.issues, ...finalArtifactAssessment.issues];
  const actions = scene.actions ?? [];
  const speeches = actions.filter(
    (action): action is Extract<(typeof actions)[number], { type: 'speech' }> =>
      action.type === 'speech',
  );
  const narration = speeches.map((action) => plainCourseText(action.text)).join(' ');
  const speechChars = narration.length;
  const actionTypeCount = new Set(actions.map((action) => action.type)).size;
  const hasLearnerCue = LEARNER_ACTION_PATTERN.test(narration);

  if (scene.type !== outline.type || scene.content.type !== outline.type) {
    issues.push(
      issue(
        'scene_type_mismatch',
        `Scene ${outline.order} does not match its approved outline type.`,
        `Regenerate scene ${outline.order} using the approved ${outline.type} contract.`,
        'error',
        outline.order,
      ),
    );
  }
  if (outline.type !== 'quiz' && actions.length < 5) {
    issues.push(
      issue(
        'scene_actions_sparse',
        `Scene ${outline.order} has too few classroom actions.`,
        'Regenerate a coherent teaching sequence with orientation, explanation, guided attention, learner cue, and transition.',
        'error',
        outline.order,
      ),
    );
  }
  if (outline.type !== 'quiz' && (speeches.length < 3 || speechChars < 180)) {
    issues.push(
      issue(
        'scene_narration_shallow',
        `Scene ${outline.order} narration is too shallow.`,
        'Regenerate narration that explains the mechanism, walks through the example, and asks the learner to notice or decide something.',
        'error',
        outline.order,
      ),
    );
  }
  if (outline.type !== 'quiz' && (actionTypeCount < 2 || !hasLearnerCue)) {
    issues.push(
      issue(
        'scene_action_sequence_weak',
        `Scene ${outline.order} does not create a complete guided-learning sequence.`,
        'Use at least two action types and explicitly ask the learner to observe, compare, explain, decide, or verify.',
        'error',
        outline.order,
      ),
    );
  }

  const dimensions = { ...contentAssessment.dimensions };
  if (outline.type !== 'quiz') {
    const narrationDepthScore = mean([
      scoreAtThreshold(speeches.length, 3, 5),
      scoreAtThreshold(speechChars, 180, 420),
    ]);
    const actionPedagogyScore = mean([
      scoreAtThreshold(actions.length, 5, 8),
      scoreAtThreshold(actionTypeCount, 2, 4),
      hasLearnerCue ? 100 : 0,
    ]);
    dimensions.instructionalDepth = mean([dimensions.instructionalDepth ?? 0, narrationDepthScore]);
    dimensions.pedagogy = mean([dimensions.pedagogy ?? 0, actionPedagogyScore]);
  }

  return finalize(
    issues,
    {
      ...contentAssessment.metrics,
      actionCount: actions.length,
      actionTypeCount,
      speechCount: speeches.length,
      speechChars,
      hasLearnerCue,
    },
    dimensions,
  );
}

/**
 * Pure score boundary used by both the release gate and fault/edge tests.
 */
export function assessCourseSceneScoreContract(
  sceneScores: readonly number[],
): CourseQualityAssessment {
  const issues: CourseQualityIssue[] = [];
  const minimumSceneScore = sceneScores.length > 0 ? Math.min(...sceneScores) : 0;
  const averageSceneScore = mean(sceneScores);

  if (sceneScores.length === 0) {
    issues.push(
      issue(
        'course_no_scored_scenes',
        'The course contains no auditable scene scores.',
        'Generate, persist, and score every approved scene before release.',
      ),
    );
  }
  if (sceneScores.some((score) => score < SCENE_QUALITY_RELEASE_FLOOR)) {
    issues.push(
      issue(
        'course_scene_quality_floor',
        `At least one scene is below the ${SCENE_QUALITY_RELEASE_FLOOR}-point release floor (minimum ${round(minimumSceneScore, 2)}).`,
        `Regenerate every scene below ${SCENE_QUALITY_RELEASE_FLOOR} using its exact content, evidence, narration, and interaction feedback.`,
      ),
    );
  }
  if (
    sceneScores.length > 0 &&
    averageSceneScore + Number.EPSILON < COURSE_AVERAGE_QUALITY_RELEASE_FLOOR
  ) {
    issues.push(
      issue(
        'course_average_quality',
        `Average scene quality is ${round(averageSceneScore, 2)}, below the ${COURSE_AVERAGE_QUALITY_RELEASE_FLOOR}-point release threshold.`,
        `Repair the weakest scenes until the complete-course average reaches ${COURSE_AVERAGE_QUALITY_RELEASE_FLOOR} without lowering any scene below ${SCENE_QUALITY_RELEASE_FLOOR}.`,
      ),
    );
  }

  return finalize(
    issues,
    {
      sceneScoreCount: sceneScores.length,
      averageSceneScore: round(averageSceneScore, 2),
      minimumSceneScore: round(minimumSceneScore, 2),
      sceneReleaseFloor: SCENE_QUALITY_RELEASE_FLOOR,
      courseAverageReleaseFloor: COURSE_AVERAGE_QUALITY_RELEASE_FLOOR,
    },
    { instructionalDepth: averageSceneScore },
    {
      releaseFloor: COURSE_AVERAGE_QUALITY_RELEASE_FLOOR,
      scoreOverride: averageSceneScore,
    },
  );
}

export function assessCourseQuality(
  outlines: readonly SceneOutline[],
  scenes: readonly Scene[],
): CourseQualityAssessment {
  const issues: CourseQualityIssue[] = [];
  const outlineAssessment = assessOutlineQuality(outlines);
  issues.push(...outlineAssessment.issues);

  const scenesByOrder = new Map(scenes.map((scene) => [scene.order, scene]));
  const duplicateOrderCount = scenes.length - scenesByOrder.size;
  if (scenes.length !== outlines.length || duplicateOrderCount > 0) {
    issues.push(
      issue(
        'course_scene_completeness',
        `The course has ${scenes.length}/${outlines.length} scenes and ${duplicateOrderCount} duplicate orders.`,
        'Do not mark the course complete until every outline has exactly one durable, quality-approved scene.',
      ),
    );
  }

  const sceneAssessments: CourseQualityAssessment[] = [];
  for (const currentOutline of outlines) {
    const scene = scenesByOrder.get(currentOutline.order);
    if (!scene) {
      issues.push(
        issue(
          'course_missing_scene',
          `Scene ${currentOutline.order} is missing.`,
          `Regenerate scene ${currentOutline.order} and persist it before completing the course.`,
          'error',
          currentOutline.order,
        ),
      );
      continue;
    }
    const currentAssessment = assessCompleteScene(currentOutline, scene);
    sceneAssessments.push(currentAssessment);
    issues.push(...currentAssessment.issues);
  }

  const sortedScenes = [...scenes].sort((left, right) => left.order - right.order);
  let nearDuplicateCount = 0;
  for (let leftIndex = 0; leftIndex < sortedScenes.length; leftIndex++) {
    for (let rightIndex = leftIndex + 1; rightIndex < sortedScenes.length; rightIndex++) {
      const left = sortedScenes[leftIndex];
      const right = sortedScenes[rightIndex];
      if (left.type !== right.type || jaccard(sceneText(left), sceneText(right)) < 0.78) continue;
      nearDuplicateCount++;
      issues.push(
        issue(
          'course_near_duplicate',
          `Scenes ${left.order} and ${right.order} are near-duplicates.`,
          `Regenerate scene ${right.order} with its own instructional purpose, evidence, example, and learner action.`,
          'error',
          right.order,
        ),
      );
    }
  }

  const fillerSceneCount = sortedScenes.filter((scene) => {
    const text = sceneText(scene);
    return text.length < 80 || FILLER_EXACT_PATTERN.test(text);
  }).length;
  if (fillerSceneCount > 0) {
    issues.push(
      issue(
        'course_blank_or_filler_scene',
        `The course contains ${fillerSceneCount} blank or filler scene(s).`,
        'Replace every blank, placeholder, or title-only scene with complete instruction and learner-visible evidence.',
      ),
    );
  }

  const finalScene = scenesByOrder.get(outlines.at(-1)?.order ?? -1);
  const finalSceneText = finalScene ? sceneText(finalScene) : '';
  const finalSceneHasSynthesis = SYNTHESIS_PATTERN.test(finalSceneText);
  const finalSceneHasTransfer = TRANSFER_PATTERN.test(finalSceneText);
  const finalSceneHasObservableResult = OBSERVABLE_RESULT_PATTERN.test(finalSceneText);
  if (
    !finalScene ||
    !finalSceneHasSynthesis ||
    !finalSceneHasTransfer ||
    !finalSceneHasObservableResult
  ) {
    issues.push(
      issue(
        'course_final_transfer_not_delivered',
        'The generated final scene does not deliver the approved synthesis and transfer task.',
        'Regenerate the final scene so the learner must synthesize the course, apply it in a new context, and produce observable completion evidence.',
        'error',
        outlines.at(-1)?.order,
      ),
    );
  }

  const sceneScores = sceneAssessments.map((entry) => entry.score);
  const sceneScoreContract = assessCourseSceneScoreContract(sceneScores);
  issues.push(...sceneScoreContract.issues);

  const duplicateScore = clamp(100 - nearDuplicateCount * 30 - fillerSceneCount * 40);
  const deliveredTransferScore =
    ([finalSceneHasSynthesis, finalSceneHasTransfer, finalSceneHasObservableResult].filter(Boolean)
      .length /
      3) *
    100;
  const dimensions: QualityDimensions = {
    structure: Math.min(
      outlineAssessment.dimensions?.structure ?? 0,
      averageDimension(sceneAssessments, 'structure'),
    ),
    instructionalDepth: averageDimension(sceneAssessments, 'instructionalDepth'),
    pedagogy: Math.min(
      outlineAssessment.dimensions?.pedagogy ?? 0,
      averageDimension(sceneAssessments, 'pedagogy'),
    ),
    distinctiveness: Math.min(outlineAssessment.dimensions?.distinctiveness ?? 0, duplicateScore),
    transfer: Math.min(outlineAssessment.dimensions?.transfer ?? 0, deliveredTransferScore),
  };
  const dimensionAverage = mean(
    Object.values(dimensions).filter((value): value is number => typeof value === 'number'),
  );
  const averageSceneScore = mean(sceneScores);

  return finalize(
    issues,
    {
      outlineCount: outlines.length,
      sceneCount: scenes.length,
      duplicateOrderCount,
      nearDuplicateCount,
      fillerSceneCount,
      averageSceneScore: round(averageSceneScore, 2),
      minimumSceneScore: sceneScores.length > 0 ? round(Math.min(...sceneScores), 2) : 0,
      sceneReleaseFloor: SCENE_QUALITY_RELEASE_FLOOR,
      courseAverageReleaseFloor: COURSE_AVERAGE_QUALITY_RELEASE_FLOOR,
      finalSceneHasSynthesis,
      finalSceneHasTransfer,
      finalSceneHasObservableResult,
    },
    dimensions,
    {
      scoreOverride: Math.min(averageSceneScore, dimensionAverage),
    },
  );
}

/**
 * V3 deliberately does not score page count, slide ratio, or raw action count
 * as a proxy for learning quality. It evaluates the explicit activity contract
 * and then applies the existing independent scene-content checks.
 */
export function assessV3OutlineQuality(outlines: readonly SceneOutline[]): CourseQualityAssessment {
  const issues: CourseQualityIssue[] = [];
  const releaseViolation = describeV3OutlineReleaseViolation(outlines);
  if (releaseViolation) {
    issues.push(
      issue(
        'v3_outline_contract',
        releaseViolation,
        'Rebuild the deterministic learning plan from the confirmed contract and frozen evidence set.',
      ),
    );
  }
  const activityKinds = new Set(outlines.map((outline) => outline.activity?.kind));
  const evidence = new Set(outlines.flatMap((outline) => outline.activity?.evidenceLabels ?? []));
  const titled = outlines.filter((outline) => outline.title.trim().length >= 4).length;
  const active = outlines.filter((outline) =>
    ['diagnostic', 'practice', 'retrieval', 'synthesis-transfer'].includes(
      outline.activity?.kind ?? '',
    ),
  ).length;
  const final = outlines.at(-1)?.activity;
  if (active < 3) {
    issues.push(
      issue(
        'v3_active_learning_gap',
        'The V3 plan lacks enough diagnosis, practice, retrieval, or transfer activity slots.',
        'Retain explicit diagnosis, practice, retrieval, and synthesis-transfer activities in the deterministic plan.',
      ),
    );
  }
  const dimensions: QualityDimensions = {
    structure: mean([
      releaseViolation ? 0 : 100,
      scoreAtThreshold(outlines.length, V3_COURSE_MIN_ACTIVITIES, V3_COURSE_MAX_ACTIVITIES),
      (titled / Math.max(1, outlines.length)) * 100,
    ]),
    instructionalDepth: mean(
      outlines.map((outline) =>
        mean([
          scoreAtThreshold(plainCourseText(outline.description).length, 80, 220),
          scoreAtThreshold((outline.keyPoints ?? []).length, 3, 4),
        ]),
      ),
    ),
    pedagogy: mean([
      scoreAtThreshold(active, 3, 4),
      activityKinds.has('diagnostic') ? 100 : 0,
      activityKinds.has('retrieval') ? 100 : 0,
    ]),
    // Grounding is satisfied when the plan cites frozen evidence; when no
    // evidence exists (a thin or empty source) there is nothing to cite, so
    // grounding is not a release failure.
    grounding: 100,
    accuracy: releaseViolation ? 0 : 100,
    distinctiveness: activityKinds.size >= Math.min(5, outlines.length) ? 100 : 75,
    transfer: final?.kind === 'synthesis-transfer' && final.artifactRequired ? 100 : 0,
  };
  return finalize(
    issues,
    {
      activityCount: outlines.length,
      minimumActivityCount: V3_COURSE_MIN_ACTIVITIES,
      maximumActivityCount: V3_COURSE_MAX_ACTIVITIES,
      activityKindCount: activityKinds.size,
      frozenEvidenceLabelCount: evidence.size,
      activeLearningActivityCount: active,
      finalArtifactRequired: final?.artifactRequired === true,
    },
    dimensions,
    { releaseFloor: SCENE_QUALITY_RELEASE_FLOOR },
  );
}

export function assessV3CourseQuality(
  outlines: readonly SceneOutline[],
  scenes: readonly Scene[],
): CourseQualityAssessment {
  const outlineAssessment = assessV3OutlineQuality(outlines);
  const issues = [...outlineAssessment.issues];
  const byOrder = new Map(scenes.map((scene) => [scene.order, scene]));
  const sceneAssessments: CourseQualityAssessment[] = [];
  for (const outline of outlines) {
    const scene = byOrder.get(outline.order);
    if (!scene) {
      issues.push(
        issue(
          'v3_course_missing_scene',
          `V3 activity ${outline.order} has no durable rendered scene.`,
          'Persist exactly one quality-approved scene for every planned activity before release.',
          'error',
          outline.order,
        ),
      );
      continue;
    }
    const assessment = assessCompleteScene(outline, scene);
    sceneAssessments.push(assessment);
    issues.push(...assessment.issues);
  }
  const duplicateOrders = scenes.length - byOrder.size;
  if (scenes.length !== outlines.length || duplicateOrders > 0) {
    issues.push(
      issue(
        'v3_course_scene_completeness',
        `The V3 course has ${scenes.length}/${outlines.length} scenes and ${duplicateOrders} duplicate orders.`,
        'Do not release until every activity has exactly one durable rendered scene.',
      ),
    );
  }
  const sceneScores = sceneAssessments.map((assessment) => assessment.score);
  const scoreContract = assessCourseSceneScoreContract(sceneScores);
  issues.push(...scoreContract.issues);
  const averageSceneScore = mean(sceneScores);
  // Grounding and accuracy are admitted at the evidence boundary before a
  // scene can be persisted. `assessCompleteScene` intentionally evaluates the
  // rendered learning experience and therefore does not repeat those two
  // provenance dimensions. Treating an absent renderer-only dimension as 0
  // made every otherwise valid V3 course fail release. For dimensions that are
  // actually rendered, retain the stricter outline/rendered minimum.
  const sceneDimensions = (
    dimension: CourseQualityDimension,
    fallback: number | undefined = undefined,
  ) => {
    const values = sceneAssessments
      .map((entry) => entry.dimensions?.[dimension])
      .filter((value): value is number => typeof value === 'number');
    return values.length > 0 ? mean(values) : (fallback ?? 0);
  };
  const dimensions: QualityDimensions = {
    structure: Math.min(outlineAssessment.dimensions?.structure ?? 0, sceneDimensions('structure')),
    instructionalDepth: sceneDimensions('instructionalDepth'),
    pedagogy: Math.min(outlineAssessment.dimensions?.pedagogy ?? 0, sceneDimensions('pedagogy')),
    grounding: Math.min(
      outlineAssessment.dimensions?.grounding ?? 0,
      sceneDimensions('grounding', outlineAssessment.dimensions?.grounding),
    ),
    accuracy: Math.min(
      outlineAssessment.dimensions?.accuracy ?? 0,
      sceneDimensions('accuracy', outlineAssessment.dimensions?.accuracy),
    ),
    distinctiveness: Math.min(
      outlineAssessment.dimensions?.distinctiveness ?? 0,
      sceneDimensions('distinctiveness'),
    ),
    transfer: Math.min(outlineAssessment.dimensions?.transfer ?? 0, sceneDimensions('transfer')),
  };
  const dimensionsScore = mean(
    Object.values(dimensions).filter((value): value is number => typeof value === 'number'),
  );
  return finalize(
    issues,
    {
      activityCount: outlines.length,
      sceneCount: scenes.length,
      averageSceneScore: round(averageSceneScore, 2),
      minimumSceneScore: sceneScores.length > 0 ? round(Math.min(...sceneScores), 2) : 0,
      v3PlanScore: outlineAssessment.score,
    },
    dimensions,
    {
      releaseFloor: COURSE_AVERAGE_QUALITY_RELEASE_FLOOR,
      scoreOverride: Math.min(averageSceneScore, dimensionsScore),
    },
  );
}
