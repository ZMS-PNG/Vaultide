'use client';

import { LEARNING_PROTOCOL_VERSION } from '@openmaic/learning-protocol';
import {
  CalendarClock,
  CheckCircle2,
  LoaderCircle,
  Pause,
  Play,
  Plus,
  RefreshCw,
  SlidersHorizontal,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import type {
  SynthesisMode,
  SynthesisRunView,
  SynthesisScheduleRecord,
  SynthesisScope,
} from '@/lib/learning/domain/synthesis';
import { SynthesisWriteback } from '@/components/learning/synthesis-writeback';

type ScheduleWire = Omit<
  SynthesisScheduleRecord,
  'nextRunAt' | 'lastSuccessAt' | 'createdAt' | 'updatedAt'
> & {
  nextRunAt: string;
  lastSuccessAt?: string;
  createdAt: string;
  updatedAt: string;
};

interface SynthesisSchedulePanelProps {
  mode: SynthesisMode;
  scope: SynthesisScope;
  onSnapshotsCreated?: (syntheses: SynthesisRunView[]) => Promise<void> | void;
}

const headers = {
  'Content-Type': 'application/json',
  'X-MAIC-Protocol-Version': LEARNING_PROTOCOL_VERSION,
};

function messageFrom(response: Response, body: { error?: { message?: string } }): Error {
  return new Error(body.error?.message || `Request failed (${response.status}).`);
}

async function json<T>(response: Response): Promise<T> {
  const body = (await response.json()) as T & { error?: { message?: string } };
  if (!response.ok) throw messageFrom(response, body);
  return body;
}

function defaultName(period: ScheduleWire['period']): string {
  switch (period) {
    case 'daily':
      return '每日知识归纳';
    case 'weekly':
      return '每周知识归纳';
    case 'monthly':
      return '每月知识归纳';
    case 'custom':
      return '自定义周期知识归纳';
  }
}

function periodLabel(period: ScheduleWire['period']): string {
  switch (period) {
    case 'daily':
      return '每日';
    case 'weekly':
      return '每周';
    case 'monthly':
      return '每月';
    case 'custom':
      return '自定义';
  }
}

function formatDate(value?: string): string {
  if (!value) return '尚未运行';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function scopeSummary(scope: SynthesisScope): string {
  const parts: string[] = [];
  if (scope.projectIds?.length) parts.push(`${scope.projectIds.length} 个项目`);
  if (scope.classroomIds?.length) parts.push(`${scope.classroomIds.length} 个课堂`);
  if (scope.domain) parts.push(`板块：${scope.domain}`);
  if (scope.domainQuery) parts.push(`关键词：${scope.domainQuery}`);
  if (scope.topicTags?.length) parts.push(`${scope.topicTags.length} 个标签`);
  if (scope.sourceType) parts.push(`来源：${scope.sourceType}`);
  if (scope.timeFrom || scope.timeTo) parts.push(`时间：${scope.timeFrom ?? '开始'} 至 ${scope.timeTo ?? '现在'}`);
  return parts.length ? parts.join(' · ') : '所有已持久化的学习资产';
}

export function SynthesisSchedulePanel({
  mode,
  scope,
  onSnapshotsCreated,
}: SynthesisSchedulePanelProps) {
  const [schedules, setSchedules] = useState<ScheduleWire[]>([]);
  const [name, setName] = useState('每周知识归纳');
  const [period, setPeriod] = useState<ScheduleWire['period']>('weekly');
  const [intervalMinutes, setIntervalMinutes] = useState(1440);
  const [timezone] = useState(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch {
      return 'UTC';
    }
  });
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [running, setRunning] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    const result = await json<{ schedules: ScheduleWire[] }>(
      await fetch('/api/v1/synthesis-schedules?limit=30', {
        headers: { 'X-MAIC-Protocol-Version': LEARNING_PROTOCOL_VERSION },
        cache: 'no-store',
      }),
    );
    setSchedules(result.schedules);
  };

  useEffect(() => {
    const refreshTimer = window.setTimeout(() => {
      void refresh()
        .catch((reason) => setError(reason instanceof Error ? reason.message : '无法读取归纳计划。'))
        .finally(() => setLoading(false));
    }, 0);
    return () => window.clearTimeout(refreshTimer);
  }, []);

  const createSchedule = async () => {
    setCreating(true);
    setError(null);
    setNotice(null);
    try {
      const result = await json<{ schedule: ScheduleWire }>(
        await fetch('/api/v1/synthesis-schedules', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            name: name.trim() || defaultName(period),
            period,
            ...(period === 'custom' ? { intervalMinutes } : {}),
            timezone,
            mode,
            scope,
          }),
          cache: 'no-store',
        }),
      );
      setSchedules((current) => {
        const rest = current.filter((schedule) => schedule.id !== result.schedule.id);
        return [result.schedule, ...rest];
      });
      setNotice('计划已保存。它会在你点击“检查到期计划”时生成新的归纳快照。');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法创建归纳计划。');
    } finally {
      setCreating(false);
    }
  };

  const patchSchedule = async (schedule: ScheduleWire, body: Record<string, unknown>) => {
    setUpdatingId(schedule.id);
    setError(null);
    setNotice(null);
    try {
      const result = await json<{ schedule: ScheduleWire }>(
        await fetch(`/api/v1/synthesis-schedules/${encodeURIComponent(schedule.id)}`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify(body),
          cache: 'no-store',
        }),
      );
      setSchedules((current) =>
        current.map((item) => (item.id === result.schedule.id ? result.schedule : item)),
      );
      setNotice(
        body.status ? '计划状态已更新。' : '计划范围已更新为当前筛选条件。',
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法更新归纳计划。');
    } finally {
      setUpdatingId(null);
    }
  };

  const runDue = async () => {
    setRunning(true);
    setError(null);
    setNotice(null);
    try {
      const response = await json<{
        result: { attempted: number; succeeded: number; skipped: number; failed: number; syntheses: SynthesisRunView[] };
      }>(
        await fetch('/api/v1/synthesis-schedules/run-due', {
          method: 'POST',
          headers,
          body: JSON.stringify({ limit: 10 }),
          cache: 'no-store',
        }),
      );
      await refresh();
      if (response.result.syntheses.length) await onSnapshotsCreated?.(response.result.syntheses);
      setNotice(
        `已检查 ${response.result.attempted} 个到期计划：生成 ${response.result.succeeded} 份，` +
          `无新证据跳过 ${response.result.skipped} 份，失败 ${response.result.failed} 份。`,
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法运行到期归纳计划。');
    } finally {
      setRunning(false);
    }
  };

  return (
    <section className="mt-4 rounded-2xl border border-violet-200 bg-violet-50/50 p-4 shadow-sm dark:border-violet-900/70 dark:bg-violet-950/20">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <CalendarClock className="h-4 w-4 text-violet-600 dark:text-violet-300" />
            <h2 className="text-sm font-semibold">周期归纳计划</h2>
          </div>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-600 dark:text-slate-300">
            计划只对当前筛选范围生效；到期时只比对新增或变化的学习证据。归纳快照不会直接改写
            Obsidian，仍需你单独确认写回。
          </p>
        </div>
        <button
          type="button"
          disabled={running}
          onClick={() => void runDue()}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-violet-600 px-3 text-xs font-medium text-white hover:bg-violet-700 disabled:opacity-60"
        >
          {running ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          检查到期计划
        </button>
      </div>

      <div className="mt-3 grid gap-2 rounded-xl border border-violet-100 bg-white/80 p-3 dark:border-violet-900/60 dark:bg-slate-950/30 md:grid-cols-[minmax(0,1fr)_130px_150px_auto]">
        <label className="min-w-0 text-xs">
          <span className="mb-1 block text-slate-500">计划名称</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="h-9 w-full rounded-lg border border-slate-200 bg-transparent px-2.5 text-sm dark:border-slate-700"
          />
        </label>
        <label className="text-xs">
          <span className="mb-1 block text-slate-500">周期</span>
          <select
            value={period}
            onChange={(event) => {
              const next = event.target.value as ScheduleWire['period'];
              setPeriod(next);
              setName((current) => (current === defaultName(period) ? defaultName(next) : current));
            }}
            className="h-9 w-full rounded-lg border border-slate-200 bg-transparent px-2 dark:border-slate-700"
          >
            <option value="daily">每日</option>
            <option value="weekly">每周</option>
            <option value="monthly">每月</option>
            <option value="custom">自定义</option>
          </select>
        </label>
        {period === 'custom' ? (
          <label className="text-xs">
            <span className="mb-1 block text-slate-500">分钟间隔（15–525600）</span>
            <input
              type="number"
              min={15}
              max={525600}
              value={intervalMinutes}
              onChange={(event) => setIntervalMinutes(Number(event.target.value))}
              className="h-9 w-full rounded-lg border border-slate-200 bg-transparent px-2.5 dark:border-slate-700"
            />
          </label>
        ) : (
          <div className="self-end pb-2 text-xs text-slate-500">{timezone}</div>
        )}
        <button
          type="button"
          disabled={creating}
          onClick={() => void createSchedule()}
          className="mt-auto inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-violet-200 bg-white px-3 text-xs font-medium text-violet-700 hover:bg-violet-100 disabled:opacity-60 dark:border-violet-800 dark:bg-slate-900 dark:text-violet-300"
        >
          {creating ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          保存计划
        </button>
      </div>
      <p className="mt-1.5 text-[11px] text-slate-500">当前范围：{scopeSummary(scope)}</p>

      {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/30 dark:text-red-300">{error}</p>}
      {notice && (
        <p className="mt-3 flex items-start gap-1.5 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">
          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {notice}
        </p>
      )}

      {loading ? (
        <div className="mt-3 flex items-center gap-2 text-xs text-slate-500">
          <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> 正在读取计划…
        </div>
      ) : schedules.length ? (
        <div className="mt-3 space-y-2">
          {schedules.map((schedule) => {
            const updating = updatingId === schedule.id;
            return (
              <div
                key={schedule.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3 text-xs dark:border-slate-800 dark:bg-slate-900"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{schedule.name}</span>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] dark:bg-slate-800">
                      {periodLabel(schedule.period)}{schedule.period === 'custom' ? ` · ${schedule.intervalMinutes} 分钟` : ''}
                    </span>
                    <span className={schedule.status === 'active' ? 'text-emerald-600' : 'text-slate-500'}>
                      {schedule.status === 'active' ? '启用中' : '已暂停'}
                    </span>
                  </div>
                  <p className="mt-1 truncate text-slate-500">范围：{scopeSummary(schedule.scope)}</p>
                  <p className="mt-1 text-slate-400">
                    下次：{formatDate(schedule.nextRunAt)} · 上次成功：{formatDate(schedule.lastSuccessAt)}
                  </p>
                  {schedule.lastError && <p className="mt-1 text-red-600">上次失败：{schedule.lastError}</p>}
                </div>
                <div className="flex shrink-0 flex-wrap gap-1.5">
                  <SynthesisWriteback scheduleId={schedule.id} compact />
                  <button
                    type="button"
                    disabled={updating}
                    onClick={() => void patchSchedule(schedule, { mode, scope })}
                    className="inline-flex h-8 items-center gap-1 rounded-md border border-slate-200 px-2 text-[11px] hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-800"
                    title="把这份计划更新为当前页面的归纳范围"
                  >
                    <SlidersHorizontal className="h-3 w-3" /> 使用当前范围
                  </button>
                  <button
                    type="button"
                    disabled={updating}
                    onClick={() =>
                      void patchSchedule(schedule, {
                        status: schedule.status === 'active' ? 'paused' : 'active',
                      })
                    }
                    className="inline-flex h-8 items-center gap-1 rounded-md border border-slate-200 px-2 text-[11px] hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-800"
                  >
                    {schedule.status === 'active' ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                    {schedule.status === 'active' ? '暂停' : '启用'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="mt-3 text-xs text-slate-500">尚未创建周期计划。先选择上方范围，再保存一个计划即可。</p>
      )}
    </section>
  );
}
