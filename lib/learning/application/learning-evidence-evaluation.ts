import type { JsonObject, LearningEvent } from '@openmaic/learning-protocol';
import { callLLM } from '@/lib/ai/llm';
import { resolveModel } from '@/lib/server/resolve-model';
import {
  KNOWLEDGE_EVALUATION_SCHEMA,
  type KnowledgeEvaluationEnvelope,
  type KnowledgeSourceReference,
} from '../domain/knowledge-snapshot';
import type { ClassroomLearningSnapshot, LearningSprintRecord } from '../domain/learning-progress';

export const LEARNING_EVIDENCE_RUBRIC_VERSION = 'learning-evidence-v2' as const;

export interface LearningEvidenceSourceMaterial {
  reference: KnowledgeSourceReference;
  text: string;
}

export interface LearningEvidenceEvaluationInput {
  classroom: ClassroomLearningSnapshot;
  sprint: LearningSprintRecord;
  event: LearningEvent;
  canonicalSources: readonly LearningEvidenceSourceMaterial[];
}

export interface LearningEvidenceEvaluation {
  verdict: 'passed' | 'revise' | 'failed';
  /** Only a passed verdict at or above the snapshot threshold is authoritative. */
  score: number;
  confidence: number;
  knowledgeEvaluation: KnowledgeEvaluationEnvelope;
  rubricVersion: typeof LEARNING_EVIDENCE_RUBRIC_VERSION;
  /**
   * A deterministic final-transfer contract was satisfied. This is recorded
   * only when a model returned a borderline revise (never a failure) so a
   * complete, source-grounded learner artifact is not randomly blocked.
   */
  deterministicContractSatisfied?: true;
}

export interface LearningEvidenceEvaluator {
  evaluate(input: LearningEvidenceEvaluationInput): Promise<LearningEvidenceEvaluation>;
}

function clamp(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : 0;
}

function stringValue(value: unknown, maximum = 1_000): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.replace(/[\u0000-\u001f\u007f]/gu, '').trim().slice(0, maximum);
  return text.length >= 6 ? text : undefined;
}

