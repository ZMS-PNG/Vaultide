'use client';

import { LEARNING_PROTOCOL_VERSION } from '@openmaic/learning-protocol';
import {
  ArrowLeft,
  BookOpenCheck,
  BrainCircuit,
  CalendarRange,
  ChevronDown,
  Link2,
  Layers3,
  LoaderCircle,
  Network,
  SlidersHorizontal,
  Target,
} from 'lucide-react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { SynthesisSchedulePanel } from '@/components/learning/synthesis-schedule-panel';
import { SynthesisWriteback } from '@/components/learning/synthesis-writeback';
import { SynthesisFreshnessBanner } from '@/components/learning/synthesis-freshness-banner';
import { MarkdownText } from '@/components/scene-renderers/pbl/v2/markdown-text';
import type {
  SynthesisFilterOptions,
  SynthesisListItem,
  SynthesisMode,
  SynthesisRequest,
  SynthesisRunView,
  SynthesisSourceType,
  SynthesisScope,
} from '@/lib/learning/domain/synthesis';
import { VaultideLearningDock } from '@/components/learning/vaultide-learning-dock';
import type { LearningSessionStage } from '@/lib/learning/domain/learning-session';
import { useLearningSessionStore } from '@/lib/store/learning-session';

const KnowledgeGraphV2Shell = dynamic(
  () =>
    import('@/components/learning/knowledge-graph-v2/knowledge-graph-shell').then(
      (module) => module.KnowledgeGraphV2Shell,
    ),
  {
    ssr: false,
    loading: () => (
      <div className="flex min-h-[420px] items-center justify-center gap-2 rounded-xl border border-slate-200 text-sm text-slate-500 dark:border-slate-700">
        <LoaderCircle className="h-4 w-4 animate-spin" /> 正在加载图谱交互层…
      </div>
    ),
  },
);

async function responseJson<T>(response: Response): Promise<T> {
  const body = (await response.json()) as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(body.error?.message || `请求失败（${response.status}）`);
  return body;
}

const protocolHeaders = {
  'Content-Type': 'application/json',
  'X-MAIC-Protocol-Version': LEARNING_PROTOCOL_VERSION,
};

async function requestSynthesis(request: SynthesisRequest): Promise<SynthesisRunView> {
  const response = await fetch('/api/v1/syntheses', {
    method: 'POST',
    headers: protocolHeaders,
    body: JSON.stringify(request),
    cache: 'no-store',
  });
  const result = await responseJson<{ synthesis: SynthesisRunView }>(response);
  return result.synthesis;
}

const EMPTY_FILTERS: SynthesisFilterOptions = {
  projects: [],
  classrooms: [],
  domains: [],
  topicTags: [],
  sourceTypes: [],
};

const SOURCE_TYPE_LABEL: Record<SynthesisSourceType, string> = {
  obsidian: '仅 Obsidian',
  external: '仅外部检索',
  hybrid: 'Obsidian + 外部检索',
  classroom: '仅课堂内容',
};

