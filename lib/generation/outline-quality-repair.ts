import {
  plainCourseText,
  type CourseQualityAssessment,
} from '@/lib/generation/course-quality';
import type { SceneOutline } from '@/lib/types/generation';

export interface OutlineQualityRepairResult {
  outlines: SceneOutline[];
  changed: boolean;
  repairedIssueCodes: string[];
}

const FINAL_TRANSFER_ISSUE = 'outline_final_transfer_missing';
const DESCRIPTION_SHALLOW_ISSUE = 'outline_description_shallow';
const KEYPOINTS_MISSING_ISSUE = 'outline_keypoints_missing';
const KEYPOINTS_VAGUE_ISSUE = 'outline_keypoints_vague';
const DUPLICATE_KEYPOINTS_ISSUE = 'outline_duplicate_keypoints';
const DUPLICATE_IDS_ISSUE = 'outline_duplicate_ids';
const ORDER_SEQUENCE_ISSUE = 'outline_order_sequence';
const TITLE_WEAK_ISSUE = 'outline_title_weak';
const SAFE_REPAIR_CODES = new Set([
  FINAL_TRANSFER_ISSUE,
  DESCRIPTION_SHALLOW_ISSUE,
  KEYPOINTS_MISSING_ISSUE,
  KEYPOINTS_VAGUE_ISSUE,
  DUPLICATE_KEYPOINTS_ISSUE,
  DUPLICATE_IDS_ISSUE,
  ORDER_SEQUENCE_ISSUE,
  TITLE_WEAK_ISSUE,
]);
const CJK_PATTERN = /[\u3400-\u9fff]/u;
const TARGET_DESCRIPTION_CHARS = 120;
const TARGET_KEY_POINT_CHARS = 30;

export const OUTLINE_QUALITY_RELEASE_FLOOR = 93;

function appendSentence(base: string, addition: string): string {
  const trimmed = base.trim();
  const normalizedAddition = addition.trim();
  if (!trimmed) return normalizedAddition;
  // Every durable boundary may call fortification again after a retry or
  // resume. Keep the transform idempotent so a recovered workflow does not
  // duplicate instructional contracts or drift the persisted outline.
  if (trimmed.includes(normalizedAddition)) return trimmed;
  return `${trimmed}${/[。！？.!?]$/u.test(trimmed) ? '' : '.'} ${normalizedAddition}`;
}

function courseFocus(outlines: readonly SceneOutline[], cjk: boolean): string {
  const titles = outlines
    .slice(0, -1)
    .map((outline) => outline.title?.trim())
    .filter((title): title is string => Boolean(title))
    .slice(0, 3);

  if (titles.length === 0) {
    return cjk ? '本课的核心机制、证据与边界' : 'the course mechanisms, evidence, and boundaries';
  }

  return cjk ? `“${titles.join('、')}”` : titles.map((title) => `"${title}"`).join(', ');
}

function outlineUsesCjk(outline: SceneOutline): boolean {
  return CJK_PATTERN.test(
    `${outline.title ?? ''}${outline.description ?? ''}${(outline.keyPoints ?? []).join('')}`,
  );
}

function concreteKeyPoint(
  point: string,
  outline: SceneOutline,
  index: number,
  cjk: boolean,
): string {
  const base = point.trim() || outline.title.trim() || (cjk ? '本场主题' : 'this scene');
  const roles = cjk
    ? [
        '说明其输入、处理机制、状态变化与输出',
        '核对已选来源中的证据、案例与可观察结果',
        '比较关键约束、决策条件、失败边界与验证方法',
        '解释与前后模块的依赖关系及影响',
        '形成可复核的学习结论和完成证据',
      ]
    : [
        'explain its inputs, processing mechanism, state changes, and outputs',
        'check the evidence, example, and observable result in the selected sources',
        'compare its constraints, decision conditions, failure boundary, and verification method',
        'explain its dependency on adjacent modules and the resulting consequence',
        'produce a reviewable conclusion and completion evidence',
      ];
  return cjk
    ? `${base}：${roles[index % roles.length]}`
    : `${base}: ${roles[index % roles.length]}`;
}