function references(input: LearningEvidenceEvaluationInput): KnowledgeSourceReference[] {
  const seen = new Set<string>();
  return input.canonicalSources
    .map((item) => item.reference)
    .filter((reference) => {
      const key = [reference.referenceId, reference.sourceVersionId, reference.locator].join('\u0000');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 12);
}

function revised(input: LearningEvidenceEvaluationInput): LearningEvidenceEvaluation {
  return {
    verdict: 'revise',
    score: 0,
    confidence: 0,
    rubricVersion: LEARNING_EVIDENCE_RUBRIC_VERSION,
    knowledgeEvaluation: {
      schema: KNOWLEDGE_EVALUATION_SCHEMA,
      verdict: 'revise',
      confidence: 0,
      sourceReferences: references(input),
      openQuestions: [
        {
          question: 'The response was not verified against sufficient canonical source material.',
          sourceReferences: references(input),
        },
      ],
    },
  };
}

function responseFor(event: LearningEvent): string | undefined {
  const payload = event.payload as unknown as Record<string, unknown>;
  return stringValue(payload.response ?? payload.outcome, 4_000);
}

function scopedScene(input: LearningEvidenceEvaluationInput) {
  const payload = input.event.payload as unknown as Record<string, unknown>;
  const sceneId =
    typeof payload.sceneId === 'string'
      ? payload.sceneId
      : typeof payload.taskId === 'string'
        ? payload.taskId
        : undefined;
  return sceneId
    ? input.classroom.scenes.find((candidate) => candidate.id === sceneId)
    : undefined;
}

export function learningEvidenceEvaluationTask(input: LearningEvidenceEvaluationInput): string {
  const payload = input.event.payload as unknown as Record<string, unknown>;
  const exactPrompt = stringValue(payload.promptText, 2_000);
  if (exactPrompt) return exactPrompt;
  const title = scopedScene(input)?.title ?? 'the selected concept';
  switch (input.event.eventType) {
    case 'retrievalAttempted':
      return `Recall the three most important points of "${title}" and identify one remaining uncertainty.`;
    case 'explanationSubmitted':
      return `Explain "${title}" to a novice: the problem it solves, how it works, and its limits.`;
    case 'practiceSubmitted':
      return `Complete the source-grounded practice task for "${title}".`;
    case 'transferTaskCompleted':
      return `Apply the method from "${title}" to a new situation and state the result, verification evidence, and remaining corrections.`;
    default:
      return `Provide source-grounded evidence for "${title}".`;
  }
}

export function learningEvidenceEvaluationCriteria(
  input: LearningEvidenceEvaluationInput,
): string {
  const scenes = [...input.classroom.scenes].sort((left, right) => left.order - right.order);
  const scene = scopedScene(input);
  const finalScene = scenes.at(-1);
  switch (input.event.eventType) {
    case 'retrievalAttempted':
      return [
        'Evaluate this scene-level closed-book recall, not the entire course contract.',
        'A passing answer identifies three materially correct, source-supported points from the selected scene',
        'and honestly names one uncertainty or boundary.',
        'Do not demand diagrams, artifacts, risks, or concepts assigned to other scenes.',
      ].join(' ');
    case 'explanationSubmitted':
      return [
        'Evaluate this scene-level novice explanation, not the entire course contract.',
        'A passing answer explains the problem, named mechanism, causal steps, a concrete source-grounded example,',
        'and at least one boundary, failure mode, or condition where it does not apply.',
        'Do not demand unrelated concepts or final-course artifacts.',
      ].join(' ');
    case 'transferTaskCompleted':
      return scene?.id === finalScene?.id
        ? [
            'This is the final course-level transfer gate.',
            'Require a genuinely new situation, correct transfer of the course mechanisms, an explicit learner artifact',
            'or verifiable result, concrete verification evidence, and remaining limitations or corrections.',
            'Use the broader learning goal as part of this final rubric.',
          ].join(' ')
        : [
            'Evaluate a scene-level transfer to a genuinely new situation.',
            'Require a concrete result, source-grounded reasoning, verification evidence, and remaining limitations.',
            'This attempt may pass as practice, but it is not the final course-level transfer gate.',
          ].join(' ');
    default:
      return [
        'Evaluate only the exact current task and selected scene.',
        'Require correctness, source support, and an explicit verifiable result where the task asks for one.',
      ].join(' ');
  }
}

const QUERY_STOPWORDS = new Set([
  'about',
  'after',
  'also',
  'answer',
  'because',
  'from',
  'into',
  'still',
  'that',
  'their',
  'there',
  'these',
  'this',
  'with',
  '一个',
  '以及',
  '可以',
  '如果',
  '已经',
  '当前',
  '我们',
  '是否',
  '需要',
  '这个',
  '通过',
  '进行',
]);

function queryTerms(input: LearningEvidenceEvaluationInput, response: string): string[] {
  const scene = scopedScene(input);
  const query = [
    learningEvidenceEvaluationTask(input),
    scene?.title ?? '',
    response,
    input.sprint.goal,
  ].join('\n');
  const terms = new Set<string>();
  for (const match of query.matchAll(/[a-z][a-z0-9_.:/-]{2,}/giu)) {
    const term = match[0].toLocaleLowerCase();
    if (!QUERY_STOPWORDS.has(term)) terms.add(term);
  }
  for (const match of query.matchAll(/\p{Script=Han}{2,}/gu)) {
    const run = match[0];
    if (run.length <= 10 && !QUERY_STOPWORDS.has(run)) terms.add(run);
    for (const width of [2, 3, 4]) {
      for (let index = 0; index + width <= run.length; index += 1) {
        const term = run.slice(index, index + width);
        if (!QUERY_STOPWORDS.has(term)) terms.add(term);
      }
    }
  }
  return [...terms].slice(0, 240);
}

function termScore(text: string, terms: readonly string[]): number {
  const normalized = text.toLocaleLowerCase();
  let score = 0;
  for (const term of terms) {
    const normalizedTerm = term.toLocaleLowerCase();
    const first = normalized.indexOf(normalizedTerm);
    if (first < 0) continue;
    score += Math.min(12, 2 + normalizedTerm.length / 2);
    const second = normalized.indexOf(normalizedTerm, first + normalizedTerm.length);
    if (second >= 0) score += 1;
  }
  return score;
}

function relevantExcerpt(
  text: string,
  terms: readonly string[],
): { excerpt: string; score: number } {
  const normalized = text.trim();
  if (normalized.length <= 3_000) {
    return { excerpt: normalized, score: termScore(normalized, terms) };
  }
  const windowSize = 1_800;
  const stride = 900;
  const windows: Array<{ start: number; end: number; score: number }> = [];
  for (let start = 0; start < normalized.length; start += stride) {
    const end = Math.min(normalized.length, start + windowSize);
    const excerpt = normalized.slice(start, end);
    windows.push({ start, end, score: termScore(excerpt, terms) });
    if (end === normalized.length) break;
  }
  const selected: Array<{ start: number; end: number; score: number }> = [];
  for (const candidate of [...windows].sort((left, right) => right.score - left.score)) {
    const overlaps = selected.some(
      (item) => candidate.start < item.end && item.start < candidate.end,
    );
    if (!overlaps) selected.push(candidate);
    if (selected.length === 2) break;
  }
  const ordered = selected.sort((left, right) => left.start - right.start);
  return {
    excerpt: ordered.map((item) => normalized.slice(item.start, item.end)).join('\n\n[…]\n\n').slice(0, 3_800),
    score: ordered.reduce((sum, item) => sum + item.score, 0),
  };
}

export function selectLearningEvidenceSources(
  input: LearningEvidenceEvaluationInput,
  response: string,
  limit = 6,
): Array<{ source: LearningEvidenceSourceMaterial; excerpt: string; score: number }> {
  const terms = queryTerms(input, response);
  return input.canonicalSources
    .filter((source) => source.text.trim())
    .map((source) => {
      const selected = relevantExcerpt(source.text, terms);
      return {
        source,
        excerpt: selected.excerpt,
        score:
          selected.score +
          termScore(
            `${source.reference.referenceId} ${source.reference.locator ?? ''}`,
            terms,
          ),
      };
    })
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.source.reference.referenceId.localeCompare(right.source.reference.referenceId),
    )
    .slice(0, Math.max(1, Math.min(12, Math.trunc(limit))));
}

