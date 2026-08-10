import type { QuizQuestion } from '@/lib/types/stage';
import type { SceneOutline } from '@/lib/types/generation';

const TRANSFER_SIGNAL =
  /迁移|新情境|新项目|实际任务|跨场景|应用到|transfer|new (?:case|context|project|problem)|apply (?:it|this|the)/iu;

function chinese(outline: SceneOutline, languageDirective?: string): boolean {
  return (
    /Chinese|中文|zh-/iu.test(languageDirective ?? '') ||
    /\p{Script=Han}/u.test(`${outline.title}${outline.description}`)
  );
}

function hasTransfer(question: QuizQuestion): boolean {
  return TRANSFER_SIGNAL.test(`${question.question} ${question.analysis ?? ''}`);
}

function substantiveAnalysis(question: QuizQuestion, isChinese: boolean): string {
  if ((question.analysis ?? '').trim().length >= 24) return question.analysis!.trim();
  return isChinese
    ? '解析：先识别题目中的约束与目标，再依据本课机制比较可选方案；不能只凭表面状态或沿用旧结论。'
    : 'Analysis: identify the constraints and objective, then compare the choices using the learned mechanism rather than reusing an old conclusion.';
}

function asTransferQuestion(
  question: QuizQuestion,
  outline: SceneOutline,
  isChinese: boolean,
): QuizQuestion {
  const focus = (outline.keyPoints ?? []).filter(Boolean).slice(0, 2).join('、') || outline.title;
  const original = question.question.trim();
  return {
    ...question,
    type: 'short_answer',
    question: isChinese
      ? `新项目迁移：在约束发生变化的新情境中，${original} 请说明你会如何选择或调整“${focus}”相关机制，并论证理由。`
      : `New-project transfer: in a new context with changed constraints, ${original} Explain how you would select or adapt the mechanism related to “${focus}” and justify the decision.`,
    options: undefined,
    answer: undefined,
    hasAnswer: false,
    commentPrompt: isChinese
      ? `评分规则：识别新情境约束 30%；正确选择或调整“${focus}”机制 35%；使用课程证据论证 25%；说明风险或验证方法 10%。`
      : `Rubric: identify new-context constraints 30%; select or adapt the “${focus}” mechanism 35%; justify with course evidence 25%; state a risk or verification method 10%.`,
    analysis: isChinese
      ? `${substantiveAnalysis(question, true)} 迁移要点：新项目不能照搬旧状态；应先比较约束，再选择或调整机制，并用可观察证据验证决策。`
      : `${substantiveAnalysis(question, false)} Transfer principle: do not copy the old state into a new project; compare constraints, adapt the mechanism, and verify the decision with observable evidence.`,
    points: Math.max(20, question.points ?? 0),
  };
}

function objectiveVarietyQuestion(outline: SceneOutline, isChinese: boolean): QuizQuestion {
  const focus = (outline.keyPoints ?? []).find(Boolean) || outline.title;
  return {
    id: 'q_contract_recall',
    type: 'single',
    question: isChinese
      ? `关于“${focus}”，进入新情境时最可靠的第一步是什么？`
      : `For “${focus}”, what is the most reliable first step in a new context?`,
    options: isChinese
      ? [
          { value: 'A', label: '直接复用旧结论，不检查条件' },
          { value: 'B', label: '核对新约束，并用证据验证机制是否适用' },
          { value: 'C', label: '只观察界面结果，忽略状态变化' },
          { value: 'D', label: '跳过判断，等待问题出现后再处理' },
        ]
      : [
          { value: 'A', label: 'Reuse the old conclusion without checking conditions' },
          { value: 'B', label: 'Check new constraints and verify the mechanism with evidence' },
          { value: 'C', label: 'Observe only the interface and ignore state changes' },
          { value: 'D', label: 'Skip the decision until a failure appears' },
        ],
    answer: ['B'],
    hasAnswer: true,
    analysis: isChinese
      ? 'B 正确，因为机制能否迁移取决于新情境的约束与证据；A、C、D 都跳过了必要的比较或验证，容易把旧结论误用到新项目。'
      : 'B is correct because transfer depends on the new context’s constraints and evidence. A, C, and D skip comparison or verification and can misapply an old conclusion.',
    points: 10,
  };
}

/**
 * Converts an otherwise substantive model quiz into a stable assessment shape.
 * This is a bounded structural repair: it preserves generated concepts and
 * explanations while guaranteeing that variety and transfer cannot oscillate
 * across durable retries.
 */
export function stabilizeGeneratedQuizAssessment(
  outline: SceneOutline,
  questions: readonly QuizQuestion[],
  languageDirective?: string,
): QuizQuestion[] {
  if (questions.length === 0) return [];
  const isChinese = chinese(outline, languageDirective);
  const repaired: QuizQuestion[] = questions.map((question) => ({
    ...question,
    analysis: substantiveAnalysis(question, isChinese),
  }));
  const types = new Set(repaired.map((question) => question.type));
  const needsTransfer = !repaired.some(hasTransfer);
  const needsVariety = types.size < 2;

  if (needsTransfer || needsVariety) {
    const counts = repaired.reduce<Record<string, number>>((result, question) => {
      result[question.type] = (result[question.type] ?? 0) + 1;
      return result;
    }, {});
    let transferIndex = repaired.length - 1;
    if (
      types.size >= 2 &&
      repaired[transferIndex].type !== 'short_answer' &&
      counts[repaired[transferIndex].type] === 1
    ) {
      let safeIndex = -1;
      for (let index = repaired.length - 1; index >= 0; index--) {
        const question = repaired[index];
        if (question.type === 'short_answer' || (counts[question.type] ?? 0) > 1) {
          safeIndex = index;
          break;
        }
      }
      if (safeIndex >= 0) transferIndex = safeIndex;
    }
    const [candidate] = repaired.splice(transferIndex, 1);
    repaired.push(asTransferQuestion(candidate, outline, isChinese));
  }

  if (new Set(repaired.map((question) => question.type)).size < 2 && repaired.length >= 2) {
    repaired[0] = objectiveVarietyQuestion(outline, isChinese);
  }

  return repaired;
}
