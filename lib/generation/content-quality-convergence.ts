import type {
  GeneratedInteractiveContent,
  GeneratedPBLContent,
  GeneratedQuizContent,
  GeneratedSlideContent,
  SceneOutline,
} from '@/lib/types/generation';
import type { PPTElement } from '@openmaic/dsl';
import type { QuizQuestion } from '@/lib/types/stage';
import { assessGeneratedSceneContent, plainCourseText } from './course-quality';
import { buildDeterministicDiagram } from './deterministic-diagram';
import {
  contextualizedCitationLabels,
  findUnsupportedNamedEvidenceTerms,
  learnerVisibleGeneratedContentText,
} from './evidence-quality';
import { postProcessInteractiveHtml } from './interactive-post-processor';

type ConvergeableContent =
  | GeneratedSlideContent
  | GeneratedQuizContent
  | GeneratedInteractiveContent
  | GeneratedPBLContent
  | null;

const EVIDENCE_LABEL_PATTERN = /\[(S\d+)\]/giu;
const FINAL_SYNTHESIS_PATTERN = /总结|归纳|综合|全貌|回顾|复盘|要点|summary|synthesis|takeaways?|review/iu;
const FINAL_TRANSFER_PATTERN =
  /迁移|新情境|新项目|实际任务|跨场景|应用到|transfer|new (?:case|context|project|problem)|apply (?:it|this|the)/iu;
const FINAL_ARTIFACT_PATTERN =
  /证据|产出|交付|完成标准|验收标准|验证|提交|方案|决策|observable|evidence|artifact|deliverable|completion criteria|acceptance criteria|verification|submit/iu;

function displayArtifactType(artifactType: string, cjk: boolean): string {
  const labels: Record<string, { en: string; zh: string }> = {
    'implementation-plan': { en: 'implementation plan', zh: '实施计划' },
    'decision-record': { en: 'decision record', zh: '决策记录' },
    'concept-map': { en: 'concept map', zh: '概念图谱' },
    'research-brief': { en: 'research brief', zh: '研究简报' },
    'project-review': { en: 'project review', zh: '项目复盘' },
    'study-note': { en: 'study note', zh: '学习笔记' },
  };
  const label = labels[artifactType];
  return label ? (cjk ? label.zh : label.en) : artifactType;
}

function hasExactArtifactContract(outline: SceneOutline, visibleText: string, cjk: boolean): boolean {
  const artifact = outline.activity?.artifact;
  if (!artifact) return true;

  const normalized = visibleText.toLocaleLowerCase();
  const artifactType = artifact.artifactType.toLocaleLowerCase();
  const displayName = displayArtifactType(artifact.artifactType, cjk).toLocaleLowerCase();
  const namedArtifact = normalized.includes(artifactType) || normalized.includes(displayName);
  const requiredSections = artifact.requiredSections.filter(Boolean);
  const coveredSections = requiredSections.filter((section) =>
    normalized.includes(section.toLocaleLowerCase()),
  );
  const hasVerification = normalized.includes(artifact.verificationMethod.toLocaleLowerCase());
  const hasDestination = normalized.includes(artifact.destination.toLocaleLowerCase());

  // A generic summary may satisfy the old final-scene wording, but it cannot
  // substitute the typed deliverable specified by the learning contract.
  return (
    namedArtifact &&
    coveredSections.length === requiredSections.length &&
    hasVerification &&
    hasDestination
  );
}

function finalArtifactDelivery(outline: SceneOutline, cjk: boolean): string {
  const artifact = outline.activity?.artifact;
  if (!artifact) {
    return cjk
      ? '<p><strong>综合归纳、迁移与完成证据：</strong>综合本课的核心机制、来源证据与适用边界，把它们迁移到一个课程未直接解答的新项目、决策或问题。请产出并提交一份可复核的方案或决策蓝图，至少写明目标、来源依据、实施步骤、风险、验收标准和可观察完成证据；用验证结果证明任务完成。</p>'
      : '<p><strong>Synthesis, transfer, and completion evidence:</strong> Synthesize the course mechanisms, source evidence, and operating boundaries, then transfer them to a new project, decision, or problem not directly solved in the course. Produce and submit a reviewable plan or decision blueprint with a goal, source support, implementation steps, risks, acceptance criteria, and observable verification evidence.</p>';
  }

  const displayType = displayArtifactType(artifact.artifactType, cjk);
  const sections = artifact.requiredSections.join('、');
  return cjk
    ? `<p><strong>最终交付与完成证据：</strong>把本课的机制、来源证据和适用边界迁移到一个新项目、决策或问题。必须提交 <strong>${displayType}（${artifact.artifactType}）</strong>，不得用泛化的学习笔记、摘要或复盘替代。内容必须包含：${sections}。验收方法：${artifact.verificationMethod}。沉淀位置：${artifact.destination}。请用可观察的验证结果证明交付完成。</p>`
    : `<p><strong>Final deliverable and completion evidence:</strong> Transfer the course mechanisms, source evidence, and operating boundaries to a new project, decision, or problem. You must submit an <strong>${displayType} (${artifact.artifactType})</strong>; do not substitute a generic study note, summary, or recap. Required sections: ${artifact.requiredSections.join(', ')}. Verification: ${artifact.verificationMethod}. Destination: ${artifact.destination}. Use an observable verification result to prove completion.</p>`;
}

function plannedEvidenceAnchors(outline: SceneOutline): Array<{ label: string; claim: string }> {
  const claims = [outline.description, ...(outline.keyPoints ?? [])].filter(Boolean);
  const anchors = new Map<string, string>();
  for (const claim of claims) {
    for (const match of claim.matchAll(EVIDENCE_LABEL_PATTERN)) {
      const label = match[1].toLocaleUpperCase();
      if (!anchors.has(label)) anchors.set(label, claim);
    }
  }
  return [...anchors].map(([label, claim]) => ({ label, claim }));
}

