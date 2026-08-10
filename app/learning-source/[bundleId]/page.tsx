'use client';

import { LEARNING_PROTOCOL_VERSION, type SourceArchive } from '@openmaic/learning-protocol';
import {
  ArrowLeft,
  BookOpenCheck,
  Check,
  Database,
  FileSearch,
  Layers3,
  LoaderCircle,
  Plus,
  SearchCheck,
  ShieldCheck,
  Sparkles,
  Target,
  TriangleAlert,
  X,
} from 'lucide-react';
import { nanoid } from 'nanoid';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { MAX_PDF_CONTENT_CHARS } from '@/lib/constants/generation';
import {
  readLearningProjectDraft,
  writeLearningProjectDraft,
} from '@/lib/learning/client/learning-project-draft';
import { projectRetrievalStorageKey } from '@/lib/learning/client/project-retrieval-cache';
import {
  createLearningProjectBrief,
  updateLearningProjectBrief,
  type LearningOutcomeKind,
  type LearningProjectBrief,
  type PriorKnowledgeLevel,
} from '@/lib/learning/domain/learning-project-plan';
import type { ExternalEvidenceMode } from '@/lib/generation/external-evidence-policy';

const MAX_LEARNING_TEXT_CHARS = MAX_PDF_CONTENT_CHARS;

interface ProjectContext {
  projectId: string;
  displayName: string;
  projectRevision: number;
  uploadedProjectRevision: number;
  coverage: 'partial' | 'complete';
  sourceCount: number;
  searchableSourceCount: number;
  pendingSourceCount: number;
  failedSourceCount: number;
  indexedChunkCount: number;
  lastIndexedAt?: string;
}

interface SourceArchiveResponse extends SourceArchive {
  project?: ProjectContext;
}

interface ProjectRetrieval {
  retrievalId: string;
  strategy: string;
  matchQuality: 'strong' | 'weak';
  project: {
    projectId: string;
    displayName: string;
    projectRevision: number;
  };
  goal: string;
  context: string;
  citations: Array<{
    citationId: string;
    sourceId: string;
    sourceVersionId: string;
    sourceBundleId: string;
    snapshotId: string;
    chunkId: string;
    title: string;
    relativePath: string;
    headingPath: string[];
    chunkOrdinal: number;
    score: number;
    excerptChars: number;
    excerptPreview: string;
    matchedTerms: string[];
    selectionReason: 'goal-match' | 'required-source' | 'project-overview';
    contentHash: string;
  }>;
  alternatives: Array<{
    chunkId: string;
    sourceId: string;
    title: string;
    relativePath: string;
    headingPath: string[];
    score: number;
    excerptPreview: string;
    matchedTerms: string[];
    reason: string;
  }>;
  metrics: {
    activeSourceCount: number;
    searchableSourceCount: number;
    unavailableSourceCount: number;
    matchedSourceCount: number;
    selectedSourceCount: number;
    candidateChunkCount: number;
    selectedChunkCount: number;
    contextCharCount: number;
    contextTruncated: boolean;
    omittedCandidateCount: number;
    unavailableCandidateCount: number;
    fallbackSelectedCount: number;
  };
  createdAt: string;
}

function directSourceText(archive: SourceArchive): { text: string; truncated: boolean } {
  const snapshots = new Map(archive.bundle.snapshots.map((snapshot) => [snapshot.id, snapshot]));
  const complete = archive.contents
    .map((content) => {
      const snapshot = snapshots.get(content.snapshotId);
      const location =
        snapshot?.origin === 'obsidian' ? snapshot.locator.relativePath : snapshot?.title;
      return `--- SOURCE: ${location ?? content.snapshotId} ---\n${content.utf8Content}`;
    })
    .join('\n\n');
  return {
    text: complete.slice(0, MAX_LEARNING_TEXT_CHARS),
    truncated: complete.length > MAX_LEARNING_TEXT_CHARS,
  };
}

function errorMessage(value: unknown, fallback: string): string {
  if (typeof value !== 'object' || value === null) return fallback;
  const error = (value as { error?: unknown }).error;
  if (typeof error !== 'object' || error === null) return fallback;
  const message = (error as { message?: unknown }).message;
  return typeof message === 'string' && message.length > 0 ? message : fallback;
}

const GOAL_TEMPLATES = [
  '我想理解这个项目的核心架构与数据流，学完后能够独立解释关键模块如何协作。',
  '我想按时间线梳理这个项目的关键变化，学完后能够说明每次变化解决了什么问题。',
  '我想比较这个项目中的主要方案与取舍，学完后能够针对具体场景做出选择。',
  '我想定位这个项目最容易出错的环节，学完后能够独立排查一个真实问题。',
];