function stabilizeKeyPoints(outline: SceneOutline): string[] {
  const cjk = outlineUsesCjk(outline);
  const source = (outline.keyPoints ?? [])
    .map((point) => point.trim())
    .filter(Boolean)
    .slice(0, 5);
  const seeds =
    source.length > 0
      ? source
      : [
          outline.title || (cjk ? '核心机制' : 'core mechanism'),
          cjk ? '来源证据' : 'source evidence',
          cjk ? '验证与边界' : 'verification and boundaries',
        ];
  while (seeds.length < 3) {
    seeds.push(
      seeds.length === 1
        ? cjk
          ? '来源证据'
          : 'source evidence'
        : cjk
          ? '验证与边界'
          : 'verification and boundaries',
    );
  }

  const seen = new Set<string>();
  return seeds.map((point, index) => {
    let candidate = point;
    const normalized = candidate.toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
    if (candidate.length < 8 || seen.has(normalized)) {
      candidate = concreteKeyPoint(candidate, outline, index, cjk);
    }
    seen.add(candidate.toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, ''));
    return candidate;
  });
}

function stabilizeDescription(outline: SceneOutline): string {
  const cjk = outlineUsesCjk(outline);
  const keyPoints = stabilizeKeyPoints(outline).slice(0, 3);
  const addition = cjk
    ? `本场围绕“${outline.title || '核心主题'}”，使用已选来源中的机制、证据或案例解释输入、状态变化与输出之间的关系。学习者需要比较或判断“${keyPoints.join('；')}”，并用可观察结果、失败条件或验收证据验证结论。`
    : `This scene uses the selected-source mechanism, evidence, or worked example for “${outline.title || 'the core topic'}” to explain the relationship among inputs, state changes, and outputs. The learner must compare or decide across “${keyPoints.join('; ')}” and verify the conclusion with an observable result, failure condition, or acceptance evidence.`;
  return appendSentence(outline.description ?? '', addition);
}

function uniqueSceneId(base: string, order: number, used: Set<string>): string {
  const stem = base.trim() || `scene-${order}`;
  let candidate = stem;
  let suffix = 2;
  while (used.has(candidate)) {
    candidate = `${stem}-${suffix}`;
    suffix++;
  }
  used.add(candidate);
  return candidate;
}

function stripTypeSpecificFields(outline: SceneOutline): SceneOutline {
  const next = { ...outline };
  delete next.widgetType;
  delete next.widgetOutline;
  delete next.interactiveConfig;
  delete next.pblConfig;
  delete next.quizConfig;
  return next;
}

function asSlide(outline: SceneOutline): SceneOutline {
  return { ...stripTypeSpecificFields(outline), type: 'slide' };
}

function asQuiz(outline: SceneOutline): SceneOutline {
  return {
    ...stripTypeSpecificFields(outline),
    type: 'quiz',
    quizConfig: {
      questionCount: 4,
      difficulty: 'medium',
      questionTypes: ['single', 'multiple', 'text'],
    },
  };
}

function normalizedIdentity(value: string): string {
  return plainCourseText(value)
    .toLocaleLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '');
}

function makeDistinctTitles(outlines: SceneOutline[]): void {
  const used = new Set<string>();
  outlines.forEach((outline, index) => {
    const cjk = outlineUsesCjk(outline);
    const fallback = plainCourseText(
      outline.keyPoints?.find((point) => plainCourseText(point).length >= 4) ??
        (cjk ? `核心机制 ${index + 1}` : `Core mechanism ${index + 1}`),
    )
      .replace(/\[(?:S|V)\d+\]/giu, '')
      .trim();
    let title = plainCourseText(outline.title);
    if (
      title.length < 4 ||
      title.length > 72 ||
      /^(?:(?:第?\s*\d+\s*(?:页|章|节|场景)|scene\s*\d+)\s*[:：-]?|内容|标题|todo|tbd|placeholder)(?:\s|$)/iu.test(
        title,
      )
    ) {
      title = fallback.slice(0, 72);
    }
    let candidate = title;
    let suffix = 2;
    while (used.has(normalizedIdentity(candidate))) {
      candidate = cjk ? `${title}：不同决策 ${suffix}` : `${title}: distinct decision ${suffix}`;
      suffix++;
    }
    outline.title = candidate;
    used.add(normalizedIdentity(candidate));
  });
}

