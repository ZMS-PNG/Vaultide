'use client';

import { LEARNING_PROTOCOL_VERSION } from '@openmaic/learning-protocol';
import { CircleAlert, LoaderCircle, Search, ShieldCheck } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  KnowledgeEdgeV2,
  KnowledgeGraphNeighborhood,
  KnowledgeGraphPath,
  KnowledgeGraphV2,
  KnowledgeNodeTypeV2,
  KnowledgeNodeV2,
} from '@/lib/learning/domain/knowledge-graph-v2/contracts';
import { filterKnowledgeGraph } from '@/lib/learning/domain/knowledge-graph-v2/graph-query';
import {
  KNOWLEDGE_SPACE_LENSES,
  projectKnowledgeSpace,
  recommendKnowledgeSpaceLens,
  type KnowledgeSpaceLens,
} from '@/lib/learning/domain/knowledge-graph-v2/knowledge-space';
import type { KnowledgeGraph } from '@/lib/learning/domain/synthesis';
import { EdgeDetails } from './edge-details';
import { GraphAccessibleList } from './graph-accessible-list';
import { KnowledgeGraphCanvasFallback } from './knowledge-graph-canvas-fallback';
import { KnowledgeLearningNavigator } from './knowledge-learning-navigator';
import { KnowledgeSpaceControls } from './knowledge-space-controls';
import { NodeDetails } from './node-details';
import { WebGLErrorBoundary } from './webgl-error-boundary';
import { KnowledgeGraph3D } from '../knowledge-graph-3d';

const KnowledgeGraphWebGL = dynamic(
  () => import('./knowledge-graph-webgl').then((module) => module.KnowledgeGraphWebGL),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[520px] items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-950 text-xs text-slate-300">
        <LoaderCircle className="h-4 w-4 animate-spin" /> 正在加载 WebGL 图谱渲染器…
      </div>
    ),
  },
);

const NODE_TYPES: Array<{ value: KnowledgeNodeTypeV2 | ''; label: string }> = [
  { value: '', label: '全部节点' },
  { value: 'project', label: '项目' },
  { value: 'original-note', label: '原笔记（只读）' },
  { value: 'companion-note', label: '学习伴随笔记' },
  { value: 'external-source', label: '外部来源' },
  { value: 'classroom', label: '课堂' },
  { value: 'concept', label: '概念' },
  { value: 'review', label: '复习项' },
];

const headers = {
  'Content-Type': 'application/json',
  'X-MAIC-Protocol-Version': LEARNING_PROTOCOL_VERSION,
};

const RENDERER_PREFERENCE_KEY = 'vaultide:knowledge-graph-renderer';
const VIEW_MODE_PREFERENCE_KEY = 'vaultide:knowledge-graph-view-mode';
const SPACE_LENS_PREFERENCE_KEY = 'vaultide:knowledge-space-lens';

async function responseJson<T>(response: Response): Promise<T> {
  const body = (await response.json()) as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(body.error?.message || `图谱请求失败（${response.status}）`);
  return body;
}