function compactEvidenceClaim(claim: string, label: string): string {
  const text = plainCourseText(claim).replace(/\s+/gu, ' ').trim();
  const token = `[${label}]`;
  const withoutDuplicateLabels = text.replace(EVIDENCE_LABEL_PATTERN, '').trim();
  const clipped =
    withoutDuplicateLabels.length > 150
      ? `${withoutDuplicateLabels.slice(0, 147).trimEnd()}…`
      : withoutDuplicateLabels;
  return `${clipped} ${token}`.trim();
}

function chinese(outline: SceneOutline, languageDirective?: string): boolean {
  return (
    /Chinese|中文|zh-/iu.test(languageDirective ?? '') ||
    /\p{Script=Han}/u.test(
      `${outline.title}${outline.description}${(outline.keyPoints ?? []).join('')}`,
    )
  );
}

function textElement(
  id: string,
  left: number,
  top: number,
  width: number,
  height: number,
  content: string,
  options: {
    color?: string;
    fill?: string;
    textType?: 'title' | 'subtitle' | 'content' | 'item' | 'notes';
  } = {},
): PPTElement {
  return {
    id,
    type: 'text',
    left,
    top,
    width,
    height,
    rotate: 0,
    content,
    defaultFontName: 'Microsoft YaHei',
    defaultColor: options.color ?? '#172033',
    fill: options.fill,
    lineHeight: 1.35,
    paragraphSpace: 4,
    textType: options.textType ?? 'content',
  };
}

/**
 * A slide card has a finite readable area. Preserve every audit label while
 * clipping exposition to the amount a learner can actually read on one slide;
 * the full source remains available in the scene notes and evidence panel.
 */
function compactSlideText(value: string, limit: number): string {
  const labels = [...value.matchAll(EVIDENCE_LABEL_PATTERN)]
    .map((match) => `[${match[1].toLocaleUpperCase()}]`)
    .filter((label, index, all) => all.indexOf(label) === index)
  const plain = plainCourseText(value)
    .replace(EVIDENCE_LABEL_PATTERN, '')
    .replace(/\s+/gu, ' ')
    .trim()
  const clipped = plain.length > limit ? `${plain.slice(0, Math.max(0, limit - 1)).trimEnd()}…` : plain
  return [clipped, ...labels].filter(Boolean).join(' ').trim()
}

type SlideActivityFrame = {
  objectiveLead: string;
  panels: [string, string, string];
  prompts: [string, string, string];
  caseLabel: string;
  casePrompt: string;
  boundaryLabel: string;
  boundaryPrompt: string;
  artifactLabel: string;
  artifactPrompt: string;
};

/**
 * A provider outage or an unsafe provider response must not collapse a whole
 * course into a visually identical deck. This frame is deterministic, but it
 * is still pedagogically specific to the learning activity selected by the
 * approved plan: map, mechanism trace, comparison, worked procedure,
 * retrieval, failure recovery, or transfer artifact each ask the learner to
 * do a different kind of intellectual work.
 */