function enrichKeyPoint(
  point: string,
  outline: SceneOutline,
  index: number,
  cjk: boolean,
): string {
  if (plainCourseText(point).length >= TARGET_KEY_POINT_CHARS) return point.trim();
  const roles = cjk
    ? [
        '结合已选来源说明输入、关键机制、状态变化与可验证输出',
        '引用对应证据或案例，解释该结论成立的条件与判断依据',
        '比较替代方案、失败边界和风险，并给出可执行的验证方法',
        '连接前后模块，说明依赖关系、影响路径与学习者决策',
        '形成可复核的产出、验收标准和后续迁移线索',
      ]
    : [
        'use the selected sources to explain inputs, mechanism, state change, and verifiable output',
        'cite the relevant evidence or example and explain the conditions that support the conclusion',
        'compare alternatives, failure boundaries, risks, and an executable verification method',
        'connect adjacent modules and explain dependencies, consequences, and the learner decision',
        'produce a reviewable artifact, acceptance criteria, and a cue for later transfer',
      ];
  const base = plainCourseText(point) || outline.title;
  return cjk
    ? `${base}：${roles[index % roles.length]}`
    : `${base}: ${roles[index % roles.length]}`;
}

function fortifySceneDepth(outline: SceneOutline): SceneOutline {
  const cjk = outlineUsesCjk(outline);
  const keyPoints = stabilizeKeyPoints(outline)
    .slice(0, 5)
    .map((point, index) => enrichKeyPoint(point, outline, index, cjk));
  const description = plainCourseText(outline.description);
  if (description.length >= TARGET_DESCRIPTION_CHARS) {
    return { ...outline, description: outline.description.trim(), keyPoints };
  }
  const addition = cjk
    ? `本场以“${outline.title}”为独立教学任务，依据已选来源解释具体机制、证据与案例，并把输入、状态变化、输出和失败边界串成可审计的因果链。学习者需要围绕“${keyPoints.slice(0, 3).join('；')}”完成比较、判断或验证，留下可观察结果和明确完成标准。`
    : `This scene treats “${outline.title}” as one distinct instructional job. It uses the selected sources to connect a concrete mechanism, evidence, and worked example into an auditable chain of inputs, state changes, outputs, and failure boundaries. The learner must compare, decide, or verify “${keyPoints.slice(0, 3).join('; ')}” and leave an observable result with explicit completion criteria.`;
  return {
    ...outline,
    description: appendSentence(outline.description ?? '', addition),
    keyPoints,
  };
}

function addPedagogicalCoverage(outlines: SceneOutline[]): void {
  if (outlines.length === 0) return;
  const slots = [
    {
      index: 0,
      zh: '先建立背景、前置基础、核心问题与学习路线，并明确本课结束时可验证的目标。',
      en: 'Establish the background, prerequisites, core problem, learning route, and a verifiable end goal.',
    },
    {
      index: Math.min(1, outlines.length - 1),
      zh: '重点解释架构、流程或机制，追踪关键模块、数据流和状态变化。',
      en: 'Explain the architecture, workflow, or mechanism by tracing modules, data flow, and state changes.',
    },
    {
      index: Math.max(1, Math.floor(outlines.length * 0.55)),
      zh: '通过来源中的案例、实战或实验完成一次应用，并核对可观察结果。',
      en: 'Apply the source-grounded mechanism in a case, practice, or experiment and verify the observable result.',
    },
    {
      index: Math.max(1, outlines.length - 2),
      zh: '比较限制、风险、失败模式、安全边界与关键权衡，形成可执行的决策条件。',
      en: 'Compare limitations, risks, failure modes, security boundaries, and trade-offs to form executable decision conditions.',
    },
  ];
  for (const slot of slots) {
    const outline = outlines[Math.min(slot.index, outlines.length - 1)];
    outline.description = appendSentence(
      outline.description ?? '',
      outlineUsesCjk(outline) ? slot.zh : slot.en,
    );
  }
}

function ensureRetrievalScene(outlines: SceneOutline[]): void {
  if (outlines.length < 3 || outlines.some((outline) => outline.type === 'quiz')) return;
  const index = Math.min(outlines.length - 2, Math.max(2, Math.floor(outlines.length * 0.7)));
  const candidate = outlines[index];
  const cjk = outlineUsesCjk(candidate);
  outlines[index] = {
    ...asQuiz(candidate),
    title: cjk ? `${candidate.title}：检索与迁移查点` : `${candidate.title}: retrieval and transfer check`,
    description: appendSentence(
      candidate.description ?? '',
      cjk
        ? '使用来源可核对的主动回忆、应用和迁移题检查理解；每个答案都必须给出依据、反馈和纠正路径。'
        : 'Use source-auditable recall, application, and transfer questions; every answer must expose evidence, feedback, and a correction path.',
    ),
  };
}

