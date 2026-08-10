'use client';

import { useState } from 'react';
import type { KnowledgeNodeV2 } from '@/lib/learning/domain/knowledge-graph-v2/contracts';

const TYPE_LABEL: Record<KnowledgeNodeV2['type'], string> = {
  project: '项目',
  'original-note': '原笔记（只读）',
  'companion-note': '学习伴随笔记',
  'external-source': '外部来源',
  classroom: '课堂',
  concept: '概念',
  claim: '主张',
  skill: '技能',
  artifact: '成果',
  review: '复习项',
};

function mastery(node: KnowledgeNodeV2): string {
  if (node.mastery === null) return '掌握度未知';
  return `掌握度 ${Math.round(node.mastery * 100)}%，置信度 ${Math.round(
    node.masteryConfidence * 100,
  )}%`;
}

export function GraphAccessibleList({
  nodes,
  selectedId,
  onSelect,
}: {
  nodes: KnowledgeNodeV2[];
  selectedId?: string;
  onSelect: (node: KnowledgeNodeV2) => void;
}) {
  const [visibleCount, setVisibleCount] = useState(300);
  const [expandedFor, setExpandedFor] = useState('');
  const listIdentity = nodes.map((node) => node.id).join('\u0000');
  const currentVisibleCount = expandedFor === listIdentity ? visibleCount : 300;
  const visibleNodes = nodes.slice(0, currentVisibleCount);
  const remaining = Math.max(0, nodes.length - visibleNodes.length);
  return (
    <div
      className="max-h-72 overflow-auto rounded-xl border border-slate-200 dark:border-slate-700"
      aria-label="可访问的知识节点列表"
    >
      {nodes.length === 0 ? (
        <p className="p-4 text-sm text-slate-500">没有符合当前筛选的节点。</p>
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {visibleNodes.map((node) => (
            <li key={node.id}>
              <button
                type="button"
                onClick={() => onSelect(node)}
                aria-pressed={selectedId === node.id}
                className={`w-full px-3 py-2.5 text-left text-xs transition ${
                  selectedId === node.id
                    ? 'bg-violet-50 text-violet-900 dark:bg-violet-950/40 dark:text-violet-100'
                    : 'hover:bg-slate-50 dark:hover:bg-slate-800/70'
                }`}
              >
                <span className="block truncate font-medium">{node.label}</span>
                <span className="mt-1 block text-[11px] text-slate-500">
                  {TYPE_LABEL[node.type]} · {mastery(node)} · {node.evidenceCount} 条证据
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {remaining > 0 && (
        <div className="border-t border-slate-100 p-2 text-center dark:border-slate-800">
          <button
            type="button"
            onClick={() => {
              setExpandedFor(listIdentity);
              setVisibleCount((value) =>
                Math.min(nodes.length, (expandedFor === listIdentity ? value : 300) + 300),
              );
            }}
            className="rounded-md px-3 py-1.5 text-xs text-violet-700 hover:bg-violet-50 dark:text-violet-300 dark:hover:bg-violet-950/30"
          >
            显示更多节点（剩余 {remaining}）
          </button>
        </div>
      )}
    </div>
  );
}
