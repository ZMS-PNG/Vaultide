'use client';

import {
  BookMarked,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  LoaderCircle,
  Network,
  Target,
} from 'lucide-react';
import Link from 'next/link';
import { useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import {
  OPEN_LEARNING_PROGRESS_EVENT,
  OPEN_OBSIDIAN_WRITEBACK_EVENT,
  getClassroomProgressSnapshot,
  openClassroomLearningPanel,
  recordClassroomSceneViewed,
  subscribeClassroomProgress,
} from '@/lib/learning/client/classroom-progress';
import {
  LEARNING_VERIFICATION_UPDATED_EVENT,
  learningVerificationStorageKey,
  parseLearningVerificationSnapshot,
} from '@/lib/learning/domain/learning-next-action';
import { readSubmittedState } from '@/lib/quiz/persistence';
import { useStageStore } from '@/lib/store';

export function ClassroomLearningDriver({ classroomId }: { readonly classroomId: string }) {
  const scenes = useStageStore((state) => state.scenes);
  const outlines = useStageStore((state) => state.outlines);
  const generationComplete = useStageStore((state) => state.generationComplete);
  const currentSceneId = useStageStore((state) => state.currentSceneId);
  const stage = useStageStore((state) => state.stage);
  const setCurrentSceneId = useStageStore((state) => state.setCurrentSceneId);
  const [advancing, setAdvancing] = useState(false);
  const [progressError, setProgressError] = useState<string | null>(null);
  const subscribe = useCallback(
    (onStoreChange: () => void) => subscribeClassroomProgress(classroomId, onStoreChange),
    [classroomId],
  );
  const getSnapshot = useCallback(() => getClassroomProgressSnapshot(classroomId), [classroomId]);
  const progressSnapshot = useSyncExternalStore(subscribe, getSnapshot, () => '[]');
  const subscribeVerification = useCallback(
    (onStoreChange: () => void) => {
      const handleVerification = (event: Event) => {
        const detail = (event as CustomEvent<{ classroomId?: string }>).detail;
        if (detail?.classroomId === classroomId) onStoreChange();
      };
      const handleStorage = (event: StorageEvent) => {
        if (event.key === learningVerificationStorageKey(classroomId)) onStoreChange();
      };
      window.addEventListener(LEARNING_VERIFICATION_UPDATED_EVENT, handleVerification);
      window.addEventListener('storage', handleStorage);
      return () => {
        window.removeEventListener(LEARNING_VERIFICATION_UPDATED_EVENT, handleVerification);
        window.removeEventListener('storage', handleStorage);
      };
    },
    [classroomId],
  );
  const getVerificationSnapshot = useCallback(() => {
    try {
      return localStorage.getItem(learningVerificationStorageKey(classroomId)) ?? '';
    } catch {
      return '';
    }
  }, [classroomId]);
  const verificationSerialized = useSyncExternalStore(
    subscribeVerification,
    getVerificationSnapshot,
    () => '',
  );
  const verification = useMemo(
    () => parseLearningVerificationSnapshot(verificationSerialized),
    [verificationSerialized],
  );
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

  const orderedScenes = useMemo(
    () => [...scenes].sort((left, right) => left.order - right.order),
    [scenes],
  );
  const completedSet = useMemo(() => new Set(completedSceneIds), [completedSceneIds]);
  const currentIndex = Math.max(
    0,
    orderedScenes.findIndex((scene) => scene.id === currentSceneId),
  );
  const currentScene = orderedScenes[currentIndex];
  const viewedCount = orderedScenes.filter((scene) => completedSet.has(scene.id)).length;
  const total = orderedScenes.length;
  const allScenesViewed = total > 0 && viewedCount === total;
  const currentSceneViewed = currentScene ? completedSet.has(currentScene.id) : false;
  const progressPercent = total > 0 ? Math.round((viewedCount / total) * 100) : 0;
  const nextScene = orderedScenes[currentIndex + 1];
  const coursePublished =
    generationComplete &&
    outlines.length >= 9 &&
    outlines.length <= 12 &&
    outlines.length === orderedScenes.length &&
    Boolean(stage?.learningContext?.generationJobId);
  const learningVerified = verification?.learningVerified === true;
  const evidenceCount = verification?.evidenceCount ?? 0;
  const learningGoal =
    stage?.learningContext?.goal?.trim() ||
    stage?.description?.trim() ||
    stage?.name ||
    '完成本课堂';

  if (total === 0) return null;

  const nextAction = learningVerified
    ? '查看归纳与沉淀'
    : allScenesViewed
      ? '完成最终迁移检验'
      : currentSceneViewed
        ? '进入下一场景'
        : '记录本场已浏览';

  const handlePrimaryAction = async () => {
    if (learningVerified || allScenesViewed || !currentScene) {
      openClassroomLearningPanel(OPEN_LEARNING_PROGRESS_EVENT, classroomId);
      return;
    }
    if (currentSceneViewed) {
      if (nextScene) setCurrentSceneId(nextScene.id);
      else openClassroomLearningPanel(OPEN_LEARNING_PROGRESS_EVENT, classroomId);
      return;
    }

    setAdvancing(true);
    setProgressError(null);
    try {
      await recordClassroomSceneViewed({
        classroomId,
        sceneId: currentScene.id,
        sceneOrder: currentIndex,
        completionKind:
          currentScene.type === 'quiz' && readSubmittedState(currentScene.id)
            ? 'quiz-submitted'
            : 'manual',
        completedSceneIds,
      });
      if (nextScene) setCurrentSceneId(nextScene.id);
      else openClassroomLearningPanel(OPEN_LEARNING_PROGRESS_EVENT, classroomId);
    } catch (reason) {
      setProgressError(
        reason instanceof Error ? reason.message : '无法同步当前场景，请稍后重试。',
      );
    } finally {
      setAdvancing(false);
    }
  };

  return (
    <aside
      aria-label="课堂学习驾驶条"
      className="fixed bottom-3 left-1/2 z-[75] w-[calc(100%_-_1.5rem)] max-w-6xl -translate-x-1/2 rounded-2xl border border-slate-200/90 bg-white/95 p-2 shadow-2xl shadow-slate-950/15 backdrop-blur-xl dark:border-slate-700 dark:bg-slate-900/95"
    >
      <div className="flex min-w-0 flex-col gap-2 lg:flex-row lg:items-center">
        <div className="hidden min-w-0 flex-1 items-center gap-3 px-1 md:flex">
          <span className="rounded-xl bg-violet-100 p-2 text-violet-700 dark:bg-violet-950 dark:text-violet-300">
            <Target className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[11px] font-medium text-slate-500">
              <span>当前学习目标</span>
              <span
                className={
                  coursePublished
                    ? 'rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                    : 'rounded-full bg-amber-100 px-2 py-0.5 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
                }
              >
                {coursePublished ? '课程已发布' : '发布状态未验证'}
              </span>
            </div>
            <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">
              {learningGoal}
            </p>
          </div>
        </div>

        <div className="min-w-0 flex-[1.15] rounded-xl bg-slate-50 px-3 py-2 dark:bg-slate-800/75">
          <div className="flex items-center justify-between gap-3 text-xs">
            <span className="truncate font-medium text-slate-700 dark:text-slate-200">
              正在浏览 {currentIndex + 1}/{total} ·{' '}
              {currentScene?.title || `场景 ${currentIndex + 1}`}
            </span>
            <span className="shrink-0 text-slate-500">
              已浏览 {viewedCount}/{total} · 有效证据 {evidenceCount}
            </span>
          </div>
          <div
            className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700"
            role="progressbar"
            aria-label="课堂场景浏览进度"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progressPercent}
          >
            <div
              className="h-full rounded-full bg-gradient-to-r from-violet-500 to-cyan-500 transition-[width]"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>

        <nav className="grid shrink-0 grid-cols-3 gap-1.5 sm:flex" aria-label="课堂下一步">
          <button
            type="button"
            disabled={advancing}
            onClick={() => void handlePrimaryAction()}
            className="col-span-3 inline-flex min-h-10 items-center justify-center gap-1.5 rounded-xl bg-violet-600 px-3 text-xs font-medium text-white transition hover:bg-violet-700 disabled:cursor-wait disabled:opacity-70 sm:col-span-1"
          >
            {advancing ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : allScenesViewed ? (
              <CheckCircle2 className="h-4 w-4" />
            ) : (
              <ClipboardCheck className="h-4 w-4" />
            )}
            下一步 · {nextAction}
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
          {learningVerified ? (
            <Link
              href={`/knowledge?classroomId=${encodeURIComponent(classroomId)}`}
              className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-xl border border-cyan-200 bg-cyan-50 px-3 text-xs font-medium text-cyan-800 transition hover:bg-cyan-100 dark:border-cyan-900 dark:bg-cyan-950/35 dark:text-cyan-200"
            >
              <Network className="h-4 w-4" /> 归纳
            </Link>
          ) : (
            <button
              type="button"
              disabled
              title="完成最终迁移检验后解锁正式归纳"
              className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-slate-100 px-3 text-xs font-medium text-slate-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-500"
            >
              <Network className="h-4 w-4" /> 归纳未解锁
            </button>
          )}
          <button
            type="button"
            disabled={!learningVerified}
            title={learningVerified ? '批准正式沉淀到 Obsidian' : '完成最终迁移检验后解锁正式沉淀'}
            onClick={() => {
              if (learningVerified) {
                openClassroomLearningPanel(OPEN_OBSIDIAN_WRITEBACK_EVENT, classroomId);
              }
            }}
            className={
              learningVerified
                ? 'inline-flex min-h-10 items-center justify-center gap-1.5 rounded-xl border border-violet-200 bg-violet-50 px-3 text-xs font-medium text-violet-800 transition hover:bg-violet-100 dark:border-violet-900 dark:bg-violet-950/35 dark:text-violet-200'
                : 'inline-flex min-h-10 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-slate-100 px-3 text-xs font-medium text-slate-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-500'
            }
          >
            <BookMarked className="h-4 w-4" /> {learningVerified ? '沉淀' : '沉淀未解锁'}
          </button>
        </nav>
      </div>
      {progressError && (
        <p className="mt-1 px-2 text-xs text-red-600 dark:text-red-300" role="alert">
          当前场景尚未记录：{progressError}
        </p>
      )}
    </aside>
  );
}
