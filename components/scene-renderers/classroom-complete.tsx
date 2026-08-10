'use client';

import {
  BookOpenCheck,
  BrainCircuit,
  CheckCircle2,
  FileText,
  Gamepad2,
  HelpCircle,
  Puzzle,
} from 'lucide-react';
import { motion, MotionConfig, useReducedMotion } from 'motion/react';
import { useMemo } from 'react';
import {
  OPEN_LEARNING_PROGRESS_EVENT,
  openClassroomLearningPanel,
} from '@/lib/learning/client/classroom-progress';
import { useMediaStageId } from '@/lib/contexts/media-stage-context';
import { useI18n } from '@/lib/hooks/use-i18n';
import { useStageStore } from '@/lib/store';
import type { Scene, SceneType } from '@/lib/types/stage';
import { cn } from '@/lib/utils';

const SCENE_TYPE_ICONS: Record<SceneType, typeof FileText> = {
  slide: FileText,
  quiz: HelpCircle,
  interactive: Gamepad2,
  pbl: Puzzle,
};

const TYPE_ORDER: SceneType[] = ['slide', 'quiz', 'interactive', 'pbl'];

interface ClassroomCompletePageProps {
  readonly scenes: Scene[];
  readonly title: string;
  readonly onReturnToCourse?: () => void;
}

function sceneTypeLabel(type: SceneType, chinese: boolean): string {
  const labels: Record<SceneType, [string, string]> = {
    slide: ['讲解', 'Lessons'],
    quiz: ['测验', 'Quizzes'],
    interactive: ['互动', 'Activities'],
    pbl: ['项目任务', 'Projects'],
  };
  return labels[type][chinese ? 0 : 1];
}