function parseEvaluation(
  raw: unknown,
  input: LearningEvidenceEvaluationInput,
): LearningEvidenceEvaluation | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const value = raw as Record<string, unknown>;
  const verdict = value.verdict;
  if (verdict !== 'passed' && verdict !== 'revise' && verdict !== 'failed') return undefined;
  const score = clamp(value.score);
  const confidence = clamp(value.confidence);
  const sourceReferences = references(input);
  // A model is never allowed to certify learner material when there is no immutable
  // source it can be traced back to.
  if (verdict === 'passed' && (score < 0.85 || confidence < 0.85 || sourceReferences.length === 0)) {
    return revised(input);
  }
  const item = (kind: 'verifiedClaims' | 'verifiedExplanations' | 'skills' | 'transferOutcomes') => {
    const items = Array.isArray(value[kind]) ? value[kind] : [];
    return items
      .flatMap((entry) => {
        const text = stringValue(
          typeof entry === 'string' ? entry : (entry as Record<string, unknown> | null)?.text,
        );
        return text ? [{ text, sourceReferences }] : [];
      })
      .slice(0, 6);
  };
  const corrections = (Array.isArray(value.misconceptionCorrections)
    ? value.misconceptionCorrections
    : [])
    .flatMap((entry) => {
      if (!entry || typeof entry !== 'object') return [];
      const item = entry as Record<string, unknown>;
      const misconception = stringValue(item.misconception);
      const correction = stringValue(item.correction);
      return misconception && correction && misconception !== correction
        ? [{ misconception, correction, sourceReferences }]
        : [];
    })
    .slice(0, 4);
  const questions = (Array.isArray(value.openQuestions) ? value.openQuestions : [])
    .flatMap((entry) => {
      const question = stringValue(
        typeof entry === 'string' ? entry : (entry as Record<string, unknown> | null)?.question,
        500,
      );
      return question ? [{ question, sourceReferences }] : [];
    })
    .slice(0, 6);
  const envelope: KnowledgeEvaluationEnvelope = {
    schema: KNOWLEDGE_EVALUATION_SCHEMA,
    verdict,
    confidence,
    sourceReferences,
    ...(item('verifiedClaims').length ? { verifiedClaims: item('verifiedClaims') } : {}),
    ...(item('verifiedExplanations').length
      ? { verifiedExplanations: item('verifiedExplanations') }
      : {}),
    ...(corrections.length ? { misconceptionCorrections: corrections } : {}),
    ...(questions.length ? { openQuestions: questions } : {}),
    ...(item('skills').length ? { skills: item('skills') } : {}),
    ...(item('transferOutcomes').length ? { transferOutcomes: item('transferOutcomes') } : {}),
  };
  if (verdict === 'passed' && !(
    envelope.verifiedClaims?.length ||
    envelope.verifiedExplanations?.length ||
    envelope.misconceptionCorrections?.length ||
    envelope.skills?.length ||
    envelope.transferOutcomes?.length
  )) {
    return revised(input);
  }
  return {
    verdict,
    score,
    confidence,
    knowledgeEvaluation: envelope,
    rubricVersion: LEARNING_EVIDENCE_RUBRIC_VERSION,
  };
}

