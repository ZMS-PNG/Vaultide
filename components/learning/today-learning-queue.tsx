'use client';

import { LEARNING_PROTOCOL_VERSION } from '@openmaic/learning-protocol';
import {
  ArrowRight,
  BookOpenCheck,
  Brain,
  CalendarClock,
  CheckCircle2,
  Clock3,
  ListChecks,
  PanelLeftClose,
  Play,
  RefreshCw,
  Route,
  Sparkles,
  TimerReset,
} from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LineChart } from 'echarts/charts';
import { GridComponent, MarkPointComponent, TooltipComponent } from 'echarts/components';
import { graphic, init as initChart, use as registerCharts, type ECharts } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import type { StageListItem } from '@/lib/utils/stage-storage';
import {
  buildTodayLearningQueue,
  type TodayLearningMastery,
  type TodayLearningReview,
} from '@/lib/learning/domain/today-learning-queue';
import { LearningSystemStatus } from './learning-system-status';

registerCharts([LineChart, GridComponent, MarkPointComponent, TooltipComponent, CanvasRenderer]);

const KIND = {
  review: {
    label: '到期复习',
    icon: Clock3,
    style: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200',
  },
  weak: {
    label: '薄弱补强',
    icon: Brain,
    style: 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200',
  },
  transfer: {
    label: '迁移检验',
    icon: Route,
    style: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
  },
  continue: {
    label: '继续课堂',
    icon: BookOpenCheck,
    style: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-950 dark:text-cyan-200',
  },
} as const;

const TASK_MINUTES = {
  review: 8,
  weak: 12,
  transfer: 15,
  continue: 10,
} as const;

const requestHeaders = {
  'X-MAIC-Protocol-Version': LEARNING_PROTOCOL_VERSION,
};

async function learningJson<T>(response: Response): Promise<T> {
  const body = (await response.json()) as T & { error?: { message?: string } };
  if (!response.ok) {
    throw new Error(body.error?.message || `学习队列请求失败（${response.status}）`);
  }
  return body;
}

async function fetchTodayLearningData(): Promise<{
  reviews: TodayLearningReview[];
  mastery: TodayLearningMastery[];
}> {
  const [reviewResponse, masteryResponse] = await Promise.all([
    fetch('/api/v1/reviews?dueOnly=true&limit=20', {
      headers: requestHeaders,
      cache: 'no-store',
    }),
    fetch('/api/v1/mastery', {
      headers: requestHeaders,
      cache: 'no-store',
    }),
  ]);
  const [reviewBody, masteryBody] = await Promise.all([
    learningJson<{ reviews: TodayLearningReview[] }>(reviewResponse),
    learningJson<{ projections: TodayLearningMastery[] }>(masteryResponse),
  ]);
  return {
    reviews: reviewBody.reviews,
    mastery: masteryBody.projections,
  };
}

interface TodayLearningQueueProps {
  readonly classrooms: readonly StageListItem[];
  readonly onOpenChange?: (open: boolean) => void;
  readonly open?: boolean;
  readonly onSummaryChange?: (summary: TodayLearningQueueSummary) => void;
  readonly showLauncher?: boolean;
}

export interface TodayLearningQueueSummary {
  readonly attentionCount: number;
  readonly dueReviews: number;
  readonly weakConcepts: number;
}

