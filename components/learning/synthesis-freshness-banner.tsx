'use client';

import { AlertTriangle, CheckCircle2, History, LoaderCircle, RefreshCw } from 'lucide-react';
import { useMemo } from 'react';
import {
  evaluateSynthesisFreshness,
  type SynthesisFreshnessStatus,
} from '@/lib/learning/domain/synthesis-freshness';
import type { SynthesisFilterOptions, SynthesisRunView } from '@/lib/learning/domain/synthesis';
import { cn } from '@/lib/utils';

const STATUS_COPY: Record<
  SynthesisFreshnessStatus,
  { title: string; description: string; icon: typeof CheckCircle2; tone: string }
> = {
  fresh: {
    title: '当前归纳仍然新鲜',
    description: '当前范围没有发现新增课堂或项目活动。',
    icon: CheckCircle2,
    tone: 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/25 dark:text-emerald-100',
  },
  review: {
    title: '建议复核这份归纳',
    description: '快照已有一段时间，重新归纳可以校准掌握度和关系。',
    icon: History,
    tone: 'border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-900 dark:bg-amber-950/25 dark:text-amber-100',
  },
  stale: {
    title: '发现范围内的新学习活动',
    description: '当前快照可能没有覆盖后来新增的课堂或项目变化。',
    icon: AlertTriangle,
    tone: 'border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100',
  },
  historical: {
    title: '正在查看历史归纳',
    description: '这是一份旧快照，可保留用于比较，也可以按原范围重新归纳。',
    icon: History,
    tone: 'border-slate-200 bg-slate-50 text-slate-900 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-100',
  },
};

export function SynthesisFreshnessBanner({
  synthesis,
  filters,
  isLatest,
  regenerating,
  onRegenerate,
}: {
  readonly synthesis: SynthesisRunView;
  readonly filters: SynthesisFilterOptions;
  readonly isLatest: boolean;
  readonly regenerating: boolean;
  readonly onRegenerate: () => void;
}) {
  const report = useMemo(
    () => evaluateSynthesisFreshness({ synthesis, filters, isLatest }),
    [filters, isLatest, synthesis],
  );
  const copy = STATUS_COPY[report.status];
  const Icon = copy.icon;
  const shouldRefresh = report.status !== 'fresh';

  return (
    <section aria-label="归纳新鲜度" className={cn('mb-4 rounded-xl border p-3.5', copy.tone)}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 rounded-lg bg-white/70 p-1.5 dark:bg-slate-950/35">
            <Icon className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold">{copy.title}</h3>
            <p className="mt-0.5 text-xs leading-5 opacity-75">{copy.description}</p>
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] opacity-75">
              <span>生成于 {synthesis.createdAt.slice(0, 16).replace('T', ' ')}</span>
              <span>
                证据覆盖 {report.coveredClassroomCount}/
                {report.scopedClassroomCount || synthesis.classroomCount}
                {report.coverageEstimated ? '（估算）' : ''}
              </span>
              {report.newClassroomCount > 0 && (
                <span>{report.newClassroomCount} 个课堂尚未覆盖</span>
              )}
              {report.changedProjectCount > 0 && (
                <span>{report.changedProjectCount} 个项目后来有活动</span>
              )}
            </div>
          </div>
        </div>
        <button
          type="button"
          disabled={regenerating}
          onClick={onRegenerate}
          className={cn(
            'inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-xl px-4 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-60',
            shouldRefresh
              ? 'bg-violet-600 text-white hover:bg-violet-700'
              : 'border border-current/15 bg-white/70 hover:bg-white dark:bg-slate-950/30 dark:hover:bg-slate-950/50',
          )}
        >
          {regenerating ? (
            <LoaderCircle className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          按原范围重新归纳
        </button>
      </div>
    </section>
  );
}
