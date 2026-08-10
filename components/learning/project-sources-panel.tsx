'use client';

import { LEARNING_PROTOCOL_VERSION } from '@openmaic/learning-protocol';
import { ExternalLink, FileSearch, LoaderCircle, RefreshCw, ShieldCheck, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  researchFreshness,
  researchFreshnessLabel,
  sourceAuthorityLabel,
  sourceAvailabilityLabel,
  type ResearchSourceHealth,
} from '@/lib/learning/domain/source-quality';
import { useStageStore } from '@/lib/store';

async function responseJson<T>(response: Response): Promise<T> {
  const body = (await response.json()) as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(body.error?.message || `请求失败（${response.status}）`);
  return body;
}

function availabilityTone(value: ResearchSourceHealth['availability']): string {
  if (value === 'available' || value === 'redirected') {
    return 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300';
  }
  if (value === 'unreachable' || value === 'unsafe') {
    return 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300';
  }
  return 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300';
}

export function ProjectSourcesPanel() {
  const learningContext = useStageStore((state) => state.stage?.learningContext);
  const [open, setOpen] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [health, setHealth] = useState<ResearchSourceHealth[]>([]);
  const [error, setError] = useState<string | null>(null);
  const citations = learningContext?.retrievalCitations ?? [];
  const researchSources = useMemo(
    () => learningContext?.researchSources ?? [],
    [learningContext?.researchSources],
  );
  const researchRunId = learningContext?.researchRunId;
  const sourceCount = citations.length + researchSources.length;
  const freshness = researchFreshness(learningContext?.researchFetchedAt);

  const fallbackHealth = useMemo<ResearchSourceHealth[]>(
    () =>
      researchSources.map((source, index) => ({
        citationId: source.citationId ?? `S${index + 1}`,
        title: source.title,
        url: source.url,
        domain:
          source.domain ??
          (() => {
            try {
              return new URL(source.url).hostname;
            } catch {
              return '未知域名';
            }
          })(),
        authority: source.authority ?? 'general',
        score: source.score ?? 0,
        availability: 'unverified',
      })),
    [researchSources],
  );
  const displayedHealth = health.length > 0 ? health : fallbackHealth;

  useEffect(() => {
    if (!open || !researchRunId || health.length > 0) return;
    void (async () => {
      try {
        const response = await fetch(
          `/api/v1/research-runs/${encodeURIComponent(researchRunId)}/source-health`,
          {
            headers: { 'X-MAIC-Protocol-Version': LEARNING_PROTOCOL_VERSION },
            cache: 'no-store',
          },
        );
        const result = await responseJson<{ sources: ResearchSourceHealth[] }>(response);
        setHealth(result.sources);
      } catch {
        // A classroom can still show its frozen citation manifest when the
        // optional live-health endpoint is temporarily unavailable.
      }
    })();
  }, [health.length, open, researchRunId]);

  if (sourceCount === 0) return null;

  const verify = async () => {
    if (!researchRunId) {
      setError('这份旧课堂没有持久化检索记录，无法执行实时链接复核；可重新生成课堂。');
      return;
    }
    setVerifying(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/v1/research-runs/${encodeURIComponent(researchRunId)}/source-health`,
        {
          method: 'POST',
          headers: { 'X-MAIC-Protocol-Version': LEARNING_PROTOCOL_VERSION },
          cache: 'no-store',
        },
      );
      const result = await responseJson<{ sources: ResearchSourceHealth[] }>(response);
      setHealth(result.sources);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法复核外部来源。');
    } finally {
      setVerifying(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-20 left-5 z-[70] inline-flex items-center gap-2 rounded-full border border-violet-200 bg-white/95 px-4 py-2.5 text-sm font-medium text-violet-700 shadow-lg backdrop-blur transition hover:-translate-y-0.5 hover:bg-violet-50 dark:border-violet-800 dark:bg-slate-900/95 dark:text-violet-300"
      >
        <FileSearch className="h-4 w-4" /> 本课堂来源 {sourceCount}
      </button>

      {open && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm">
          <section className="flex max-h-[90dvh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
            <header className="flex items-start justify-between gap-4 border-b border-slate-200 p-5 dark:border-slate-800">
              <div>
                <div className="flex items-center gap-2 text-sm font-medium text-violet-600 dark:text-violet-400">
                  <ShieldCheck className="h-4 w-4" /> 可追溯的课堂证据
                </div>
                <h2 className="mt-1 text-xl font-semibold">
                  {learningContext?.projectName ?? '本课堂'} · 来源清单
                </h2>
                <p className="mt-1 text-sm leading-6 text-slate-500">
                  内部来源冻结到生成时的版本；外部来源显示权威等级、检索时效和实时可访问性。
                  “可访问”不代表结论正确，仍应结合课堂论证判断。
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="关闭来源面板"
                className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </header>

            <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-5">
              {learningContext?.externalEvidenceStatus === 'unavailable' && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                  <strong className="block">本课堂未取得外部补充证据</strong>
                  <span>
                    {learningContext.externalEvidenceWarning ??
                      '课堂仅依据已冻结的内部原始资料生成，不包含最新外部结论。'}
                  </span>
                </div>
              )}
              {citations.length > 0 && (
                <section>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="font-semibold">Obsidian / 项目来源</h3>
                      <p className="mt-1 text-xs text-slate-500">
                        版本 {learningContext?.projectRevision ?? '未知'} ·{' '}
                        {learningContext?.projectCoverageState === 'authorized-index-complete'
                          ? '授权范围已完整索引'
                          : '仅覆盖已授权的部分来源'}
                      </p>
                    </div>
                    <span className="rounded-full bg-violet-50 px-2.5 py-1 text-xs text-violet-700 dark:bg-violet-950/40 dark:text-violet-300">
                      匹配质量：
                      {learningContext?.retrievalMatchQuality === 'weak' ? '较弱' : '明确'}
                    </span>
                  </div>
                  <ol className="mt-3 space-y-2">
                    {citations.map((citation) => (
                      <li
                        key={citation.chunkId}
                        className="rounded-xl border border-slate-200 p-3 text-sm dark:border-slate-800"
                      >
                        <div className="font-medium">
                          <span className="mr-1 font-mono text-violet-600">
                            [{citation.citationId}]
                          </span>
                          {citation.relativePath}
                        </div>
                        <div className="mt-1 text-xs leading-5 text-slate-500">
                          {citation.headingPath.length > 0
                            ? citation.headingPath.join(' → ')
                            : '入口片段'}{' '}
                          · {citation.excerptChars.toLocaleString()} 字符
                        </div>
                        <div className="mt-1 break-all font-mono text-[10px] text-slate-400">
                          {citation.sourceVersionId} · {citation.contentHash.slice(0, 16)}…
                        </div>
                      </li>
                    ))}
                  </ol>
                </section>
              )}

              {researchSources.length > 0 && (
                <section>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="font-semibold">外部检索来源</h3>
                      <p className="mt-1 text-xs text-slate-500">
                        {researchFreshnessLabel(freshness)}
                        {learningContext?.researchFetchedAt
                          ? ` · ${new Date(learningContext.researchFetchedAt).toLocaleString()}`
                          : ''}
                        {learningContext?.researchProviderId
                          ? ` · ${learningContext.researchProviderId}`
                          : ''}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void verify()}
                      disabled={verifying}
                      className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 px-3 text-xs font-medium hover:border-violet-300 hover:bg-violet-50 disabled:opacity-60 dark:border-slate-700 dark:hover:bg-violet-950/30"
                    >
                      {verifying ? (
                        <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="h-3.5 w-3.5" />
                      )}
                      实时复核链接
                    </button>
                  </div>
                  {freshness === 'stale' && (
                    <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                      这份课堂的外部检索快照已超过 30 天。它仍可用于回顾当时的证据，但学习“最新”
                      论文、技术或仓库状态前应重新生成课堂。
                    </div>
                  )}
                  <ol className="mt-3 space-y-2">
                    {displayedHealth.map((source) => (
                      <li
                        key={`${source.citationId}:${source.url}`}
                        className="rounded-xl border border-slate-200 p-3 text-sm dark:border-slate-800"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <a
                              href={source.finalUrl ?? source.url}
                              target="_blank"
                              rel="noreferrer"
                              className="font-medium text-slate-900 hover:text-violet-600 dark:text-slate-100"
                            >
                              <span className="mr-1 font-mono text-violet-600">
                                [{source.citationId}]
                              </span>
                              {source.title}
                              <ExternalLink className="ml-1 inline h-3 w-3" />
                            </a>
                            <div className="mt-1 break-all text-xs text-slate-500">
                              {source.domain}
                              {source.httpStatus ? ` · HTTP ${source.httpStatus}` : ''}
                              {source.checkedAt
                                ? ` · 复核于 ${new Date(source.checkedAt).toLocaleString()}`
                                : ''}
                            </div>
                          </div>
                          <div className="flex shrink-0 flex-col items-end gap-1">
                            <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                              {sourceAuthorityLabel(source.authority)}
                            </span>
                            <span
                              className={`rounded-full px-2 py-1 text-[10px] ${availabilityTone(source.availability)}`}
                            >
                              {sourceAvailabilityLabel(source.availability)}
                            </span>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ol>
                  {error && (
                    <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
                      {error}
                    </div>
                  )}
                </section>
              )}
            </div>
          </section>
        </div>
      )}
    </>
  );
}