export function ClassroomCompletePage({
  scenes,
  title,
  onReturnToCourse,
}: ClassroomCompletePageProps) {
  const { locale } = useI18n();
  const classroomId = useMediaStageId();
  const prefersReducedMotion = useReducedMotion();
  const chinese = locale.toLowerCase().startsWith('zh');
  const counts = useMemo(() => {
    const result: Partial<Record<SceneType, number>> = {};
    for (const scene of scenes) result[scene.type] = (result[scene.type] ?? 0) + 1;
    return result;
  }, [scenes]);
  const trailItems = TYPE_ORDER.filter((type) => (counts[type] ?? 0) > 0).map((type) => ({
    type,
    count: counts[type] ?? 0,
    Icon: SCENE_TYPE_ICONS[type],
  }));

  const copy = chinese
    ? {
        badge: '课程内容已准备',
        fallbackTitle: '课程已发布',
        explanation:
          '这里表示讲解内容已经发布，不代表你已经学会。浏览、有效学习证据和最终迁移检验是三个不同阶段。',
        nextTitle: '接下来完成真正的学习闭环',
        steps: [
          ['01', '浏览课程', '按场景理解概念、机制与证据。'],
          ['02', '主动提取', '闭卷回忆、解释或练习，形成有效学习证据。'],
          ['03', '迁移检验', '在新情境中正确应用后，学习才会被标记为已验证。'],
        ],
        returnLabel: '返回课程内容',
        evidenceLabel: '检查学习证据',
      }
    : {
        badge: 'Course content ready',
        fallbackTitle: 'Course published',
        explanation:
          'This means the lesson content is published, not that learning is complete. Browsing, valid evidence, and transfer verification are separate stages.',
        nextTitle: 'Complete the real learning loop',
        steps: [
          ['01', 'Browse', 'Understand each concept, mechanism, and supporting evidence.'],
          ['02', 'Retrieve', 'Recall, explain, or practise to create valid learning evidence.'],
          ['03', 'Transfer', 'Learning is verified only after correct use in a new situation.'],
        ],
        returnLabel: 'Return to course',
        evidenceLabel: 'Check learning evidence',
      };

  return (
    <MotionConfig reducedMotion={prefersReducedMotion ? 'always' : 'user'}>
      <section
        className="absolute inset-0 z-[105] overflow-auto bg-gradient-to-br from-slate-50 via-white to-violet-50/70 px-5 py-8 dark:from-slate-950 dark:via-slate-900 dark:to-violet-950/30"
        aria-label={copy.badge}
      >
        <div className="mx-auto flex min-h-full w-full max-w-5xl items-center justify-center">
          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.42, ease: [0.16, 1, 0.3, 1] }}
            className="w-full rounded-3xl border border-slate-200/90 bg-white/95 p-6 shadow-2xl shadow-slate-950/10 backdrop-blur md:p-9 dark:border-slate-700 dark:bg-slate-900/95"
          >
            <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
              <div className="max-w-2xl">
                <div className="inline-flex items-center gap-2 rounded-full border border-violet-200 bg-violet-50 px-3 py-1.5 text-xs font-semibold text-violet-700 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-300">
                  <BookOpenCheck className="h-4 w-4" />
                  {copy.badge}
                </div>
                <h2 className="mt-4 text-2xl font-bold leading-tight text-slate-950 md:text-4xl dark:text-white">
                  {title || copy.fallbackTitle}
                </h2>
                <p className="mt-3 max-w-xl text-sm leading-7 text-slate-600 md:text-base dark:text-slate-300">
                  {copy.explanation}
                </p>
              </div>

              <div className="grid shrink-0 grid-cols-2 gap-2 sm:grid-cols-4 lg:max-w-md lg:grid-cols-2">
                {trailItems.map(({ type, count, Icon }) => (
                  <div
                    key={type}
                    className="min-w-28 rounded-2xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/80"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <Icon className="h-4 w-4 text-violet-500" />
                      <span className="text-xl font-semibold text-slate-900 dark:text-white">
                        {count}
                      </span>
                    </div>
                    <div className="mt-2 text-xs text-slate-500">
                      {sceneTypeLabel(type, chinese)}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="my-7 h-px bg-slate-200 dark:bg-slate-700" />

            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
                <BrainCircuit className="h-4 w-4 text-cyan-600 dark:text-cyan-400" />
                {copy.nextTitle}
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-3">
                {copy.steps.map(([number, label, description], index) => (
                  <motion.div
                    key={number}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.08 + index * 0.06 }}
                    className={cn(
                      'rounded-2xl border p-4',
                      index === 2
                        ? 'border-cyan-200 bg-cyan-50/70 dark:border-cyan-900 dark:bg-cyan-950/20'
                        : 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900',
                    )}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-xs font-semibold tracking-wider text-violet-600 dark:text-violet-300">
                        {number}
                      </span>
                      {index === 2 && <CheckCircle2 className="h-4 w-4 text-cyan-600" />}
                    </div>
                    <div className="mt-3 font-semibold text-slate-900 dark:text-white">{label}</div>
                    <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">
                      {description}
                    </p>
                  </motion.div>
                ))}
              </div>
            </div>

            <div className="mt-7 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={onReturnToCourse}
                className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                {copy.returnLabel}
              </button>
              <button
                type="button"
                disabled={!classroomId}
                onClick={() => {
                  if (classroomId) {
                    openClassroomLearningPanel(OPEN_LEARNING_PROGRESS_EVENT, classroomId);
                  }
                }}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-violet-600 px-5 text-sm font-medium text-white transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:bg-slate-300 dark:disabled:bg-slate-700"
              >
                <BrainCircuit className="h-4 w-4" />
                {copy.evidenceLabel}
              </button>
            </div>
          </motion.div>
        </div>
      </section>
    </MotionConfig>
  );
}

export function ClassroomCompletePageConnected() {
  const stage = useStageStore((state) => state.stage);
  const scenes = useStageStore((state) => state.scenes);
  const setCurrentSceneId = useStageStore((state) => state.setCurrentSceneId);
  const firstSceneId = [...scenes].sort((left, right) => left.order - right.order)[0]?.id;
  return (
    <ClassroomCompletePage
      scenes={scenes}
      title={stage?.name ?? ''}
      onReturnToCourse={() => {
        if (firstSceneId) setCurrentSceneId(firstSceneId);
      }}
    />
  );
}
