'use client';

import { BrainCircuit, CheckCircle2, LoaderCircle, Send, Sparkles } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  createBrowserLearningEventId,
  recordClassroomLearningEvents,
  type BrowserLearningEvent,
  type ClassroomLearningEvaluationFeedback,
  type ClassroomLearningVerification,
} from '@/lib/learning/client/learning-events';
import type { Scene } from '@/lib/types/stage';
import { cn } from '@/lib/utils';

type PracticeKind = 'recall' | 'explain' | 'transfer';
type PracticeVerdict = 'revise' | 'partial' | 'passed';

interface MasteryView {
  estimate: number | null;
  confidence: number;
  evidenceCount: number;
  nextReviewAt?: string;
}

interface LearningCoachResult {
  mastery?: MasteryView;
  completedSceneIds?: string[];
  verification?: ClassroomLearningVerification;
}

const PRACTICE_COPY: Record<
  PracticeKind,
  { label: string; description: string; prompt: (scene: Scene) => string }
> = {
  recall: {
    label: '闭卷回忆',
    description: '不看课件，先从记忆中提取。',
    prompt: (scene) =>
      `关闭课堂内容，用自己的话写出“${scene.title || '这个场景'}”最重要的三个要点，以及一个仍不确定的问题。`,
  },
  explain: {
    label: '费曼解释',
    description: '向完全不了解的人讲明白。',
    prompt: (scene) =>
      `假设对方第一次接触这个主题，请解释“${scene.title || '这个场景'}”：它解决什么问题、如何工作、什么时候不适用？`,
  },
  transfer: {
    label: '迁移应用',
    description: '把方法用于一个新的真实情境。',
    prompt: (scene) =>
      `选择一个课堂中没有直接演示的新情境，使用“${scene.title || '这个场景'}”的方法解决它，并写下结果、证据和需要修正的地方。`,
  },
};

const VERDICT_SCORE: Record<PracticeVerdict, number> = {
  revise: 0.3,
  partial: 0.6,
  passed: 0.9,
};

