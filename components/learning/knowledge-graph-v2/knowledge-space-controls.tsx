'use client';

import { Boxes, Clock3, DatabaseZap, GitBranch, Layers3, ScanSearch } from 'lucide-react';
import { useMemo } from 'react';
import {
  KNOWLEDGE_SPACE_LENSES,
  type KnowledgeSpaceActionKind,
  type KnowledgeSpaceLens,
  type KnowledgeSpaceProjection,
} from '@/lib/learning/domain/knowledge-graph-v2/knowledge-space';

const LENS_ICON = {
  logic: GitBranch,
  domain: Boxes,
  source: DatabaseZap,
  time: Clock3,
} satisfies Record<KnowledgeSpaceLens, typeof GitBranch>;

const CLUSTER_DOT = [
  'bg-violet-500',
  'bg-cyan-500',
  'bg-amber-500',
  'bg-emerald-500',
  'bg-pink-500',
  'bg-blue-500',
];

const CLUSTER_ACTION = {
  review: {
    label: '到期复习',
    style: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200',
    priority: 6,
  },
  refresh: {
    label: '来源更新',
    style: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200',
    priority: 5,
  },
  reinforce: {
    label: '薄弱补强',
    style: 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200',
    priority: 4,
  },
  validate: {
    label: '建立证据',
    style: 'bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200',
    priority: 3,
  },
  transfer: {
    label: '迁移检验',
    style: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
    priority: 2,
  },
  maintain: {
    label: '持续巩固',
    style: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
    priority: 1,
  },
} satisfies Record<KnowledgeSpaceActionKind, { label: string; style: string; priority: number }>;

function masteryLabel(value: number | null): string {
  return value === null ? '掌握未知' : `平均掌握 ${Math.round(value * 100)}%`;
}

