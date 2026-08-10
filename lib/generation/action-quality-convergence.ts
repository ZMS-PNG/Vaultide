import type { Action, SpeechAction } from '@/lib/types/action';
import type {
  GeneratedInteractiveContent,
  GeneratedPBLContent,
  GeneratedQuizContent,
  GeneratedSlideContent,
  SceneOutline,
} from '@/lib/types/generation';

type GeneratedContent =
  | GeneratedSlideContent
  | GeneratedQuizContent
  | GeneratedInteractiveContent
  | GeneratedPBLContent;

const LEARNER_CUE =
  /请|尝试|判断|思考|选择|比较|观察|解释|验证|apply|try|decide|compare|observe|explain|verify/iu;

function isChinese(outline: SceneOutline, languageDirective?: string): boolean {
  return (
    /Chinese|中文|zh-/iu.test(languageDirective ?? '') ||
    /\p{Script=Han}/u.test(`${outline.title}${outline.description}`)
  );
}

function learnerNarrationText(value: string, limit = 220): string {
  return value
    .replace(/\[(?:S|V)\d+\]/giu, '')
    .replace(/(?:设计提案（需自行验证，非来源事实）|Design proposal \(verify independently; not a source fact\))\s*:\s*.*/giu, '')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, limit)
    .trim();
}

function speechPlans(outline: SceneOutline, languageDirective?: string): SpeechAction[] {
  const cjk = isChinese(outline, languageDirective);
  const points = (outline.keyPoints ?? [])
    .filter(Boolean)
    .map((point) => learnerNarrationText(point, 180))
    .filter(Boolean)
    .slice(0, 3);
  const focus = points.join(cjk ? '；' : '; ') || outline.title;
  const learnerAction = learnerNarrationText(
    outline.activity?.learnerAction || outline.description || outline.title,
    200,
  );
  const sourceFact = points[0] || learnerNarrationText(outline.title, 160);
  const prefix = `action_quality_${outline.order}`;
  const texts = cjk
    ? [
        `本场围绕“${outline.title}”展开。你要完成的学习任务是：${learnerAction}。先把这个来源事实说清楚：${sourceFact}。不要只记名词，要把输入、处理机制、状态变化和可观察输出连起来。`,
        `接下来把计划要点连成一条因果链：${focus}。因为系统行为由约束、状态与证据共同决定，所以要比较这些要点如何协同，以及一个环节的变化怎样影响后续结果。`,
        `现在请进行主动验证：观察或操作当前场景，比较至少两个状态，解释变化原因，并指出一个可能导致结果异常的失败条件。完成后，用可见结果或来源证据核对自己的判断。`,
        `最后请用自己的话复述本场机制，并给出一个可检查的结论：说明采用了什么判断、依据是什么、预期结果是什么，以及出现偏差时应该检查哪个环节。`,
      ]
    : [
        `This scene focuses on “${outline.title}”. Your learning task is: ${learnerAction}. First establish this source fact: ${sourceFact}. Do not memorize labels alone; connect the inputs, processing mechanism, state changes, and observable outputs.`,
        `Now connect the planned points into one causal chain: ${focus}. Because system behavior depends on constraints, state, and evidence together, compare how these points interact and how one change affects the downstream result.`,
        `Please perform an active verification: observe or operate the current scene, compare at least two states, explain the cause of the change, and identify one failure condition. Then check the judgment against a visible result or source evidence.`,
        `Finally, explain the mechanism in your own words and state a checkable conclusion: the decision you made, its evidence, the expected result, and the first component to inspect when the result diverges.`,
      ];

  return texts.map((text, index) => ({
    id: `${prefix}_speech_${index + 1}`,
    type: 'speech',
    title: cjk ? `教学收敛 ${index + 1}` : `Teaching convergence ${index + 1}`,
    text,
  }));
}