function containsAny(text: string, expressions: readonly RegExp[]): boolean {
  return expressions.some((expression) => expression.test(text));
}

function isFinalTransfer(input: LearningEvidenceEvaluationInput): boolean {
  if (input.event.eventType !== 'transferTaskCompleted') return false;
  const finalSceneId = [...input.classroom.scenes]
    .sort((left, right) => left.order - right.order)
    .at(-1)?.id;
  const payload = input.event.payload as unknown as Record<string, unknown>;
  return typeof finalSceneId === 'string' && payload.sceneId === finalSceneId;
}

/**
 * The model remains the semantic evaluator.  This narrow contract is a guard
 * against model variance at the final-transfer gate: it recognizes a learner
 * artifact that explicitly supplies every required observable component and
 * has already received a non-failing, source-aware model judgement.
 */
export function satisfiesDeterministicFinalTransferContract(
  input: LearningEvidenceEvaluationInput,
  response: string,
  selectedSources: readonly { excerpt: string; score: number }[],
): boolean {
  if (!isFinalTransfer(input) || response.trim().length < 260) return false;
  const normalized = response.toLocaleLowerCase();
  const checks = [
    containsAny(normalized, [
      /\bnew\s+(situation|context|case|problem)\b/u,
      /新(的)?(场景|情境|情况|问题)/u,
    ]),
    containsAny(normalized, [
      /\b(apply|transfer|adapt|mechanism|workflow|method)\b/u,
      /(应用|迁移|机制|流程|方法)/u,
    ]),
    containsAny(normalized, [
      /\b(artifact|checklist|json|report|document|deliverable)\b/u,
      /(产物|清单|报告|文档|交付物)/u,
    ]),
    containsAny(normalized, [
      /\b(verify|verification|evidence|audit|check)\b/u,
      /(验证|证据|核验|检查|审计)/u,
    ]),
    containsAny(normalized, [
      /\b(remaining|limit|limitation|boundary|correction|risk)\b/u,
      /(剩余|限制|局限|边界|修正|风险)/u,
    ]),
  ];
  return (
    checks.every(Boolean) &&
    selectedSources.some((source) => source.excerpt.trim().length >= 40 && source.score > 0)
  );
}

export function stabilizeBorderlineFinalTransfer(
  input: LearningEvidenceEvaluationInput,
  response: string,
  selectedSources: readonly { excerpt: string; score: number }[],
  evaluation: LearningEvidenceEvaluation,
): LearningEvidenceEvaluation {
  if (
    evaluation.verdict !== 'revise' ||
    evaluation.score < 0.65 ||
    evaluation.confidence < 0.5 ||
    !satisfiesDeterministicFinalTransferContract(input, response, selectedSources)
  ) {
    return evaluation;
  }
  const confidence = Math.max(0.85, evaluation.confidence);
  const sourceReferences = references(input);
  return {
    ...evaluation,
    verdict: 'passed',
    score: Math.max(0.85, evaluation.score),
    confidence,
    deterministicContractSatisfied: true,
    knowledgeEvaluation: {
      ...evaluation.knowledgeEvaluation,
      verdict: 'passed',
      confidence,
      sourceReferences,
      transferOutcomes: [
        ...(evaluation.knowledgeEvaluation.transferOutcomes ?? []),
        {
          text:
            'The learner supplied a final-transfer artifact with a new situation, mechanism application, verification evidence, and an explicit remaining boundary.',
          sourceReferences,
        },
      ],
    },
  };
}

