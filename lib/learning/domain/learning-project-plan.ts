export type LearningSourceMode = 'external' | 'obsidian' | 'hybrid';

export type LearningOutcomeKind = 'understand' | 'compare' | 'apply' | 'build';

export type PriorKnowledgeLevel = 'new' | 'basic' | 'working' | 'advanced';

export type LearningEvidencePolicy = 'primary-first' | 'balanced';

export interface LearningProjectBrief {
  id: string;
  sourceMode: LearningSourceMode;
  goal: string;
  outcome: LearningOutcomeKind;
  priorKnowledge: PriorKnowledgeLevel;
  knownContext?: string;
  successCriteria: string[];
  evidencePolicy: LearningEvidencePolicy;
  createdAt: string;
  updatedAt: string;
}

const SUCCESS_CRITERIA: Record<LearningOutcomeKind, readonly string[]> = {
  understand: ['能够闭卷解释核心概念', '能够说清关键概念之间的关系', '能够指出仍不确定的问题'],
  compare: ['能够列出主要方案及证据', '能够解释各方案的适用边界', '能够针对具体场景做出选择'],
  apply: ['能够独立完成一个真实任务', '能够解释关键步骤和常见错误', '能够根据反馈修正一次结果'],
  build: ['能够产出一个可运行或可验证的成果', '能够说明设计取舍', '能够用证据验证成果是否达标'],
};

export function suggestedSuccessCriteria(outcome: LearningOutcomeKind): string[] {
  return [...SUCCESS_CRITERIA[outcome]];
}

export function createLearningProjectBrief(
  id: string,
  now = new Date().toISOString(),
): LearningProjectBrief {
  return {
    id,
    sourceMode: 'external',
    goal: '',
    outcome: 'understand',
    priorKnowledge: 'new',
    successCriteria: suggestedSuccessCriteria('understand'),
    evidencePolicy: 'primary-first',
    createdAt: now,
    updatedAt: now,
  };
}

export function updateLearningProjectBrief(
  current: LearningProjectBrief,
  patch: Partial<Omit<LearningProjectBrief, 'id' | 'createdAt'>>,
  now = new Date().toISOString(),
): LearningProjectBrief {
  const outcome = patch.outcome ?? current.outcome;
  const successCriteria =
    patch.successCriteria ??
    (patch.outcome && patch.outcome !== current.outcome
      ? suggestedSuccessCriteria(outcome)
      : current.successCriteria);
  return {
    ...current,
    ...patch,
    outcome,
    goal: (patch.goal ?? current.goal).slice(0, 2_000),
    ...(typeof patch.knownContext === 'string'
      ? { knownContext: patch.knownContext.slice(0, 1_000) }
      : current.knownContext
        ? { knownContext: current.knownContext }
        : {}),
    successCriteria: successCriteria
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 6)
      .map((item) => item.slice(0, 180)),
    updatedAt: now,
  };
}

export function learningProjectPromptContext(
  project: LearningProjectBrief,
  externalEvidence?: {
    mode?: 'off' | 'supplemental' | 'required';
    status?: 'not-requested' | 'ready' | 'unavailable';
    warning?: string;
  },
): string {
  const priorLabel: Record<PriorKnowledgeLevel, string> = {
    new: '第一次系统学习',
    basic: '知道少量术语或背景',
    working: '已有实践经验，但知识不完整',
    advanced: '已有较深基础，希望形成迁移与判断能力',
  };
  const outcomeLabel: Record<LearningOutcomeKind, string> = {
    understand: '理解并能解释',
    compare: '比较并能做出选择',
    apply: '应用并解决问题',
    build: '产出并验证成果',
  };
  const sourceLabel: Record<LearningSourceMode, string> = {
    external: '外部权威资料',
    obsidian: 'Obsidian 内部资料',
    hybrid: 'Obsidian 内部资料与外部权威资料',
  };

  return [
    '## Learning Project Contract',
    '',
    `Source scope: ${sourceLabel[project.sourceMode]}.`,
    ...(externalEvidence?.status === 'unavailable'
      ? [
          `External evidence boundary: unavailable (${externalEvidence.mode ?? 'supplemental'}).`,
          externalEvidence.warning ??
            'Do not claim that the course contains current external findings; ground it only in the supplied canonical source.',
        ]
      : externalEvidence?.status === 'ready'
        ? ['External evidence boundary: retrieved and available for citation.']
        : []),
    `Prior knowledge: ${priorLabel[project.priorKnowledge]}.`,
    `Expected outcome: ${outcomeLabel[project.outcome]}.`,
    ...(project.knownContext ? [`Learner context: ${project.knownContext}`] : []),
    'Success criteria:',
    ...project.successCriteria.map((criterion) => `- ${criterion}`),
    '',
    'Teaching requirements:',
    '- Diagnose or activate prior knowledge before introducing difficult material.',
    '- Explain with source-grounded examples, then ask for active recall before revealing answers.',
    '- Include at least one application or transfer task tied to the success criteria.',
    '- Separate observed mastery evidence from simple viewing or completion.',
    '- End with unresolved questions, an Obsidian deposition suggestion, and the next review action.',
    ...(externalEvidence?.status === 'unavailable'
      ? [
          '- Never describe internal-only evidence as current, externally verified, or independently confirmed.',
        ]
      : []),
    '',
    '---',
  ].join('\n');
}

export function isLearningProjectBrief(value: unknown): value is LearningProjectBrief {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === 'string' &&
    ['external', 'obsidian', 'hybrid'].includes(String(record.sourceMode)) &&
    typeof record.goal === 'string' &&
    ['understand', 'compare', 'apply', 'build'].includes(String(record.outcome)) &&
    ['new', 'basic', 'working', 'advanced'].includes(String(record.priorKnowledge)) &&
    Array.isArray(record.successCriteria) &&
    record.successCriteria.every((item) => typeof item === 'string') &&
    ['primary-first', 'balanced'].includes(String(record.evidencePolicy)) &&
    typeof record.createdAt === 'string' &&
    typeof record.updatedAt === 'string'
  );
}
