'use client';

import { LEARNING_PROTOCOL_VERSION } from '@openmaic/learning-protocol';
import { BookMarked, CheckCircle2, LoaderCircle, ShieldCheck, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { CopyWritebackCommand, WritebackSteps } from '@/components/learning/writeback-steps';

interface DraftView {
  id: string;
  revision: number;
  synthesisRunId?: string;
  targetVaultName: string;
  relativePath: string;
  content: string;
}

interface SynthesisWritebackCommonProps {
  readonly compact?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
  readonly onWritebackPending?: (count: number) => void;
  readonly onWritebackQueued?: () => void;
  readonly open?: boolean;
  readonly showLauncher?: boolean;
}

type SynthesisWritebackProps =
  | (SynthesisWritebackCommonProps & { synthesisId: string; scheduleId?: never })
  | (SynthesisWritebackCommonProps & { scheduleId: string; synthesisId?: never });

async function responseJson<T>(response: Response): Promise<T> {
  const body = (await response.json()) as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(body.error?.message || `请求失败（${response.status}）`);
  return body;
}

export function SynthesisWriteback(props: SynthesisWritebackProps) {
  const onOpenChange = props.onOpenChange;
  const onWritebackPending = props.onWritebackPending;
  const onWritebackQueued = props.onWritebackQueued;
  const isIndex = typeof props.scheduleId === 'string';
  const targetId = isIndex ? props.scheduleId : props.synthesisId;
  const title = isIndex ? '周期归纳索引预览' : '归纳笔记预览';
  const targetLabel = isIndex ? '周期归纳索引' : '归纳笔记';
  const buttonLabel = isIndex ? '更新归纳索引' : '沉淀到 Obsidian 归纳区';
  const description = isIndex
    ? '首次只会在 Vaultide/归纳/周期/索引 下创建一份索引；以后只更新其哈希一致的受管区块。历史快照与“我的补充”不会被修改。'
    : '只会在 Vaultide/归纳 下创建新笔记；网页批准后，Obsidian 仍会再次请你确认。';
  const [internalOpen, setInternalOpen] = useState(false);
  const [draft, setDraft] = useState<DraftView | null>(null);
  const [busy, setBusy] = useState(false);
  const [queued, setQueued] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = props.open ?? internalOpen;
  const setOpen = (next: boolean) => {
    setInternalOpen(next);
    onOpenChange?.(next);
  };

  const createDraft = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        isIndex
          ? `/api/v1/synthesis-schedules/${encodeURIComponent(targetId)}/index-drafts`
          : `/api/v1/syntheses/${encodeURIComponent(targetId)}/writeback-drafts`,
        {
          method: 'POST',
          headers: { 'X-MAIC-Protocol-Version': LEARNING_PROTOCOL_VERSION },
          cache: 'no-store',
        },
      );
      const result = await responseJson<{ draft: DraftView }>(response);
      setDraft(result.draft);
      onWritebackPending?.(1);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : `无法生成${targetLabel}草稿。`);
    } finally {
      setBusy(false);
    }
  }, [isIndex, onWritebackPending, targetId, targetLabel]);

  useEffect(() => {
    if (!open || draft || busy || error || queued) return;
    const timer = window.setTimeout(() => void createDraft(), 0);
    return () => window.clearTimeout(timer);
  }, [busy, createDraft, draft, error, open, queued]);

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
      setError(reason instanceof Error ? reason.message : `无法批准${targetLabel}写回。`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {props.showLauncher !== false && (
        <button
          type="button"
          onClick={() => {
            setOpen(true);
            if (!draft && !busy) void createDraft();
          }}
          className={
            props.compact
              ? 'inline-flex h-8 items-center gap-1 rounded-md border border-violet-200 bg-white px-2 text-[11px] font-medium text-violet-700 hover:bg-violet-100 dark:border-violet-800 dark:bg-slate-900 dark:text-violet-300'
              : 'inline-flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-violet-700'
          }
        >
          <BookMarked className={props.compact ? 'h-3 w-3' : 'h-4 w-4'} /> {buttonLabel}
        </button>
      )}
      {open && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
          <section className="flex max-h-[92dvh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-slate-900">
            <header className="flex items-start justify-between border-b border-slate-200 p-5 dark:border-slate-800">
              <div>
                <div className="flex items-center gap-2 text-sm text-violet-600 dark:text-violet-400">
                  <ShieldCheck className="h-4 w-4" /> 双重确认写回
                </div>
                <h2 className="mt-1 text-xl font-semibold">{title}</h2>
                <p className="mt-1 text-sm text-slate-500">{description}</p>
              </div>
              <button
                type="button"
                aria-label="关闭"
                onClick={() => setOpen(false)}
                className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              <WritebackSteps currentStep={queued ? 3 : draft ? 2 : 1} />

              {busy && !draft && (
                <div className="flex min-h-48 items-center justify-center gap-2 text-sm text-slate-500">
                  <LoaderCircle className="h-5 w-5 animate-spin" /> 正在生成受控草稿…
                </div>
              )}
              {draft && !queued && (
                <div className="space-y-4">
                  <div className="rounded-xl border border-slate-200 p-3 text-sm dark:border-slate-700">
                    <div>目标 Vault：{draft.targetVaultName}</div>
                    <div className="mt-1 break-all text-slate-500">{draft.relativePath}</div>
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
                  <h3 className="mt-3 text-lg font-semibold">{targetLabel}已加入安全队列</h3>
                  <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-500">
                    网页端已经完成。现在回到 Obsidian，打开命令面板执行下面的命令，
                    核对路径和内容后确认。
                  </p>
                  <CopyWritebackCommand />
                  <div className="mx-auto mt-4 max-w-2xl break-all rounded-xl bg-slate-50 p-3 text-left text-xs dark:bg-slate-800">
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
