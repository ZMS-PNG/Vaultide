'use client';

import type {
  KnowledgeEdgeV2,
  KnowledgeEvidenceRefV2,
  KnowledgeNodeV2,
} from '@/lib/learning/domain/knowledge-graph-v2/contracts';
import { describeKnowledgeRelation } from '@/lib/learning/domain/knowledge-graph-v2/relation-semantics';

export function NodeDetails({
  node,
  edges,
  evidence,
  obsidianVaultName,
  navigationBusy,
  pathStartId,
  onEdgeSelect,
  onFocusNeighborhood,
  onSetPathStart,
  onConnectPath,
}: {
  node: KnowledgeNodeV2;
  edges: KnowledgeEdgeV2[];
  evidence: KnowledgeEvidenceRefV2[];
  obsidianVaultName?: string;
  navigationBusy: boolean;
  pathStartId?: string;
  onEdgeSelect: (edge: KnowledgeEdgeV2) => void;
  onFocusNeighborhood: (depth: 1 | 2) => void;
  onSetPathStart: () => void;
  onConnectPath: () => void;
}) {
  const nodeEvidence = evidence.filter((item) => node.evidenceRefs.includes(item.id));
  const notePath = node.companionPath ?? node.originalPath;
  const obsidianUrl =
    notePath && /^[a-zA-Z]:[\\/]/.test(notePath)
      ? `obsidian://open?path=${encodeURIComponent(notePath)}`
      : notePath && obsidianVaultName
        ? `obsidian://open?vault=${encodeURIComponent(obsidianVaultName)}&file=${encodeURIComponent(notePath)}`
        : undefined;
  return (
    <section className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-slate-500">{node.type}</p>
          <h4 className="mt-1 text-sm font-semibold">{node.label}</h4>
        </div>
        <span
          className={`rounded-full px-2 py-1 text-[10px] ${
            node.writable
              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200'
              : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
          }`}
        >
          {node.writable ? '受管可更新' : '只读/不可写'}
        </span>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div>
          <dt className="text-slate-500">掌握度</dt>
          <dd className="mt-0.5 font-medium">
            {node.mastery === null ? '未知' : `${Math.round(node.mastery * 100)}%`}
          </dd>
        </div>
        <div>
          <dt className="text-slate-500">证据置信度</dt>
          <dd className="mt-0.5 font-medium">{Math.round(node.masteryConfidence * 100)}%</dd>
        </div>
        <div>
          <dt className="text-slate-500">证据数</dt>
          <dd className="mt-0.5 font-medium">{node.evidenceCount}</dd>
        </div>
        <div>
          <dt className="text-slate-500">关系数</dt>
          <dd className="mt-0.5 font-medium">{edges.length}</dd>
        </div>
      </dl>
      <div className="mt-3 flex flex-wrap gap-1.5">
        <button
          type="button"
          disabled={navigationBusy}
          onClick={() => onFocusNeighborhood(1)}
          className="rounded-lg border border-violet-200 px-2.5 py-1.5 text-[10px] text-violet-700 hover:bg-violet-50 disabled:opacity-50 dark:border-violet-900 dark:text-violet-300 dark:hover:bg-violet-950/30"
        >
          查看一跳邻域
        </button>
        <button
          type="button"
          disabled={navigationBusy}
          onClick={() => onFocusNeighborhood(2)}
          className="rounded-lg border border-violet-200 px-2.5 py-1.5 text-[10px] text-violet-700 hover:bg-violet-50 disabled:opacity-50 dark:border-violet-900 dark:text-violet-300 dark:hover:bg-violet-950/30"
        >
          查看两跳邻域
        </button>
        {pathStartId && pathStartId !== node.id ? (
          <button
            type="button"
            disabled={navigationBusy}
            onClick={onConnectPath}
            className="rounded-lg bg-violet-600 px-2.5 py-1.5 text-[10px] font-medium text-white disabled:opacity-50"
          >
            计算到此节点的路径
          </button>
        ) : (
          <button
            type="button"
            disabled={navigationBusy}
            onClick={onSetPathStart}
            className="rounded-lg bg-slate-800 px-2.5 py-1.5 text-[10px] font-medium text-white disabled:opacity-50 dark:bg-slate-200 dark:text-slate-900"
          >
            {pathStartId === node.id ? '已设为路径起点' : '设为路径起点'}
          </button>
        )}
        {node.classroomIds[0] && (
          <a
            href={`/classroom/${encodeURIComponent(node.classroomIds[0])}`}
            className="rounded-lg border border-cyan-200 px-2.5 py-1.5 text-[10px] text-cyan-700 hover:bg-cyan-50 dark:border-cyan-900 dark:text-cyan-300"
          >
            打开课堂
          </a>
        )}
        {node.externalUrl && (
          <a
            href={node.externalUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg border border-blue-200 px-2.5 py-1.5 text-[10px] text-blue-700 hover:bg-blue-50 dark:border-blue-900 dark:text-blue-300"
          >
            打开外部来源
          </a>
        )}
        {obsidianUrl && (
          <a
            href={obsidianUrl}
            className="rounded-lg border border-emerald-200 px-2.5 py-1.5 text-[10px] text-emerald-700 hover:bg-emerald-50 dark:border-emerald-900 dark:text-emerald-300"
          >
            在 Obsidian 打开
          </a>
        )}
      </div>
      {node.originalPath && (
        <p className="mt-3 break-all rounded-lg bg-slate-50 p-2 font-mono text-[10px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          原路径：{node.originalPath}
        </p>
      )}
      {node.companionPath && (
        <p className="mt-2 break-all rounded-lg bg-emerald-50 p-2 font-mono text-[10px] text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200">
          伴随笔记：{node.companionPath}
        </p>
      )}
      {nodeEvidence.length > 0 && (
        <div className="mt-3">
          <h5 className="text-xs font-semibold">节点证据</h5>
          <ul className="mt-2 space-y-1 text-[11px] text-slate-600 dark:text-slate-300">
            {nodeEvidence.map((item) => (
              <li key={item.id} className="rounded-lg bg-slate-50 p-2 dark:bg-slate-800">
                {item.label}
              </li>
            ))}
          </ul>
        </div>
      )}
      {edges.length > 0 && (
        <div className="mt-3">
          <h5 className="text-xs font-semibold">相邻关系</h5>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {edges.slice(0, 20).map((edge) => {
              const relation = describeKnowledgeRelation(edge);
              return (
                <button
                  key={edge.id}
                  type="button"
                  onClick={() => onEdgeSelect(edge)}
                  title={relation.headline}
                  className="rounded-full border border-slate-200 px-2 py-1 text-[10px] hover:border-violet-300 hover:text-violet-700 dark:border-slate-700"
                >
                  {relation.typeLabel} · {relation.statusLabel} · {relation.evidenceCount} 条证据
                </button>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