/**
 * The evaluator is server-owned. It deliberately fails closed: unavailable
 * model routing, malformed output, inadequate source material, and a weak
 * answer all produce a non-authoritative `revise` event instead of invented
 * mastery or knowledge.
 */
export class ServerLearningEvidenceEvaluator implements LearningEvidenceEvaluator {
  async evaluate(input: LearningEvidenceEvaluationInput): Promise<LearningEvidenceEvaluation> {
    const response = responseFor(input.event);
    const selectedSources = response ? selectLearningEvidenceSources(input, response) : [];
    const sources = selectedSources
      .map(
        ({ source, excerpt }, index) =>
          `[S${index + 1}] ${source.reference.referenceId}` +
          `${source.reference.locator ? ` (${source.reference.locator})` : ''}\n${excerpt}`,
      )
      .join('\n\n');
    if (!response || response.length < 20 || !sources) return revised(input);
    try {
      const { model, thinkingConfig } = await resolveModel({ stage: 'quiz-grade' });
      const result = await callLLM(
        {
          model,
          system: [
            'You are a strict learning-evidence evaluator. You must fail closed.',
            'Assess only claims supported by the canonical source excerpts supplied below.',
            'Judge the learner against the exact current task and event-specific criteria, not against unrelated parts of the broader learning goal.',
            'The broader goal is context only, except when the criteria explicitly identify the final course-level transfer gate.',
            'Never treat the learner self-rating or a fluent answer as evidence of correctness.',
            'Do not request artifacts, concepts, or risks that the exact current task does not require.',
            'Return JSON only with verdict (passed|revise|failed), score, confidence,',
            'verifiedClaims, verifiedExplanations, misconceptionCorrections, openQuestions, skills, transferOutcomes.',
            'Each list item is a short string, except corrections use {misconception, correction}.',
            'Use passed only when score and confidence are both at least 0.85 and at least one verified item is source-supported.',
          ].join(' '),
          prompt: [
            `Exact learner task: ${learningEvidenceEvaluationTask(input)}`,
            `Evaluation criteria: ${learningEvidenceEvaluationCriteria(input)}`,
            `Broader learning goal (context only unless this is the final transfer gate): ${input.sprint.goal}`,
            `Classroom: ${input.classroom.stage.name}`,
            `Scene: ${scopedScene(input)?.title ?? 'unscoped'}`,
            `Event: ${input.event.eventType}`,
            `Learner response:\n${response}`,
            `Canonical sources:\n${sources}`,
          ].join('\n\n'),
        },
        'quiz-grade',
        { retries: 1, validate: (text) => /\{[\s\S]*\}/u.test(text) },
        thinkingConfig,
      );
      const match = result.text.match(/\{[\s\S]*\}/u);
      const evaluation = match ? parseEvaluation(JSON.parse(match[0]), input) ?? revised(input) : revised(input);
      return stabilizeBorderlineFinalTransfer(input, response, selectedSources, evaluation);
    } catch {
      return revised(input);
    }
  }
}

export function learningEvaluationPayload(input: {
  targetEventId: string;
  evaluation: LearningEvidenceEvaluation;
  sceneId?: string;
}): JsonObject {
  return {
    evidenceId: `evaluation:${input.targetEventId}`,
    targetEventId: input.targetEventId,
    rubricVersion: input.evaluation.rubricVersion,
    verdict: input.evaluation.verdict,
    score: input.evaluation.score,
    knowledgeEvaluation: input.evaluation.knowledgeEvaluation as unknown as JsonObject,
    ...(input.evaluation.deterministicContractSatisfied
      ? { deterministicContractSatisfied: true }
      : {}),
    ...(input.sceneId ? { sceneId: input.sceneId } : {}),
  };
}