export function KnowledgeGraphV2Shell({
  synthesisId,
  fallbackGraph,
  question,
}: {
  synthesisId: string;
  fallbackGraph: KnowledgeGraph;
  question?: string;
}) {
  const recommendedLens = recommendKnowledgeSpaceLens(question);
  const [graph, setGraph] = useState<KnowledgeGraphV2 | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [nodeType, setNodeType] = useState<KnowledgeNodeTypeV2 | ''>('');
  const [minimumConfidence, setMinimumConfidence] = useState(0.55);
  const [showCandidates, setShowCandidates] = useState(false);
  const [selectedNode, setSelectedNode] = useState<KnowledgeNodeV2 | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<KnowledgeEdgeV2 | null>(null);
  const [feedbackBusy, setFeedbackBusy] = useState(false);
  const [webglEnabled, setWebglEnabled] = useState(false);
  const [renderer, setRenderer] = useState<'webgl' | 'canvas'>('canvas');
  const [viewMode, setViewMode] = useState<'learning' | 'explore'>('learning');
  const [spaceLens, setSpaceLens] = useState<KnowledgeSpaceLens>(recommendedLens);
  const [activeSpaceClusterId, setActiveSpaceClusterId] = useState<string | null>(null);
  const [obsidianVaultName, setObsidianVaultName] = useState<string | undefined>();
  const [focus, setFocus] = useState<{
    label: string;
    nodeIds: string[];
    edgeIds: string[];
  } | null>(null);
  const [pathStart, setPathStart] = useState<KnowledgeNodeV2 | null>(null);
  const [navigationBusy, setNavigationBusy] = useState(false);
  const learningDetailsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch('/api/v1/knowledge-graphs/projections', {
          method: 'POST',
          headers,
          body: JSON.stringify({ synthesisId }),
          cache: 'no-store',
        });
        const result = await responseJson<{
          projection: { graph: KnowledgeGraphV2 };
          renderer?: { webglEnabled?: boolean; obsidianVaultName?: string };
        }>(response);
        if (!cancelled) {
          const webgl =
            result.renderer?.webglEnabled === true &&
            typeof window !== 'undefined' &&
            ('WebGL2RenderingContext' in window || 'WebGLRenderingContext' in window);
          setGraph(result.projection.graph);
          setWebglEnabled(result.renderer?.webglEnabled === true);
          setObsidianVaultName(result.renderer?.obsidianVaultName);
          const preferred = window.localStorage.getItem(RENDERER_PREFERENCE_KEY);
          setRenderer(preferred === 'canvas' || !webgl ? 'canvas' : 'webgl');
          const preferredView = window.localStorage.getItem(VIEW_MODE_PREFERENCE_KEY);
          setViewMode(preferredView === 'explore' ? 'explore' : 'learning');
          const preferredLens = window.localStorage.getItem(SPACE_LENS_PREFERENCE_KEY);
          setSpaceLens(
            question
              ? recommendedLens
              : preferredLens === 'domain' || preferredLens === 'source' || preferredLens === 'time'
                ? preferredLens
                : recommendedLens,
          );
        }
      } catch (reason) {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : '图谱 v2 暂时不可用。');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [question, recommendedLens, synthesisId]);

  const chooseRenderer = (next: 'webgl' | 'canvas') => {
    setRenderer(next);
    try {
      window.localStorage.setItem(RENDERER_PREFERENCE_KEY, next);
    } catch {
      // A privacy-restricted browser can still use the current-session choice.
    }
  };

  const chooseViewMode = (next: 'learning' | 'explore') => {
    setViewMode(next);
    try {
      window.localStorage.setItem(VIEW_MODE_PREFERENCE_KEY, next);
    } catch {
      // A privacy-restricted browser can still use the current-session choice.
    }
  };

  const chooseSpaceLens = (next: KnowledgeSpaceLens) => {
    setSpaceLens(next);
    setActiveSpaceClusterId(null);
    setSelectedEdge(null);
    try {
      window.localStorage.setItem(SPACE_LENS_PREFERENCE_KEY, next);
    } catch {
      // A privacy-restricted browser can still use the current-session choice.
    }
  };

  const filtered = useMemo(() => {
    if (!graph) return null;
    const base = filterKnowledgeGraph(graph, {
      ...(nodeType ? { nodeTypes: [nodeType] } : {}),
      minConfidence: minimumConfidence,
      includeCandidates: showCandidates,
    });
    const needle = query.trim().toLocaleLowerCase();
    const searched = !needle
      ? base
      : (() => {
          const nodes = base.nodes.filter((node) =>
            node.label.toLocaleLowerCase().includes(needle),
          );
          const ids = new Set(nodes.map((node) => node.id));
          return {
            ...base,
            nodes,
            edges: base.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target)),
          };
        })();
    if (!focus) return searched;
    const focusNodeIds = new Set(focus.nodeIds);
    const focusEdgeIds = new Set(focus.edgeIds);
    const nodes = searched.nodes.filter((node) => focusNodeIds.has(node.id));
    const ids = new Set(nodes.map((node) => node.id));
    const edges = searched.edges.filter(
      (edge) => focusEdgeIds.has(edge.id) && ids.has(edge.source) && ids.has(edge.target),
    );
    const evidenceIds = new Set([
      ...nodes.flatMap((node) => node.evidenceRefs),
      ...edges.flatMap((edge) => edge.evidenceRefs),
    ]);
    return {
      ...searched,
      nodes,
      edges,
      evidence: searched.evidence.filter((item) => evidenceIds.has(item.id)),
    };
  }, [focus, graph, minimumConfidence, nodeType, query, showCandidates]);

  const rendered = useMemo(() => {
    if (!filtered) return null;
    const lod = filtered.nodes.length >= 2000 ? 2 : filtered.nodes.length >= 750 ? 1 : 0;
    return lod === 0 ? filtered : filterKnowledgeGraph(filtered, { lod, includeCandidates: true });
  }, [filtered]);

  const knowledgeSpaceLabels = useMemo(() => {
    if (!rendered) return undefined;
    const legacyById = new Map(fallbackGraph.nodes.map((node) => [node.id, node]));
    const legacyByLabel = new Map(
      fallbackGraph.nodes.map((node) => [node.label.trim().toLocaleLowerCase(), node]),
    );
    const votes = new Map<string, Map<string, number>>();
    for (const node of rendered.nodes) {
      const domainId = node.domainIds[0];
      if (!domainId) continue;
      const legacy =
        legacyById.get(node.id) ?? legacyByLabel.get(node.label.trim().toLocaleLowerCase());
      if (!legacy?.domain) continue;
      const domainVotes = votes.get(domainId) ?? new Map<string, number>();
      domainVotes.set(legacy.domain, (domainVotes.get(legacy.domain) ?? 0) + 1);
      votes.set(domainId, domainVotes);
    }
    return {
      domains: Object.fromEntries(
        [...votes.entries()].map(([domainId, domainVotes]) => [
          domainId,
          [...domainVotes.entries()].sort(
            (left, right) => right[1] - left[1] || left[0].localeCompare(right[0], 'zh-CN'),
          )[0]?.[0] ?? domainId,
        ]),
      ),
    };
  }, [fallbackGraph.nodes, rendered]);

  const knowledgeSpace = useMemo(
    () => (rendered ? projectKnowledgeSpace(rendered, spaceLens, knowledgeSpaceLabels) : null),
    [knowledgeSpaceLabels, rendered, spaceLens],
  );

  const explorationGraph = useMemo(() => {
    if (!knowledgeSpace || !activeSpaceClusterId) return knowledgeSpace?.graph ?? null;
    const cluster = knowledgeSpace.clusters.find((item) => item.id === activeSpaceClusterId);
    if (!cluster) return knowledgeSpace.graph;
    const nodeIds = new Set(cluster.nodeIds);
    const nodes = knowledgeSpace.graph.nodes.filter((node) => nodeIds.has(node.id));
    const edges = knowledgeSpace.graph.edges.filter(
      (edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target),
    );
    const evidenceIds = new Set([
      ...nodes.flatMap((node) => node.evidenceRefs),
      ...edges.flatMap((edge) => edge.evidenceRefs),
    ]);
    return {
      ...knowledgeSpace.graph,
      nodes,
      edges,
      evidence: knowledgeSpace.graph.evidence.filter((item) => evidenceIds.has(item.id)),
    };
  }, [activeSpaceClusterId, knowledgeSpace]);

  const adjacentEdges = useMemo(
    () =>
      graph && selectedNode
        ? graph.edges.filter(
            (edge) => edge.source === selectedNode.id || edge.target === selectedNode.id,
          )
        : [],
    [graph, selectedNode],
  );

  const submitFeedback = async (action: 'confirm' | 'reject') => {
    if (!selectedEdge || !graph) return;
    setFeedbackBusy(true);
    setError(null);
    try {
      await responseJson(
        await fetch('/api/v1/knowledge-graphs/feedback', {
          method: 'POST',
          headers,
          body: JSON.stringify({ relationId: selectedEdge.id, action }),
        }),
      );
      const status = action === 'confirm' ? 'confirmed' : 'rejected';
      setGraph({
        ...graph,
        edges: graph.edges.map((edge) =>
          edge.id === selectedEdge.id ? { ...edge, status } : edge,
        ),
      });
      setSelectedEdge({ ...selectedEdge, status });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法保存关系反馈。');
    } finally {
      setFeedbackBusy(false);
    }
  };

  const focusNeighborhood = async (node: KnowledgeNodeV2, depth: 1 | 2) => {
    if (!graph) return;
    setNavigationBusy(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/v1/knowledge-graphs/nodes/${encodeURIComponent(node.id)}/neighborhood?projectionId=${encodeURIComponent(graph.projectionId)}&depth=${depth}`,
        { headers, cache: 'no-store' },
      );
      const result = await responseJson<{ neighborhood: KnowledgeGraphNeighborhood }>(response);
      setFocus({
        label: `${node.label} · ${depth} 跳邻域`,
        nodeIds: result.neighborhood.nodes.map((item) => item.id),
        edgeIds: result.neighborhood.edges.map((item) => item.id),
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法读取知识邻域。');
    } finally {
      setNavigationBusy(false);
    }
  };

  const connectPath = async (target: KnowledgeNodeV2) => {
    if (!graph || !pathStart || pathStart.id === target.id) return;
    setNavigationBusy(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        projectionId: graph.projectionId,
        from: pathStart.id,
        to: target.id,
      });
      const response = await fetch(`/api/v1/knowledge-graphs/path?${params.toString()}`, {
        headers,
        cache: 'no-store',
      });
      const result = await responseJson<{ path: KnowledgeGraphPath }>(response);
      if (!result.path.found) {
        setError(`“${pathStart.label}”与“${target.label}”之间没有可解释路径。`);
        return;
      }
      setFocus({
        label: `${pathStart.label} → ${target.label}`,
        nodeIds: result.path.nodes.map((item) => item.id),
        edgeIds: result.path.edges.map((item) => item.id),
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法计算知识路径。');
    } finally {
      setNavigationBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[420px] items-center justify-center gap-2 rounded-xl border border-slate-200 text-sm text-slate-500 dark:border-slate-700">
        <LoaderCircle className="h-4 w-4 animate-spin" /> 正在生成可追溯图谱投影…
      </div>
    );
  }

  if (!graph || !filtered || !rendered || !knowledgeSpace || !explorationGraph) {
    return (
      <div>
        <div className="mb-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-medium">学习导航暂时未能加载。</p>
            <p className="mt-1 opacity-80">
              你仍可查看归纳笔记；如需排查关系数据，可按需展开兼容关系图。
            </p>
            {error && <p className="mt-1 opacity-80">{error}</p>}
          </div>
        </div>
        <details className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
          <summary className="cursor-pointer text-xs font-medium text-slate-600 dark:text-slate-300">
            打开兼容关系图
          </summary>
          <div className="mt-3">
            <KnowledgeGraph3D graph={fallbackGraph} />
          </div>
        </details>
      </div>
    );
  }

  const displayedGraph = viewMode === 'explore' ? explorationGraph : filtered;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-200 bg-emerald-50/70 p-3 text-xs text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">
        <span className="inline-flex items-center gap-1.5 font-medium">
          <ShieldCheck className="h-4 w-4" /> 学习证据图谱 · 可追溯
        </span>
        <span>
          {displayedGraph.nodes.length} 节点 · {displayedGraph.edges.length} 关系 ·{' '}
          {displayedGraph.evidence.length} 条证据
        </span>
        {viewMode === 'explore' && webglEnabled && (
          <div className="inline-flex rounded-lg border border-emerald-300/70 bg-white/60 p-0.5 dark:border-emerald-800 dark:bg-slate-950/30">
            <button
              type="button"
              onClick={() => chooseRenderer('webgl')}
              className={`rounded-md px-2 py-1 ${
                renderer === 'webgl' ? 'bg-emerald-600 text-white' : 'text-emerald-800'
              }`}
            >
              WebGL
            </button>
            <button
              type="button"
              onClick={() => chooseRenderer('canvas')}
              className={`rounded-md px-2 py-1 ${
                renderer === 'canvas' ? 'bg-emerald-600 text-white' : 'text-emerald-800'
              }`}
            >
              兼容
            </button>
          </div>
        )}
      </div>
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200">
          {error}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-violet-200 bg-violet-50/60 p-2 dark:border-violet-900 dark:bg-violet-950/20">
        <div className="inline-flex rounded-lg border border-violet-200 bg-white p-0.5 dark:border-violet-900 dark:bg-slate-950">
          <button
            type="button"
            onClick={() => chooseViewMode('learning')}
            className={`rounded-md px-3 py-1.5 text-xs font-medium ${
              viewMode === 'learning'
                ? 'bg-violet-600 text-white'
                : 'text-violet-700 hover:bg-violet-50 dark:text-violet-300'
            }`}
          >
            下一步学习（推荐）
          </button>
          <button
            type="button"
            onClick={() => chooseViewMode('explore')}
            className={`rounded-md px-3 py-1.5 text-xs font-medium ${
              viewMode === 'explore'
                ? 'bg-violet-600 text-white'
                : 'text-violet-700 hover:bg-violet-50 dark:text-violet-300'
            }`}
          >
            关系探索（按需）
          </button>
        </div>
        <p className="text-[11px] text-violet-700 dark:text-violet-300">
          先完成学习行动，再用关系图回答“它与什么有关”。
        </p>
      </div>
      {viewMode === 'explore' && (
        <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-cyan-200 bg-cyan-50/70 p-3 text-xs text-cyan-900 dark:border-cyan-900 dark:bg-cyan-950/25 dark:text-cyan-100">
          <div className="min-w-0 flex-1">
            <p className="font-semibold">
              系统推荐“{KNOWLEDGE_SPACE_LENSES[recommendedLens].label}”视角
            </p>
            <p className="mt-1 leading-5 text-cyan-800 dark:text-cyan-200">
              {question
                ? `根据归纳问题：${question}`
                : KNOWLEDGE_SPACE_LENSES[recommendedLens].question}
            </p>
          </div>
          {spaceLens !== recommendedLens && (
            <button
              type="button"
              onClick={() => chooseSpaceLens(recommendedLens)}
              className="shrink-0 rounded-lg border border-cyan-300 bg-white/80 px-3 py-1.5 font-medium transition hover:bg-white dark:border-cyan-800 dark:bg-slate-900/70"
            >
              使用推荐视角
            </button>
          )}
        </div>
      )}
      <div
        className={`grid gap-2 ${
          viewMode === 'explore'
            ? 'md:grid-cols-[minmax(0,1fr)_180px_190px_auto]'
            : 'md:grid-cols-[minmax(0,1fr)_180px]'
        }`}
      >
        <label className="relative">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索项目、来源、课堂或概念"
            className="h-9 w-full rounded-lg border border-slate-200 bg-transparent pl-9 pr-3 text-xs dark:border-slate-700"
          />
        </label>
        <select
          value={nodeType}
          onChange={(event) => setNodeType(event.target.value as KnowledgeNodeTypeV2 | '')}
          className="h-9 rounded-lg border border-slate-200 bg-transparent px-3 text-xs dark:border-slate-700"
        >
          {NODE_TYPES.map((item) => (
            <option key={item.value || 'all'} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
        {viewMode === 'explore' && (
          <>
            <label className="flex h-9 items-center gap-2 rounded-lg border border-slate-200 px-3 text-[11px] dark:border-slate-700">
              关系阈值
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={minimumConfidence}
                onChange={(event) => setMinimumConfidence(Number(event.target.value))}
                className="min-w-0 flex-1"
              />
              {Math.round(minimumConfidence * 100)}%
            </label>
            <label className="flex h-9 items-center gap-2 rounded-lg border border-slate-200 px-3 text-[11px] dark:border-slate-700">
              <input
                type="checkbox"
                checked={showCandidates}
                onChange={(event) => setShowCandidates(event.target.checked)}
              />
              候选关系
            </label>
          </>
        )}
      </div>
      {viewMode === 'explore' && (focus || pathStart) && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-violet-200 bg-violet-50/60 px-3 py-2 text-[11px] text-violet-800 dark:border-violet-900 dark:bg-violet-950/20 dark:text-violet-200">
          <span>
            {focus ? `当前聚焦：${focus.label}` : '已设置路径起点'}
            {pathStart ? ` · 起点：${pathStart.label}` : ''}
          </span>
          <button
            type="button"
            onClick={() => {
              setFocus(null);
              setPathStart(null);
            }}
            className="rounded-lg border border-violet-300 px-2 py-1 hover:bg-white/70 dark:border-violet-800"
          >
            清除聚焦与路径
          </button>
        </div>
      )}
      {viewMode === 'learning' ? (
        <div className="space-y-3">
          <KnowledgeLearningNavigator
            graph={filtered}
            onSelect={(node) => {
              setSelectedNode(node);
              setSelectedEdge(null);
              window.requestAnimationFrame(() =>
                learningDetailsRef.current?.scrollIntoView({
                  behavior: 'smooth',
                  block: 'nearest',
                }),
              );
            }}
            onExplore={(node) => {
              const edges = graph.edges.filter(
                (edge) => edge.source === node.id || edge.target === node.id,
              );
              const nodeIds = new Set<string>([node.id]);
              for (const edge of edges) {
                nodeIds.add(edge.source);
                nodeIds.add(edge.target);
              }
              setSelectedNode(node);
              setSelectedEdge(null);
              setFocus({
                label: `${node.label} · 学习相关知识`,
                nodeIds: [...nodeIds],
                edgeIds: edges.map((edge) => edge.id),
              });
              chooseViewMode('explore');
            }}
          />
          {selectedNode && (
            <div
              ref={learningDetailsRef}
              className="space-y-3 rounded-2xl border border-violet-200 bg-violet-50/30 p-3 dark:border-violet-900 dark:bg-violet-950/10"
            >
              <div>
                <p className="text-xs font-semibold text-violet-700 dark:text-violet-300">
                  学习依据与 Obsidian 去向
                </p>
                <p className="mt-1 text-[11px] text-slate-500">
                  核对来源、掌握证据和笔记身份后，再进入课堂或继续探索。
                </p>
              </div>
              <NodeDetails
                node={selectedNode}
                edges={adjacentEdges}
                evidence={graph.evidence}
                obsidianVaultName={obsidianVaultName}
                navigationBusy={navigationBusy}
                pathStartId={pathStart?.id}
                onEdgeSelect={setSelectedEdge}
                onFocusNeighborhood={(depth) => void focusNeighborhood(selectedNode, depth)}
                onSetPathStart={() => setPathStart(selectedNode)}
                onConnectPath={() => void connectPath(selectedNode)}
              />
              {selectedEdge && (
                <EdgeDetails
                  edge={selectedEdge}
                  nodes={graph.nodes}
                  evidence={graph.evidence}
                  feedbackBusy={feedbackBusy}
                  onFeedback={(action) => void submitFeedback(action)}
                />
              )}
            </div>
          )}
        </div>
      ) : (
        <>
          <KnowledgeSpaceControls
            projection={knowledgeSpace}
            activeClusterId={activeSpaceClusterId}
            onLensChange={chooseSpaceLens}
            onClusterChange={(clusterId) => {
              setActiveSpaceClusterId(clusterId);
              setSelectedEdge(null);
              if (
                clusterId &&
                selectedNode &&
                !knowledgeSpace.clusters
                  .find((cluster) => cluster.id === clusterId)
                  ?.nodeIds.includes(selectedNode.id)
              ) {
                setSelectedNode(null);
              }
            }}
          />
          {renderer === 'webgl' && webglEnabled ? (
            <WebGLErrorBoundary
              key={filtered.projectionId}
              onError={() => setRenderer('canvas')}
              fallback={
                <KnowledgeGraphCanvasFallback
                  graph={explorationGraph}
                  axisLabels={knowledgeSpace.definition.axes}
                />
              }
            >
              <KnowledgeGraphWebGL
                graph={explorationGraph}
                clusters={knowledgeSpace.clusters}
                activeClusterId={activeSpaceClusterId}
                axisLabels={knowledgeSpace.definition.axes}
                selectedNodeId={selectedNode?.id}
                onNodeSelect={(node) => {
                  setSelectedNode(node);
                  setSelectedEdge(null);
                }}
                onUnavailable={() => setRenderer('canvas')}
              />
            </WebGLErrorBoundary>
          ) : (
            <KnowledgeGraphCanvasFallback
              graph={explorationGraph}
              axisLabels={knowledgeSpace.definition.axes}
            />
          )}
          <p className="text-[11px] text-slate-500">
            {renderer === 'webgl' && webglEnabled
              ? 'WebGL 使用实例化节点、合并关系线与按需帧渲染；图谱数据、证据合同和可访问列表与兼容视图完全相同。'
              : '当前使用稳定坐标的 Canvas 兼容层；WebGL 不可用或关闭时，搜索、证据详情和笔记身份仍然完整可用。'}
          </p>
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(320px,.8fr)]">
            <GraphAccessibleList
              nodes={explorationGraph.nodes}
              selectedId={selectedNode?.id}
              onSelect={(node) => {
                setSelectedNode(node);
                setSelectedEdge(null);
              }}
            />
            <div className="space-y-3">
              {selectedNode ? (
                <NodeDetails
                  node={selectedNode}
                  edges={adjacentEdges}
                  evidence={graph.evidence}
                  obsidianVaultName={obsidianVaultName}
                  navigationBusy={navigationBusy}
                  pathStartId={pathStart?.id}
                  onEdgeSelect={setSelectedEdge}
                  onFocusNeighborhood={(depth) => void focusNeighborhood(selectedNode, depth)}
                  onSetPathStart={() => setPathStart(selectedNode)}
                  onConnectPath={() => void connectPath(selectedNode)}
                />
              ) : (
                <div className="rounded-xl border border-dashed border-slate-300 p-4 text-xs text-slate-500 dark:border-slate-700">
                  从列表选择一个节点，查看掌握证据、原笔记/伴随笔记身份和相邻关系。
                </div>
              )}
              {selectedEdge && (
                <EdgeDetails
                  edge={selectedEdge}
                  nodes={graph.nodes}
                  evidence={graph.evidence}
                  feedbackBusy={feedbackBusy}
                  onFeedback={(action) => void submitFeedback(action)}
                />
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