function displayTag(tag: string): string {
  return tag.replace(/^#+/, '');
}

export default function KnowledgePage() {
  const router = useRouter();
  const [items, setItems] = useState<SynthesisListItem[]>([]);
  const [current, setCurrent] = useState<SynthesisRunView | null>(null);
  const [question, setQuestion] = useState('');
  const [mode, setMode] = useState<SynthesisMode>('combined');
  const [timeFrom, setTimeFrom] = useState('');
  const [timeTo, setTimeTo] = useState('');
  const [domainQuery, setDomainQuery] = useState('');
  const [domain, setDomain] = useState('');
  const [sourceType, setSourceType] = useState<SynthesisSourceType | ''>('');
  const [projectId, setProjectId] = useState('');
  const [classroomId, setClassroomId] = useState('');
  const [topicTag, setTopicTag] = useState('');
  const [filters, setFilters] = useState<SynthesisFilterOptions>(EMPTY_FILTERS);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [writebackOpen, setWritebackOpen] = useState(false);
  const bridgeState = useLearningSessionStore((state) => state.bridgeState);
  const pendingWritebacks = useLearningSessionStore((state) => state.pendingWritebacks);
  const attentionCount = useLearningSessionStore((state) => state.attentionCount);
  const markWritebackPending = useLearningSessionStore((state) => state.markWritebackPending);
  const markWritebackQueued = useLearningSessionStore((state) => state.markWritebackQueued);

  const applySynthesisScope = (synthesis: SynthesisRunView) => {
    const scope = synthesis.scope;
    setMode(synthesis.mode);
    setQuestion(typeof scope.question === 'string' ? scope.question : '');
    setTimeFrom(typeof scope.timeFrom === 'string' ? scope.timeFrom : '');
    setTimeTo(typeof scope.timeTo === 'string' ? scope.timeTo : '');
    setDomainQuery(typeof scope.domainQuery === 'string' ? scope.domainQuery : '');
    setDomain(typeof scope.domain === 'string' ? scope.domain : '');
    setSourceType(
      scope.sourceType && ['obsidian', 'external', 'hybrid', 'classroom'].includes(scope.sourceType)
        ? scope.sourceType
        : '',
    );
    setProjectId(scope.projectIds?.length === 1 ? scope.projectIds[0]! : '');
    setClassroomId(scope.classroomIds?.length === 1 ? scope.classroomIds[0]! : '');
    setTopicTag(scope.topicTags?.length === 1 ? scope.topicTags[0]! : '');
  };

  const loadSynthesis = async (id: string) => {
    const response = await fetch(`/api/v1/syntheses/${encodeURIComponent(id)}`, {
      headers: { 'X-MAIC-Protocol-Version': LEARNING_PROTOCOL_VERSION },
      cache: 'no-store',
    });
    const result = await responseJson<{ synthesis: SynthesisRunView }>(response);
    setCurrent(result.synthesis);
    applySynthesisScope(result.synthesis);
  };

  const refreshList = async () => {
    const response = await fetch('/api/v1/syntheses?limit=30', {
      headers: { 'X-MAIC-Protocol-Version': LEARNING_PROTOCOL_VERSION },
      cache: 'no-store',
    });
    const result = await responseJson<{
      syntheses: SynthesisListItem[];
      filters?: SynthesisFilterOptions;
    }>(response);
    setItems(result.syntheses);
    setError(null);
    setFilters(
      result.filters
        ? {
            ...EMPTY_FILTERS,
            ...result.filters,
            projects: result.filters.projects ?? [],
          }
        : EMPTY_FILTERS,
    );
    return result.syntheses;
  };

  useEffect(() => {
    void (async () => {
      try {
        const list = await refreshList();
        const searchParams = new URLSearchParams(window.location.search);
        const requested = searchParams.get('synthesis');
        const requestedQuestion = searchParams.get('question');
        const requestedClassroom = searchParams.get('classroomId')?.trim().slice(0, 200);
        if (requested) {
          await loadSynthesis(requested);
          if (requestedQuestion) setQuestion(requestedQuestion.slice(0, 300));
        } else if (requestedClassroom) {
          // Entering from a classroom means “summarize this classroom now”.
          // Generate a fresh, explicitly scoped snapshot instead of showing
          // whichever unrelated synthesis happened to be newest.
          setClassroomId(requestedClassroom);
          const synthesis = await requestSynthesis({
            mode: 'combined',
            classroomIds: [requestedClassroom],
            ...(requestedQuestion ? { question: requestedQuestion.slice(0, 300) } : {}),
          });
          setCurrent(synthesis);
          applySynthesisScope(synthesis);
          markWritebackPending(1);
          window.history.replaceState(null, '', `/knowledge?synthesis=${synthesis.id}`);
          await refreshList();
        } else {
          const id = list[0]?.id;
          if (id) await loadSynthesis(id);
          if (requestedQuestion) setQuestion(requestedQuestion.slice(0, 300));
        }
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : '无法读取知识归纳。');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const generate = async (requestOverride?: SynthesisRequest) => {
    setGenerating(true);
    setError(null);
    try {
      const synthesis = await requestSynthesis(
        requestOverride ?? {
          mode,
          ...(question.trim() ? { question: question.trim() } : {}),
          ...(timeFrom ? { timeFrom } : {}),
          ...(timeTo ? { timeTo } : {}),
          ...(domainQuery.trim() ? { domainQuery: domainQuery.trim() } : {}),
          ...(domain ? { domain } : {}),
          ...(sourceType ? { sourceType } : {}),
          ...(projectId ? { projectIds: [projectId] } : {}),
          ...(classroomId ? { classroomIds: [classroomId] } : {}),
          ...(topicTag ? { topicTags: [topicTag] } : {}),
        },
      );
      setCurrent(synthesis);
      applySynthesisScope(synthesis);
      markWritebackPending(1);
      window.history.replaceState(null, '', `/knowledge?synthesis=${synthesis.id}`);
      await refreshList();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法生成知识归纳。');
    } finally {
      setGenerating(false);
    }
  };

  const resetFilters = () => {
    setMode('combined');
    setQuestion('');
    setTimeFrom('');
    setTimeTo('');
    setDomainQuery('');
    setDomain('');
    setSourceType('');
    setProjectId('');
    setClassroomId('');
    setTopicTag('');
  };

  const conceptCount = current?.graph.nodes.filter((node) => node.type === 'concept').length ?? 0;
  const citedSourceCount =
    current?.graph.nodes.filter((node) => node.type === 'source' && node.url).length ?? 0;
  const weakClassroomCount =
    current?.graph.nodes.filter(
      (node) => node.type === 'classroom' && node.mastery !== null && node.mastery < 0.5,
    ).length ?? 0;
  const latestSynthesisId = items.reduce<string | null>((latestId, item) => {
    if (!latestId) return item.id;
    const latest = items.find((candidate) => candidate.id === latestId);
    return !latest || Date.parse(item.createdAt) > Date.parse(latest.createdAt)
      ? item.id
      : latestId;
  }, null);
  const scheduleScope: SynthesisScope = {
    ...(question.trim() ? { question: question.trim() } : {}),
    ...(timeFrom ? { timeFrom } : {}),
    ...(timeTo ? { timeTo } : {}),
    ...(domainQuery.trim() ? { domainQuery: domainQuery.trim() } : {}),
    ...(domain ? { domain } : {}),
    ...(sourceType ? { sourceType } : {}),
    ...(projectId ? { projectIds: [projectId] } : {}),
    ...(classroomId ? { classroomIds: [classroomId] } : {}),
    ...(topicTag ? { topicTags: [topicTag] } : {}),
  };

  const handleLearningStageChange = (stage: LearningSessionStage) => {
    if (stage === 'goal') {
      document.getElementById('synthesis-question')?.focus();
      return;
    }
    if (stage === 'classroom') {
      router.push('/?open=review');
      return;
    }
    if (current) {
      setWritebackOpen(true);
    } else {
      document.getElementById('synthesis-question')?.focus();
    }
  };

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <div className="mx-auto max-w-[1600px] px-4 py-5 sm:px-6 lg:px-8">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-violet-600"
            >
              <ArrowLeft className="h-4 w-4" /> 返回知洄
            </Link>
            <div className="mt-3 flex items-center gap-3">
              <div className="rounded-2xl bg-violet-600 p-3 text-white shadow-lg shadow-violet-600/20">
                <BrainCircuit className="h-6 w-6" />
              </div>
              <div>
                <h1 className="text-2xl font-semibold tracking-tight">知识归纳与学习导航</h1>
                <p className="mt-1 text-sm text-slate-500">
                  先提出要回答的问题，再让课堂、来源、Obsidian 与掌握证据共同形成结论。
                </p>
              </div>
            </div>
          </div>
          {current && (
            <SynthesisWriteback
              key={current.id}
              synthesisId={current.id}
              open={writebackOpen}
              onOpenChange={setWritebackOpen}
              onWritebackPending={markWritebackPending}
              onWritebackQueued={markWritebackQueued}
            />
          )}
        </header>

        <section className="mt-5 rounded-2xl border border-violet-200 bg-gradient-to-br from-violet-50 to-cyan-50 p-4 shadow-sm dark:border-violet-900 dark:from-violet-950/35 dark:to-cyan-950/25">
          <div className="flex items-start gap-3">
            <span className="rounded-xl bg-violet-600 p-2 text-white">
              <Target className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <label htmlFor="synthesis-question" className="text-sm font-semibold">
                这次归纳要回答什么问题？
              </label>
              <p className="mt-1 text-xs leading-5 text-slate-600 dark:text-slate-300">
                问题会决定推荐的关系视角和归纳重点；范围与时间只是证据边界。
              </p>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <input
                  id="synthesis-question"
                  value={question}
                  onChange={(event) => setQuestion(event.target.value)}
                  maxLength={300}
                  placeholder="例如：这些方案为什么发生变化，当前最可靠的选择是什么？"
                  className="h-11 min-w-0 flex-1 rounded-xl border border-white bg-white/90 px-4 text-sm outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-100 dark:border-slate-800 dark:bg-slate-900 dark:focus:ring-violet-950"
                />
                <button
                  type="button"
                  onClick={() => void generate()}
                  disabled={generating}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-violet-600 px-5 text-sm font-medium text-white transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {generating && <LoaderCircle className="h-4 w-4 animate-spin" />}
                  用当前证据回答
                </button>
              </div>
            </div>
          </div>
        </section>

        <details className="group mt-5 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-4 py-3.5 [&::-webkit-details-marker]:hidden">
            <div className="flex min-w-0 items-center gap-3">
              <div className="rounded-xl bg-slate-100 p-2 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                <SlidersHorizontal className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <h2 className="text-sm font-semibold">调整归纳范围与周期计划</h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  需要重新归纳或自动生成快照时再展开；日常学习无需设置。
                </p>
              </div>
            </div>
            <span className="inline-flex shrink-0 items-center gap-1.5 text-xs font-medium text-violet-600">
              按需展开
              <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
            </span>
          </summary>
          <div className="border-t border-slate-200 px-4 pb-4 dark:border-slate-800">
            <section className="mt-4 grid min-w-0 gap-4 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 md:grid-cols-2 xl:grid-cols-4">
              <div className="flex items-start justify-between gap-4 md:col-span-2 xl:col-span-4">
                <div>
                  <h2 className="text-sm font-semibold">选择归纳范围</h2>
                  <p className="mt-1 text-xs text-slate-500">
                    未选择的条件按“全部”处理，可组合时间、板块、来源与 Obsidian 标签。
                  </p>
                </div>
                <button
                  type="button"
                  onClick={resetFilters}
                  className="shrink-0 rounded-lg px-3 py-1.5 text-xs text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-white"
                >
                  清空筛选
                </button>
              </div>
              <label className="min-w-0 space-y-1.5 text-sm">
                <span className="text-slate-500">归纳模式</span>
                <select
                  value={mode}
                  onChange={(event) => setMode(event.target.value as SynthesisMode)}
                  className="h-10 w-full rounded-lg border border-slate-200 bg-transparent px-3 dark:border-slate-700"
                >
                  <option value="combined">时间 × 板块</option>
                  <option value="timeline">时间线</option>
                  <option value="domain">知识板块</option>
                </select>
              </label>
              <label className="min-w-0 space-y-1.5 text-sm">
                <span className="text-slate-500">来源类型</span>
                <select
                  value={sourceType}
                  onChange={(event) =>
                    setSourceType(event.target.value as SynthesisSourceType | '')
                  }
                  className="h-10 w-full rounded-lg border border-slate-200 bg-transparent px-3 dark:border-slate-700"
                >
                  <option value="">全部来源</option>
                  {filters.sourceTypes.map((type) => (
                    <option key={type} value={type}>
                      {SOURCE_TYPE_LABEL[type]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="min-w-0 space-y-1.5 text-sm">
                <span className="text-slate-500">项目</span>
                <select
                  value={projectId}
                  onChange={(event) => setProjectId(event.target.value)}
                  className="h-10 w-full rounded-lg border border-slate-200 bg-transparent px-3 dark:border-slate-700"
                >
                  <option value="">全部项目</option>
                  {filters.projects.map((project) => (
                    <option key={project.projectId} value={project.projectId}>
                      {project.projectName} · {project.classroomCount} 个课堂
                    </option>
                  ))}
                </select>
              </label>
              <label className="min-w-0 space-y-1.5 text-sm">
                <span className="text-slate-500">课堂</span>
                <select
                  value={classroomId}
                  onChange={(event) => setClassroomId(event.target.value)}
                  className="h-10 w-full rounded-lg border border-slate-200 bg-transparent px-3 dark:border-slate-700"
                >
                  <option value="">全部课堂</option>
                  {filters.classrooms.map((classroom) => (
                    <option key={classroom.classroomId} value={classroom.classroomId}>
                      {classroom.title} · {classroom.createdAt.slice(0, 10)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="min-w-0 space-y-1.5 text-sm">
                <span className="text-slate-500">知识板块</span>
                <select
                  value={domain}
                  onChange={(event) => setDomain(event.target.value)}
                  className="h-10 w-full rounded-lg border border-slate-200 bg-transparent px-3 dark:border-slate-700"
                >
                  <option value="">全部板块</option>
                  {filters.domains.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </label>
              <label className="min-w-0 space-y-1.5 text-sm">
                <span className="text-slate-500">Obsidian 主题标签</span>
                <select
                  value={topicTag}
                  onChange={(event) => setTopicTag(event.target.value)}
                  className="h-10 w-full rounded-lg border border-slate-200 bg-transparent px-3 dark:border-slate-700"
                >
                  <option value="">全部标签</option>
                  {filters.topicTags.map((tag) => (
                    <option key={tag} value={tag}>
                      #{displayTag(tag)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="min-w-0 space-y-1.5 text-sm">
                <span className="text-slate-500">开始日期</span>
                <input
                  type="date"
                  value={timeFrom}
                  onChange={(event) => setTimeFrom(event.target.value)}
                  className="h-10 w-full rounded-lg border border-slate-200 bg-transparent px-3 dark:border-slate-700"
                />
              </label>
              <label className="min-w-0 space-y-1.5 text-sm">
                <span className="text-slate-500">结束日期</span>
                <input
                  type="date"
                  value={timeTo}
                  onChange={(event) => setTimeTo(event.target.value)}
                  className="h-10 w-full rounded-lg border border-slate-200 bg-transparent px-3 dark:border-slate-700"
                />
              </label>
              <label className="min-w-0 space-y-1.5 text-sm">
                <span className="text-slate-500">全文关键词（可选）</span>
                <input
                  value={domainQuery}
                  onChange={(event) => setDomainQuery(event.target.value)}
                  placeholder="例如：人工智能、历史、产品"
                  className="h-10 w-full rounded-lg border border-slate-200 bg-transparent px-3 dark:border-slate-700"
                />
              </label>
              <button
                type="button"
                disabled={generating}
                onClick={() => void generate()}
                className="mt-auto inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-violet-600 px-5 text-sm font-medium text-white shadow-sm shadow-violet-600/20 transition hover:bg-violet-700 disabled:opacity-60 md:col-span-2 xl:col-span-1"
              >
                {generating ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : (
                  <Network className="h-4 w-4" />
                )}
                {current ? '重新生成归纳' : '生成归纳'}
              </button>
            </section>

            <SynthesisSchedulePanel
              mode={mode}
              scope={scheduleScope}
              onSnapshotsCreated={async (syntheses) => {
                const newest = syntheses.at(-1);
                if (newest) {
                  setCurrent(newest);
                  window.history.replaceState(null, '', `/knowledge?synthesis=${newest.id}`);
                }
                await refreshList();
              }}
            />
          </div>
        </details>

        {error && (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex min-h-[55dvh] items-center justify-center gap-2 text-sm text-slate-500">
            <LoaderCircle className="h-5 w-5 animate-spin" /> 正在加载知识图谱…
          </div>
        ) : current ? (
          <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.7fr)_minmax(360px,.8fr)]">
            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="font-semibold">{current.title}</h2>
                  <p className="mt-1 text-xs text-slate-500">
                    {current.classroomCount} 个课堂 · {current.nodeCount} 个节点 ·{' '}
                    {current.edgeCount} 条关系
                  </p>
                </div>
                <div className="flex gap-2 text-xs text-slate-500">
                  <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 dark:bg-slate-800">
                    <CalendarRange className="h-3.5 w-3.5" /> {current.createdAt.slice(0, 10)}
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 dark:bg-slate-800">
                    <Layers3 className="h-3.5 w-3.5" /> {current.mode}
                  </span>
                </div>
              </div>
              <div className="mb-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
                <div className="rounded-xl bg-violet-50 p-3 dark:bg-violet-950/30">
                  <div className="flex items-center gap-1.5 text-[11px] text-violet-600 dark:text-violet-300">
                    <BookOpenCheck className="h-3.5 w-3.5" /> 已归纳课堂
                  </div>
                  <div className="mt-1 text-lg font-semibold">{current.classroomCount}</div>
                </div>
                <div className="rounded-xl bg-cyan-50 p-3 dark:bg-cyan-950/30">
                  <div className="flex items-center gap-1.5 text-[11px] text-cyan-700 dark:text-cyan-300">
                    <Network className="h-3.5 w-3.5" /> 知识点
                  </div>
                  <div className="mt-1 text-lg font-semibold">{conceptCount}</div>
                </div>
                <div className="rounded-xl bg-blue-50 p-3 dark:bg-blue-950/30">
                  <div className="flex items-center gap-1.5 text-[11px] text-blue-700 dark:text-blue-300">
                    <Link2 className="h-3.5 w-3.5" /> 外部引用
                  </div>
                  <div className="mt-1 text-lg font-semibold">{citedSourceCount}</div>
                </div>
                <div className="rounded-xl bg-amber-50 p-3 dark:bg-amber-950/30">
                  <div className="flex items-center gap-1.5 text-[11px] text-amber-700 dark:text-amber-300">
                    <Target className="h-3.5 w-3.5" /> 待强化课堂
                  </div>
                  <div className="mt-1 text-lg font-semibold">{weakClassroomCount}</div>
                </div>
              </div>
              <SynthesisFreshnessBanner
                synthesis={current}
                filters={filters}
                isLatest={current.id === latestSynthesisId}
                regenerating={generating}
                onRegenerate={() =>
                  void generate({
                    mode: current.mode,
                    ...current.scope,
                  })
                }
              />
              {current.incremental && current.delta && (
                <section className="mb-4 rounded-xl border border-violet-100 bg-violet-50/60 p-3 dark:border-violet-900/60 dark:bg-violet-950/20">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-xs font-semibold text-violet-800 dark:text-violet-200">
                      相对上次快照的变化
                    </h3>
                    {current.baselineSynthesisId && (
                      <span className="font-mono text-[10px] text-violet-600 dark:text-violet-300">
                        基线 {current.baselineSynthesisId.slice(-8)}
                      </span>
                    )}
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-3 lg:grid-cols-6">
                    <div>
                      <span className="text-slate-500">新增课堂</span>
                      <div className="mt-0.5 font-semibold">
                        {current.delta.addedClassroomIds.length}
                      </div>
                    </div>
                    <div>
                      <span className="text-slate-500">更新课堂</span>
                      <div className="mt-0.5 font-semibold">
                        {current.delta.updatedClassroomIds.length}
                      </div>
                    </div>
                    <div>
                      <span className="text-slate-500">移出课堂</span>
                      <div className="mt-0.5 font-semibold">
                        {current.delta.removedClassroomIds.length}
                      </div>
                    </div>
                    <div>
                      <span className="text-slate-500">掌握加强</span>
                      <div className="mt-0.5 font-semibold text-emerald-600">
                        {current.delta.strengthened.length}
                      </div>
                    </div>
                    <div>
                      <span className="text-slate-500">需要巩固</span>
                      <div className="mt-0.5 font-semibold text-amber-600">
                        {current.delta.weakened.length}
                      </div>
                    </div>
                    <div>
                      <span className="text-slate-500">关系变化</span>
                      <div className="mt-0.5 font-semibold">
                        {current.delta.relationChanges.length}
                      </div>
                    </div>
                  </div>
                  <p className="mt-2 text-[11px] leading-4 text-slate-500">
                    冲突只会在未来能同时给出相互矛盾证据时显示；当前不会依据图形形状猜测冲突。
                  </p>
                </section>
              )}
              <KnowledgeGraphV2Shell
                key={current.id}
                synthesisId={current.id}
                fallbackGraph={current.graph}
                question={
                  typeof current.scope.question === 'string' ? current.scope.question : undefined
                }
              />
            </section>
            <aside className="space-y-4">
              <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <h2 className="font-semibold">归纳笔记</h2>
                <div className="mt-3 max-h-[70dvh] overflow-auto pr-2 text-slate-700 dark:text-slate-300">
                  <MarkdownText
                    key={current.id}
                    content={current.summaryMarkdown}
                    className="prose-headings:scroll-mt-4 [&_h1]:!mb-4 [&_h1]:!text-xl [&_h1]:!leading-snug prose-h2:text-base prose-h2:border-b prose-h2:border-slate-200 prose-h2:pb-2 dark:prose-h2:border-slate-700"
                  />
                </div>
              </section>
              {items.length > 0 && (
                <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                  <h2 className="text-sm font-semibold">历史归纳</h2>
                  <div className="mt-3 space-y-2">
                    {items.slice(0, 10).map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => {
                          setError(null);
                          void loadSynthesis(item.id).catch((reason) =>
                            setError(reason instanceof Error ? reason.message : '无法读取归纳。'),
                          );
                          window.history.replaceState(null, '', `/knowledge?synthesis=${item.id}`);
                        }}
                        className="w-full rounded-lg border border-slate-200 p-2.5 text-left text-xs hover:border-violet-300 hover:bg-violet-50 dark:border-slate-700 dark:hover:bg-violet-950/20"
                      >
                        <div className="truncate font-medium">{item.title}</div>
                        <div className="mt-1 text-slate-500">
                          {item.classroomCount} 课堂 · {item.nodeCount} 节点
                        </div>
                      </button>
                    ))}
                  </div>
                </section>
              )}
            </aside>
          </div>
        ) : (
          <div className="mt-6 rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center dark:border-slate-700 dark:bg-slate-900">
            <Network className="mx-auto h-10 w-10 text-violet-500" />
            <h2 className="mt-3 text-lg font-semibold">尚未生成知识归纳</h2>
            <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-500">
              若已有持久化课堂，可直接选择范围并点击“生成归纳”；建议累计多个真实学习课堂后再比较时间、板块与掌握度关系。
            </p>
          </div>
        )}
      </div>
      <VaultideLearningDock
        activeStage={current ? 'writeback' : 'goal'}
        attentionCount={attentionCount}
        bridgeState={bridgeState}
        classroomCopy="返回记忆与复习"
        classroomCount={filters.classrooms.length}
        goalCopy={question.trim() ? '归纳问题已定义' : '定义本次归纳问题'}
        hasGoal={Boolean(question.trim())}
        onStageChange={handleLearningStageChange}
        onPrepareWriteback={() => {
          if (current) setWritebackOpen(true);
        }}
        pendingWritebacks={current ? Math.max(1, pendingWritebacks) : 0}
        writebackCopy={current ? '归纳结果可沉淀' : '先生成知识归纳'}
      />
    </main>
  );
}
