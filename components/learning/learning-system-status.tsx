'use client';

import { LEARNING_PROTOCOL_VERSION } from '@openmaic/learning-protocol';
import {
  Activity,
  AlertTriangle,
  BookOpenCheck,
  CheckCircle2,
  ChevronDown,
  Database,
  FileCheck2,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { CopyWritebackCommand, WritebackSteps } from './writeback-steps';
import {
  productHealthStateLabel,
  type ProductHealthMetric,
  type ProductHealthSnapshot,
} from '@/lib/learning/domain/product-health';
import type { ObsidianBridgeState } from '@/lib/learning/domain/learning-session';

interface DraftView {
  id: string;
  revision: number;
  targetVaultName: string;
  operation: 'createManagedNote' | 'replaceVaultOverviewBlocks';
  relativePath: string;
  content: string;
}

async function responseJson<T>(response: Response): Promise<T> {
  const body = (await response.json()) as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(body.error?.message || `请求失败（${response.status}）`);
  return body;
}

const requestHeaders = {
  'X-MAIC-Protocol-Version': LEARNING_PROTOCOL_VERSION,
};

function tone(metric: ProductHealthMetric): string {
  if (metric.state === 'healthy') {
    return 'border-emerald-200/80 bg-emerald-50/65 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/25 dark:text-emerald-200';
  }
  if (metric.state === 'action-required') {
    return 'border-rose-200/80 bg-rose-50/65 text-rose-800 dark:border-rose-900 dark:bg-rose-950/25 dark:text-rose-200';
  }
  if (metric.state === 'warning') {
    return 'border-amber-200/80 bg-amber-50/65 text-amber-800 dark:border-amber-900 dark:bg-amber-950/25 dark:text-amber-200';
  }
  return 'border-slate-200 bg-slate-50/80 text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300';
}

function metricHeadline(key: string, metric: ProductHealthMetric): string {
  if (key === 'sources') {
    if (metric.failed > 0) return `${metric.failed} 条来源不可用`;
    if (metric.pending > 0) return `${metric.pending} 条来源待复核`;
    if (metric.succeeded > 0) return `${metric.succeeded} 条来源已验证`;
    return '尚未积累外部来源';
  }
  if (metric.failed > 0) return `${metric.failed} 次异常待处理`;
  if (metric.pending > 0) return `${metric.pending} 项正在处理`;
  if (metric.succeeded > 0) return `${metric.succeeded} 次运行成功`;
  return '近 7 天暂无运行记录';
}

function metricNextAction(key: string, metric: ProductHealthMetric): string {
  if (key === 'sources' && metric.failed > 0) return '替换或移除失效来源';
  if (key === 'sources' && metric.pending > 0) return '完成来源可用性复核';
  if (key === 'writeback' && metric.pending > 0) return '回到 Obsidian 核对并确认';
  if (metric.failed > 0) return '查看最近异常后重新运行';
  if (metric.pending > 0) return '等待当前任务完成';
  if (metric.succeeded > 0) return '无需操作';
  return '首次使用后开始记录';
}

interface LearningSystemStatusProps {
  readonly onStatusChange?: (summary: LearningSystemSummary) => void;
  readonly onWritebackQueued?: () => void;
  readonly variant?: 'card' | 'sidebar' | 'dialog-only';
  readonly open?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
}

export interface LearningSystemSummary {
  readonly attentionCount: number;
  readonly bridgeState: ObsidianBridgeState;
  readonly pendingWritebacks: number;
  readonly statusLabel: string;
}

export function LearningSystemStatus({
  onStatusChange,
  onWritebackQueued,
  variant = 'card',
  open: controlledOpen,
  onOpenChange,
}: LearningSystemStatusProps) {
  const [health, setHealth] = useState<ProductHealthSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [internalOpen, setInternalOpen] = useState(false);
  const [draft, setDraft] = useState<DraftView | null>(null);
  const [busy, setBusy] = useState(false);
  const [queued, setQueued] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const writebackOpen = controlledOpen ?? internalOpen;
  const setWritebackOpen = (next: boolean) => {
    setInternalOpen(next);
    onOpenChange?.(next);
  };

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/v1/product-health', {
        headers: requestHeaders,
        cache: 'no-store',
      });
      const result = await responseJson<{ health: ProductHealthSnapshot }>(response);
      setHealth(result.health);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法读取学习系统状态。');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  const createDraft = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/v1/vault-overview/writeback-drafts', {
        method: 'POST',
        headers: requestHeaders,
        cache: 'no-store',
      });
      const result = await responseJson<{ draft: DraftView }>(response);
      setDraft(result.draft);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法生成知洄总览草稿。');
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!writebackOpen || draft || busy || error || queued) return;
    const timer = window.setTimeout(() => void createDraft(), 0);
    return () => window.clearTimeout(timer);
  }, [busy, createDraft, draft, error, queued, writebackOpen]);

  const approve = async () => {
    if (!draft) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/v1/writeback-drafts/${encodeURIComponent(draft.id)}/approve`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-MAIC-Protocol-Version': LEARNING_PROTOCOL_VERSION,
          },
          body: JSON.stringify({ draftRevision: draft.revision }),
          cache: 'no-store',
        },
      );
      await responseJson(response);
      setQueued(true);
      onWritebackQueued?.();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法批准知洄总览回写。');
    } finally {
      setBusy(false);
    }
  };

  const metrics = health
    ? [
        { key: 'generation', label: '课堂生成', icon: BookOpenCheck, metric: health.generation },
        { key: 'synthesis', label: '知识归纳', icon: Activity, metric: health.synthesis },
        { key: 'writeback', label: 'Obsidian 回写', icon: FileCheck2, metric: health.writeback },
        { key: 'sources', label: '外部来源', icon: Database, metric: health.sources },
      ]
    : [];
  const attentionMetrics = metrics.filter(
    ({ metric }) => metric.state === 'warning' || metric.state === 'action-required',
  );
  const orderedAttentionMetrics = [...attentionMetrics].sort((left, right) => {
    const statePriority = { 'action-required': 2, warning: 1, healthy: 0, 'no-data': 0 };
    return statePriority[right.metric.state] - statePriority[left.metric.state];
  });
  const primaryAttention = orderedAttentionMetrics[0];
  const statusLabel = loading
    ? '正在检查学习闭环'
    : error && !health
      ? '状态暂不可用'
      : attentionMetrics.length > 0
        ? `${attentionMetrics.length} 项学习维护任务`
        : '学习闭环运行正常';
  const pendingWritebacks = health?.writeback.pending ?? 0;
  const bridgeState: ObsidianBridgeState = loading
    ? 'syncing'
    : error && !health
      ? 'offline'
      : (health?.writeback.failed ?? 0) > 0
        ? 'offline'
        : pendingWritebacks > 0 || attentionMetrics.length > 0
          ? 'attention'
          : 'online';

  useEffect(() => {
    onStatusChange?.({
      attentionCount: attentionMetrics.length,
      bridgeState,
      pendingWritebacks,
      statusLabel,
    });
  }, [attentionMetrics.length, bridgeState, onStatusChange, pendingWritebacks, statusLabel]);

  return (
    <>
      {variant !== 'dialog-only' && (
        <section
          aria-labelledby="learning-system-status-title"
          className={
            variant === 'sidebar'
              ? 'w-full rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm dark:border-slate-800 dark:bg-slate-900'
              : 'relative z-10 mt-3 w-full rounded-2xl border border-slate-200/80 bg-white/80 p-3 shadow-sm backdrop-blur dark:border-slate-800 dark:bg-slate-950/55'
          }
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <span
                className={`rounded-lg p-1.5 ${
                  attentionMetrics.some(({ metric }) => metric.state === 'action-required')
                    ? 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300'
                    : attentionMetrics.length > 0
                      ? 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
                      : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                }`}
              >
                {attentionMetrics.length > 0 ? (
                  <AlertTriangle className="h-4 w-4" />
                ) : (
                  <ShieldCheck className="h-4 w-4" />
                )}
              </span>
              <div className="min-w-0">
                <h2 id="learning-system-status-title" className="text-sm font-semibold">
                  {statusLabel}
                </h2>
                <p className="mt-0.5 text-[10px] leading-4 text-muted-foreground">
                  系统维护与学习任务分开显示，不影响今天的复习顺序。
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void refresh()}
              disabled={loading}
              aria-label="刷新学习闭环状态"
              title="刷新学习闭环状态"
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-slate-200 text-slate-500 transition hover:border-violet-300 hover:text-violet-600 disabled:opacity-60 dark:border-slate-700"
            >
              {loading ? (
                <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
            </button>
          </div>

          {health && primaryAttention && !detailsOpen && (
            <div className={`mt-3 rounded-xl border p-3 ${tone(primaryAttention.metric)}`}>
              <div className="flex items-start gap-2.5">
                <primaryAttention.icon className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[11px] font-semibold">{primaryAttention.label}</span>
                    <span className="rounded-full bg-white/65 px-2 py-0.5 text-[9px] font-medium dark:bg-slate-950/25">
                      {productHealthStateLabel(primaryAttention.metric.state)}
                    </span>
                  </div>
                  <p className="mt-1 text-xs font-semibold">
                    {metricHeadline(primaryAttention.key, primaryAttention.metric)}
                  </p>
                  <p className="mt-0.5 text-[10px] opacity-80">
                    下一步：{metricNextAction(primaryAttention.key, primaryAttention.metric)}
                  </p>
                </div>
              </div>
            </div>
          )}

          {health && !primaryAttention && !detailsOpen && (
            <div className="mt-3 flex items-center gap-2.5 rounded-xl border border-emerald-200/80 bg-emerald-50/65 p-3 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/25 dark:text-emerald-200">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <p className="text-[11px]">课堂、归纳、回写与来源检查均无待处理异常。</p>
            </div>
          )}

          {health && detailsOpen && (
            <div className="mt-3 space-y-2">
              {metrics.map(({ key, label, icon: Icon, metric }) => (
                <div key={key} className={`rounded-xl border px-3 py-2.5 ${tone(metric)}`}>
                  <div className="flex items-start gap-2.5">
                    <Icon className="mt-0.5 h-4 w-4 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] font-semibold">{label}</span>
                        <span className="text-[9px]">{productHealthStateLabel(metric.state)}</span>
                      </div>
                      <p className="mt-1 text-xs font-semibold">{metricHeadline(key, metric)}</p>
                      <p className="mt-0.5 text-[10px] opacity-80">
                        {metricNextAction(key, metric)}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="mt-3 flex items-center gap-2">
            {health && (
              <button
                type="button"
                aria-expanded={detailsOpen}
                onClick={() => setDetailsOpen((current) => !current)}
                className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-xl border border-slate-200 px-3 text-[11px] font-semibold transition hover:border-violet-300 hover:text-violet-700 dark:border-slate-700 dark:hover:border-violet-700 dark:hover:text-violet-200"
              >
                {detailsOpen ? '收起维护详情' : '查看全部维护'}
                <ChevronDown
                  className={`h-3.5 w-3.5 transition-transform ${detailsOpen ? 'rotate-180' : ''}`}
                />
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setWritebackOpen(true);
              }}
              className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-xl bg-slate-950 px-3 text-[11px] font-semibold text-white transition hover:bg-violet-700 dark:bg-white dark:text-slate-950 dark:hover:bg-violet-200"
            >
              <FileCheck2 className="h-3.5 w-3.5" /> 总览预览
            </button>
          </div>

          {!health && !loading && error && (
            <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
              {error}
            </div>
          )}
        </section>
      )}

      {writebackOpen && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
          <section className="flex max-h-[92dvh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-slate-900">
            <header className="flex items-start justify-between gap-4 border-b border-slate-200 p-5 dark:border-slate-800">
              <div>
                <div className="flex items-center gap-2 text-sm text-violet-600 dark:text-violet-400">
                  <ShieldCheck className="h-4 w-4" /> 稳定总览 · 双重确认
                </div>
                <h2 className="mt-1 text-xl font-semibold">知洄总览预览</h2>
                <p className="mt-1 text-sm leading-6 text-slate-500">
                  首次创建 Vaultide/知洄总览.md；以后只替换哈希一致的受管区块。
                  “我的补充”和所有原始笔记保持不变。
                </p>
              </div>
              <button
                type="button"
                onClick={() => setWritebackOpen(false)}
                aria-label="关闭"
                className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              <WritebackSteps currentStep={queued ? 3 : draft ? 2 : 1} />
              {busy && !draft && (
                <div className="flex min-h-48 items-center justify-center gap-2 text-sm text-slate-500">
                  <LoaderCircle className="h-5 w-5 animate-spin" /> 正在汇总学习资产…
                </div>
              )}
              {draft && !queued && (
                <div className="space-y-4">
                  <div className="rounded-xl border border-slate-200 p-3 text-sm dark:border-slate-700">
                    <div>目标 Vault：{draft.targetVaultName}</div>
                    <div className="mt-1 text-slate-500">
                      {draft.operation === 'createManagedNote' ? '首次创建' : '安全更新'} ·{' '}
                      {draft.relativePath}
                    </div>
                  </div>
                  <pre className="max-h-[52dvh] overflow-auto whitespace-pre-wrap rounded-xl bg-slate-950 p-4 text-xs leading-6 text-slate-100">
                    {draft.content}
                  </pre>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void approve()}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 py-3 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-60"
                  >
                    {busy && <LoaderCircle className="h-4 w-4 animate-spin" />} 批准并发送给
                    Obsidian
                  </button>
                </div>
              )}
              {queued && draft && (
                <div className="py-10 text-center">
                  <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-500" />
                  <h3 className="mt-3 text-lg font-semibold">知洄总览已加入安全队列</h3>
                  <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-500">
                    回到 Obsidian，执行下面的命令，核对路径后确认。
                  </p>
                  <CopyWritebackCommand />
                  <div className="mx-auto mt-4 max-w-2xl rounded-xl bg-slate-50 p-3 text-left text-xs dark:bg-slate-800">
                    {draft.relativePath}
                  </div>
                </div>
              )}
              {error && (
                <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
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
