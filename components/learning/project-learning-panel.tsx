'use client';

import { LEARNING_PROTOCOL_VERSION } from '@openmaic/learning-protocol';
import {
  BookOpenCheck,
  BrainCircuit,
  CheckCircle2,
  FileStack,
  LoaderCircle,
  LockKeyhole,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { CopyWritebackCommand, WritebackSteps } from '@/components/learning/writeback-steps';
import { useMediaStageId } from '@/lib/contexts/media-stage-context';
import {
  LEARNING_VERIFICATION_UPDATED_EVENT,
  learningVerificationStorageKey,
  parseLearningVerificationSnapshot,
} from '@/lib/learning/domain/learning-next-action';
import { useStageStore } from '@/lib/store';

type SourceState = 'pending' | 'learning' | 'review' | 'verified';
type ReviewRating = 'again' | 'hard' | 'good' | 'easy';

interface ProjectSourceView {
  sourceId: string;
  title: string;
  relativePath: string;
  indexStatus: 'pending' | 'ready' | 'failed' | 'purged' | 'missing';
  indexedChunkCount: number;
  learningState: SourceState;
  sourceUpdated: boolean;
  companion?: { id: string; relativePath: string };
  latestSprint?: { id: string; classroomId: string; status: string };
  mastery?: { estimate: number | null; confidence: number; evidenceCount: number };
  review?: { id: string; state: string; dueAt: string };
}

interface ProjectIndexView {
  project: { id: string; projectName: string; projectRevision: number; rootPath: string };
  sources: ProjectSourceView[];
  generatedAt: string;
}

interface ReviewView {
  id: string;
  conceptId: string;
  state: 'scheduled' | 'due' | 'completed' | 'cancelled';
  dueAt: string;
  classroomId: string;
  goal: string;
  projectId?: string;
  projectName?: string;
  masteryEstimate: number | null;
  masteryConfidence: number;
  masteryEvidenceCount: number;
  isDue: boolean;
}

interface DraftView {
  id: string;
  revision: number;
  draftKind: 'project-index';
  projectIndexId: string;
  targetVaultName: string;
  operation: 'createManagedNote' | 'replaceProjectIndexBlocks';
  relativePath: string;
  content: string;
}

async function responseJson<T>(response: Response): Promise<T> {
  const body = (await response.json()) as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(body.error?.message || `请求失败（${response.status}）`);
  return body;
}

function stateLabel(state: SourceState): string {
  switch (state) {
    case 'pending':
      return '待学习';
    case 'learning':
      return '学习中';
    case 'review':
      return '待复习';
    case 'verified':
      return '阶段证据达标';
  }
}

function stateClass(state: SourceState): string {
  switch (state) {
    case 'pending':
      return 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300';
    case 'learning':
      return 'bg-blue-50 text-blue-700 dark:bg-blue-950/35 dark:text-blue-300';
    case 'review':
      return 'bg-amber-50 text-amber-700 dark:bg-amber-950/35 dark:text-amber-300';
    case 'verified':
      return 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/35 dark:text-emerald-300';
  }
}

function formatDate(value: string | undefined): string {
  if (!value) return '未安排';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString('zh-CN');
}

/**
 * The project index is deliberately separate from individual companion notes:
 * it is an aggregate view and the only mutable regions are its marked blocks.
 */
export function ProjectLearningPanel() {
  const classroomId = useMediaStageId();
  const learningContext = useStageStore((state) => state.stage?.learningContext);
  const projectId = learningContext?.projectId;
  const projectName = learningContext?.projectName ?? '当前项目';
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState<ProjectIndexView | null>(null);
  const [reviews, setReviews] = useState<ReviewView[]>([]);
  const [loading, setLoading] = useState(false);
  const [creatingDraft, setCreatingDraft] = useState(false);
  const [approving, setApproving] = useState(false);
  const [reviewBusyId, setReviewBusyId] = useState<string | null>(null);
  const [activeReviewId, setActiveReviewId] = useState<string | null>(null);
  const [reviewResponse, setReviewResponse] = useState('');
  const [draft, setDraft] = useState<DraftView | null>(null);
  const [queued, setQueued] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validProjectId = Boolean(projectId && /^prj_[a-f0-9]{32}$/.test(projectId));
  const subscribeVerification = useCallback(
    (onStoreChange: () => void) => {
      if (!classroomId) return () => undefined;
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
    if (!classroomId) return '';
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
  const learningVerified = verification?.learningVerified === true;

  const refresh = useCallback(async () => {
    if (!validProjectId && !classroomId) return;
    setLoading(true);
    setError(null);
    try {
      const reviewUrl =
        validProjectId && projectId
          ? `/api/v1/reviews?projectId=${encodeURIComponent(projectId)}&limit=50`
          : '/api/v1/reviews?limit=200';
      const reviewPromise = fetch(reviewUrl, {
        headers: { 'X-MAIC-Protocol-Version': LEARNING_PROTOCOL_VERSION },
        cache: 'no-store',
      });
      const indexPromise =
        validProjectId && projectId
          ? fetch(`/api/v1/projects/${encodeURIComponent(projectId)}/learning-index`, {
              headers: { 'X-MAIC-Protocol-Version': LEARNING_PROTOCOL_VERSION },
              cache: 'no-store',
            })
          : null;
      const [reviewResponse, indexResponse] = await Promise.all([reviewPromise, indexPromise]);
      const reviewResult = await responseJson<{ reviews: ReviewView[] }>(reviewResponse);
      const visibleReviews =
        validProjectId || !classroomId
          ? reviewResult.reviews
          : reviewResult.reviews.filter((review) => review.classroomId === classroomId);
      setReviews(visibleReviews);
      if (indexResponse) {
        const indexResult = await responseJson<{ index: ProjectIndexView }>(indexResponse);
        setIndex(indexResult.index);
      } else {
        setIndex(null);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法读取学习与反刍状态。');
    } finally {
      setLoading(false);
    }
  }, [classroomId, projectId, validProjectId]);

  useEffect(() => {
    const reviewItemId = new URLSearchParams(window.location.search).get('reviewItemId');
    if (!reviewItemId || !/^rvi_[a-f0-9]{32}$/.test(reviewItemId)) return;
    const timer = window.setTimeout(() => {
      setActiveReviewId(reviewItemId);
      setOpen(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      void refresh();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [open, refresh]);

  const summary = useMemo(() => {
    const initial: Record<SourceState, number> = {
      pending: 0,
      learning: 0,
      review: 0,
      verified: 0,
    };
    for (const source of index?.sources ?? []) initial[source.learningState] += 1;
    return {
      ...initial,
      updated: (index?.sources ?? []).filter((source) => source.sourceUpdated).length,
      unindexed: (index?.sources ?? []).filter((source) => source.indexStatus !== 'ready').length,
    };
  }, [index]);

  const createDraft = async () => {
    if (!projectId) return;
    setCreatingDraft(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/v1/projects/${encodeURIComponent(projectId)}/learning-index`,
        {
          method: 'POST',
          headers: { 'X-MAIC-Protocol-Version': LEARNING_PROTOCOL_VERSION },
          cache: 'no-store',
        },
      );
      const result = await responseJson<{ draft: DraftView }>(response);
      setDraft(result.draft);
      setQueued(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法生成项目学习索引草稿。');
    } finally {
      setCreatingDraft(false);
    }
  };

  const approveDraft = async () => {
    if (!draft || !learningVerified) {
      setError('完成最终迁移检验后，才能批准正式写回 Obsidian。');
      return;
    }
    setApproving(true);
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
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法批准项目索引写回。');
    } finally {
      setApproving(false);
    }
  };

  const completeReview = async (review: ReviewView, rating: ReviewRating) => {
    const responseText = reviewResponse.trim();
    if (responseText.length < 20) {
      setError('请先完成至少 20 个字的闭卷回忆，再评价这次反刍。');
      return;
    }
    setReviewBusyId(review.id);
    setError(null);
    try {
      const attemptId = `review_${globalThis.crypto.randomUUID()}`;
      const response = await fetch(`/api/v1/reviews/${encodeURIComponent(review.id)}/complete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-MAIC-Protocol-Version': LEARNING_PROTOCOL_VERSION,
        },
        body: JSON.stringify({
          attemptId,
          response: responseText,
          rating,
        }),
        cache: 'no-store',
      });
      await responseJson(response);
      setActiveReviewId(null);
      setReviewResponse('');
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法完成本次复习。');
    } finally {
      setReviewBusyId(null);
    }
  };

  const reviewQueueSection = (
    <section
      id="rumination"
      className="rounded-2xl border border-amber-200 bg-amber-50/40 p-4 dark:border-amber-900/60 dark:bg-amber-950/15"
    >
      <div className="flex items-start gap-3">
        <span className="rounded-lg bg-amber-100 p-2 text-amber-700 dark:bg-amber-950 dark:text-amber-300">
          <BrainCircuit className="h-4 w-4" />
        </span>
        <div>
          <h3 className="font-semibold">反刍与复习</h3>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            先闭卷提取，再评价回忆难度。难度只调整下次复习时间，不会直接制造掌握证据。
          </p>
        </div>
      </div>
      <div className="mt-3 space-y-2">
        {reviews.length === 0 ? (
          <p className="rounded-xl border border-dashed border-amber-200 bg-white/70 p-4 text-sm text-slate-500 dark:border-amber-900 dark:bg-slate-900/60">
            当前课堂暂无到期反刍。完成主动练习后，系统会按证据与遗忘风险安排下一次复习。
          </p>
        ) : (
          reviews.map((review) => (
            <div
              key={review.id}
              className="rounded-xl border border-amber-200/80 bg-white p-3 text-sm dark:border-amber-900/60 dark:bg-slate-900"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="font-medium">{review.goal || '课堂反刍'}</div>
                  <div className="mt-1 text-xs text-slate-500">
                    {review.isDue ? '已到期' : '计划'} · {formatDate(review.dueAt)} · 当前掌握{' '}
                    {review.masteryEstimate === null
                      ? '未知'
                      : `${Math.round(review.masteryEstimate * 100)}%`}
                  </div>
                </div>
                <button
                  type="button"
                  aria-expanded={activeReviewId === review.id}
                  onClick={() => {
                    const opening = activeReviewId !== review.id;
                    setActiveReviewId(opening ? review.id : null);
                    setReviewResponse('');
                    setError(null);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-800 transition hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
                >
                  <BrainCircuit className="h-3.5 w-3.5" />
                  {activeReviewId === review.id ? '收起反刍' : '开始反刍'}
                </button>
              </div>

              {activeReviewId === review.id && (
                <div className="mt-3 rounded-xl border border-violet-200 bg-violet-50/60 p-3 dark:border-violet-900 dark:bg-violet-950/20">
                  <div className="text-xs font-semibold text-violet-800 dark:text-violet-200">
                    先闭卷提取，再决定复习间隔
                  </div>
                  <p className="mt-1 text-xs leading-5 text-slate-600 dark:text-slate-300">
                    不看资料，用自己的话写出：①核心机制；②关键关系或依据；③一个新情境中的应用；④仍不确定的地方。
                  </p>
                  <p className="mt-1 text-[11px] text-slate-500">
                    目标：{review.goal || '当前课堂'} · 范围：
                    {review.conceptId === 'classroom'
                      ? '整堂课'
                      : review.conceptId.replace(/^scene:/, '场景 ')}
                  </p>
                  <textarea
                    value={reviewResponse}
                    onChange={(event) => setReviewResponse(event.target.value)}
                    rows={5}
                    maxLength={4_000}
                    autoFocus
                    placeholder="先凭记忆写下答案；至少 20 个字……"
                    className="mt-2 w-full resize-y rounded-xl border border-violet-200 bg-white p-3 text-sm leading-6 outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-100 dark:border-violet-900 dark:bg-slate-900 dark:focus:ring-violet-950"
                  />
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[11px] text-slate-500">
                      {reviewResponse.trim().length}/4000 ·
                      评价只调整下次复习时间，不会直接提高掌握度。
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {(
                        [
                          ['again', '忘记了'],
                          ['hard', '较困难'],
                          ['good', '能回忆'],
                          ['easy', '很轻松'],
                        ] as const
                      ).map(([rating, label]) => (
                        <button
                          key={rating}
                          type="button"
                          disabled={reviewBusyId === review.id || reviewResponse.trim().length < 20}
                          onClick={() => void completeReview(review, rating)}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] text-slate-700 transition hover:border-violet-400 hover:text-violet-700 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                        >
                          {reviewBusyId === review.id ? (
                            <LoaderCircle className="h-3 w-3 animate-spin" />
                          ) : (
                            <Send className="h-3 w-3" />
                          )}
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </section>
  );

  if (!validProjectId && !classroomId) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-36 left-5 z-[70] inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-white/95 px-4 py-2.5 text-sm font-medium text-emerald-700 shadow-lg backdrop-blur transition hover:-translate-y-0.5 hover:bg-emerald-50 dark:border-emerald-900 dark:bg-slate-900/95 dark:text-emerald-300"
      >
        {validProjectId ? (
          <BookOpenCheck className="h-4 w-4" />
        ) : (
          <BrainCircuit className="h-4 w-4" />
        )}
        {validProjectId ? '项目学习' : '反刍与复习'}
      </button>

      {open && (
        <div className="fixed inset-0 z-[125] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
          <section className="flex max-h-[92dvh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-slate-900">
            <header className="flex items-start justify-between gap-4 border-b border-slate-200 p-5 dark:border-slate-800">
              <div>
                <div className="flex items-center gap-2 text-sm font-medium text-emerald-600 dark:text-emerald-400">
                  {validProjectId ? (
                    <FileStack className="h-4 w-4" />
                  ) : (
                    <BrainCircuit className="h-4 w-4" />
                  )}
                  {validProjectId ? '项目学习与反刍' : '课堂反刍'}
                </div>
                <h2 className="mt-1 text-xl font-semibold">
                  {validProjectId
                    ? (index?.project.projectName ?? projectName)
                    : '用主动提取巩固本课堂'}
                </h2>
                <p className="mt-1 text-sm leading-6 text-slate-500">
                  {validProjectId
                    ? '原始项目文件保持只读。这里汇总来源、课堂、伴随笔记与反刍证据；项目索引只写入独立受控文档。'
                    : '这里适用于没有绑定 Obsidian 项目的课堂。到期任务会直达对应反刍，不需要先进入项目面板。'}
                </p>
              </div>
              <button
                type="button"
                aria-label="关闭项目学习面板"
                onClick={() => setOpen(false)}
                className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div className="text-xs text-slate-500">
                  {validProjectId
                    ? index
                      ? `项目版本 ${index.project.projectRevision} · ${index.sources.length} 份已授权来源`
                      : '正在读取项目状态'
                    : `${reviews.length} 个可执行反刍任务`}
                </div>
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => void refresh()}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> 刷新状态
                </button>
              </div>

              {loading && (validProjectId ? !index : reviews.length === 0) && (
                <div className="flex min-h-48 items-center justify-center gap-2 text-sm text-slate-500">
                  <LoaderCircle className="h-5 w-5 animate-spin" /> 正在读取学习与反刍状态…
                </div>
              )}

              {!loading && !draft && <div className="mb-5">{reviewQueueSection}</div>}

              {index && !draft && (
                <div className="space-y-5">
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                    {(
                      [
                        ['待学习', summary.pending, 'slate'],
                        ['学习中', summary.learning, 'blue'],
                        ['待复习', summary.review, 'amber'],
                        ['阶段证据达标', summary.verified, 'emerald'],
                        ['来源已更新', summary.updated, 'rose'],
                      ] as const
                    ).map(([label, count, tone]) => (
                      <div
                        key={label}
                        className={`rounded-xl p-3 ${
                          tone === 'blue'
                            ? 'bg-blue-50 dark:bg-blue-950/25'
                            : tone === 'amber'
                              ? 'bg-amber-50 dark:bg-amber-950/25'
                              : tone === 'emerald'
                                ? 'bg-emerald-50 dark:bg-emerald-950/25'
                                : tone === 'rose'
                                  ? 'bg-rose-50 dark:bg-rose-950/25'
                                  : 'bg-slate-50 dark:bg-slate-800/60'
                        }`}
                      >
                        <div className="text-[11px] text-slate-500">{label}</div>
                        <div className="mt-1 text-xl font-semibold">{count}</div>
                      </div>
                    ))}
                  </div>

                  <section className="rounded-2xl border border-slate-200 dark:border-slate-700">
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-4 dark:border-slate-700">
                      <div>
                        <h3 className="font-semibold">来源覆盖与学习状态</h3>
                        <p className="mt-1 text-xs text-slate-500">
                          索引缺失 {summary.unindexed}{' '}
                          份；“来源已更新”仅提示重新学习，不会静默改变掌握度。
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={creatingDraft}
                        onClick={() => void createDraft()}
                        className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
                      >
                        {creatingDraft ? (
                          <LoaderCircle className="h-4 w-4 animate-spin" />
                        ) : (
                          <Sparkles className="h-4 w-4" />
                        )}
                        生成项目索引草稿
                      </button>
                    </div>
                    <div className="max-h-[40dvh] overflow-auto">
                      {index.sources.length === 0 ? (
                        <p className="p-4 text-sm text-slate-500">该项目尚无已授权来源。</p>
                      ) : (
                        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                          {index.sources.map((source) => (
                            <li key={source.sourceId} className="p-3.5">
                              <div className="flex flex-wrap items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="truncate font-medium">{source.title}</div>
                                  <div className="mt-1 truncate text-xs text-slate-500">
                                    {source.relativePath}
                                  </div>
                                  <div className="mt-1.5 flex flex-wrap gap-x-2 gap-y-1 text-[11px] text-slate-500">
                                    <span>
                                      {source.companion ? '已绑定伴随笔记' : '尚未创建伴随笔记'}
                                    </span>
                                    <span>
                                      {source.latestSprint ? '已有课堂记录' : '尚未开始课堂'}
                                    </span>
                                    {source.mastery && (
                                      <span>
                                        掌握{' '}
                                        {source.mastery.estimate === null
                                          ? '未知'
                                          : `${Math.round(source.mastery.estimate * 100)}%`}
                                      </span>
                                    )}
                                  </div>
                                </div>
                                <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                                  {source.sourceUpdated && (
                                    <span className="rounded-full bg-rose-50 px-2 py-1 text-[11px] font-medium text-rose-700 dark:bg-rose-950/35 dark:text-rose-300">
                                      来源已更新
                                    </span>
                                  )}
                                  <span
                                    className={`rounded-full px-2 py-1 text-[11px] font-medium ${stateClass(source.learningState)}`}
                                  >
                                    {stateLabel(source.learningState)}
                                  </span>
                                </div>
                              </div>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </section>
                </div>
              )}

              {draft && !queued && (
                <div className="space-y-4">
                  <WritebackSteps currentStep={2} />
                  <div
                    className={
                      learningVerified
                        ? 'rounded-xl border border-emerald-200 bg-emerald-50/50 p-4 text-sm dark:border-emerald-900/60 dark:bg-emerald-950/15'
                        : 'rounded-xl border border-amber-200 bg-amber-50/60 p-4 text-sm dark:border-amber-900/60 dark:bg-amber-950/15'
                    }
                  >
                    <div
                      className={
                        learningVerified
                          ? 'flex items-center gap-2 font-medium text-emerald-700 dark:text-emerald-300'
                          : 'flex items-center gap-2 font-medium text-amber-700 dark:text-amber-300'
                      }
                    >
                      {learningVerified ? (
                        <ShieldCheck className="h-4 w-4" />
                      ) : (
                        <LockKeyhole className="h-4 w-4" />
                      )}
                      {learningVerified
                        ? '学习已验证 · 可批准正式写回'
                        : '项目索引草稿 · 正式写回未解锁'}
                    </div>
                    <p className="mt-2 leading-6 text-slate-600 dark:text-slate-300">
                      {!learningVerified
                        ? '草稿可以审查，但必须先完成有效学习证据和最终迁移检验，才能发送给 Obsidian。'
                        : draft.operation === 'replaceProjectIndexBlocks'
                          ? '只更新哈希一致的项目索引受管区；任何本地冲突都会停止写入。'
                          : '这是第一次创建项目索引，Obsidian 仍会显示路径与内容并要求最终确认。'}
                    </p>
                    <div className="mt-3 text-xs text-slate-500">
                      目标 Vault：{draft.targetVaultName}
                    </div>
                    <div className="mt-1 break-all font-mono text-xs text-slate-600 dark:text-slate-300">
                      {draft.relativePath}
                    </div>
                  </div>
                  <pre className="max-h-[48dvh] overflow-auto whitespace-pre-wrap rounded-xl bg-slate-950 p-4 text-xs leading-6 text-slate-100">
                    {draft.content}
                  </pre>
                  <button
                    type="button"
                    disabled={approving || !learningVerified}
                    onClick={() => void approveDraft()}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
                  >
                    {approving && <LoaderCircle className="h-4 w-4 animate-spin" />}
                    {learningVerified ? '批准并发送给 Obsidian' : '完成迁移检验后可批准写回'}
                  </button>
                </div>
              )}

              {queued && draft && (
                <div className="py-10 text-center">
                  <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-500" />
                  <h3 className="mt-3 text-lg font-semibold">项目学习索引已加入安全写回队列</h3>
                  <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-500">
                    回到 Obsidian
                    后执行下方命令。插件会再次显示路径与内容，确认后才会创建或更新项目索引；项目中的原始文件不会被修改。
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