function slideActivityFrame(
  kind: SceneOutline['activity'] extends infer Activity
    ? Activity extends { kind?: infer Kind }
      ? Kind
      : undefined
    : undefined,
  cjk: boolean,
): SlideActivityFrame {
  const english: Record<string, SlideActivityFrame> = {
    orientation: {
      objectiveLead: 'Course compass:',
      panels: ['01 Decision to resolve', '02 Evidence map', '03 Success signal'],
      prompts: [
        'Name the real decision this course will resolve before collecting details.',
        'Separate what the source proves from what still needs to be tested.',
        'Define the observable outcome that will demonstrate understanding.',
      ],
      caseLabel: 'Starting brief',
      casePrompt: 'Write one source-labeled question you will answer and one boundary that would change the answer.',
      boundaryLabel: 'Scope check',
      boundaryPrompt: 'Do not treat a topic label or a familiar tool name as evidence; state what the selected source actually supports.',
      artifactLabel: 'Learner output',
      artifactPrompt: 'Record the goal, two evidence questions, and the success signal for this course.',
    },
    diagnostic: {
      objectiveLead: 'Starting-point diagnostic:',
      panels: ['01 Current assumption', '02 Unknown to test', '03 Evidence needed'],
      prompts: [
        'State the belief you would act on today and the condition behind it.',
        'Locate the smallest uncertainty that could make the belief unsafe.',
        'Name the exact source, log, test, or result that could settle the uncertainty.',
      ],
      caseLabel: 'Diagnostic prompt',
      casePrompt: 'Predict the result first, then compare your prediction with the cited source fact.',
      boundaryLabel: 'Misconception check',
      boundaryPrompt: 'A correct-looking answer without an explicit assumption is not a diagnostic result.',
      artifactLabel: 'Learner output',
      artifactPrompt: 'Submit the assumption, unknown, and evidence required to verify it.',
    },
    foundation: {
      objectiveLead: 'Core model:',
      panels: ['01 Definition', '02 Relationship', '03 Consequence'],
      prompts: [
        'Explain the concept in your own words without dropping the source constraint.',
        'Link the concept to the condition or component that changes its behavior.',
        'State which observable result would be different if this model were wrong.',
      ],
      caseLabel: 'Concept reconstruction',
      casePrompt: 'Draw or write a three-part relationship: condition → mechanism → observable result.',
      boundaryLabel: 'Concept boundary',
      boundaryPrompt: 'Do not substitute a neighboring concept just because both use similar vocabulary.',
      artifactLabel: 'Learner output',
      artifactPrompt: 'Leave three linked source-labeled concept statements and one consequence.',
    },
    mechanism: {
      objectiveLead: 'Mechanism trace:',
      panels: ['01 Input and trigger', '02 Rule and state change', '03 Output and verification'],
      prompts: [
        'Identify the input condition that starts the mechanism.',
        'Trace the rule, constraint, and state transition in order.',
        'Name the visible output and the verification point that proves the transition occurred.',
      ],
      caseLabel: 'Trace exercise',
      casePrompt: 'Annotate the flow step by step; a missing state change means the explanation is incomplete.',
      boundaryLabel: 'Break point',
      boundaryPrompt: 'Test the first transition that could fail instead of changing several downstream settings at once.',
      artifactLabel: 'Learner output',
      artifactPrompt: 'Submit a mechanism trace with input, constraint, state change, output, and evidence.',
    },
    evidence: {
      objectiveLead: 'Evidence-backed choice:',
      panels: ['01 Option and constraint', '02 Trade-off evidence', '03 Decision record'],
      prompts: [
        'State the option under consideration and the constraint it must satisfy.',
        'Compare the consequence of at least one credible alternative using source evidence.',
        'Choose explicitly and record what would make you revisit the choice.',
      ],
      caseLabel: 'Decision exercise',
      casePrompt: 'Create a compact trade-off table: option, evidence, consequence, and chosen action.',
      boundaryLabel: 'Decision risk',
      boundaryPrompt: 'A preference is not a decision rationale until its evidence and invalidating condition are visible.',
      artifactLabel: 'Learner output',
      artifactPrompt: 'Submit a source-backed trade-off table and one justified choice.',
    },
    'worked-example': {
      objectiveLead: 'Worked procedure:',
      panels: ['01 Setup', '02 Action', '03 Verification'],
      prompts: [
        'Identify the required precondition, files, inputs, or permissions before acting.',
        'Perform or explain the concrete command, operation, or decision in the source example.',
        'State the expected observable result and the check that distinguishes success from a plausible-looking failure.',
      ],
      caseLabel: 'Procedure walkthrough',
      casePrompt: 'Annotate setup → action → expected result → verification point in the order another learner could repeat.',
      boundaryLabel: 'Procedure recovery',
      boundaryPrompt: 'If the expected result is missing, preserve the error and return to the first unmet precondition.',
      artifactLabel: 'Learner output',
      artifactPrompt: 'Submit an annotated, repeatable procedure with its verification point.',
    },
    practice: {
      objectiveLead: 'Changed-condition practice:',
      panels: ['01 New condition', '02 Evidence-guided choice', '03 Expected consequence'],
      prompts: [
        'Identify which condition has changed and which old assumption no longer holds.',
        'Use the cited evidence to select the safest next action.',
        'Predict the result and define the evidence that will confirm or reject the prediction.',
      ],
      caseLabel: 'Practice decision',
      casePrompt: 'Choose an action for the changed condition, then defend it with evidence rather than a generic best practice.',
      boundaryLabel: 'Counterfactual',
      boundaryPrompt: 'Name one plausible condition under which the opposite choice would become correct.',
      artifactLabel: 'Learner output',
      artifactPrompt: 'Submit the changed-condition choice, rationale, source evidence, and expected consequence.',
    },
    retrieval: {
      objectiveLead: 'Retrieval and correction:',
      panels: ['01 Recall without prompts', '02 Misconception to correct', '03 Source-backed correction'],
      prompts: [
        'Attempt the explanation before looking back at the source fact.',
        'Identify the tempting but incorrect interpretation and why it seems plausible.',
        'Use the evidence to correct the interpretation and define the next verification action.',
      ],
      caseLabel: 'Recall challenge',
      casePrompt: 'Answer from memory, then compare every consequential claim with the cited passage.',
      boundaryLabel: 'Correction rule',
      boundaryPrompt: 'Do not replace a wrong answer with a longer answer; identify the exact assumption that failed.',
      artifactLabel: 'Learner output',
      artifactPrompt: 'Submit the no-prompt answer, one misconception, and its evidence-backed correction.',
    },
    limits: {
      objectiveLead: 'Failure and recovery boundary:',
      panels: ['01 Failure signal', '02 Containment and recovery', '03 Escalation evidence'],
      prompts: [
        'Identify the first observable signal that indicates the expected mechanism did not hold.',
        'Choose the smallest safe containment and recovery action before retrying.',
        'Record the evidence and escalation condition needed if the recovery does not work.',
      ],
      caseLabel: 'Recovery drill',
      casePrompt: 'Write detection → containment → recovery → escalation as an auditable sequence.',
      boundaryLabel: 'Unsafe recovery',
      boundaryPrompt: 'Never erase the first failure signal or retry blindly; both remove the evidence needed for diagnosis.',
      artifactLabel: 'Learner output',
      artifactPrompt: 'Submit one failure scenario with detection, containment, recovery, escalation, and source evidence.',
    },
    'synthesis-transfer': {
      objectiveLead: 'Transfer project:',
      panels: ['01 New problem framing', '02 Source-backed workflow', '03 Verifiable delivery'],
      prompts: [
        'Frame a new project, decision, or problem that the course did not solve directly.',
        'Adapt the mechanism and evidence rather than copying a recap of the source.',
        'Produce the required artifact with a concrete verification result and recovery action.',
      ],
      caseLabel: 'Transfer brief',
      casePrompt: 'Use the course evidence to justify each consequential design choice in the new context.',
      boundaryLabel: 'Completion test',
      boundaryPrompt: 'A summary is not completion evidence; the artifact must be executable or independently reviewable.',
      artifactLabel: 'Final learner artifact',
      artifactPrompt: 'Submit the required artifact, its cited rationale, an executable verification step, and failure recovery evidence.',
    },
  };
  const chinese: Record<string, SlideActivityFrame> = {
    ...english,
    orientation: { ...english.orientation, objectiveLead: '学习路线：', panels: ['01 要解决的决策', '02 证据地图', '03 成功信号'], caseLabel: '起步任务', boundaryLabel: '范围检查', artifactLabel: '学习产出' },
    diagnostic: { ...english.diagnostic, objectiveLead: '起点诊断：', panels: ['01 当前假设', '02 待验证未知点', '03 所需证据'], caseLabel: '诊断任务', boundaryLabel: '误解检查', artifactLabel: '学习产出' },
    foundation: { ...english.foundation, objectiveLead: '核心模型：', panels: ['01 定义', '02 关系', '03 后果'], caseLabel: '概念重建', boundaryLabel: '概念边界', artifactLabel: '学习产出' },
    mechanism: { ...english.mechanism, objectiveLead: '机制追踪：', panels: ['01 输入与触发', '02 规则与状态变化', '03 输出与验证'], caseLabel: '链路练习', boundaryLabel: '断点检查', artifactLabel: '学习产出' },
    evidence: { ...english.evidence, objectiveLead: '证据决策：', panels: ['01 选项与约束', '02 取舍证据', '03 决策记录'], caseLabel: '决策练习', boundaryLabel: '决策风险', artifactLabel: '学习产出' },
    'worked-example': { ...english['worked-example'], objectiveLead: '案例演练：', panels: ['01 前置准备', '02 执行动作', '03 验证结果'], caseLabel: '步骤走读', boundaryLabel: '恢复路径', artifactLabel: '学习产出' },
    practice: { ...english.practice, objectiveLead: '情境练习：', panels: ['01 条件变化', '02 证据驱动选择', '03 预期后果'], caseLabel: '情境决策', boundaryLabel: '反事实检查', artifactLabel: '学习产出' },
    retrieval: { ...english.retrieval, objectiveLead: '主动回忆：', panels: ['01 无提示回忆', '02 纠正误解', '03 证据校正'], caseLabel: '回忆挑战', boundaryLabel: '校正规则', artifactLabel: '学习产出' },
    limits: { ...english.limits, objectiveLead: '故障与恢复：', panels: ['01 失败信号', '02 控制与恢复', '03 升级证据'], caseLabel: '恢复演练', boundaryLabel: '不安全恢复', artifactLabel: '学习产出' },
    'synthesis-transfer': { ...english['synthesis-transfer'], objectiveLead: '迁移项目：', panels: ['01 新问题定义', '02 证据化方案', '03 可验证交付'], caseLabel: '迁移简报', boundaryLabel: '完成测试', artifactLabel: '最终学习产出' },
  };
  const frames = cjk ? chinese : english;
  return frames[kind ?? 'foundation'] ?? frames.foundation;
}