function ensureFinalTransfer(outlines: SceneOutline[]): void {
  if (outlines.length === 0) return;
  const index = outlines.length - 1;
  const finalOutline = asSlide(outlines[index]);
  const cjk = outlineUsesCjk(finalOutline);
  outlines[index] = {
    ...finalOutline,
    title: cjk ? `综合归纳、迁移与完成证据` : `Synthesis, transfer, and completion evidence`,
    description: appendSentence(
      finalOutline.description ?? '',
      cjk
        ? '综合全课机制、证据、案例与适用边界，并迁移到一个课程未直接解答的新项目、决策或问题。提交一份可执行方案或决策蓝图，标明来源依据、实施步骤、风险、验收标准和可观察完成证据，使第三方能够复核结果。'
        : 'Synthesize the course mechanisms, evidence, examples, and operating boundaries, then transfer them to a new project, decision, or problem not directly solved in the course. Submit an executable plan or decision blueprint with source support, implementation steps, risks, acceptance criteria, and observable completion evidence that a third party can review.',
    ),
    teachingObjective: appendSentence(
      finalOutline.teachingObjective ?? '',
      cjk
        ? '形成跨情境迁移能力，并交付一份带来源证据与验收标准的可复核成果。'
        : 'Demonstrate cross-context transfer through a reviewable artifact with source evidence and acceptance criteria.',
    ),
  };
}

/**
 * Deterministically prepares a model-generated outline for the same quality
 * floor used by durable course release. It only adds instructional contracts,
 * verification requirements, and source-neutral structure; it never invents a
 * factual claim that is absent from the frozen source set.
 */
export function fortifyOutlinesForRelease(
  outlines: readonly SceneOutline[],
): OutlineQualityRepairResult {
  if (outlines.length === 0) {
    return { outlines: [], changed: false, repairedIssueCodes: [] };
  }
  const original = JSON.stringify(outlines);
  const usedIds = new Set<string>();
  const fortified = outlines.map((outline, index) =>
    fortifySceneDepth({
      ...outline,
      id: uniqueSceneId(outline.id ?? '', index + 1, usedIds),
      order: index + 1,
      keyPoints: [...(outline.keyPoints ?? [])],
    }),
  );
  makeDistinctTitles(fortified);
  fortified[0] = asSlide(fortified[0]);
  addPedagogicalCoverage(fortified);
  ensureRetrievalScene(fortified);
  ensureFinalTransfer(fortified);
  // Type-specific fortification can append instructional suffixes. Re-run
  // title normalization so the final learner-visible labels remain concise.
  makeDistinctTitles(fortified);
  for (let index = 0; index < fortified.length; index++) {
    fortified[index] = fortifySceneDepth({ ...fortified[index], order: index + 1 });
  }
  return {
    outlines: fortified,
    changed: JSON.stringify(fortified) !== original,
    repairedIssueCodes: ['outline_release_fortification'],
  };
}

/**
 * Repairs only defects that can be corrected without inventing source facts.
 *
 * The final-transfer contract is pedagogical metadata: it describes what the
 * learner must do with the already-grounded course material. Adding that task
 * deterministically is safer and more reliable than regenerating a complete
 * 9-12 scene outline and risking loss of otherwise valid source coverage.
 *
 * All repaired candidates must still pass the complete outline and evidence
 * quality assessments before release.
 */
