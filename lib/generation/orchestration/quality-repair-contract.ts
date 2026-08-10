import type { SceneOutline } from '@/lib/types/generation';
import type { CourseGenerationStepRecord } from './types';

function issueCodes(step: CourseGenerationStepRecord): Set<string> {
  return new Set(
    (step.quality?.issues ?? [])
      .map((entry) => entry.code)
      .filter((code): code is string => typeof code === 'string' && code.length > 0),
  );
}

function metricSummary(step: CourseGenerationStepRecord): string {
  const metrics = step.quality?.metrics ?? {};
  const keys = [
    'elementCount',
    'textChars',
    'substantiveTextElements',
    'semanticTokenCount',
    'keyPointCoverage',
    'pedagogySignalCount',
    'visibleTextChars',
    'controlCount',
    'eventCount',
    'hasFeedback',
    'hasReset',
    'taskSignalCount',
    'actionCount',
    'actionTypeCount',
    'speechCount',
    'speechChars',
    'hasLearnerCue',
  ];
  return keys
    .filter((key) => metrics[key] !== undefined)
    .map((key) => `${key}=${String(metrics[key])}`)
    .join(', ');
}

function isChinese(outline: SceneOutline, languageDirective?: string): boolean {
  return (
    /Chinese|中文|zh-/iu.test(languageDirective ?? '') ||
    /\p{Script=Han}/u.test(`${outline.title}${outline.description}`)
  );
}