export function ClassroomLearningCoach({
  classroomId,
  scenes,
  currentSceneId,
  onRecorded,
}: {
  readonly classroomId: string;
  readonly scenes: readonly Scene[];
  readonly currentSceneId?: string | null;
  readonly onRecorded: (result: LearningCoachResult) => void;
}) {
  const orderedScenes = useMemo(
    () => [...scenes].sort((left, right) => left.order - right.order),
    [scenes],
  );
  const [sceneId, setSceneId] = useState(currentSceneId ?? orderedScenes[0]?.id ?? '');
  const [kind, setKind] = useState<PracticeKind>('recall');
  const [response, setResponse] = useState('');
  const [practiceVerdict, setPracticeVerdict] = useState<PracticeVerdict>('partial');
  const [submitting, setSubmitting] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [evaluation, setEvaluation] = useState<ClassroomLearningEvaluationFeedback | null>(null);

  const scene = orderedScenes.find((item) => item.id === sceneId) ?? orderedScenes[0];
  if (!scene) return null;

  const submit = async () => {
    if (response.trim().length < 20 || submitting) return;
    setSubmitting(true);
    setError(null);
    setSaved(false);
    try {
      const now = new Date().toISOString();
      const stablePromptId = `${kind}:${classroomId}:${scene.id}`.slice(0, 160);
      const promptText = PRACTICE_COPY[kind].prompt(scene);
      const evidenceEvent: BrowserLearningEvent =
        kind === 'recall'
          ? {
              eventType: 'retrievalAttempted' as const,
              clientEventId: createBrowserLearningEventId('retrieval'),
              occurredAt: now,
              payload: {
                promptId: stablePromptId,
                promptText,
                response: response.trim(),
                sceneId: scene.id,
                score: VERDICT_SCORE[practiceVerdict],
              },
            }
          : kind === 'explain'
            ? {
                eventType: 'explanationSubmitted' as const,
                clientEventId: createBrowserLearningEventId('explanation'),
                occurredAt: now,
                payload: {
                  promptId: stablePromptId,
                  promptText,
                  response: response.trim(),
                  sceneId: scene.id,
                  score: VERDICT_SCORE[practiceVerdict],
                },
              }
            : {
                eventType: 'transferTaskCompleted' as const,
                clientEventId: createBrowserLearningEventId('transfer'),
                occurredAt: now,
                  payload: {
                    taskId: scene.id,
                    promptText,
                    sceneId: scene.id,
                    outcome: response.trim(),
                    score: VERDICT_SCORE[practiceVerdict],
                  },
              };
      const result = await recordClassroomLearningEvents(classroomId, [
        evidenceEvent,
        ...(kind === 'transfer'
          ? [
              {
                eventType: 'sceneCompleted' as const,
                clientEventId: `scene-completed:${classroomId}:${scene.id}`.slice(0, 160),
                occurredAt: now,
                payload: {
                  sceneId: scene.id,
                  sceneOrder: orderedScenes.findIndex((item) => item.id === scene.id),
                  completionKind: 'transfer-completed' as const,
                },
              },
            ]
          : []),
      ]);
        onRecorded({
          ...(result.mastery ? { mastery: result.mastery } : {}),
          ...(result.completion ? { completedSceneIds: result.completion.completedSceneIds } : {}),
          ...(result.verification ? { verification: result.verification } : {}),
        });
        const latestEvaluation = result.verification?.latestEvaluation ?? null;
        setEvaluation(latestEvaluation);
        if (latestEvaluation?.verdict === 'passed') setResponse('');
        setSaved(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法记录主动练习，请稍后重试。');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="rounded-xl border border-violet-200 bg-violet-50/60 p-4 dark:border-violet-900 dark:bg-violet-950/20">
      <div className="flex items-start gap-3">
        <span className="rounded-lg bg-violet-600 p-2 text-white">
          <BrainCircuit className="h-4 w-4" />
        </span>
        <div>
          <h3 className="text-sm font-semibold">主动练习：把“看过”变成“会用”</h3>
          <p className="mt-1 text-xs leading-5 text-slate-600 dark:text-slate-300">
            下面的回答会形成掌握证据；仅浏览和手动完成不会提高掌握度。
          </p>
        </div>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-[180px_1fr]">
        <label>
          <span className="mb-1.5 block text-xs font-medium">选择知识点</span>
          <select
            value={scene.id}
              onChange={(event) => {
                setSceneId(event.target.value);
                setSaved(false);
                setEvaluation(null);
              }}
            className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs dark:border-slate-700 dark:bg-slate-900"
          >
            {orderedScenes.map((item, index) => (
              <option key={item.id} value={item.id}>
                {index + 1}. {item.title || `场景 ${index + 1}`}
              </option>
            ))}
          </select>
        </label>
        <div>
          <span className="mb-1.5 block text-xs font-medium">选择验证方式</span>
          <div className="grid grid-cols-3 gap-1.5">
            {(Object.keys(PRACTICE_COPY) as PracticeKind[]).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={kind === value}
                onClick={() => {
                  setKind(value);
                  setSaved(false);
                  setEvaluation(null);
                }}
                className={cn(
                  'rounded-xl border px-2 py-2 text-xs font-medium transition',
                  kind === value
                    ? 'border-violet-500 bg-white text-violet-700 shadow-sm dark:bg-slate-900 dark:text-violet-300'
                    : 'border-transparent bg-violet-100/60 text-slate-600 hover:border-violet-300 dark:bg-violet-950/40 dark:text-slate-300',
                )}
              >
                {PRACTICE_COPY[value].label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-3 rounded-xl border border-violet-100 bg-white/80 p-3 text-xs leading-5 text-slate-700 dark:border-violet-900 dark:bg-slate-900/70 dark:text-slate-200">
        <div className="mb-1 flex items-center gap-1.5 font-medium text-violet-700 dark:text-violet-300">
          <Sparkles className="h-3.5 w-3.5" />
          {PRACTICE_COPY[kind].description}
        </div>
        {PRACTICE_COPY[kind].prompt(scene)}
      </div>

      <textarea
        value={response}
        onChange={(event) => {
          setResponse(event.target.value);
          setSaved(false);
        }}
        rows={5}
        maxLength={4_000}
        placeholder="先不看答案，写下你的思考……"
        className="mt-3 w-full resize-y rounded-xl border border-slate-200 bg-white p-3 text-sm leading-6 outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-100 dark:border-slate-700 dark:bg-slate-900 dark:focus:ring-violet-950"
      />

      <fieldset className="mt-3">
        <legend className="text-xs font-medium">
          {kind === 'transfer' ? '按实际结果自检' : '对照课堂要点后自检'}
        </legend>
        <div className="mt-1.5 grid grid-cols-3 gap-1.5">
          {(
            [
              ['revise', '需要重做'],
              ['partial', '基本正确'],
              ['passed', kind === 'transfer' ? '证据达标' : '完整准确'],
            ] as Array<[PracticeVerdict, string]>
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={practiceVerdict === value}
              onClick={() => setPracticeVerdict(value)}
              className={cn(
                'rounded-lg border px-2 py-2 text-xs transition',
                practiceVerdict === value
                  ? 'border-emerald-500 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300'
                  : 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900',
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[10px] leading-4 text-slate-500">
          自检只形成中等强度证据；带评分的练习、证据评估和迁移任务权重更高。
        </p>
      </fieldset>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11px] text-slate-500">
          至少写 20 个字；同一题反复提交会自动降低证据权重。
        </span>
        <button
          type="button"
          disabled={response.trim().length < 20 || submitting}
          onClick={() => void submit()}
          className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2 text-xs font-medium text-white transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:bg-slate-300 dark:disabled:bg-slate-700"
        >
          {submitting ? (
            <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
          ) : saved ? (
            <CheckCircle2 className="h-3.5 w-3.5" />
          ) : (
            <Send className="h-3.5 w-3.5" />
          )}
          {evaluation?.verdict === 'passed'
            ? '评审通过'
            : evaluation
              ? '已评审，可修订后重试'
              : saved
                ? '已记录证据'
                : '提交主动练习'}
        </button>
      </div>

      {evaluation && (
        <div
          className={cn(
            'mt-3 rounded-xl border p-3 text-xs leading-5',
            evaluation.verdict === 'passed'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200'
              : 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200',
          )}
        >
          <div className="font-semibold">
            {evaluation.verdict === 'passed'
              ? '服务端证据评审已通过'
              : evaluation.verdict === 'revise'
                ? '服务端评审：需要修订'
                : '服务端评审：尚未达标'}
            <span className="ml-2 font-normal opacity-75">
              分数 {Math.round(evaluation.score * 100)}% · 置信度{' '}
              {Math.round(evaluation.confidence * 100)}%
            </span>
          </div>
          {evaluation.corrections.length > 0 && (
            <div className="mt-2">
              <div className="font-medium">需要校正</div>
              <ul className="mt-1 list-disc space-y-1 pl-4">
                {evaluation.corrections.map((item, index) => (
                  <li key={`${item.misconception}-${index}`}>
                    {item.misconception} → {item.correction}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {evaluation.openQuestions.length > 0 && (
            <div className="mt-2">
              <div className="font-medium">补齐后再提交</div>
              <ul className="mt-1 list-disc space-y-1 pl-4">
                {evaluation.openQuestions.map((question) => (
                  <li key={question}>{question}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </div>
      )}
    </section>
  );
}