export function KnowledgeSpaceControls({
  projection,
  activeClusterId,
  onLensChange,
  onClusterChange,
}: {
  projection: KnowledgeSpaceProjection;
  activeClusterId: string | null;
  onLensChange: (lens: KnowledgeSpaceLens) => void;
  onClusterChange: (clusterId: string | null) => void;
}) {
  const insight = useMemo(() => {
    const urgent = [...projection.clusters].sort(
      (left, right) =>
        CLUSTER_ACTION[right.actionKind].priority - CLUSTER_ACTION[left.actionKind].priority ||
        right.reviewDueCount - left.reviewDueCount ||
        right.weakCount - left.weakCount ||
        right.unknownCount - left.unknownCount ||
        right.nodeCount - left.nodeCount,
    )[0];
    if (!urgent) return '当前筛选范围尚未形成可显示的知识簇。';
    return `当前形成 ${projection.clusters.length} 个离散知识簇；优先处理“${urgent.label}”：${urgent.nextAction}`;
  }, [projection.clusters]);
  const activeCluster =
    projection.clusters.find((cluster) => cluster.id === activeClusterId) ?? null;

  return (
    <section className="rounded-2xl border border-indigo-200 bg-gradient-to-br from-indigo-50 via-white to-cyan-50 p-3.5 dark:border-indigo-900 dark:from-indigo-950/30 dark:via-slate-950 dark:to-cyan-950/20">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-indigo-600 dark:text-indigo-300">
            <ScanSearch className="h-3.5 w-3.5" /> 多维知识逻辑空间
          </p>
          <h3 className="mt-1 text-base font-semibold">选择一个空间透镜</h3>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-600 dark:text-slate-300">
            同一批知识不只有一种坐标。切换透镜，观察逻辑阶段、主题岛、来源转化或时间演化。
          </p>
        </div>
        <div className="rounded-xl border border-indigo-200 bg-white/80 px-3 py-2 text-right dark:border-indigo-900 dark:bg-slate-950/70">
          <p className="text-[10px] text-slate-500">离散知识簇</p>
          <p className="mt-0.5 text-xl font-semibold text-indigo-700 dark:text-indigo-300">
            {projection.clusters.length}
          </p>
        </div>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4" aria-label="空间透镜">
        {(Object.keys(KNOWLEDGE_SPACE_LENSES) as KnowledgeSpaceLens[]).map((lens) => {
          const definition = KNOWLEDGE_SPACE_LENSES[lens];
          const Icon = LENS_ICON[lens];
          const selected = projection.lens === lens;
          return (
            <button
              key={lens}
              type="button"
              onClick={() => onLensChange(lens)}
              aria-pressed={selected}
              className={`min-h-16 rounded-xl border px-3 py-2.5 text-left transition ${
                selected
                  ? 'border-indigo-500 bg-indigo-600 text-white shadow-sm'
                  : 'border-slate-200 bg-white/85 hover:border-indigo-300 hover:bg-white dark:border-slate-700 dark:bg-slate-900/70'
              }`}
            >
              <span className="flex items-center gap-2 text-xs font-semibold">
                <Icon className="h-4 w-4" />
                {definition.label}
              </span>
              <span
                className={`mt-1.5 block text-[10px] leading-4 ${
                  selected ? 'text-indigo-100' : 'text-slate-500'
                }`}
              >
                {definition.shortDescription}
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-3 rounded-xl border border-indigo-100 bg-white/75 p-3 dark:border-indigo-900/70 dark:bg-slate-950/55">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-medium text-slate-700 dark:text-slate-200">
            {projection.definition.question}
          </p>
          {activeClusterId && (
            <button
              type="button"
              onClick={() => onClusterChange(null)}
              className="rounded-lg border border-indigo-200 px-2.5 py-1 text-[10px] font-medium text-indigo-700 hover:bg-indigo-50 dark:border-indigo-900 dark:text-indigo-300 dark:hover:bg-indigo-950/30"
            >
              返回全部空间
            </button>
          )}
        </div>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          {(
            [
              ['X', projection.definition.axes.x],
              ['Y', projection.definition.axes.y],
              ['Z', projection.definition.axes.z],
            ] as const
          ).map(([axis, definition]) => (
            <div
              key={axis}
              className="rounded-lg bg-slate-50 px-2.5 py-2 text-[10px] dark:bg-slate-900"
            >
              <span className="font-semibold text-indigo-600 dark:text-indigo-300">
                {axis} · {definition.label}
              </span>
              <span className="ml-1.5 text-slate-500">
                {definition.low} → {definition.high}
              </span>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[11px] leading-5 text-slate-600 dark:text-slate-300">{insight}</p>
        {activeCluster && (
          <div className="mt-3 grid gap-2 border-t border-indigo-100 pt-3 dark:border-indigo-900 sm:grid-cols-3">
            {[
              ['已掌握', activeCluster.learnedSummary],
              ['当前缺口', activeCluster.gapSummary],
              ['下一步', activeCluster.nextAction],
            ].map(([label, content]) => (
              <div key={label} className="rounded-lg bg-slate-50 px-3 py-2.5 dark:bg-slate-900">
                <p className="text-[10px] font-semibold text-indigo-600 dark:text-indigo-300">
                  {label}
                </p>
                <p className="mt-1 text-[11px] leading-5 text-slate-600 dark:text-slate-300">
                  {content}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mt-3 flex items-center gap-2 text-[11px] font-medium text-slate-600 dark:text-slate-300">
        <Layers3 className="h-3.5 w-3.5 text-indigo-500" />
        点击知识簇，只观察这一组节点及其内部关系
      </div>
      <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {projection.clusters.slice(0, 12).map((cluster, index) => {
          const selected = cluster.id === activeClusterId;
          const action = CLUSTER_ACTION[cluster.actionKind];
          return (
            <button
              key={cluster.id}
              type="button"
              onClick={() => onClusterChange(selected ? null : cluster.id)}
              aria-pressed={selected}
              className={`min-w-0 rounded-xl border p-2.5 text-left transition ${
                selected
                  ? 'border-indigo-500 bg-indigo-50 ring-1 ring-indigo-300 dark:bg-indigo-950/35'
                  : 'border-slate-200 bg-white/80 hover:border-indigo-300 dark:border-slate-700 dark:bg-slate-900/65'
              }`}
            >
              <span className="flex items-start gap-2">
                <span
                  className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${
                    CLUSTER_DOT[index % CLUSTER_DOT.length]
                  }`}
                />
                <span className="min-w-0">
                  <span className="flex flex-wrap items-start gap-1.5">
                    <span className="line-clamp-2 min-w-0 flex-1 text-xs font-semibold">
                      {cluster.label}
                    </span>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-medium ${action.style}`}
                    >
                      {action.label}
                    </span>
                  </span>
                  <span className="mt-1 block text-[10px] text-slate-500">
                    {cluster.nodeCount} 节点 · {cluster.evidenceCount} 证据 ·{' '}
                    {masteryLabel(cluster.averageMastery)}
                  </span>
                  <span className="mt-1.5 line-clamp-2 block text-[10px] leading-4 text-slate-600 dark:text-slate-300">
                    {cluster.nextAction}
                  </span>
                </span>
              </span>
            </button>
          );
        })}
      </div>
      {projection.clusters.length > 12 && (
        <p className="mt-2 text-[10px] text-slate-500">
          当前仅显示排序靠前的 12 个知识簇；可先用上方搜索或节点类型缩小范围。
        </p>
      )}
    </section>
  );
}