function relevanceLabel(score: number): string {
  if (score >= 0.08) return '匹配较强';
  if (score >= 0.03) return '匹配明确';
  return '匹配较弱';
}

export default function LearningSourcePage() {
  const router = useRouter();
  const params = useParams<{ bundleId: string }>();
  const [archive, setArchive] = useState<SourceArchiveResponse | null>(null);
  const [goal, setGoal] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [retrieving, setRetrieving] = useState(false);
  const [retrievalError, setRetrievalError] = useState<string | null>(null);
  const [retrieval, setRetrieval] = useState<ProjectRetrieval | null>(null);
  const [requiredSourceIds, setRequiredSourceIds] = useState<string[]>([]);
  const [excludedSourceIds, setExcludedSourceIds] = useState<string[]>([]);
  const [sourceControlsDirty, setSourceControlsDirty] = useState(false);
  const [weakMatchConfirmed, setWeakMatchConfirmed] = useState(false);
  const [webSearch, setWebSearch] = useState(false);
  const [externalEvidenceMode, setExternalEvidenceMode] =
    useState<ExternalEvidenceMode>('supplemental');
  const [learningProject, setLearningProject] = useState<LearningProjectBrief>(() =>
    createLearningProjectBrief(`lp_${nanoid(16)}`),
  );

  useEffect(() => {
    if (!archive) return;
    const draftScopeId = archive.project?.projectId ?? params.bundleId;
    const saved = readLearningProjectDraft(draftScopeId);
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      if (!saved) {
        setLearningProject((current) =>
          updateLearningProjectBrief(current, { sourceMode: 'obsidian', goal: '' }),
        );
        setGoal('');
        setWebSearch(false);
        return;
      }
      setLearningProject(updateLearningProjectBrief(saved, { sourceMode: 'obsidian' }));
      setGoal((current) => current || saved.goal);
      setWebSearch(saved.sourceMode === 'hybrid');
    });
    return () => {
      cancelled = true;
    };
  }, [archive, params.bundleId]);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      const [response, projectResponse] = await Promise.all([
        fetch(`/api/v1/source-bundles/${encodeURIComponent(params.bundleId)}`, {
          headers: { 'X-MAIC-Protocol-Version': LEARNING_PROTOCOL_VERSION },
          cache: 'no-store',
          signal: controller.signal,
        }),
        fetch(`/api/v1/source-bundles/${encodeURIComponent(params.bundleId)}/project-context`, {
          headers: { 'X-MAIC-Protocol-Version': LEARNING_PROTOCOL_VERSION },
          cache: 'no-store',
          signal: controller.signal,
        }),
      ]);
      const [body, projectBody] = await Promise.all([
        response.json() as Promise<
          SourceArchive & {
            error?: { message?: string };
          }
        >,
        projectResponse.json() as Promise<{
          project?: ProjectContext | null;
          error?: { message?: string };
        }>,
      ]);
      if (!response.ok) {
        throw new Error(body.error?.message || `请求失败（${response.status}）`);
      }
      if (!projectResponse.ok) {
        throw new Error(
          projectBody.error?.message || `项目上下文请求失败（${projectResponse.status}）`,
        );
      }
      setArchive({
        ...body,
        ...(projectBody.project ? { project: projectBody.project } : {}),
      });
    })()
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === 'AbortError') return;
        setError(reason instanceof Error ? reason.message : '无法读取已上传资料。');
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [params.bundleId]);

  useEffect(() => {
    if (!archive?.project) return;
    let cancelled = false;
    try {
      const raw = sessionStorage.getItem(projectRetrievalStorageKey(params.bundleId));
      if (!raw) return;
      const saved = JSON.parse(raw) as {
        goal?: unknown;
        retrieval?: ProjectRetrieval;
        requiredSourceIds?: unknown;
        excludedSourceIds?: unknown;
        savedAt?: unknown;
      };
      if (
        typeof saved.goal !== 'string' ||
        typeof saved.savedAt !== 'number' ||
        Date.now() - saved.savedAt > 30 * 60 * 1000 ||
        !saved.retrieval ||
        saved.retrieval.project.projectId !== archive.project.projectId ||
        saved.retrieval.project.projectRevision !== archive.project.projectRevision
      ) {
        sessionStorage.removeItem(projectRetrievalStorageKey(params.bundleId));
        return;
      }
      const required = Array.isArray(saved.requiredSourceIds)
        ? saved.requiredSourceIds.filter((item): item is string => typeof item === 'string')
        : [];
      const excluded = Array.isArray(saved.excludedSourceIds)
        ? saved.excludedSourceIds.filter((item): item is string => typeof item === 'string')
        : [];
      queueMicrotask(() => {
        if (cancelled) return;
        setGoal(saved.goal as string);
        setRetrieval(saved.retrieval ?? null);
        setRequiredSourceIds(required);
        setExcludedSourceIds(excluded);
        setSourceControlsDirty(false);
      });
    } catch {
      sessionStorage.removeItem(projectRetrievalStorageKey(params.bundleId));
    }
    return () => {
      cancelled = true;
    };
  }, [archive?.project, params.bundleId]);

  const directContext = useMemo(
    () => (archive ? directSourceText(archive) : { text: '', truncated: false }),
    [archive],
  );

  const retrieveProject = async () => {
    if (!archive?.project || !goal.trim() || retrieving) return;
    setRetrieving(true);
    setRetrievalError(null);
    setRetrieval(null);
    try {
      const response = await fetch(
        `/api/v1/projects/${encodeURIComponent(archive.project.projectId)}/retrievals`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'X-MAIC-Protocol-Version': LEARNING_PROTOCOL_VERSION,
          },
          body: JSON.stringify({
            goal: goal.trim(),
            anchorBundleId: archive.bundle.id,
            maxContextChars: 44_000,
            requiredSourceIds,
            excludedSourceIds,
          }),
        },
      );
      const body = (await response.json()) as { retrieval?: ProjectRetrieval; error?: unknown };
      if (!response.ok || !body.retrieval) {
        throw new Error(errorMessage(body, `项目检索失败（${response.status}）`));
      }
      setRetrieval(body.retrieval);
      sessionStorage.setItem(
        projectRetrievalStorageKey(params.bundleId),
        JSON.stringify({
          goal: goal.trim(),
          retrieval: body.retrieval,
          requiredSourceIds,
          excludedSourceIds,
          savedAt: Date.now(),
        }),
      );
      setSourceControlsDirty(false);
      setWeakMatchConfirmed(false);
    } catch (reason) {
      setRetrievalError(reason instanceof Error ? reason.message : '无法检索项目资料。');
    } finally {
      setRetrieving(false);
    }
  };

  const requireSource = (sourceId: string) => {
    if (!requiredSourceIds.includes(sourceId) && requiredSourceIds.length >= 12) {
      setRetrievalError('一次最多设置 12 份“必须包含”来源。');
      return;
    }
    setRequiredSourceIds((current) =>
      current.includes(sourceId) ? current : [...current, sourceId],
    );
    setExcludedSourceIds((current) => current.filter((item) => item !== sourceId));
    setSourceControlsDirty(true);
    setWeakMatchConfirmed(false);
  };

  const excludeSource = (sourceId: string) => {
    if (!excludedSourceIds.includes(sourceId) && excludedSourceIds.length >= 12) {
      setRetrievalError('一次最多排除 12 份来源。');
      return;
    }
    setExcludedSourceIds((current) =>
      current.includes(sourceId) ? current : [...current, sourceId],
    );
    setRequiredSourceIds((current) => current.filter((item) => item !== sourceId));
    setSourceControlsDirty(true);
    setWeakMatchConfirmed(false);
  };

  const resetSource = (sourceId: string) => {
    setRequiredSourceIds((current) => current.filter((item) => item !== sourceId));
    setExcludedSourceIds((current) => current.filter((item) => item !== sourceId));
    setSourceControlsDirty(true);
    setWeakMatchConfirmed(false);
  };

  const launch = () => {
    if (!archive || !goal.trim()) return;
    if (archive.project && (!retrieval || sourceControlsDirty)) return;
    if (retrieval?.matchQuality === 'weak' && !weakMatchConfirmed) return;
    const pdfText = retrieval?.context ?? directContext.text;
    const project = retrieval?.project ?? archive.project;
    const activeLearningProject = updateLearningProjectBrief(learningProject, {
      goal: goal.trim(),
      sourceMode: webSearch ? 'hybrid' : 'obsidian',
    });
    setLearningProject(activeLearningProject);
    writeLearningProjectDraft(
      activeLearningProject,
      project?.projectId ?? params.bundleId,
    );
    writeLearningProjectDraft(activeLearningProject);
    sessionStorage.setItem(
      'generationSession',
      JSON.stringify({
        sessionId: nanoid(),
        requirements: {
          requirement: goal.trim(),
          webSearch,
          externalEvidenceMode: webSearch ? externalEvidenceMode : 'off',
          interactiveMode: true,
          learningProject: activeLearningProject,
        },
        pdfText,
        sourceContextCharCount: pdfText.length,
        pdfImages: [],
        imageStorageIds: [],
        sceneOutlines: null,
        currentStep: 'generating',
        previewPhase: 'preparing',
        sourceBundleId: archive.bundle.id,
        ...(project
          ? {
              projectId: project.projectId,
              projectName: project.displayName,
              projectRevision: project.projectRevision,
            }
          : {}),
        ...(retrieval
          ? {
              retrievalRunId: retrieval.retrievalId,
              retrievalStrategy: retrieval.strategy,
              retrievedSourceCount: retrieval.metrics.selectedSourceCount,
              retrievedChunkCount: retrieval.metrics.selectedChunkCount,
              retrievalMatchQuality: retrieval.matchQuality,
              retrievalUnavailableSourceCount:
                retrieval.metrics.unavailableSourceCount +
                retrieval.metrics.unavailableCandidateCount,
              projectCoverageState:
                retrieval.metrics.activeSourceCount === retrieval.metrics.searchableSourceCount
                  ? 'authorized-index-complete'
                  : 'authorized-index-partial',
              retrievalCitations: retrieval.citations.map((citation) => ({
                citationId: citation.citationId,
                sourceId: citation.sourceId,
                sourceVersionId: citation.sourceVersionId,
                chunkId: citation.chunkId,
                relativePath: citation.relativePath,
                headingPath: citation.headingPath,
                excerptChars: citation.excerptChars,
                contentHash: citation.contentHash,
              })),
            }
          : {}),
      }),
    );
    router.push('/generation-preview');
  };

  return (
    <main className="min-h-[100dvh] bg-slate-50 px-4 py-10 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <div className="mx-auto max-w-4xl">
        <button
          type="button"
          onClick={() => router.push('/')}
          className="mb-6 inline-flex items-center gap-2 text-sm text-slate-500 hover:text-slate-900 dark:hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" /> 返回知洄
        </button>

        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <header className="border-b border-slate-200 p-6 dark:border-slate-800">
            <div className="mb-3 flex items-center gap-2 text-sm font-medium text-violet-600 dark:text-violet-400">
              <BookOpenCheck className="h-4 w-4" /> Obsidian 学习来源
            </div>
            <h1 className="text-2xl font-semibold">
              {archive?.project
                ? '按目标检索整个项目，再启动 MAIC 学习'
                : '用这组资料启动 MAIC 学习'}
            </h1>
            <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-400">
              原笔记保持只读。项目学习会先从当前有效项目来源中选出最相关片段，并记录可追溯的 [V#]
              引用。
            </p>
          </header>

          <div className="space-y-6 p-6">
            {loading && (
              <div className="flex items-center gap-3 rounded-xl bg-slate-100 p-4 text-sm dark:bg-slate-800">
                <LoaderCircle className="h-4 w-4 animate-spin" /> 正在校验私有快照……
              </div>
            )}
            {error && (
              <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
                {error} 请确认站点访问码、设备配对和上传状态。
              </div>
            )}

            {archive && (
              <>
                {archive.project && (
                  <section className="rounded-xl border border-violet-200 bg-violet-50 p-4 dark:border-violet-900 dark:bg-violet-950/30">
                    <div className="flex items-start gap-3">
                      <Layers3 className="mt-0.5 h-5 w-5 shrink-0 text-violet-600 dark:text-violet-400" />
                      <div className="min-w-0">
                        <h2 className="font-medium text-violet-900 dark:text-violet-100">
                          {archive.project.displayName}
                        </h2>
                        <p className="mt-1 text-xs leading-5 text-violet-700 dark:text-violet-300">
                          项目版本 {archive.project.projectRevision} · 已登记{' '}
                          {archive.project.sourceCount} 份来源 · 当前可检索{' '}
                          {archive.project.searchableSourceCount} 份 ·{' '}
                          {archive.project.indexedChunkCount} 个分块
                        </p>
                        <p className="mt-1 text-xs leading-5 text-violet-600 dark:text-violet-400">
                          {archive.project.coverage === 'partial'
                            ? '本次是增量补充批次：未出现在本批次的文件不会被判定为删除；未授权或尚未索引的文件不会参与本轮学习。'
                            : '本次上传声明了完整清单覆盖。'}
                        </p>
                      </div>
                    </div>
                  </section>
                )}

                {archive.project && (
                  <section className="grid gap-3 sm:grid-cols-3">
                    <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
                      <div className="text-xs font-medium text-slate-500">① 本地扫描与授权</div>
                      <p className="mt-2 text-xs leading-5">
                        文件发现、排除和授权只在 Obsidian 中完成；未授权路径不会上传到服务器。
                      </p>
                    </div>
                    <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
                      <div className="text-xs font-medium text-slate-500">② 服务端索引覆盖</div>
                      <p className="mt-2 text-xs leading-5">
                        可检索 {archive.project.searchableSourceCount}/{archive.project.sourceCount}{' '}
                        份；索引中 {archive.project.pendingSourceCount} 份，失败{' '}
                        {archive.project.failedSourceCount} 份。
                      </p>
                    </div>
                    <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
                      <div className="text-xs font-medium text-slate-500">③ 当前目标取材</div>
                      <p className="mt-2 text-xs leading-5">
                        {retrieval
                          ? `命中 ${retrieval.metrics.matchedSourceCount} 份，最终选入 ${retrieval.metrics.selectedSourceCount} 份。`
                          : '输入具体目标并检索后，才会显示本轮真正读到的范围。'}
                      </p>
                    </div>
                  </section>
                )}

                <details className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
                    <span className="font-medium">
                      本次上传包：{archive.bundle.itemCount} 份笔记
                    </span>
                    <span className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                      <ShieldCheck className="h-3.5 w-3.5" /> 私有 Blob · 哈希一致
                    </span>
                  </summary>
                  <ul className="mt-4 space-y-2">
                    {archive.bundle.snapshots.map((snapshot) => (
                      <li
                        key={snapshot.id}
                        className="flex items-start gap-3 rounded-lg bg-slate-50 p-3 dark:bg-slate-950"
                      >
                        <Database className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">{snapshot.title}</div>
                          <div className="truncate text-xs text-slate-500">
                            {snapshot.origin === 'obsidian'
                              ? snapshot.locator.relativePath
                              : snapshot.origin}{' '}
                            · {snapshot.byteSize.toLocaleString()} bytes
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </details>

                <label className="block">
                  <span className="mb-2 block font-medium">这次你真正想解决什么问题？</span>
                  <textarea
                    value={goal}
                    onChange={(event) => {
                      setGoal(event.target.value);
                      setRetrieval(null);
                      setRetrievalError(null);
                      setRequiredSourceIds([]);
                      setExcludedSourceIds([]);
                      setSourceControlsDirty(false);
                      setWeakMatchConfirmed(false);
                      sessionStorage.removeItem(projectRetrievalStorageKey(params.bundleId));
                    }}
                    maxLength={4000}
                    rows={6}
                    placeholder="例如：我想理解数据如何流过这个项目，学完后能够独立定位缓存失效问题。"
                    className="w-full resize-y rounded-xl border border-slate-300 bg-white p-4 text-sm leading-6 outline-none ring-violet-500 transition focus:ring-2 dark:border-slate-700 dark:bg-slate-950"
                  />
                </label>
                <div className="flex flex-wrap gap-2">
                  {GOAL_TEMPLATES.map((template, index) => (
                    <button
                      key={template}
                      type="button"
                      onClick={() => {
                        setGoal(template);
                        setRetrieval(null);
                        setRetrievalError(null);
                        setRequiredSourceIds([]);
                        setExcludedSourceIds([]);
                        setSourceControlsDirty(false);
                        setWeakMatchConfirmed(false);
                        sessionStorage.removeItem(projectRetrievalStorageKey(params.bundleId));
                      }}
                      className="rounded-full border border-slate-200 px-3 py-1.5 text-xs text-slate-600 transition hover:border-violet-300 hover:text-violet-700 dark:border-slate-700 dark:text-slate-300"
                    >
                      {['理解架构', '梳理时间线', '比较方案', '排查问题'][index]}
                    </button>
                  ))}
                </div>

                <section className="rounded-xl border border-violet-200 bg-violet-50/50 p-4 dark:border-violet-900 dark:bg-violet-950/20">
                  <div className="flex items-start gap-3">
                    <Target className="mt-0.5 h-5 w-5 shrink-0 text-violet-600" />
                    <div className="min-w-0 flex-1">
                      <h2 className="text-sm font-semibold">
                        学习合同：先定义如何证明自己真的学会
                      </h2>
                      <p className="mt-1 text-xs leading-5 text-slate-600 dark:text-slate-300">
                        这些设置会影响课堂难度、提问方式、迁移任务和最终写回的掌握证据。
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <label>
                      <span className="mb-1.5 flex items-center gap-1.5 text-xs font-medium">
                        <Sparkles className="h-3.5 w-3.5 text-violet-500" /> 当前基础
                      </span>
                      <select
                        value={learningProject.priorKnowledge}
                        onChange={(event) =>
                          setLearningProject((current) =>
                            updateLearningProjectBrief(current, {
                              priorKnowledge: event.target.value as PriorKnowledgeLevel,
                            }),
                          )
                        }
                        className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900"
                      >
                        <option value="new">第一次系统学习</option>
                        <option value="basic">知道少量背景</option>
                        <option value="working">有实践但不完整</option>
                        <option value="advanced">已有深入基础</option>
                      </select>
                    </label>
                    <label>
                      <span className="mb-1.5 block text-xs font-medium">学完后的能力</span>
                      <select
                        value={learningProject.outcome}
                        onChange={(event) =>
                          setLearningProject((current) =>
                            updateLearningProjectBrief(current, {
                              outcome: event.target.value as LearningOutcomeKind,
                            }),
                          )
                        }
                        className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900"
                      >
                        <option value="understand">理解并解释</option>
                        <option value="compare">比较并判断</option>
                        <option value="apply">应用解决问题</option>
                        <option value="build">产出并验证</option>
                      </select>
                    </label>
                  </div>
                  <label className="mt-3 block">
                    <span className="mb-1.5 block text-xs font-medium">
                      已有理解与当前卡点（可选）
                    </span>
                    <textarea
                      value={learningProject.knownContext ?? ''}
                      onChange={(event) =>
                        setLearningProject((current) =>
                          updateLearningProjectBrief(current, {
                            knownContext: event.target.value,
                          }),
                        )
                      }
                      rows={2}
                      maxLength={1_000}
                      placeholder="例如：看过主要文件，但不理解数据流和关键取舍。"
                      className="w-full resize-y rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs leading-5 dark:border-slate-700 dark:bg-slate-900"
                    />
                  </label>
                  <ul className="mt-3 grid gap-2 text-xs leading-5 text-slate-700 dark:text-slate-300 sm:grid-cols-3">
                    {learningProject.successCriteria.map((criterion) => (
                      <li
                        key={criterion}
                        className="rounded-lg border border-white bg-white/80 px-3 py-2 dark:border-slate-800 dark:bg-slate-900/70"
                      >
                        <Check className="mr-1.5 inline h-3.5 w-3.5 text-emerald-500" />
                        {criterion}
                      </li>
                    ))}
                  </ul>
                </section>

                {archive.project && (
                  <section className="space-y-3">
                    {(requiredSourceIds.length > 0 || excludedSourceIds.length > 0) && (
                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs leading-5 dark:border-slate-800 dark:bg-slate-950">
                        来源规则：必须包含 {requiredSourceIds.length} 份 · 排除{' '}
                        {excludedSourceIds.length} 份
                        {sourceControlsDirty
                          ? '。规则已改变，请重新检索以冻结新的资料包。'
                          : '。这些规则已写入当前检索记录。'}
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => void retrieveProject()}
                      disabled={!goal.trim() || retrieving}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-violet-300 bg-violet-50 px-5 py-3 text-sm font-medium text-violet-800 transition hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-200 dark:hover:bg-violet-950"
                    >
                      {retrieving ? (
                        <LoaderCircle className="h-4 w-4 animate-spin" />
                      ) : (
                        <FileSearch className="h-4 w-4" />
                      )}
                      {retrieving
                        ? '正在检索并校验项目片段……'
                        : sourceControlsDirty
                          ? '按新的来源规则重新检索'
                          : '按这个目标检索整个项目'}
                    </button>

                    {retrievalError && (
                      <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
                        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                        <span>{retrievalError}</span>
                      </div>
                    )}

                    {retrieval && (
                      <div
                        className={`rounded-xl border p-4 ${
                          retrieval.matchQuality === 'strong'
                            ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/30'
                            : 'border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30'
                        }`}
                      >
                        <div className="flex items-center gap-2 font-medium">
                          {retrieval.matchQuality === 'strong' ? (
                            <SearchCheck className="h-4 w-4 text-emerald-700" />
                          ) : (
                            <TriangleAlert className="h-4 w-4 text-amber-700" />
                          )}
                          {retrieval.matchQuality === 'strong'
                            ? '已找到明确匹配，请审查来源'
                            : '匹配证据较弱，请先审查再决定'}
                        </div>
                        <div className="mt-2 grid gap-2 text-xs sm:grid-cols-4">
                          <span>可检索 {retrieval.metrics.searchableSourceCount} 份</span>
                          <span>命中 {retrieval.metrics.matchedSourceCount} 份</span>
                          <span>选入 {retrieval.metrics.selectedSourceCount} 份</span>
                          <span>
                            {retrieval.metrics.selectedChunkCount} 个片段 ·{' '}
                            {retrieval.metrics.contextCharCount.toLocaleString()} 字符
                          </span>
                        </div>
                        {(retrieval.metrics.unavailableSourceCount > 0 ||
                          retrieval.metrics.unavailableCandidateCount > 0) && (
                          <p className="mt-3 text-xs leading-5 text-amber-700 dark:text-amber-300">
                            有 {retrieval.metrics.unavailableSourceCount} 份项目来源不可检索， 另有{' '}
                            {retrieval.metrics.unavailableCandidateCount}{' '}
                            个候选片段未通过原文读取或哈希校验；可在 Obsidian 重新同步。
                          </p>
                        )}
                        {retrieval.metrics.omittedCandidateCount > 0 && (
                          <p className="mt-2 text-xs leading-5 text-slate-600 dark:text-slate-300">
                            受 16 个片段 / 44,000 字符预算限制，另有{' '}
                            {retrieval.metrics.omittedCandidateCount} 个已校验候选未选入。
                          </p>
                        )}

                        <div className="mt-4 space-y-3">
                          {retrieval.citations.map((citation) => (
                            <article
                              key={citation.chunkId}
                              className="rounded-xl border border-white/80 bg-white/80 p-3 text-xs dark:border-slate-800 dark:bg-slate-950/60"
                            >
                              <div className="flex flex-wrap items-start justify-between gap-2">
                                <div>
                                  <div className="font-medium">
                                    <span className="mr-1 font-mono">[{citation.citationId}]</span>
                                    {citation.relativePath}
                                  </div>
                                  <div className="mt-1 text-slate-500">
                                    {citation.headingPath.length > 0
                                      ? citation.headingPath.join(' › ')
                                      : '整篇入口片段'}{' '}
                                    · {relevanceLabel(citation.score)}
                                    {citation.selectionReason === 'required-source'
                                      ? ' · 你要求必须包含'
                                      : citation.selectionReason === 'project-overview'
                                        ? ' · 项目入口补充'
                                        : ' · 目标命中'}
                                    {citation.matchedTerms.length > 0
                                      ? ` · 命中 ${citation.matchedTerms.slice(0, 4).join('、')}`
                                      : ''}
                                  </div>
                                </div>
                                <div className="flex flex-wrap gap-1">
                                  <button
                                    type="button"
                                    onClick={() => requireSource(citation.sourceId)}
                                    className={`rounded px-2 py-1 ${
                                      requiredSourceIds.includes(citation.sourceId)
                                        ? 'bg-violet-600 text-white'
                                        : 'bg-slate-100 dark:bg-slate-800'
                                    }`}
                                  >
                                    <Check className="mr-1 inline h-3 w-3" />
                                    必须包含
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => excludeSource(citation.sourceId)}
                                    className={`rounded px-2 py-1 ${
                                      excludedSourceIds.includes(citation.sourceId)
                                        ? 'bg-red-600 text-white'
                                        : 'bg-slate-100 dark:bg-slate-800'
                                    }`}
                                  >
                                    <X className="mr-1 inline h-3 w-3" />
                                    排除
                                  </button>
                                  {(requiredSourceIds.includes(citation.sourceId) ||
                                    excludedSourceIds.includes(citation.sourceId)) && (
                                    <button
                                      type="button"
                                      onClick={() => resetSource(citation.sourceId)}
                                      className="rounded bg-slate-100 px-2 py-1 dark:bg-slate-800"
                                    >
                                      自动
                                    </button>
                                  )}
                                </div>
                              </div>
                              <blockquote className="mt-2 border-l-2 border-slate-300 pl-3 leading-5 text-slate-600 dark:border-slate-700 dark:text-slate-300">
                                {citation.excerptPreview}
                              </blockquote>
                            </article>
                          ))}
                        </div>

                        {retrieval.alternatives.length > 0 && (
                          <details className="mt-4">
                            <summary className="cursor-pointer text-xs font-medium">
                              查看未选入的高排名来源（{retrieval.alternatives.length}）
                            </summary>
                            <div className="mt-2 space-y-2">
                              {retrieval.alternatives.map((alternative) => {
                                const isRequired = requiredSourceIds.includes(alternative.sourceId);
                                return (
                                  <div
                                    key={alternative.chunkId}
                                    className="rounded-lg bg-white/70 p-3 text-xs dark:bg-slate-950/50"
                                  >
                                    <div className="flex items-start justify-between gap-3">
                                      <div>
                                        <div className="font-medium">
                                          {alternative.relativePath}
                                        </div>
                                        <div className="mt-1 text-slate-500">
                                          {alternative.reason} · {relevanceLabel(alternative.score)}
                                        </div>
                                      </div>
                                      <button
                                        type="button"
                                        aria-pressed={isRequired}
                                        onClick={() =>
                                          isRequired
                                            ? resetSource(alternative.sourceId)
                                            : requireSource(alternative.sourceId)
                                        }
                                        className={`shrink-0 rounded px-2 py-1 transition ${
                                          isRequired
                                            ? 'bg-violet-700 text-white shadow-sm dark:bg-violet-500 dark:text-slate-950'
                                            : 'bg-violet-100 text-violet-800 hover:bg-violet-200 dark:bg-violet-950 dark:text-violet-200 dark:hover:bg-violet-900'
                                        }`}
                                      >
                                        {isRequired ? (
                                          <Check className="mr-1 inline h-3 w-3" />
                                        ) : (
                                          <Plus className="mr-1 inline h-3 w-3" />
                                        )}
                                        {isRequired ? '已加入' : '加入'}
                                      </button>
                                    </div>
                                    <p className="mt-2 line-clamp-3 leading-5 text-slate-600 dark:text-slate-300">
                                      {alternative.excerptPreview}
                                    </p>
                                  </div>
                                );
                              })}
                            </div>
                          </details>
                        )}

                        {retrieval.matchQuality === 'weak' && (
                          <label className="mt-4 flex cursor-pointer items-start gap-2 rounded-lg border border-amber-300 bg-white/70 p-3 text-xs dark:border-amber-800 dark:bg-slate-950/50">
                            <input
                              type="checkbox"
                              checked={weakMatchConfirmed}
                              onChange={(event) => setWeakMatchConfirmed(event.target.checked)}
                              className="mt-0.5 accent-amber-600"
                            />
                            <span>
                              我已查看证据，确认仍使用这组较弱匹配生成课堂；否则我会改写目标或补充来源。
                            </span>
                          </label>
                        )}
                      </div>
                    )}
                  </section>
                )}

                <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-4 dark:border-slate-800">
                  <input
                    type="checkbox"
                    checked={webSearch}
                    onChange={(event) => setWebSearch(event.target.checked)}
                    className="mt-1 h-4 w-4 accent-violet-600"
                  />
                  <span>
                    <span className="block text-sm font-medium">同时检索最新外部资料</span>
                    <span className="mt-1 block text-xs leading-5 text-slate-500">
                      这是第二层外部研究；项目内引用 [V#] 与网络引用 [S#] 会分别保留。
                    </span>
                  </span>
                </label>

                {webSearch && (
                  <fieldset className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-950/40">
                    <legend className="px-1 text-xs font-medium">外部证据在本课中的作用</legend>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-violet-200 bg-white p-3 text-xs dark:border-violet-900 dark:bg-slate-900">
                        <input
                          type="radio"
                          name="external-evidence-mode"
                          value="supplemental"
                          checked={externalEvidenceMode === 'supplemental'}
                          onChange={() => setExternalEvidenceMode('supplemental')}
                          className="mt-0.5 accent-violet-600"
                        />
                        <span>
                          <strong className="block text-slate-900 dark:text-slate-100">
                            项目原文为主（推荐）
                          </strong>
                          <span className="mt-1 block leading-5 text-slate-500">
                            外部资料用于补充；若供应商暂时不可用，仍以已审查原文生成，并明确标记证据边界。
                          </span>
                        </span>
                      </label>
                      <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-slate-200 bg-white p-3 text-xs dark:border-slate-700 dark:bg-slate-900">
                        <input
                          type="radio"
                          name="external-evidence-mode"
                          value="required"
                          checked={externalEvidenceMode === 'required'}
                          onChange={() => setExternalEvidenceMode('required')}
                          className="mt-0.5 accent-violet-600"
                        />
                        <span>
                          <strong className="block text-slate-900 dark:text-slate-100">
                            外部权威证据必须取得
                          </strong>
                          <span className="mt-1 block leading-5 text-slate-500">
                            搜索未取得合格来源时在生成前停止，适合必须核验最新变化的任务。
                          </span>
                        </span>
                      </label>
                    </div>
                  </fieldset>
                )}

                {!archive.project && directContext.truncated && (
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    本次送入生成流程的文本已按 50,000 字符生成上限截断；原始私有快照未改变。
                  </p>
                )}

                <button
                  type="button"
                  onClick={launch}
                  disabled={
                    !goal.trim() ||
                    Boolean(archive.project && (!retrieval || sourceControlsDirty)) ||
                    Boolean(retrieval?.matchQuality === 'weak' && !weakMatchConfirmed)
                  }
                  className="w-full rounded-xl bg-violet-600 px-5 py-3 text-sm font-medium text-white transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {archive.project && !retrieval
                    ? '请先检索项目资料'
                    : sourceControlsDirty
                      ? '请按新的来源规则重新检索'
                      : retrieval?.matchQuality === 'weak' && !weakMatchConfirmed
                        ? '请先确认较弱匹配'
                        : '使用这些来源生成课堂'}
                </button>
              </>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