function activitySpecificSlideCopy(
  outline: SceneOutline,
  cjk: boolean,
  first: string,
  second: string,
  third: string,
): {
  objective: string;
  mechanism: string;
  evidence: string;
  decision: string;
  case: string;
  failure: string;
  takeaway: string;
} {
  const frame = slideActivityFrame(outline.activity?.kind, cjk);
  const conciseFirst = compactSlideText(first, 220);
  const conciseSecond = compactSlideText(second, 220);
  const conciseThird = compactSlideText(third, 220);
  const conciseDescription = compactSlideText(outline.description, 230);
  const panel = (title: string, point: string, prompt: string, color: string) =>
    `<p><strong style="font-size:20px;color:${color}">${title}</strong></p><p>${point}</p><p>${compactSlideText(prompt, 125)}</p>`;
  const objective = cjk
    ? `${frame.objectiveLead}${conciseDescription}。请把本页的来源事实、学习动作和可验证产出连成一条清晰链路。`
    : `${frame.objectiveLead} ${conciseDescription} Build a clear chain from the source fact, through the learner action, to a checkable result.`;
  const caseLead = cjk ? '请以来源事实为依据完成以下动作。' : 'Complete this action using the cited source fact rather than a generic best practice.';
  const boundaryLead = cjk ? '完成后保留可复核证据。' : 'Keep an inspectable record before continuing.';
  const prompts: [string, string, string] = cjk
    ? [
        '说明这一来源事实对应的输入、约束或前置条件，以及它为何影响当前判断。',
        '将该事实放入具体案例，观察行动前后的状态变化，并给出可复核的证据。',
        '写下你的选择、预期后果和使结论失效的边界条件，再决定下一步验证。',
      ]
    : frame.prompts;
  const casePrompt = cjk
    ? '依次写下你的选择、理由、预期结果和验证方式。'
    : frame.casePrompt;
  const boundaryPrompt = cjk
    ? '不要以“界面看起来正常”代替完成证据；记录首个异常、纠正动作和复核结果。'
    : frame.boundaryPrompt;
  const artifactPrompt = cjk
    ? '提交与本环节相匹配的可检查成果，并标明支撑它的来源证据。'
    : frame.artifactPrompt;
  return {
    objective,
    mechanism: panel(frame.panels[0], conciseFirst, prompts[0], '#5b3df5'),
    evidence: panel(frame.panels[1], conciseSecond, prompts[1], '#087ea4'),
    decision: panel(frame.panels[2], conciseThird, prompts[2], '#b45309'),
    case: `<p><strong>${frame.caseLabel}:</strong> ${caseLead} ${compactSlideText(casePrompt, 190)}</p>`,
    failure: `<p><strong>${frame.boundaryLabel}:</strong> ${compactSlideText(boundaryPrompt, 180)} ${boundaryLead}</p>`,
    takeaway: `<p><strong>${frame.artifactLabel}:</strong> ${compactSlideText(artifactPrompt, 190)}</p>`,
  };
}

/**
 * The safety net is part of the product, not an error card. Each instructional
 * activity therefore receives a distinct composition: a map, diagnostic,
 * mechanism trace, worked case, decision exercise, recovery runbook, or
 * transfer brief. All variants retain the same eight inspectable text
 * elements so the renderer and quality contract stay deterministic.
 */