export function TodayLearningQueue({
  classrooms,
  onOpenChange,
  open: controlledOpen,
  onSummaryChange,
  showLauncher = true,
}: TodayLearningQueueProps) {
  const [reviews, setReviews] = useState<TodayLearningReview[]>([]);
  const [mastery, setMastery] = useState<TodayLearningMastery[]>([]);
  const [loading, setLoading] = useState(true);
  const [remoteAvailable, setRemoteAvailable] = useState(true);
  const [internalOpen, setInternalOpen] = useState(false);
  const shouldReduceMotion = useReducedMotion();
  const open = controlledOpen ?? internalOpen;
  const setOpen = (next: boolean) => {
    setInternalOpen(next);
    onOpenChange?.(next);
  };

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchTodayLearningData();
      setReviews(data.reviews);
      setMastery(data.mastery);
      setRemoteAvailable(true);
    } catch {
      setRemoteAvailable(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetchTodayLearningData()
      .then((data) => {
        if (cancelled) return;
        setReviews(data.reviews);
        setMastery(data.mastery);
        setRemoteAvailable(true);
      })
      .catch(() => {
        if (!cancelled) setRemoteAvailable(false);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  const queue = useMemo(
    () =>
      buildTodayLearningQueue({
        reviews,
        mastery,
        classrooms,
        limit: 8,
      }),
    [classrooms, mastery, reviews],
  );

  const weakPoints = useMemo(() => {
    const projections = mastery
      .filter((item) => item.estimate !== null && item.estimate < 0.72)
      .sort((left, right) => (left.estimate ?? 1) - (right.estimate ?? 1))
      .map((item) => ({
        id: `${item.sprintId}:${item.conceptId}`,
        label: conceptLabel(item.conceptId, item.goal),
        mastery: Math.round((item.estimate ?? 0) * 100),
        evidence: item.evidenceCount,
      }))
      .filter((item, index, items) => items.findIndex(({ label }) => label === item.label) === index)
      .slice(0, 4);

    if (projections.length > 0) return projections;

    return reviews
      .filter((item) => item.masteryEstimate !== null)
      .sort((left, right) => (left.masteryEstimate ?? 1) - (right.masteryEstimate ?? 1))
      .map((item) => ({
        id: item.id,
        label: conceptLabel(item.conceptId, item.goal),
        mastery: Math.round((item.masteryEstimate ?? 0) * 100),
        evidence: item.masteryEvidenceCount,
      }))
      .filter((item, index, items) => items.findIndex(({ label }) => label === item.label) === index)
      .slice(0, 4);
  }, [mastery, reviews]);

  const weakPointCount = weakPoints.length;
  const taskClassroomCount = new Set(
    queue.items
      .map((item) => item.href.match(/^\/classroom\/([^/?#]+)/)?.[1])
      .filter((value): value is string => Boolean(value)),
  ).size;
  const estimatedMinutes = queue.items
    .slice(0, Math.min(3, queue.items.length))
    .reduce((sum, item) => sum + TASK_MINUTES[item.kind], 0);
  const firstTask = queue.items[0];
  const attentionCount = queue.summary.dueReviews + weakPointCount + queue.summary.transferNeeded;

  useEffect(() => {
    onSummaryChange?.({
      attentionCount,
      dueReviews: queue.summary.dueReviews,
      weakConcepts: weakPointCount,
    });
  }, [attentionCount, onSummaryChange, queue.summary.dueReviews, weakPointCount]);

  return (
    <>
      {showLauncher && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="打开继续学习侧栏"
          aria-expanded={open}
          className="fixed bottom-5 left-2 z-40 flex h-12 items-center gap-2 rounded-2xl border border-violet-200 bg-white/92 px-3 text-violet-700 shadow-xl shadow-violet-950/10 backdrop-blur-xl transition hover:-translate-y-0.5 hover:border-violet-300 hover:bg-white focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-violet-200 dark:border-violet-900 dark:bg-slate-900/92 dark:text-violet-200 dark:focus-visible:ring-violet-950 md:bottom-auto md:top-1/2 md:h-auto md:-translate-y-1/2 md:flex-col md:px-2.5 md:py-3"
        >
          <span className="relative">
            <CalendarClock className="h-5 w-5" />
            {attentionCount > 0 && (
              <span className="absolute -right-2.5 -top-2.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white">
                {Math.min(attentionCount, 9)}
              </span>
            )}
          </span>
          <span className="text-xs font-semibold md:[writing-mode:vertical-rl]">继续学习</span>
        </button>
      )}

      <AnimatePresence>
        {open && (
          <>
            <motion.button
              type="button"
              aria-label="关闭继续学习侧栏"
              className="fixed inset-0 z-[69] bg-slate-950/25 backdrop-blur-[2px]"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setOpen(false)}
            />
            <motion.aside
              id="today-learning-sidebar"
              aria-labelledby="today-learning-title"
              className="fixed inset-y-0 left-0 z-[70] flex w-[min(440px,94vw)] flex-col border-r border-white/80 bg-slate-50/96 shadow-2xl shadow-slate-950/20 backdrop-blur-2xl dark:border-slate-800 dark:bg-slate-950/96"
              initial={shouldReduceMotion ? { opacity: 0 } : { x: '-100%' }}
              animate={shouldReduceMotion ? { opacity: 1 } : { x: 0 }}
              exit={shouldReduceMotion ? { opacity: 0 } : { x: '-100%' }}
              transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            >
              <header className="flex items-start justify-between border-b border-slate-200/80 bg-gradient-to-br from-white via-white to-violet-50/60 px-5 py-5 dark:border-slate-800 dark:from-slate-950 dark:via-slate-950 dark:to-violet-950/20">
                <div>
                  <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-violet-600 dark:text-violet-300">
                    <Sparkles className="h-3.5 w-3.5" />
                    MEMORY DESK
                  </div>
                  <h2
                    id="today-learning-title"
                    className="mt-1.5 text-xl font-semibold tracking-tight"
                  >
                    记忆与复习
                  </h2>
                  <p className="mt-1 text-xs text-slate-500">
                    {queue.summary.dueReviews} 项到期 · {weakPointCount} 个薄弱点 ·{' '}
                    {taskClassroomCount} 个关联课堂
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="关闭继续学习侧栏"
                  className="rounded-xl p-2 text-slate-400 transition hover:bg-white hover:text-slate-900 hover:shadow-sm dark:hover:bg-slate-900 dark:hover:text-white"
                >
                  <PanelLeftClose className="h-5 w-5" />
                </button>
              </header>

              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
                <section className="overflow-hidden rounded-2xl border border-violet-200/80 bg-gradient-to-br from-violet-600 via-violet-600 to-cyan-600 p-4 text-white shadow-lg shadow-violet-950/10 dark:border-violet-800">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-violet-100">
                        <ListChecks className="h-3.5 w-3.5" />
                        TODAY&apos;S REVIEW
                      </div>
                      <h3 className="mt-1.5 text-base font-semibold">今日复习计划</h3>
                      <p className="mt-1 text-[11px] leading-5 text-violet-100">
                        {firstTask
                          ? `先完成“${firstTask.title.replace(/^(复习|补强|迁移检验|继续)：/u, '')}”，再按薄弱度继续。`
                          : '当前没有到期任务，可以开始一门新课堂。'}
                      </p>
                    </div>
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-white/15 px-2.5 py-1 text-[10px] font-semibold backdrop-blur">
                      <TimerReset className="h-3.5 w-3.5" />约 {estimatedMinutes || 10} 分钟
                    </span>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    <div className="rounded-xl bg-white/12 p-2.5 backdrop-blur">
                      <div className="text-lg font-semibold tabular-nums">
                        {queue.summary.dueReviews}
                      </div>
                      <div className="text-[9px] text-violet-100">到期知识点</div>
                    </div>
                    <div className="rounded-xl bg-white/12 p-2.5 backdrop-blur">
                      <div className="text-lg font-semibold tabular-nums">{weakPointCount}</div>
                      <div className="text-[9px] text-violet-100">薄弱知识点</div>
                    </div>
                    <div className="rounded-xl bg-white/12 p-2.5 backdrop-blur">
                      <div className="text-lg font-semibold tabular-nums">
                        {queue.summary.transferNeeded}
                      </div>
                      <div className="text-[9px] text-violet-100">迁移检验</div>
                    </div>
                  </div>
                  {firstTask && (
                    <a
                      href={firstTask.href}
                      className="mt-3 inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-white text-xs font-semibold text-violet-700 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
                    >
                      <Play className="h-3.5 w-3.5 fill-current" />
                      开始第 1 项
                    </a>
                  )}
                </section>

                <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold">遗忘曲线</h3>
                      <p className="mt-0.5 text-[10px] text-slate-500">
                        根据待复习量估算下一阶段记忆保持趋势
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void refresh()}
                      disabled={loading}
                      aria-label="刷新记忆与复习数据"
                      className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-slate-200 text-slate-500 transition hover:border-violet-300 hover:text-violet-600 disabled:opacity-50 dark:border-slate-700"
                    >
                      <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
                    </button>
                  </div>
                  <MemoryCurveChart
                    dueReviews={queue.summary.dueReviews}
                    weakConcepts={queue.summary.weakConcepts}
                  />
                  <p className="mt-1 text-[9px] leading-4 text-slate-400">
                    趋势用于安排复习优先级，不等同于认知测量结果。
                  </p>
                </section>

                <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                  <div className="flex items-center justify-between">
                    <h3 className="flex items-center gap-2 text-sm font-semibold">
                      <Brain className="h-4 w-4 text-rose-500" />
                      薄弱点
                    </h3>
                    <span className="text-[10px] text-slate-400">按掌握度排序</span>
                  </div>
                  <div className="mt-3 space-y-3">
                    {weakPoints.length > 0 ? (
                      weakPoints.map((point) => (
                        <div key={point.id}>
                          <div className="mb-1.5 flex items-center justify-between gap-3">
                            <span className="truncate text-xs font-medium text-slate-700 dark:text-slate-200">
                              {point.label}
                            </span>
                            <span className="shrink-0 text-[10px] tabular-nums text-slate-500">
                              {point.mastery}% · {point.evidence} 条证据
                            </span>
                          </div>
                          <div className="h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                            <motion.div
                              initial={{ width: 0 }}
                              animate={{ width: `${Math.max(6, point.mastery)}%` }}
                              className={
                                point.mastery < 45
                                  ? 'h-full rounded-full bg-rose-500'
                                  : 'h-full rounded-full bg-amber-500'
                              }
                            />
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="flex items-start gap-2 rounded-xl bg-emerald-50 p-3 text-xs text-emerald-800 dark:bg-emerald-950/25 dark:text-emerald-200">
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                        暂无明确薄弱点。完成一次课堂检验后，这里会显示掌握度与证据数量。
                      </div>
                    )}
                  </div>
                </section>

                <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-sm font-semibold">下一步记忆任务</h3>
                    <span className="text-[10px] text-slate-400">{queue.items.length} 项</span>
                  </div>
                  <div className="mt-3 space-y-2">
                    {!loading && queue.items.length === 0 ? (
                      <div className="flex items-start gap-2 rounded-xl bg-emerald-50 p-3 text-xs text-emerald-800 dark:bg-emerald-950/25 dark:text-emerald-200">
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                        目前没有待办。打开或生成课堂后，知洄会在这里安排复习与补强。
                      </div>
                    ) : (
                      queue.items.map((item, index) => {
                        const meta = KIND[item.kind];
                        const Icon = meta.icon;
                        return (
                          <a
                            key={item.id}
                            href={item.href}
                            className="group block rounded-xl border border-slate-200 bg-slate-50/65 p-3 transition hover:-translate-y-0.5 hover:border-violet-300 hover:bg-violet-50/50 hover:shadow-sm dark:border-slate-800 dark:bg-slate-950/55 dark:hover:border-violet-800 dark:hover:bg-violet-950/20"
                          >
                            <div className="flex items-start gap-3">
                              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white text-[10px] font-semibold text-violet-700 shadow-sm dark:bg-slate-900 dark:text-violet-300">
                                {index + 1}
                              </span>
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <span
                                    className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[9px] ${meta.style}`}
                                  >
                                    <Icon className="h-3 w-3" />
                                    {meta.label}
                                  </span>
                                  <span className="text-[9px] text-slate-400">
                                    约 {TASK_MINUTES[item.kind]} 分钟
                                  </span>
                                </div>
                                <p className="mt-1.5 line-clamp-1 text-xs font-semibold">
                                  {item.title}
                                </p>
                                <p className="mt-1 line-clamp-2 text-[10px] leading-4 text-slate-500">
                                  {item.description}
                                </p>
                              </div>
                              <span className="mt-0.5 inline-flex shrink-0 items-center gap-1 text-[10px] font-semibold text-violet-600 opacity-0 transition group-hover:opacity-100">
                                开始 <ArrowRight className="h-3.5 w-3.5" />
                              </span>
                            </div>
                          </a>
                        );
                      })
                    )}
                  </div>
                </section>

                {!remoteAvailable && !loading && (
                  <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-[10px] leading-4 text-amber-800 dark:border-amber-900 dark:bg-amber-950/25 dark:text-amber-200">
                    当前仅显示本机课堂；恢复学习数据服务后，会自动加入到期复习与薄弱知识。
                  </p>
                )}

                <LearningSystemStatus variant="sidebar" />
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  );
}

function MemoryCurveChart({
  dueReviews,
  weakConcepts,
}: {
  readonly dueReviews: number;
  readonly weakConcepts: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let chart: ECharts | null = null;
    let resizeObserver: ResizeObserver | null = null;

    const timer = window.setTimeout(() => {
      const container = containerRef.current;
      if (!container || container.clientWidth === 0 || container.clientHeight === 0) return;
      chart = initChart(container, undefined, { renderer: 'canvas' });
      const pressure = Math.min(22, dueReviews * 2.5 + weakConcepts * 3);
      const memory = [
        100,
        Math.max(55, 84 - pressure * 0.25),
        Math.max(42, 70 - pressure * 0.45),
        Math.max(28, 56 - pressure * 0.65),
        Math.max(18, 44 - pressure * 0.8),
      ];

      chart.setOption({
        animationDuration: 650,
        grid: { left: 8, right: 8, top: 18, bottom: 20, containLabel: true },
        xAxis: {
          type: 'category',
          boundaryGap: false,
          data: ['本次', '1 天', '3 天', '7 天', '14 天'],
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: { color: '#94a3b8', fontSize: 9 },
        },
        yAxis: {
          type: 'value',
          min: 0,
          max: 100,
          interval: 50,
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: { color: '#94a3b8', fontSize: 9, formatter: '{value}%' },
          splitLine: { lineStyle: { color: 'rgba(148,163,184,0.16)' } },
        },
        tooltip: {
          trigger: 'axis',
          valueFormatter: (value: unknown) =>
            typeof value === 'number' ? `${Math.round(value)}%` : String(value),
          backgroundColor: 'rgba(15,23,42,0.94)',
          borderWidth: 0,
          textStyle: { color: '#fff', fontSize: 11 },
        },
        series: [
          {
            type: 'line',
            data: memory,
            smooth: 0.45,
            symbol: 'circle',
            symbolSize: 6,
            lineStyle: { color: '#7c3aed', width: 3 },
            itemStyle: { color: '#7c3aed', borderColor: '#fff', borderWidth: 2 },
            areaStyle: {
              color: new graphic.LinearGradient(0, 0, 0, 1, [
                { offset: 0, color: 'rgba(124,58,237,0.28)' },
                { offset: 1, color: 'rgba(6,182,212,0.02)' },
              ]),
            },
            markPoint:
              dueReviews > 0
                ? {
                    symbol: 'pin',
                    symbolSize: 34,
                    label: { formatter: '复习', fontSize: 8, color: '#fff' },
                    itemStyle: { color: '#f59e0b' },
                    data: [{ coord: ['1 天', memory[1]] }],
                  }
                : undefined,
          },
        ],
      });

      resizeObserver = new ResizeObserver(() => chart?.resize());
      resizeObserver.observe(container);
    }, 360);

    return () => {
      window.clearTimeout(timer);
      resizeObserver?.disconnect();
      chart?.dispose();
    };
  }, [dueReviews, weakConcepts]);

  return <div ref={containerRef} className="mt-2 h-40 w-full" aria-label="预计遗忘曲线图" />;
}

function conceptLabel(conceptId: string, goal?: string): string {
  const withoutNamespace = conceptId.includes(':')
    ? conceptId.slice(conceptId.lastIndexOf(':') + 1)
    : conceptId;
  const normalized = withoutNamespace.replaceAll(/[_-]+/g, ' ').trim();
  const isOpaqueId = /^[A-Za-z0-9]{12,}$/.test(normalized) && !/\s/.test(normalized);
  if (
    normalized &&
    !isOpaqueId &&
    !/^(classroom|concept|knowledge|scene|待检验知识点)$/i.test(normalized)
  ) {
    return normalized;
  }
  const subject = goal
    ?.replaceAll(/https?:\/\/\S+/gu, '')
    .split(/[。！？；\n]/u)[0]
    ?.trim();
  return subject ? (subject.length > 28 ? `${subject.slice(0, 28)}…` : subject) : '待检验知识点';
}
