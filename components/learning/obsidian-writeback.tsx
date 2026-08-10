'use client';

import { LEARNING_PROTOCOL_VERSION } from '@openmaic/learning-protocol';
import { BookMarked, CheckCircle2, LoaderCircle, ShieldCheck, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { CopyWritebackCommand, WritebackSteps } from '@/components/learning/writeback-steps';
import { readSubmittedState } from '@/lib/quiz/persistence';
import { useStageStore } from '@/lib/store';
import type { QuizContent } from '@/lib/types/stage';
import { OPEN_OBSIDIAN_WRITEBACK_EVENT } from '@/lib/learning/client/classroom-progress';

interface DraftView {
  id: string;
  revision: number;
  sprintId?: string;
  draftKind: 'learning-summary' | 'external-card' | 'synthesis';
  assetId?: string;
  assetVersionId?: string;
  targetVaultName: string;
  operation: 'createManagedNote' | 'replaceManagedBlocks';
  companionId?: string;
  relativePath: string;
  content: string;
  status: 'generated' | 'edited' | 'approved' | 'rejected' | 'expired';
}

type PanelState = 'idle' | 'generating' | 'preview' | 'approving' | 'queued';

async function responseJson<T>(response: Response): Promise<T> {
  const body = (await response.json()) as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(body.error?.message || `请求失败（${response.status}）`);
  return body;
}

export function ObsidianWriteback({
  classroomId,
  onWritebackPending,
  onWritebackQueued,
  showLauncher = true,
}: {
  classroomId: string;
  onWritebackPending?: (count: number) => void;
  onWritebackQueued?: () => void;
  showLauncher?: boolean;
}) {
  const scenes = useStageStore((state) => state.scenes);
  const currentSceneId = useStageStore((state) => state.currentSceneId);
  const learningContext = useStageStore((state) => state.stage?.learningContext);
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<PanelState>('idle');
  const [drafts, setDrafts] = useState<DraftView[]>([]);
  const [approvedDraftIds, setApprovedDraftIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handleOpen = (event: Event) => {
      const detail = (event as CustomEvent<{ classroomId?: string }>).detail;
      if (detail?.classroomId === classroomId) setOpen(true);
    };
    window.addEventListener(OPEN_OBSIDIAN_WRITEBACK_EVENT, handleOpen);
    return () => window.removeEventListener(OPEN_OBSIDIAN_WRITEBACK_EVENT, handleOpen);
  }, [classroomId]);

  const progress = useMemo(() => {
    const quizSummaries = scenes.flatMap((scene) => {
      if (scene.type !== 'quiz') return [];
      const content = scene.content as QuizContent;
      const submitted = readSubmittedState(scene.id);
      if (!submitted) return [];
      const answered = Object.values(submitted.answers).filter((answer) =>
        Array.isArray(answer) ? answer.length > 0 : answer.trim().length > 0,
      ).length;
      const possible = content.questions.reduce((sum, question) => sum + (question.points ?? 1), 0);
      const earned =
        submitted.kind === 'reviewing'
          ? submitted.results.reduce((sum, result) => sum + result.earned, 0)
          : undefined;
      return [
        {
          sceneId: scene.id,
          title: scene.title,
          answered,
          total: content.questions.length,
          ...(earned !== undefined ? { earned, possible } : {}),
        },
      ];
    });
    return { currentSceneId, quizSummaries };
  }, [currentSceneId, scenes]);

  const generateDraft = async () => {
    setState('generating');
    setError(null);
    try {
      const response = await fetch(
        `/api/v1/classrooms/${encodeURIComponent(classroomId)}/writeback-drafts`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-MAIC-Protocol-Version': LEARNING_PROTOCOL_VERSION,
          },
          body: JSON.stringify({ progress }),
          cache: 'no-store',
        },
      );
      const result = await responseJson<{ draft: DraftView }>(response);
      const nextDrafts = [result.draft];
      const hasExternalResearch =
        Boolean(learningContext?.researchRunId) ||
        Boolean(learningContext?.researchSources?.length);
      if (hasExternalResearch) {
        try {
          const externalResponse = await fetch(
            `/api/v1/classrooms/${encodeURIComponent(classroomId)}/external-card-drafts`,
            {
              method: 'POST',
              headers: { 'X-MAIC-Protocol-Version': LEARNING_PROTOCOL_VERSION },
              cache: 'no-store',
            },
          );
          if (externalResponse.ok) {
            const external = await responseJson<{ draft: DraftView }>(externalResponse);
            if (!nextDrafts.some((draft) => draft.id === external.draft.id)) {
              nextDrafts.push(external.draft);
            }
          } else if (externalResponse.status !== 404) {
            const body = (await externalResponse.json().catch(() => null)) as {
              error?: { message?: string };
            } | null;
            setError(body?.error?.message ?? '外部资料卡暂时无法生成；学习记录仍可正常回写。');
          }
        } catch {
          setError('外部资料卡暂时无法生成；学习记录仍可正常回写。');
        }
      }
      setDrafts(nextDrafts);
      setApprovedDraftIds([]);
      setState('preview');
      onWritebackPending?.(nextDrafts.length);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法生成 Obsidian 学习沉淀草稿。');
      setState('idle');
    }
  };

  const approveDrafts = async () => {
    const pending = drafts.filter((draft) => !approvedDraftIds.includes(draft.id));
    if (pending.length === 0) {
      setState('queued');
      return;
    }
    setState('approving');
    setError(null);
    try {
      for (const draft of pending) {
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
        await responseJson<{ command: { id: string } }>(response);
        setApprovedDraftIds((ids) => [...new Set([...ids, draft.id])]);
      }
      setState('queued');
      onWritebackQueued?.();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法批准回写。');
      setState('preview');
    }
  };

  const close = () => {
    setOpen(false);
    if (state !== 'queued') {
      setState('idle');
      setDrafts([]);
      setApprovedDraftIds([]);
      setError(null);
    }
  };

  const primaryDraft = drafts[0] ?? null;
  const isManagedUpdate = primaryDraft?.operation === 'replaceManagedBlocks';
  const isExternalCard = primaryDraft?.draftKind === 'external-card';
  const pendingDraftCount = drafts.filter((draft) => !approvedDraftIds.includes(draft.id)).length;
  const actionNoun =
    drafts.length === 0
      ? '沉淀本课堂的学习结果'
      : drafts.length > 1
        ? `审查 ${drafts.length} 份学习沉淀`
        : isManagedUpdate
          ? '更新同一份学习伴随笔记'
          : isExternalCard
            ? '创建可追溯的外部资料卡'
            : primaryDraft?.companionId
              ? '创建学习伴随笔记'
              : '创建受管学习记录';

  return (
    <>
      {showLauncher && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed bottom-5 right-5 z-[70] inline-flex items-center gap-2 rounded-full border border-violet-200 bg-white/95 px-4 py-2.5 text-sm font-medium text-violet-700 shadow-lg backdrop-blur transition hover:-translate-y-0.5 hover:bg-violet-50 dark:border-violet-800 dark:bg-slate-900/95 dark:text-violet-300 dark:hover:bg-slate-800"
        >
          <BookMarked className="h-4 w-4" /> 沉淀到 Obsidian
        </button>
      )}

      {open && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm">
          <section className="flex max-h-[90dvh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
            <header className="flex items-start justify-between gap-4 border-b border-slate-200 p-5 dark:border-slate-800">
              <div>
                <div className="flex items-center gap-2 text-sm font-medium text-violet-600 dark:text-violet-400">
                  <ShieldCheck className="h-4 w-4" /> 受控 Obsidian 回写
                </div>
                <h2 className="mt-1 text-xl font-semibold">{actionNoun}</h2>
                <p className="mt-1 text-sm text-slate-500">
                  原有笔记永远不会被修改。首次学习会创建一份位于 Vaultide/
                  的伴随笔记；后续学习只更新其中已标记、且哈希一致的受管区块。
                </p>
              </div>
              <button
                type="button"
                onClick={close}
                aria-label="关闭"
                className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              <WritebackSteps
                currentStep={
                  state === 'queued' ? 3 : state === 'preview' || state === 'approving' ? 2 : 1
                }
              />

              {state === 'idle' && (
                <div className="space-y-4">
                  <div className="rounded-xl bg-slate-50 p-4 text-sm leading-6 dark:bg-slate-800/60">
                    将沉淀课堂目标、来源链接、{scenes.length}{' '}
                    个场景与当前已提交的测验进度。具体作答内容不会被写入笔记。若课堂对应一份已选中的
                    Obsidian
                    原有笔记，系统会绑定并持续更新同一份伴随笔记；外部课堂还会额外生成一份可追溯的资料卡版本。
                  </div>
                  <button
                    type="button"
                    onClick={() => void generateDraft()}
                    className="w-full rounded-xl bg-violet-600 px-5 py-3 text-sm font-medium text-white hover:bg-violet-700"
                  >
                    生成并预览学习沉淀
                  </button>
                </div>
              )}

              {state === 'generating' && (
                <div className="flex min-h-48 items-center justify-center gap-3 text-sm text-slate-500">
                  <LoaderCircle className="h-5 w-5 animate-spin" /> 正在生成可审查草稿…
                </div>
              )}

              {(state === 'preview' || state === 'approving') && drafts.length > 0 && (
                <div className="space-y-4">
                  {drafts.map((draft, index) => (
                    <details
                      key={draft.id}
                      open={index === 0}
                      className="rounded-xl border border-slate-200 p-4 text-sm dark:border-slate-700"
                    >
                      <summary className="cursor-pointer font-medium text-slate-800 dark:text-slate-100">
                        {draft.draftKind === 'external-card'
                          ? '外部资料卡（不可变来源版本）'
                          : draft.operation === 'replaceManagedBlocks'
                            ? '学习伴随笔记（更新受管区块）'
                            : draft.companionId
                              ? '学习伴随笔记（首次创建）'
                              : '课堂学习记录'}
                        {approvedDraftIds.includes(draft.id) ? ' · 已批准' : ''}
                      </summary>
                      <div className="mt-3 grid gap-2 text-slate-700 dark:text-slate-200">
                        <div>
                          <span className="text-slate-500">目标 Vault：</span>{' '}
                          {draft.targetVaultName}
                        </div>
                        <div>
                          <span className="text-slate-500">操作：</span>
                          {draft.operation === 'replaceManagedBlocks'
                            ? ' 更新已有伴随笔记的受管区块'
                            : draft.draftKind === 'external-card'
                              ? ' 创建外部资料卡的不可变版本'
                              : draft.companionId
                                ? ' 创建新的受管伴随笔记'
                                : ' 创建新的受管学习记录'}
                        </div>
                        <div className="break-all">
                          <span className="text-slate-500">目标路径：</span> {draft.relativePath}
                        </div>
                        {draft.assetVersionId && (
                          <div className="break-all">
                            <span className="text-slate-500">资料版本：</span>{' '}
                            {draft.assetVersionId}
                          </div>
                        )}
                      </div>
                      <pre className="mt-3 max-h-[35dvh] overflow-auto whitespace-pre-wrap rounded-xl bg-slate-950 p-4 text-xs leading-6 text-slate-100">
                        {draft.content}
                      </pre>
                    </details>
                  ))}
                  <button
                    type="button"
                    disabled={state === 'approving' || pendingDraftCount === 0}
                    onClick={() => void approveDrafts()}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-violet-600 px-5 py-3 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-60"
                  >
                    {state === 'approving' && <LoaderCircle className="h-4 w-4 animate-spin" />}
                    批准并发送 {pendingDraftCount} 条到 Obsidian
                  </button>
                </div>
              )}

              {state === 'queued' && drafts.length > 0 && (
                <div className="space-y-4 text-center">
                  <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-500" />
                  <div>
                    <h3 className="text-lg font-semibold">已安全加入回写队列</h3>
                    <p className="mt-2 text-sm leading-6 text-slate-500">
                      网页端已完成批准。回到 Obsidian
                      后运行下方命令，插件会再次展示目标路径与内容；确认后才会在本地创建或更新受管区块。
                    </p>
                  </div>
                  <CopyWritebackCommand />
                  <div className="space-y-1 break-all rounded-xl bg-slate-50 p-3 text-left text-xs dark:bg-slate-800">
                    {drafts.map((draft) => (
                      <div key={draft.id}>{draft.relativePath}</div>
                    ))}
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