function activitySpecificSlideLayout(
  outline: SceneOutline,
  content: ReturnType<typeof activitySpecificSlideCopy>,
): PPTElement[] {
  const kind = outline.activity?.kind ?? 'foundation';
  const prefix = `firstpass-${kind}-${outline.order}`;
  const title = textElement(
    `${prefix}-title`,
    50,
    26,
    900,
    58,
    `<p style="font-size:30px;font-weight:800">${outline.title}</p>`,
    { color: '#111827', textType: 'title' },
  );
  const objective = textElement(
    `${prefix}-objective`,
    50,
    88,
    900,
    68,
    `<p style="font-size:15px;color:#526078">${content.objective}</p>`,
    { fill: '#eef2ff', textType: 'subtitle' },
  );
  const card = (
    name: string,
    left: number,
    top: number,
    width: number,
    height: number,
    value: string,
    fill: string,
    textType: 'content' | 'notes' = 'content',
  ) => textElement(`${prefix}-${name}`, left, top, width, height, value, { fill, textType });

  if (kind === 'orientation') {
    return [
      title,
      objective,
      card('map', 50, 176, 520, 230, content.mechanism, '#f3f0ff'),
      card('evidence', 600, 176, 350, 102, content.evidence, '#ecfeff'),
      card('signal', 600, 304, 350, 102, content.decision, '#fff7ed'),
      card('brief', 50, 430, 520, 70, content.case, '#f8fafc', 'notes'),
      card('boundary', 600, 430, 350, 70, content.failure, '#fff1f2', 'notes'),
      card('artifact', 50, 518, 900, 38, content.takeaway, '#ecfdf5', 'notes'),
    ];
  }

  if (kind === 'diagnostic' || kind === 'retrieval') {
    return [
      title,
      objective,
      card('prompt', 50, 176, 900, 104, content.mechanism, '#f3f0ff'),
      card('evidence', 50, 306, 430, 128, content.evidence, '#ecfeff'),
      card('correction', 520, 306, 430, 128, content.decision, '#fff7ed'),
      card('attempt', 50, 458, 430, 52, content.case, '#f8fafc', 'notes'),
      card('guardrail', 520, 458, 430, 52, content.failure, '#fff1f2', 'notes'),
      card('record', 50, 528, 900, 34, content.takeaway, '#ecfdf5', 'notes'),
    ];
  }

  if (kind === 'evidence' || kind === 'worked-example') {
    return [
      title,
      objective,
      card('case', 50, 176, 430, 252, content.mechanism, '#f3f0ff'),
      card('source', 510, 176, 440, 112, content.evidence, '#ecfeff'),
      card('choice', 510, 314, 440, 114, content.decision, '#fff7ed'),
      card('work', 50, 452, 570, 54, content.case, '#f8fafc', 'notes'),
      card('risk', 650, 452, 300, 54, content.failure, '#fff1f2', 'notes'),
      card('result', 50, 526, 900, 34, content.takeaway, '#ecfdf5', 'notes'),
    ];
  }

  if (kind === 'practice') {
    return [
      title,
      objective,
      card('scenario', 50, 176, 900, 94, content.mechanism, '#f3f0ff'),
      card('option-a', 50, 296, 280, 160, content.evidence, '#ecfeff'),
      card('option-b', 360, 296, 280, 160, content.decision, '#fff7ed'),
      card('decision', 670, 296, 280, 160, content.case, '#f8fafc'),
      card('counterfactual', 50, 480, 450, 48, content.failure, '#fff1f2', 'notes'),
      card('submission', 520, 480, 430, 48, content.takeaway, '#ecfdf5', 'notes'),
    ];
  }

  if (kind === 'limits') {
    return [
      title,
      objective,
      card('signal', 50, 176, 900, 84, content.mechanism, '#fff7ed'),
      card('runbook', 50, 286, 590, 150, content.failure, '#fff1f2'),
      card('evidence', 670, 286, 280, 150, content.evidence, '#ecfeff'),
      card('decision', 50, 460, 430, 50, content.decision, '#f3f0ff', 'notes'),
      card('rehearsal', 520, 460, 430, 50, content.case, '#f8fafc', 'notes'),
      card('record', 50, 530, 900, 32, content.takeaway, '#ecfdf5', 'notes'),
    ];
  }

  if (kind === 'synthesis-transfer') {
    return [
      title,
      objective,
      card('problem', 50, 176, 430, 112, content.mechanism, '#f3f0ff'),
      card('evidence-map', 520, 176, 430, 112, content.evidence, '#ecfeff'),
      card('proposal', 50, 314, 900, 78, content.decision, '#fff7ed'),
      card('deliverable', 50, 418, 900, 72, content.case, '#f8fafc', 'notes'),
      card('acceptance', 50, 516, 430, 42, content.failure, '#fff1f2', 'notes'),
      card('handoff', 520, 516, 430, 42, content.takeaway, '#ecfdf5', 'notes'),
    ];
  }

  return [
    title,
    objective,
    card('mechanism', 50, 176, 900, 96, content.mechanism, '#f3f0ff'),
    card('evidence', 50, 298, 430, 154, content.evidence, '#ecfeff'),
    card('decision', 520, 298, 430, 154, content.decision, '#fff7ed'),
    card('case', 50, 476, 430, 48, content.case, '#f8fafc', 'notes'),
    card('boundary', 520, 476, 430, 48, content.failure, '#fff1f2', 'notes'),
    card('artifact', 50, 542, 900, 28, content.takeaway, '#ecfdf5', 'notes'),
  ];
}

function activitySpecificSlideBackground(kind: SceneOutline['activity'] extends infer Activity
  ? Activity extends { kind?: infer Kind }
    ? Kind
    : undefined
  : undefined) {
  const end = kind === 'limits'
    ? '#fff7ed'
    : kind === 'synthesis-transfer'
      ? '#f5f3ff'
      : kind === 'practice'
        ? '#eff6ff'
        : kind === 'evidence' || kind === 'worked-example'
          ? '#f0fdfa'
          : '#f4f7ff';
  return {
    type: 'gradient' as const,
    gradient: {
      type: 'linear' as const,
      colors: [
        { pos: 0, color: '#ffffff' },
        { pos: 1, color: end },
      ],
      rotate: 0,
    },
  };
}

/**
 * A complete outline-grounded slide used only when a model result is missing
 * or fails the release contract. It is intentionally information-dense but
 * visually bounded: title/objective, three distinct teaching cards, a worked
 * decision, a failure boundary, and a checkable takeaway.
 */
