'use client';

import {
  BookOpenCheck,
  Brain,
  CircleHelp,
  Clock3,
  Compass,
  RefreshCw,
  Route,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import type {
  KnowledgeGraphV2,
  KnowledgeNodeV2,
} from '@/lib/learning/domain/knowledge-graph-v2/contracts';
import {
  buildKnowledgeLearningPlan,
  summarizeKnowledgeLearning,
  type KnowledgeLearningActionKind,
} from '@/lib/learning/domain/knowledge-graph-v2/learning-navigation';

const KIND_LABEL: Record<KnowledgeLearningActionKind, string> = {
  review: '到期复习',
  weak: '薄弱知识',
  prerequisite: '先修知识',
  unknown: '需要检验',
  updated: '来源更新',
};

const KIND_STYLE: Record<KnowledgeLearningActionKind, string> = {
  review: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200',
  weak: 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200',
  prerequisite: 'bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200',
  unknown: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
  updated: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200',
};

type NavigationFilter = 'all' | 'review' | 'weak' | 'unknown' | 'updated';

export function KnowledgeLearningNavigator({
  graph,
  onSelect,
  onExplore,
}: {
  graph: KnowledgeGraphV2;
  onSelect: (node: KnowledgeNodeV2) => void;
  onExplore: (node: KnowledgeNodeV2) => void;
}) {
  const [filter, setFilter] = useState<NavigationFilter>('all');
  const summary = useMemo(() => summarizeKnowledgeLearning(graph), [graph]);
  const plan = useMemo(() => buildKnowledgeLearningPlan(graph, 12), [graph]);
  const visiblePlan = useMemo(
    () =>
      filter === 'all'
        ? plan.slice(0, 6)
        : plan.filter((item) => item.kind === filter).slice(0, 6),
    [filter, plan],
  );

  const filters: Array<{
    value: NavigationFilter;
    label: string;
    count: number;
    icon: typeof Compass;
  }> = [
    { value: 'all', label: '今日建议', count: plan.length, icon: Compass },
    { value: 'review', label: '到期复习', count: summary.reviewDue, icon: Clock3 },
    { value: 'weak', label: '薄弱知识', count: summary.weak, icon: Brain },
    { value: 'unknown', label: '需要检验', count: summary.unknown, icon: CircleHelp },
    { value: 'updated', label: '来源更新', count: summary.updated, icon: RefreshCw },
  ];

  return (
    <section
      className="rounded-2xl border border-violet-200 bg-gradient-to-br from-violet-50 via-white to-cyan-50 p-4 dark:border-violet-900 dark:from-violet-950/30 dark:via-slate-950 dark:to-cyan-950/20"
      aria-labelledby="knowledge-learning-title"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-violet-600 dark:text-violet-300">
            学习导航
          </p>
          <h3 id="knowledge-learning-title" className="mt-1 text-lg font-semibold">
            下一步学什么
          </h3>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-600 dark:text-slate-300">
            根据掌握证据、复习时间、先修关系和来源变化生成。先完成清单，再使用三维图探索关系。
          </p>
        </div>
        <div className="rounded-xl border border-violet-200 bg-white/80 px-3 py-2 text-right dark:border-violet-900 dark:bg-slate-950/60">
          <p className="text-[10px] text-slate-500">当前可执行建议</p>
          <p className="mt-0.5 text-xl font-semibold text-violet-700 dark:text-violet-300">
            {plan.length}
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-5" aria-label="学习建议筛选">
        {filters.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.value}
              type="button"
              onClick={() => setFilter(item.value)}
              aria-pressed={filter === item.value}
              className={`flex min-h-14 items-center justify-between rounded-xl border px-3 py-2 text-left transition ${
                filter === item.value
                  ? 'border-violet-500 bg-violet-600 text-white shadow-sm'
                  : 'border-slate-200 bg-white/80 hover:border-violet-300 hover:bg-white dark:border-slate-700 dark:bg-slate-900/70'
              }`}
            >
              <span className="inline-flex items-center gap-2 text-xs font-medium">
                <Icon className="h-4 w-4" />
                {item.label}
              </span>
              <span className="text-sm font-semibold">{item.count}</span>
            </button>
          );
        })}
      </div>

      <div className="mt-4 space-y-2">
        {visiblePlan.length === 0 ? (
          <div className="rounded-xl border border-dashed border-emerald-300 bg-emerald-50/70 p-4 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/20 dark:text-emerald-200">
            当前分类没有待处理项。可以切换到“今日建议”，或进入关系探索发现新的学习方向。
          </div>
        ) : (
          visiblePlan.map((item, index) => (
            <article
              key={item.node.id}
              className={`grid gap-3 rounded-xl border bg-white p-3 dark:bg-slate-950/70 md:grid-cols-[auto_minmax(0,1fr)_auto] md:items-center ${
                index === 0 && filter === 'all'
                  ? 'border-violet-400 shadow-sm'
                  : 'border-slate-200 dark:border-slate-700'
              }`}
            >
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-violet-100 text-sm font-semibold text-violet-700 dark:bg-violet-950 dark:text-violet-200">
                {index + 1}
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h4 className="truncate text-sm font-semibold">{item.node.label}</h4>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] ${KIND_STYLE[item.kind]}`}>
                    {KIND_LABEL[item.kind]}
                  </span>
                  {index === 0 && filter === 'all' && (
                    <span className="rounded-full bg-violet-600 px-2 py-0.5 text-[10px] text-white">
                      建议先学
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs leading-5 text-slate-600 dark:text-slate-300">
                  {item.reason}
                </p>
                <p className="mt-1 text-[10px] text-slate-500">
                  {item.node.mastery === null
                    ? '掌握度未知'
                    : `掌握度 ${Math.round(item.node.mastery * 100)}%`}
                  {' · '}
                  {item.node.evidenceCount} 条证据
                </p>
              </div>
              <div className="flex flex-wrap gap-2 md:justify-end">
                <button
                  type="button"
                  onClick={() => onSelect(item.node)}
                  className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-2 text-xs font-medium text-white hover:bg-violet-700"
                >
                  <BookOpenCheck className="h-3.5 w-3.5" />
                  查看学习依据
                </button>
                <button
                  type="button"
                  onClick={() => onExplore(item.node)}
                  className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-violet-200 px-3 py-2 text-xs text-violet-700 hover:bg-violet-50 dark:border-violet-900 dark:text-violet-300 dark:hover:bg-violet-950/30"
                >
                  <Route className="h-3.5 w-3.5" />
                  探索相关知识
                </button>
                {item.node.classroomIds[0] && (
                  <a
                    href={`/classroom/${encodeURIComponent(item.node.classroomIds[0])}`}
                    className="inline-flex min-h-9 items-center rounded-lg border border-cyan-200 px-3 py-2 text-xs text-cyan-700 hover:bg-cyan-50 dark:border-cyan-900 dark:text-cyan-300"
                  >
                    进入课堂
                  </a>
                )}
              </div>
            </article>
          ))
        )}
      </div>
    </section>
  );
}