export function applyCourseStepRepairContract(
  outline: SceneOutline,
  step: CourseGenerationStepRecord,
  languageDirective?: string,
): SceneOutline {
  if (!step.lastErrorDetail || step.attemptCount <= 1) return outline;

  const codes = issueCodes(step);
  const metrics = metricSummary(step);
  const slideDepth =
    outline.type === 'slide' &&
    (codes.has('scene_slide_depth') ||
      codes.has('scene_slide_elements') ||
      codes.has('scene_slide_pedagogy') ||
      codes.has('scene_slide_keypoint_coverage'));
  const quizAssessment =
    outline.type === 'quiz' &&
    (codes.has('scene_quiz_variety') ||
      codes.has('scene_quiz_transfer_missing') ||
      codes.has('scene_quiz_explanations') ||
      codes.has('scene_quiz_coverage') ||
      codes.has('scene_quiz_duplicate_questions'));
  const interactiveDepth =
    outline.type === 'interactive' &&
    (codes.has('scene_interactive_depth') ||
      codes.has('scene_interactive_function') ||
      codes.has('scene_interactive_feedback') ||
      codes.has('scene_interactive_coverage'));
  const pblDepth =
    outline.type === 'pbl' &&
    (codes.has('scene_pbl_depth') || codes.has('scene_pbl_learning_contract'));
  const actionSequence =
    codes.has('scene_actions_sparse') ||
    codes.has('scene_narration_shallow') ||
    codes.has('scene_action_sequence_weak');
  const finalTransfer = codes.has('course_final_transfer_not_delivered');
  const qualityFeedback = (step.quality?.issues ?? [])
    .filter((entry) => entry.severity === 'error')
    .map((entry) => `[${entry.code}] ${entry.retryInstruction}`)
    .join(' ');
  const finalTransferFeedback = finalTransfer
    ? isChinese(outline, languageDirective)
      ? [
          '这是整门课程的最终迁移场景。页面必须显式综合课程中的 2–3 个核心概念或机制，说明它们如何协同；只做内容回顾不合格。',
          '要求学习者把这些机制应用到一个与课程示例不同的新项目、新决策或新问题，并当场产出可观察成果，例如决策记录、方案、检查表、对比矩阵或验证计划。',
          '给出可度量的完成标准与验证证据：成果必须包含哪些字段、如何判断合格、学习者完成后能展示或提交什么。保留来源标签，并让迁移步骤与课程机制一一对应。',
        ].join('\n')
      : [
          'This is the final transfer scene. Visibly synthesize 2–3 core concepts or named mechanisms from the course and explain how they work together; a recap alone is insufficient.',
          'Require the learner to apply those mechanisms to a genuinely new project, decision, or problem and produce an observable artifact such as a decision record, plan, checklist, comparison matrix, or verification plan.',
          'State measurable completion criteria and verification evidence: required artifact fields, the pass condition, and what the learner can show or submit. Preserve source labels and map each transfer step back to a course mechanism.',
        ].join('\n')
    : '';
  const targetedConvergenceFeedback = isChinese(outline, languageDirective)
    ? [
        interactiveDepth
          ? '交互场景必须形成完整闭环：至少两个有效控件、真实事件处理、每次操作后的可见状态或结果反馈、可工作的重置或重放入口，以及不少于 240 个可见教学字符。控件、标签和反馈必须覆盖计划要点。'
          : '',
        pblDepth
          ? '项目式场景必须产出可验收证据：写清真实任务简报、分阶段工作、来源约束、角色或决策、反馈机制、风险边界、验收字段和迁移应用。'
          : '',
        actionSequence
          ? '课堂动作必须至少 5 个，包含至少 3 段讲解和 2 种动作类型；可见讲解合计不少于 180 字，并明确要求学习者观察、比较、解释、判断或验证。'
          : '',
      ]
        .filter(Boolean)
        .join('\n')
    : [
        interactiveDepth
          ? 'Build a complete interaction loop: at least two meaningful controls, real event handling, visible state or result feedback after every action, a working reset or replay path, and at least 240 learner-visible teaching characters. Controls, labels, and feedback must cover the planned key points.'
          : '',
        pblDepth
          ? 'Make the project scene produce assessable evidence: a realistic brief, staged work, source-grounded constraints, learner roles or decisions, feedback, risk boundaries, explicit acceptance fields, and transfer to a realistic context.'
          : '',
        actionSequence
          ? 'Create at least 5 classroom actions with at least 3 substantive speeches and 2 action types. Keep at least 180 visible narration characters and explicitly ask the learner to observe, compare, explain, decide, or verify.'
          : '',
      ]
        .filter(Boolean)
        .join('\n');
  const feedback = [qualityFeedback, finalTransferFeedback, targetedConvergenceFeedback]
    .filter(Boolean)
    .join('\n');

  const contract = isChinese(outline, languageDirective)
    ? [
        `质量修复契约（第 ${step.attemptCount} 次，所有条目都必须满足）：`,
        metrics ? `上次可见指标：${metrics}。` : '',
        slideDepth
          ? '本页必须使用可见内容完成教学，不得把核心解释只放在讲稿、动作或元数据中。'
          : '',
        slideDepth
          ? '采用“标题 + 机制/因果 + 来源案例/证据 + 学习者判断/检查 + 结论/边界”的五区结构。'
          : '',
        slideDepth
          ? '至少 8 个有意义的视觉元素、5 个可见文字组，其中至少 4 组各不少于 24 个字符；全页可见纯文本控制在 260–420 个字符，并覆盖全部计划要点。'
          : '',
        slideDepth
          ? '明确写出一个有名称的机制及其因果解释；给出一个来自已提供来源的具体案例或证据并保留 [S#]/[V#] 标签；要求学习者作出一次比较、判断、选择或验证；最后给出可执行结论或适用边界。'
          : '',
        quizAssessment
          ? '测验必须同时满足全部固定条件：3–5 题；至少两种题型（优先采用单选 + 多选 + 简答）；题目分别覆盖回忆、应用与迁移；每题都有充分解析且不得重复。'
          : '',
        quizAssessment
          ? '最后一题必须是迁移题：题干和解析中明确出现“新情境”或“新项目”，要求学习者选择、调整或论证已学机制；简答题必须提供详细 commentPrompt 评分规则。即使本轮只报告一个缺项，也不得牺牲题型多样性或迁移题。'
          : '',
        feedback || step.lastErrorDetail,
        '保持来源忠实、场景独特性和版面可读性；输出前逐项自检，任何一项缺失都不要提交。',
      ]
        .filter(Boolean)
        .join('\n')
    : [
        `QUALITY REPAIR CONTRACT (attempt ${step.attemptCount}; every item is mandatory):`,
        metrics ? `Previous visible metrics: ${metrics}.` : '',
        slideDepth
          ? 'Teach through visible slide content; do not hide the core explanation in notes, actions, or metadata.'
          : '',
        slideDepth
          ? 'Use five visible zones: title; named mechanism/causality; source-grounded example/evidence; learner decision/check; takeaway/boundary.'
          : '',
        slideDepth
          ? 'Create at least 8 purposeful visual elements and 5 visible text groups, with at least 4 groups containing 24+ characters. Keep 260–420 visible plain-text characters and cover every planned key point.'
          : '',
        slideDepth
          ? 'State a named mechanism and causal explanation, a concrete supplied-source example with its [S#]/[V#] label, one learner comparison/decision/verification, and an actionable conclusion or boundary.'
          : '',
        quizAssessment
          ? 'The quiz must satisfy every fixed condition together: 3–5 questions; at least two types (prefer single + multiple + short_answer); distinct recall, application, and transfer tasks; substantive analysis for every answer; no duplicate questions.'
          : '',
        quizAssessment
          ? 'The final question must explicitly say “new context” or “new project” and require selecting, adapting, or justifying the learned mechanism. A short-answer transfer item must include a detailed commentPrompt rubric. Never trade away variety while repairing transfer, or transfer while repairing variety.'
          : '',
        feedback || step.lastErrorDetail,
        'Preserve source fidelity, scene distinctiveness, and readable layout. Self-check every requirement before returning JSON.',
      ]
        .filter(Boolean)
        .join('\n');

  return {
    ...outline,
    generationRepairDirective: contract,
  };
}