export function buildDeterministicSlideContent(
  outline: SceneOutline,
  languageDirective?: string,
): GeneratedSlideContent {
  const cjk = chinese(outline, languageDirective);
  const points = (outline.keyPoints ?? []).filter(Boolean);
  const first = points[0] || outline.description;
  const second = points[1] || first;
  const third = points[2] || second;
  const content = cjk
    ? {
        objective: `学习目标：${outline.description}。阅读时请把注意力放在“输入条件—处理机制—状态变化—可观察结果”的因果链，而不是只记住术语。`,
        mechanism: `<p><strong style="font-size:20px;color:#5b3df5">01 核心机制</strong></p><p>${first}</p><p>这一步决定系统允许什么进入、按什么规则处理，以及哪一种状态变化可以被后续环节观察。请说明它为什么存在，以及改变这一条件会影响什么结果。</p>`,
        evidence: `<p><strong style="font-size:20px;color:#087ea4">02 证据与例子</strong></p><p>${second}</p><p>把要点放进一个具体案例：先记录原始条件，再观察动作前后的状态差异，用来源、测试、日志或可见结果证明判断。证据必须能够被另一位学习者复核。</p>`,
        decision: `<p><strong style="font-size:20px;color:#b45309">03 决策与边界</strong></p><p>${third}</p><p>比较至少两个可选方案，判断哪一个满足当前约束；同时指出一个会使结论失效的边界。若结果偏离预期，从最后一个仍满足验收条件的环节向后定位。</p>`,
        case: `<p><strong>工作案例：</strong>假设项目条件发生变化。先根据“${first}”确认输入，再用“${second}”检查状态与证据，最后依据“${third}”做出选择。学习者需要写下选择、理由、预期结果和验证方式。</p>`,
        failure:
          '<p><strong>失败检查：</strong>不要把“界面看起来正常”当成完成。至少验证一次正常路径和一次失败条件；记录第一个异常状态、触发条件、修正动作，以及修正后重新运行的可观察结果。</p>',
        takeaway:
          '<p><strong>本场产出：</strong>用自己的话复述机制，提交一个可检查结论：我选择了什么、依据是什么、预期会看到什么、什么情况会推翻结论、下一步如何验证。</p>',
      }
    : {
        objective: `Learning objective: ${outline.description}. Follow the causal chain from input condition to mechanism, state change, and observable result instead of memorizing labels.`,
        mechanism: `<p><strong style="font-size:20px;color:#5b3df5">01 Core mechanism</strong></p><p>${first}</p><p>This determines what enters the system, which rule processes it, and which state transition becomes visible downstream. Explain why the mechanism exists and which result changes when its condition changes.</p>`,
        evidence: `<p><strong style="font-size:20px;color:#087ea4">02 Evidence and worked example</strong></p><p>${second}</p><p>Place the point in a concrete case: record the initial condition, compare state before and after the action, and verify the judgment with a source, test, log, or visible outcome that another learner can inspect.</p>`,
        decision: `<p><strong style="font-size:20px;color:#b45309">03 Decision and boundary</strong></p><p>${third}</p><p>Compare at least two alternatives, select the one that satisfies the current constraint, and name a boundary that would invalidate the conclusion. If the result diverges, inspect the first contract after the last accepted state.</p>`,
        case: `<p><strong>Worked case:</strong> Assume the project conditions change. Use “${first}” to confirm the input, “${second}” to inspect state and evidence, and “${third}” to make the decision. Record the choice, reason, expected result, and verification method.</p>`,
        failure:
          '<p><strong>Failure check:</strong> A normal-looking interface is not acceptance evidence. Test one successful path and one failure condition; record the first abnormal state, trigger, correction, and observable result after verification.</p>',
        takeaway:
          '<p><strong>Learner artifact:</strong> Explain the mechanism in your own words and submit a checkable conclusion: decision, evidence, expected result, invalidating condition, and the next verification step.</p>',
      };
  const activityContent = {
    ...content,
    ...activitySpecificSlideCopy(outline, cjk, first, second, third),
  };

  return {
    elements: activitySpecificSlideLayout(outline, activityContent),
    background: activitySpecificSlideBackground(outline.activity?.kind),
    remark: cjk
      ? '首轮质量收敛模板：内容严格来自已批准大纲，用于替代不完整或不可解析的模型输出。'
      : 'First-pass quality convergence: content is grounded in the approved outline and replaces incomplete model output.',
  };
}