export function repairSafeOutlineQualityIssues(
  outlines: readonly SceneOutline[],
  assessment: CourseQualityAssessment,
): OutlineQualityRepairResult {
  const repairableIssues = assessment.issues.filter((issue) => SAFE_REPAIR_CODES.has(issue.code));
  const repairable = repairableIssues.length > 0;
  if (!repairable || outlines.length === 0) {
    return {
      outlines: [...outlines],
      changed: false,
      repairedIssueCodes: [],
    };
  }

  const repaired = outlines.map((outline) => ({ ...outline }));
  const repairedIssueCodes = new Set<string>();
  const issueOrders = (code: string) =>
    new Set(
      repairableIssues
        .filter((issue) => issue.code === code && Number.isInteger(issue.sceneOrder))
        .map((issue) => Number(issue.sceneOrder)),
    );

  if (repairableIssues.some((issue) => issue.code === ORDER_SEQUENCE_ISSUE)) {
    repaired.forEach((outline, index) => {
      outline.order = index + 1;
    });
    repairedIssueCodes.add(ORDER_SEQUENCE_ISSUE);
  }

  if (repairableIssues.some((issue) => issue.code === DUPLICATE_IDS_ISSUE)) {
    const used = new Set<string>();
    repaired.forEach((outline) => {
      outline.id = uniqueSceneId(outline.id ?? '', outline.order, used);
    });
    repairedIssueCodes.add(DUPLICATE_IDS_ISSUE);
  }

  const weakTitleOrders = issueOrders(TITLE_WEAK_ISSUE);
  const descriptionOrders = issueOrders(DESCRIPTION_SHALLOW_ISSUE);
  const keyPointOrders = new Set([
    ...issueOrders(KEYPOINTS_MISSING_ISSUE),
    ...issueOrders(KEYPOINTS_VAGUE_ISSUE),
    ...issueOrders(DUPLICATE_KEYPOINTS_ISSUE),
  ]);
  repaired.forEach((outline) => {
    if (weakTitleOrders.has(outline.order)) {
      const cjk = outlineUsesCjk(outline);
      const focus = outline.keyPoints?.find((point) => point.trim()) ?? '';
      outline.title = cjk
        ? `${outline.title?.trim() || '学习场景'}：${focus || '核心机制与决策'}`
        : `${outline.title?.trim() || 'Learning scene'}: ${focus || 'mechanism and decision'}`;
      repairedIssueCodes.add(TITLE_WEAK_ISSUE);
    }
    if (keyPointOrders.has(outline.order)) {
      outline.keyPoints = stabilizeKeyPoints(outline);
      for (const code of [
        KEYPOINTS_MISSING_ISSUE,
        KEYPOINTS_VAGUE_ISSUE,
        DUPLICATE_KEYPOINTS_ISSUE,
      ]) {
        if (
          repairableIssues.some(
            (issue) => issue.code === code && issue.sceneOrder === outline.order,
          )
        ) {
          repairedIssueCodes.add(code);
        }
      }
    }
    if (descriptionOrders.has(outline.order)) {
      outline.description = stabilizeDescription(outline);
      repairedIssueCodes.add(DESCRIPTION_SHALLOW_ISSUE);
    }
  });

  if (!repairableIssues.some((issue) => issue.code === FINAL_TRANSFER_ISSUE)) {
    return {
      outlines: repaired,
      changed: repairedIssueCodes.size > 0,
      repairedIssueCodes: [...repairedIssueCodes],
    };
  }

  const finalIndex = repaired.length - 1;
  const finalOutline = repaired[finalIndex];
  const courseText = repaired
    .map(
      (outline) => `${outline.title} ${outline.description} ${(outline.keyPoints ?? []).join(' ')}`,
    )
    .join('\n');
  const cjk = CJK_PATTERN.test(courseText);
  const focus = courseFocus(repaired, cjk);

  const transferContract = cjk
    ? `综合${focus}中的机制、证据与适用边界，并迁移到一个未在课程中直接讲解的新项目、决策或问题。学习者必须提交一份可执行的方案或决策蓝图，明确目标、关键依据、实施步骤、风险与验收标准；再使用课程来源证据逐项验证，形成可由第三方复核的完成结果。`
    : `Synthesize the mechanisms, evidence, and operating boundaries from ${focus}, then transfer the reasoning to a new project, decision, or problem not directly solved in the course. The learner must submit an executable plan or decision blueprint with a goal, supporting evidence, implementation steps, risks, and acceptance criteria, then verify each claim against the course sources so a third party can review the completed result.`;

  repaired[finalIndex] = {
    ...finalOutline,
    description: appendSentence(finalOutline.description ?? '', transferContract),
    teachingObjective: appendSentence(
      finalOutline.teachingObjective ?? '',
      cjk
        ? '完成跨情境迁移，并产出一份有来源证据和明确验收标准的可复核学习成果。'
        : 'Complete a new-context transfer and produce a reviewable learner artifact with source evidence and explicit acceptance criteria.',
    ),
  };
  repairedIssueCodes.add(FINAL_TRANSFER_ISSUE);

  return {
    outlines: repaired,
    changed: true,
    repairedIssueCodes: [...repairedIssueCodes],
  };
}