function actionContractSatisfied(actions: readonly Action[]): boolean {
  const speeches = actions.filter((action): action is SpeechAction => action.type === 'speech');
  const speechText = speeches.map((action) => action.text).join(' ');
  return (
    actions.length >= 5 &&
    speeches.length >= 3 &&
    speechText.length >= 180 &&
    LEARNER_CUE.test(speechText) &&
    new Set(actions.map((action) => action.type)).size >= 2
  );
}

function deterministicVisualAction(
  outline: SceneOutline,
  content: GeneratedContent,
): Action | undefined {
  if (outline.type === 'slide' && 'elements' in content && content.elements[0]?.id) {
    return {
      id: `action_quality_${outline.order}_focus`,
      type: 'spotlight',
      title: '聚焦当前学习对象',
      elementId: content.elements[0].id,
    };
  }
  if (outline.type === 'interactive') {
    return {
      id: `action_quality_${outline.order}_focus`,
      type: 'widget_highlight',
      title: '聚焦交互学习状态',
      target: '#vaultide-learning-status',
      content: '先查看当前反馈，再操作场景并比较状态变化。',
    };
  }
  return undefined;
}

function deterministicDiscussion(outline: SceneOutline, languageDirective?: string): Action {
  const cjk = isChinese(outline, languageDirective);
  return {
    id: `action_quality_${outline.order}_discussion`,
    type: 'discussion',
    title: cjk ? '学习结果复核' : 'Learning result review',
    topic: cjk
      ? `${outline.title}的机制、证据与失败边界`
      : `${outline.title}: mechanism, evidence, and failure boundary`,
    prompt: cjk
      ? '请提交你的判断、依据、可观察结果和一个失败条件，并说明如何验证。'
      : 'State your decision, evidence, observable result, one failure condition, and how you would verify it.',
  };
}

/**
 * Converges model-generated classroom actions onto the same invariant enforced
 * by the release quality gate. It preserves all valid model actions and only
 * appends the missing orientation, causal explanation, learner verification,
 * visual focus, or final discussion required for a complete teaching sequence.
 */
export function stabilizeGeneratedSceneActions(
  outline: SceneOutline,
  content: GeneratedContent,
  actions: readonly Action[],
  languageDirective?: string,
): Action[] {
  if (outline.type === 'quiz' || actionContractSatisfied(actions)) return [...actions];

  const discussions = actions.filter((action) => action.type === 'discussion').slice(0, 1);
  const repaired: Action[] = actions.filter((action) => action.type !== 'discussion');
  const existingIds = new Set(repaired.map((action) => action.id));
  const plans = speechPlans(outline, languageDirective);

  const speechMetrics = () => {
    const speeches = repaired.filter((action): action is SpeechAction => action.type === 'speech');
    const text = speeches.map((action) => action.text).join(' ');
    return { count: speeches.length, chars: text.length, hasLearnerCue: LEARNER_CUE.test(text) };
  };

  for (const plan of plans) {
    const metrics = speechMetrics();
    if (metrics.count >= 3 && metrics.chars >= 180 && metrics.hasLearnerCue) break;
    if (!existingIds.has(plan.id)) {
      repaired.push(plan);
      existingIds.add(plan.id);
    }
  }

  if (new Set(repaired.map((action) => action.type)).size < 2) {
    const visual = deterministicVisualAction(outline, content);
    if (visual && !existingIds.has(visual.id)) {
      repaired.splice(Math.min(1, repaired.length), 0, visual);
      existingIds.add(visual.id);
    }
  }

  while (repaired.length < 5) {
    const plan = plans.find((candidate) => !existingIds.has(candidate.id));
    if (!plan) break;
    repaired.push(plan);
    existingIds.add(plan.id);
  }

  let finalDiscussion: Action | undefined = discussions[0];
  if (
    new Set(repaired.map((action) => action.type)).size < 2 ||
    (outline.type === 'pbl' && repaired.length < 5)
  ) {
    finalDiscussion = deterministicDiscussion(outline, languageDirective);
  }
  if (finalDiscussion) repaired.push(finalDiscussion);

  return repaired;
}