export function buildDeterministicQuizContent(
  outline: SceneOutline,
  languageDirective?: string,
): GeneratedQuizContent {
  const cjk = chinese(outline, languageDirective);
  const points = (outline.keyPoints ?? []).filter(Boolean);
  const first = points[0] || outline.description;
  const second = points[1] || first;
  const third = points[2] || second;
  const questions: QuizQuestion[] = cjk
    ? [
        {
          id: `firstpass-q1-${outline.order}`,
          type: 'single',
          question: `关于“${first}”，开始分析时最可靠的第一步是什么？`,
          options: [
            { value: 'A', label: '先确认输入、约束和预期的可观察结果' },
            { value: 'B', label: '直接复制上一次结论，不检查条件' },
            { value: 'C', label: '只观察界面是否漂亮' },
            { value: 'D', label: '等待失败后再决定目标' },
          ],
          answer: ['A'],
          hasAnswer: true,
          analysis: `A 正确。${first}只有在输入条件、约束和验收结果明确时才能被正确应用。B 忽略情境变化，C 把外观当成证据，D 则缺少可验证目标，因此都无法建立可靠因果链。`,
          points: 20,
        },
        {
          id: `firstpass-q2-${outline.order}`,
          type: 'multiple',
          question: `要验证“${second}”是否真正成立，哪些证据是有效的？（多选）`,
          options: [
            { value: 'A', label: '操作前后的状态差异' },
            { value: 'B', label: '可复现的测试、日志或来源记录' },
            { value: 'C', label: '没有条件说明的主观感觉' },
            { value: 'D', label: '失败条件触发后的可观察结果' },
          ],
          answer: ['A', 'B', 'D'],
          hasAnswer: true,
          analysis: `A、B、D 共同覆盖状态、证据和失败边界，能够支持对“${second}”的复核。C 没有说明条件、动作和结果，无法由他人验证，也不能区分机制生效与偶然现象。`,
          points: 25,
        },
        {
          id: `firstpass-q3-${outline.order}`,
          type: 'single',
          question: `当“${third}”的结果偏离预期时，最有效的定位策略是什么？`,
          options: [
            { value: 'A', label: '随机修改多个环节直到看起来正常' },
            { value: 'B', label: '从最后一个通过验收的状态向后检查第一个失效连接' },
            { value: 'C', label: '删除失败记录' },
            { value: 'D', label: '只重新阅读标题' },
          ],
          answer: ['B'],
          hasAnswer: true,
          analysis: `B 正确，因为它把“${third}”放回可观察的状态链中，能够缩小故障范围并保留因果证据。A 会引入新变量，C 会破坏追踪，D 没有执行任何验证。`,
          points: 25,
        },
        {
          id: `firstpass-q4-${outline.order}`,
          type: 'short_answer',
          question: `新项目迁移：如果外部条件发生变化，你会如何综合“${first}”“${second}”“${third}”调整方案，并证明新结果可靠？`,
          hasAnswer: false,
          commentPrompt:
            '评分标准：识别新约束 25%；解释机制选择 25%；给出可观察证据与验收方式 30%；指出失败边界和修正路径 20%。',
          analysis:
            '高质量回答应先比较新旧条件，再说明保留或调整的机制，给出操作、状态和结果证据，同时列出至少一个会推翻结论的失败条件。只复述旧答案或不给验证方式，不能证明知识迁移。',
          points: 30,
        },
      ]
    : [
        {
          id: `firstpass-q1-${outline.order}`,
          type: 'single',
          question: `For “${first}”, what is the most reliable first analysis step?`,
          options: [
            { value: 'A', label: 'Confirm input, constraints, and the observable result' },
            { value: 'B', label: 'Copy the previous conclusion without checking conditions' },
            { value: 'C', label: 'Judge only whether the interface looks polished' },
            { value: 'D', label: 'Wait for failure before defining the objective' },
          ],
          answer: ['A'],
          hasAnswer: true,
          analysis: `A is correct. ${first} can be applied reliably only when its input, constraints, and acceptance result are explicit. B ignores context change, C substitutes appearance for evidence, and D has no verifiable objective.`,
          points: 20,
        },
        {
          id: `firstpass-q2-${outline.order}`,
          type: 'multiple',
          question: `Which evidence can verify whether “${second}” actually holds? Select all that apply.`,
          options: [
            { value: 'A', label: 'State difference before and after the operation' },
            { value: 'B', label: 'A reproducible test, log, or source record' },
            { value: 'C', label: 'A feeling with no stated conditions' },
            { value: 'D', label: 'An observable result after triggering a failure condition' },
          ],
          answer: ['A', 'B', 'D'],
          hasAnswer: true,
          analysis: `A, B, and D cover state, evidence, and failure boundaries and make “${second}” independently reviewable. C does not identify a condition, action, or result and cannot distinguish mechanism from coincidence.`,
          points: 25,
        },
        {
          id: `firstpass-q3-${outline.order}`,
          type: 'single',
          question: `When the result of “${third}” diverges, which diagnosis strategy is strongest?`,
          options: [
            { value: 'A', label: 'Randomly change several components' },
            {
              value: 'B',
              label: 'Start after the last accepted state and inspect the first broken connection',
            },
            { value: 'C', label: 'Delete the failure record' },
            { value: 'D', label: 'Read the title again without testing' },
          ],
          answer: ['B'],
          hasAnswer: true,
          analysis: `B places “${third}” back into an observable state chain, narrows the fault, and preserves causal evidence. A introduces confounders, C destroys traceability, and D performs no verification.`,
          points: 25,
        },
        {
          id: `firstpass-q4-${outline.order}`,
          type: 'short_answer',
          question: `New-project transfer: if external conditions change, how would you combine “${first}”, “${second}”, and “${third}” to adapt the solution and prove the new result?`,
          hasAnswer: false,
          commentPrompt:
            'Rubric: identify new constraints 25%; explain mechanism choice 25%; observable evidence and acceptance 30%; failure boundary and correction 20%.',
          analysis:
            'A strong answer compares old and new conditions, explains which mechanism is retained or adapted, gives operation-state-result evidence, and names a condition that would invalidate the conclusion. Repeating the old answer without verification does not demonstrate transfer.',
          points: 30,
        },
      ];
  return { questions };
}

/**
 * Keeps every citation approved in the outline next to an explanatory claim
 * without spending another model call. This is intentionally a narrow repair:
 * it never invents labels and leaves already-contextualized content untouched.
 */
