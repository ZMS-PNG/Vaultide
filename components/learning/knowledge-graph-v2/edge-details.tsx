'use client';

import type {
  KnowledgeEdgeV2,
  KnowledgeEvidenceRefV2,
  KnowledgeNodeV2,
} from '@/lib/learning/domain/knowledge-graph-v2/contracts';
import { describeKnowledgeRelation } from '@/lib/learning/domain/knowledge-graph-v2/relation-semantics';

export function EdgeDetails({
  edge,
  nodes,
  evidence,
  feedbackBusy,
  onFeedback,
}: {
  edge: KnowledgeEdgeV2;
  nodes: KnowledgeNodeV2[];
  evidence: KnowledgeEvidenceRefV2[];
  feedbackBusy: boolean;
  onFeedback: (action: 'confirm' | 'reject') => void;
}) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const refs = evidence.filter((item) => edge.evidenceRefs.includes(item.id));
  const relation = describeKnowledgeRelation(edge);
  return (
    <section className="rounded-xl border border-violet-200 bg-violet-50/40 p-3 dark:border-violet-900 dark:bg-violet-950/20">
      <p className="text-[11px] uppercase tracking-wide text-violet-600 dark:text-violet-300">
        {relation.typeLabel} · {relation.originLabel} · {relation.statusLabel}
      </p>
      <h4 className="mt-1 text-sm font-semibold">
        {byId.get(edge.source)?.label ?? edge.source}
        <span className="mx-2 text-slate-400">{edge.directed ? '→' : '↔'}</span>
        {byId.get(edge.target)?.label ?? edge.target}
      </h4>
      <p className="mt-2 text-xs text-slate-600 dark:text-slate-300">
        {relation.headline} · 连接置信度 {relation.confidencePercent}% · {relation.evidenceCount}{' '}
        条证据
      </p>
      <p className="mt-2 rounded-lg border border-violet-100 bg-white/70 px-2.5 py-2 text-[10px] leading-4 text-slate-500 dark:border-violet-900 dark:bg-slate-950/50">
        {relation.caution}
      </p>
      <p className="mt-2 text-[10px] text-slate-500">
        关系权重 {Math.round(edge.weight * 100)}% · 生成器 {edge.generatorVersion}
      </p>
      <div className="mt-3">
        <h5 className="text-xs font-semibold">为什么连接</h5>
        {refs.length === 0 ? (
          <p className="mt-1 text-xs text-red-600">缺少可展示证据；该关系不应被默认信任。</p>
        ) : (
          <ul className="mt-2 space-y-1 text-[11px]">
            {refs.map((item) => (
              <li key={item.id} className="rounded-lg bg-white/80 p-2 dark:bg-slate-900/70">
                <span className="font-medium">{item.label}</span>
                <span className="ml-2 text-slate-500">({item.kind})</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {edge.origin !== 'deterministic' && (
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            disabled={feedbackBusy}
            onClick={() => onFeedback('confirm')}
            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          >
            确认关系
          </button>
          <button
            type="button"
            disabled={feedbackBusy}
            onClick={() => onFeedback('reject')}
            className="rounded-lg bg-slate-700 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          >
            标记错误
          </button>
        </div>
      )}
    </section>
  );
}
