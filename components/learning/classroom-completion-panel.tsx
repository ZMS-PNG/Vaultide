'use client';

import {
  CheckCircle2,
  ChevronDown,
  Circle,
  ClipboardCheck,
  LoaderCircle,
  LockKeyhole,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { readSubmittedState } from '@/lib/quiz/persistence';
import { useStageStore } from '@/lib/store';
import type { Scene } from '@/lib/types/stage';
import { createLogger } from '@/lib/logger';
import { ClassroomLearningCoach } from '@/components/learning/classroom-learning-coach';
import {
  readClassroomLearningStatus,
  type ClassroomLearningVerification,
} from '@/lib/learning/client/learning-events';
import {
  OPEN_LEARNING_PROGRESS_EVENT,
  getClassroomProgressSnapshot,
  readPersistedCompletedScenes,
  recordClassroomSceneViewed,
  subscribeClassroomProgress,
  writePersistedCompletedScenes,
} from '@/lib/learning/client/classroom-progress';
import {
  LEARNING_VERIFICATION_UPDATED_EVENT,
  deriveLearningNextAction,
  learningVerificationSnapshot,
  learningVerificationStorageKey,
} from '@/lib/learning/domain/learning-next-action';

const log = createLogger('ClassroomCompletionPanel');

interface MasteryView {
  estimate: number | null;
  confidence: number;
  evidenceCount: number;
  evidenceTypes?: string[];
  evidenceSummary?: Array<{
    eventType: string;
    score: number;
  }>;
  nextReviewAt?: string;
  classroomId?: string;
  conceptId?: string;
  computedAt?: string;
}

export interface ClassroomCompletionSnapshot {
  readonly complete: boolean;
  readonly completedCount: number;
  readonly total: number;
}

function completionKind(scene: Scene): 'manual' | 'quiz-submitted' {
  return scene.type === 'quiz' && readSubmittedState(scene.id) ? 'quiz-submitted' : 'manual';
}

export function ClassroomCompletionPanel({
  classroomId,
  onCompletionChange,
  showLauncher = true,
}: {
  readonly classroomId: string;
  readonly onCompletionChange?: (snapshot: ClassroomCompletionSnapshot) => void;
  readonly showLauncher?: boolean;
}) {
  const scenes = useStageStore((state) => state.scenes);
  const currentSceneId = useStageStore((state) => state.currentSceneId);
  const learningContext = useStageStore((state) => state.stage?.learningContext);
  const coursePublished = useStageStore((state) => state.generationComplete);
  const [open, setOpen] = useState(false);
  const [mastery, setMastery] = useState<MasteryView | null>(null);
  const [verification, setVerification] = useState<ClassroomLearningVerification | null>(null);
  const [syncingSceneId, setSyncingSceneId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const orderedScenes = useMemo(
    () => [...scenes].sort((left, right) => left.order - right.order),
    [scenes],
  );
  const subscribe = useCallback(
    (onStoreChange: () => void) => subscribeClassroomProgress(classroomId, onStoreChange),
    [classroomId],
  );
  const getSnapshot = useCallback(() => getClassroomProgressSnapshot(classroomId), [classroomId]);
  const progressSnapshot = useSyncExternalStore(subscribe, getSnapshot, () => '[]');
  const completedSceneIds = useMemo(() => {
    try {
      const parsed = JSON.parse(progressSnapshot);
      return Array.isArray(parsed)
        ? parsed.filter((item): item is string => typeof item === 'string')
        : [];
    } catch {
      return [];
    }
  }, [progressSnapshot]);
  const completedSet = useMemo(() => new Set(completedSceneIds), [completedSceneIds]);
  const total = orderedScenes.length;
  const learningAction = useMemo(
    () =>
      deriveLearningNextAction({
        coursePublished,
        totalScenes: total,
        viewedSceneCount: completedSet.size,
        evidenceCount: verification?.passedEvaluationCount ?? 0,
        masteryEstimate:
          verification && verification.passedEvaluationCount > 0
            ? verification.authoritativeMastery
            : null,
        masteryConfidence: verification?.authoritativeConfidence ?? 0,
        transferEvidencePassed: verification?.transferPassed ?? false,
        serverVerified: verification?.learningVerified ?? false,
      }),
    [
      completedSet.size,
      coursePublished,
      total,
      verification,
    ],
  );

  useEffect(() => {
    onCompletionChange?.({
      complete: learningAction.learningVerified,
      completedCount: completedSet.size,
      total,
    });
  }, [completedSet.size, learningAction.learningVerified, onCompletionChange, total]);

  useEffect(() => {
    const snapshot = learningVerificationSnapshot(learningAction, {
      viewedSceneCount: completedSet.size,
      totalScenes: total,
      evidenceCount: verification?.passedEvaluationCount ?? 0,
    });
    try {
      localStorage.setItem(learningVerificationStorageKey(classroomId), JSON.stringify(snapshot));
    } catch {
      // Server state remains authoritative; this snapshot only coordinates classroom controls.
    }
    window.dispatchEvent(
      new CustomEvent(LEARNING_VERIFICATION_UPDATED_EVENT, {
        detail: { classroomId, snapshot },
      }),
    );
  }, [
    classroomId,
    completedSet.size,
    learningAction,
    total,
    verification?.passedEvaluationCount,
  ]);

  const refreshMastery = useCallback(async () => {
    try {
      const status = await readClassroomLearningStatus(classroomId);
      setMastery(status.mastery);
      setVerification(status.verification);
      writePersistedCompletedScenes(classroomId, status.completion.completedSceneIds);
    } catch (reason) {
      log.warn('Unable to refresh classroom mastery evidence:', reason);
    }
  }, [classroomId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refreshMastery();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [refreshMastery]);

  const refreshLocalProgress = useCallback(() => {
    const known = new Set(orderedScenes.map((scene) => scene.id));
    const persisted = readPersistedCompletedScenes(classroomId).filter((sceneId) =>
      known.has(sceneId),
    );
    const submittedQuizzes = orderedScenes
      .filter((scene) => scene.type === 'quiz' && readSubmittedState(scene.id))
      .map((scene) => scene.id);
    const next = [...new Set([...persisted, ...submittedQuizzes])];
    writePersistedCompletedScenes(classroomId, next);
  }, [classroomId, orderedScenes]);

  useEffect(() => {
    refreshLocalProgress();
  }, [refreshLocalProgress]);

  useEffect(() => {
    const handleOpen = (event: Event) => {
      const detail = (event as CustomEvent<{ classroomId?: string }>).detail;
      if (detail?.classroomId !== classroomId) return;
      refreshLocalProgress();
      void refreshMastery();
      setOpen(true);
    };
    window.addEventListener(OPEN_LEARNING_PROGRESS_EVENT, handleOpen);
    return () => window.removeEventListener(OPEN_LEARNING_PROGRESS_EVENT, handleOpen);
  }, [classroomId, refreshLocalProgress, refreshMastery]);

  const markSceneViewed = useCallback(
    async (scene: Scene) => {
      if (completedSet.has(scene.id) || syncingSceneId) return;
      const nextIds = orderedScenes
        .map((item) => item.id)
        .filter((sceneId) => sceneId === scene.id || completedSet.has(sceneId));
      setSyncingSceneId(scene.id);
      setError(null);
      try {
        await recordClassroomSceneViewed({
          classroomId,
          sceneId: scene.id,
          sceneOrder: orderedScenes.findIndex((item) => item.id === scene.id),
          completionKind: completionKind(scene),
          completedSceneIds: nextIds,
        });
        void refreshMastery();
      } catch (reason) {
        log.warn('Unable to record classroom browsing progress:', reason);
        setError(reason instanceof Error ? reason.message : '无法同步浏览进度，请稍后重试。');
      } finally {
        setSyncingSceneId(null);
      }
    },
    [classroomId, completedSet, orderedScenes, refreshMastery, syncingSceneId],
  );

  if (orderedScenes.length === 0) return null;

  return (
    <>
      {showLauncher && (
        <button
          type="button"
          onClick={() => {
            refreshLocalProgress();
            void refreshMastery();
            setOpen(true);
          }}
          className="fixed bottom-20 right-5 z-[70] inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-white/95 px-4 py-2.5 text-sm font-medium text-emerald-700 shadow-lg backdrop-blur transition hover:-translate-y-0.5 hover:bg-emerald-50 dark:border-emerald-900 dark:bg-slate-900/95 dark:text-emerald-300"
        >
          <ClipboardCheck className="h-4 w-4" /> 有效证据 {mastery?.evidenceCount ?? 0} 条
        </button>
      )}

      {open && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm">
          <section className="flex max-h-[90dvh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
            <header className="flex items-start justify-between gap-4 border-b border-slate-200 p-5 dark:border-slate-800">
              <div>
                <div className="flex items-center gap-2 text-sm font-medium text-emerald-600 dark:text-emerald-400">
                  <ClipboardCheck className="h-4 w-4" /> 学习进度与有效证据
                </div>
                <h2 className="mt-1 text-xl font-semibold">{learningAction.statusLabel}</h2>
                <p className="mt-1 text-sm leading-6 text-slate-500">
                  浏览记录只说明你看过哪些场景；测验、闭卷回忆、解释和迁移结果才是有效学习证据。
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="关闭学习进度"
                className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </header>

            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-5">
              {learningContext?.learningProject && (
                <section className="rounded-xl border border-violet-200 bg-violet-50/60 p-4 text-sm dark:border-violet-900 dark:bg-violet-950/20">
                  <div className="font-medium text-violet-800 dark:text-violet-200">
                    本次学习合同
                  </div>
                  <p className="mt-1 leading-6 text-slate-700 dark:text-slate-300">
                    {learningContext.goal}
                  </p>
                  <ul className="mt-2 grid gap-1 text-xs leading-5 text-slate-600 dark:text-slate-300 sm:grid-cols-3">
                    {learningContext.learningProject.successCriteria.map((criterion) => (
                      <li key={criterion} className="flex gap-1.5">
                        <Circle className="mt-1 h-3 w-3 shrink-0 text-violet-400" />
                        {criterion}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              <section
                className={
                  learningAction.learningVerified
                    ? 'rounded-xl border border-emerald-200 bg-emerald-50/70 p-4 text-sm dark:border-emerald-900 dark:bg-emerald-950/20'
                    : 'rounded-xl border border-amber-200 bg-amber-50/65 p-4 text-sm dark:border-amber-900 dark:bg-amber-950/20'
                }
              >
                <div className="flex items-start gap-3">
                  <span
                    className={
                      learningAction.learningVerified
                        ? 'rounded-lg bg-emerald-600 p-2 text-white'
                        : 'rounded-lg bg-amber-100 p-2 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
                    }
                  >
                    {learningAction.learningVerified ? (
                      <ShieldCheck className="h-4 w-4" />
                    ) : (
                      <LockKeyhole className="h-4 w-4" />
                    )}
                  </span>
                  <div className="min-w-0">
                    <div className="font-semibold">
                      {learningAction.learningVerified
                        ? '最终迁移检验已通过'
                        : '归纳与正式沉淀尚未解锁'}
                    </div>
                    <p className="mt-1 leading-6 text-slate-600 dark:text-slate-300">
                      {learningAction.learningVerified
                        ? '有效证据已达到标准线；现在可以正式归纳并批准写回 Obsidian。'
                        : '你可以先准备草稿；只有浏览完整、有效证据达标且最终迁移检验通过后，才会显示“学习已验证”。'}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                      <span className="rounded-full bg-white/80 px-2 py-1 dark:bg-slate-900/70">
                        已浏览场景 {completedSet.size}/{total}
                      </span>
                      <span className="rounded-full bg-white/80 px-2 py-1 dark:bg-slate-900/70">
                        已验证证据 {verification?.passedEvaluationCount ?? 0}/
                        {verification?.requiredEvaluationCount ?? 3}
                      </span>
                      <span className="rounded-full bg-white/80 px-2 py-1 dark:bg-slate-900/70">
                        迁移检验 {verification?.transferPassed ? '已通过' : '待通过'}
                      </span>
                    </div>
                  </div>
                </div>
              </section>

              <div className="rounded-xl bg-slate-50 p-4 text-sm leading-6 dark:bg-slate-800/70">
                <div className="flex items-center gap-2 font-medium text-slate-800 dark:text-slate-100">
                  <Sparkles className="h-4 w-4 text-violet-500" /> 有效学习证据
                </div>
                {mastery ? (
                  <div className="mt-2 space-y-1 text-slate-600 dark:text-slate-300">
                    <p>
                      {mastery.estimate === null
                        ? '尚无可用于估计掌握度的主动证据。'
                        : `当前估计：${Math.round(mastery.estimate * 100)}%，置信度 ${Math.round(mastery.confidence * 100)}%。`}
                    </p>
                    <p>已记录 {mastery.evidenceCount} 条主动学习证据。</p>
                    {mastery.nextReviewAt && <p>建议复习：{mastery.nextReviewAt.slice(0, 10)}</p>}
                  </div>
                ) : (
                  <p className="mt-2 text-slate-500">
                    完成一次主动练习后，这里会显示可解释的学习证据摘要。
                  </p>
                )}
              </div>

              <ClassroomLearningCoach
                classroomId={classroomId}
                scenes={orderedScenes}
                currentSceneId={currentSceneId}
                onRecorded={(result) => {
                  if (result.mastery) setMastery(result.mastery);
                  if (result.verification) setVerification(result.verification);
                  if (result.completedSceneIds) {
                    writePersistedCompletedScenes(classroomId, result.completedSceneIds);
                  }
                  void refreshMastery();
                }}
              />

              <details className="group rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
                  <span>
                    已浏览场景 · {completedSet.size}/{total}
                  </span>
                  <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                    按需展开
                    <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
                  </span>
                </summary>
                <ol className="space-y-2 border-t border-slate-200 p-3 dark:border-slate-700">
                  {orderedScenes.map((scene, index) => {
                    const done = completedSet.has(scene.id);
                    const busy = syncingSceneId === scene.id;
                    return (
                      <li key={scene.id}>
                        <button
                          type="button"
                          disabled={done || Boolean(syncingSceneId)}
                          onClick={() => void markSceneViewed(scene)}
                          className="flex w-full items-center gap-3 rounded-xl border border-slate-200 p-3 text-left transition hover:border-emerald-300 hover:bg-emerald-50 disabled:cursor-default disabled:hover:border-slate-200 disabled:hover:bg-transparent dark:border-slate-700 dark:hover:border-emerald-800 dark:hover:bg-emerald-950/20"
                        >
                          {busy ? (
                            <LoaderCircle className="h-5 w-5 shrink-0 animate-spin text-emerald-500" />
                          ) : done ? (
                            <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" />
                          ) : (
                            <Circle className="h-5 w-5 shrink-0 text-slate-300" />
                          )}
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-medium text-slate-800 dark:text-slate-100">
                              {index + 1}. {scene.title || `场景 ${index + 1}`}
                            </span>
                            <span className="mt-0.5 block text-xs text-slate-500">
                              {done
                                ? '已记录浏览'
                                : scene.type === 'quiz'
                                  ? '提交测验后会记录浏览，也可在此确认'
                                  : '看完后点击记录；这不会增加掌握度'}
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ol>
              </details>

              {error && (
                <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
                  {error}
                </div>
              )}
            </div>
          </section>
        </div>
      )}
    </>
  );
}