export function convergeGeneratedSceneEvidence(
  outline: SceneOutline,
  content: Exclude<ConvergeableContent, null>,
  languageDirective?: string,
): Exclude<ConvergeableContent, null> {
  // Keep convergence and the release gate on the same definition of
  // "learner-visible". Looking at serialized JSON can mistake labels in
  // metadata, styles, or hidden control state for visible evidence.
  const visibleText = learnerVisibleGeneratedContentText(content);
  const contextualized = contextualizedCitationLabels(visibleText);
  const missing = plannedEvidenceAnchors(outline).filter(
    ({ label }) => !contextualized.has(label),
  );
  if (missing.length === 0) return content;

  const cjk = chinese(outline, languageDirective);
  const anchorHtml = missing
    .map(({ label, claim }) => compactEvidenceClaim(claim, label))
    .map((claim) => `<p><strong>${cjk ? '证据锚点' : 'Evidence anchor'}：</strong>${claim}</p>`)
    .join('');

  if ('elements' in content && Array.isArray(content.elements)) {
    const elements = content.elements.map((element) => ({ ...element }));
    const targetIndex = elements.findLastIndex(
      (element) => element.type === 'text' && typeof element.content === 'string',
    );
    if (targetIndex >= 0) {
      const target = elements[targetIndex];
      if (target?.type === 'text') {
        elements[targetIndex] = {
          ...target,
          content: `${target.content}${anchorHtml}`,
        };
      }
    } else {
      elements.push(
        textElement(
          `evidence-anchor-${outline.order}`,
          50,
          470,
          900,
          72,
          anchorHtml,
          { fill: '#f8fafc', textType: 'notes' },
        ),
      );
    }
    return { ...content, elements } as Exclude<ConvergeableContent, null>;
  }

  if ('questions' in content && Array.isArray(content.questions)) {
    const questions = content.questions.map((question, index) =>
      index === 0
        ? {
            ...question,
            analysis: `${question.analysis ?? ''}\n${plainCourseText(anchorHtml)}`.trim(),
          }
        : question,
    );
    return { ...content, questions } as Exclude<ConvergeableContent, null>;
  }

  if ('html' in content && typeof content.html === 'string') {
    return {
      ...content,
      html: `${content.html}<aside class="vaultide-evidence-anchors" aria-label="${
        cjk ? '来源证据' : 'Source evidence'
      }">${anchorHtml}</aside>`,
    } as Exclude<ConvergeableContent, null>;
  }

  return content;
}

/**
 * A source label is not a license to retain a made-up named fact. Rather than
 * spending another provider call after this deterministic evidence check fails,
 * replace the unsafe page with the already-approved outline-grounded lesson.
 * This keeps the first classroom run moving while preserving a clear, auditable
 * source boundary.
 */
export function convergeUnsupportedNamedEvidenceClaims(
  outline: SceneOutline,
  content: Exclude<ConvergeableContent, null>,
  sourceContext: string | undefined,
  languageDirective?: string,
): Exclude<ConvergeableContent, null> {
  const unsupported = findUnsupportedNamedEvidenceTerms(
    sourceContext ?? '',
    learnerVisibleGeneratedContentText(content),
  );
  if (unsupported.length === 0) return content;

  // PBL payloads are structured project contracts rather than a slide, quiz,
  // or HTML surface. Replacing one with an interactive fallback would make it
  // impossible for the scene builder to publish the declared `pbl` scene.
  // Keep the typed payload intact here; the normal evidence/quality gate can
  // still reject it with an actionable diagnostic if its project text is not
  // supportable by the frozen source set.
  if ('projectConfig' in content) return content;

  const deterministic = convergeGeneratedSceneContent(outline, null, languageDirective);
  return convergeGeneratedSceneEvidence(outline, deterministic, languageDirective);
}

/**
 * Guarantees that the final scene visibly delivers the synthesis, transfer,
 * and observable-artifact contract that release assesses. The outline already
 * defines the task; this function only makes that pedagogical contract visible
 * when a model kept it in notes or narration that the release gate cannot see.
 */
export function convergeFinalSceneTransferDelivery(
  outline: SceneOutline,
  content: Exclude<ConvergeableContent, null>,
  languageDirective?: string,
): Exclude<ConvergeableContent, null> {
  if (!('elements' in content) || !Array.isArray(content.elements)) return content;

  const visibleText = plainCourseText(JSON.stringify(content.elements));
  if (
    FINAL_SYNTHESIS_PATTERN.test(visibleText) &&
    FINAL_TRANSFER_PATTERN.test(visibleText) &&
    FINAL_ARTIFACT_PATTERN.test(visibleText) &&
    hasExactArtifactContract(outline, visibleText, chinese(outline, languageDirective))
  ) {
    return content;
  }

  const cjk = chinese(outline, languageDirective);
  const delivery = finalArtifactDelivery(outline, cjk);
  const artifact = outline.activity?.artifact;
  const genericStudyNotePattern = /\bstudy[ -]?note\b/giu;
  const replacement = artifact ? displayArtifactType(artifact.artifactType, cjk) : undefined;
  const elements = content.elements.map((element) => {
    if (!replacement || element.type !== 'text' || typeof element.content !== 'string') {
      return { ...element };
    }
    return {
      ...element,
      content: element.content.replace(genericStudyNotePattern, replacement),
    };
  });
  const targetIndex = elements.findLastIndex(
    (element) => element.type === 'text' && typeof element.content === 'string',
  );
  if (targetIndex >= 0) {
    const target = elements[targetIndex];
    if (target?.type === 'text') {
      elements[targetIndex] = { ...target, content: `${target.content}${delivery}` };
    }
  } else {
    elements.push(
      textElement(`final-transfer-${outline.order}`, 50, 462, 900, 80, delivery, {
        fill: '#ecfdf5',
        textType: 'notes',
      }),
    );
  }
  return { ...content, elements } as Exclude<ConvergeableContent, null>;
}

export function convergeGeneratedSceneContent(
  outline: SceneOutline,
  content: ConvergeableContent,
  languageDirective?: string,
): Exclude<ConvergeableContent, null> {
  if (content && assessGeneratedSceneContent(outline, content).passed) return content;

  if (outline.type === 'slide') {
    return buildDeterministicSlideContent(outline, languageDirective);
  }
  if (outline.type === 'quiz') {
    return buildDeterministicQuizContent(outline, languageDirective);
  }

  const fallbackOutline: SceneOutline = {
    ...outline,
    widgetType: 'diagram',
    widgetOutline: {
      diagramType: 'system',
      nodeCount: Math.max(3, Math.min(6, outline.keyPoints?.length || 4)),
    },
  };
  const diagram = buildDeterministicDiagram(fallbackOutline, languageDirective);
  return {
    html: postProcessInteractiveHtml(diagram.html),
    widgetType: 'diagram',
    widgetConfig: diagram.widgetConfig,
  };
}
