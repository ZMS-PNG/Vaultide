import type { JsonObject } from '@openmaic/learning-protocol';
import type { ManagedBlockDraft, ManagedBlockState } from './learning-progress';
import { managedBlockHash, normalizeManagedBlockContent } from './learning-companion';
import type { SynthesisRunRecord, SynthesisScheduleRecord, SynthesisScope } from './synthesis';

export const SYNTHESIS_INDEX_ROOT = 'Vaultide/归纳/周期/索引';

/**
 * One mutable overview per schedule and Vault. It is an aggregate document,
 * never a substitute for an original note, a companion, or an immutable
 * synthesis snapshot.
 */
export interface SynthesisIndexDocumentRecord {
  id: string;
  ownerId: string;
  scheduleId: string;
  vaultBindingId: string;
  relativePath: string;
  status: 'active' | 'archived';
  managedBlocks: ManagedBlockState[];
  lastContentHash?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface RenderedSynthesisIndex {
  relativePath: string;
  content: string;
  frontmatter: JsonObject;
  managedBlocks: ManagedBlockState[];
}

function cleanInline(value: string, fallback: string): string {
  const cleaned = value
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || fallback;
}

function safeBlockText(value: string): string {
  return value
    .replace(/<!--\s*\/?vaultide:managed\b/gi, 'Vaultide managed')
    .replace(/[\u0000\u0008\u000b\u000c\u007f]/g, '');
}

function pathSegment(value: string): string {
  const cleaned = cleanInline(value, '周期归纳')
    .replace(/[<>:"/\\|?*]/g, '-')
    .replace(/\.{2,}/g, '.')
    .replace(/[. ]+$/g, '')
    .slice(0, 72);
  return cleaned || '周期归纳';
}

function block(id: string, content: string): ManagedBlockState {
  const normalized = normalizeManagedBlockContent(safeBlockText(content));
  return { id, content: normalized, contentHash: managedBlockHash(normalized) };
}

function renderBlock(item: ManagedBlockState, synthesisIndexId: string): string {
  return [
    `<!-- vaultide:managed block=${item.id} synthesis-index=${synthesisIndexId} -->`,
    item.content,
    '<!-- /vaultide:managed -->',
  ].join('\n');
}

function schedulePeriodLabel(schedule: SynthesisScheduleRecord): string {
  if (schedule.period === 'daily') return '每日';
  if (schedule.period === 'weekly') return '每周';
  if (schedule.period === 'monthly') return '每月';
  return `每 ${schedule.intervalMinutes ?? 60} 分钟`;
}

function scopeLabel(scope: SynthesisScope): string {
  const parts: string[] = [];
  if (scope.projectIds?.length) parts.push(`${scope.projectIds.length} 个项目`);
  if (scope.classroomIds?.length) parts.push(`${scope.classroomIds.length} 个课堂`);
  if (scope.domain) parts.push(`板块：${cleanInline(scope.domain, '未命名')}`);
  if (scope.domainQuery) parts.push(`关键词：${cleanInline(scope.domainQuery, '未命名')}`);
  if (scope.topicTags?.length) parts.push(`${scope.topicTags.length} 个标签`);
  if (scope.sourceType) parts.push(`来源：${scope.sourceType}`);
  if (scope.timeFrom || scope.timeTo) {
    parts.push(`时间：${scope.timeFrom ?? '开始'} 至 ${scope.timeTo ?? '当前'}`);
  }
  return parts.length ? parts.join(' · ') : '所有已持久化的学习资产';
}

function snapshotLines(snapshots: readonly SynthesisRunRecord[]): string[] {
  if (snapshots.length === 0) return ['- 尚无成功生成的周期归纳快照。'];
  return snapshots.slice(0, 20).map((snapshot) => {
    const delta = snapshot.delta;
    const change = delta
      ? `｜新增 ${delta.addedClassroomIds.length}｜更新 ${delta.updatedClassroomIds.length}｜巩固 ${delta.strengthened.length}｜待加强 ${delta.weakened.length}`
      : '';
    return `- ${snapshot.createdAt.toISOString().slice(0, 10)}｜${cleanInline(snapshot.title, snapshot.id)}｜\`${snapshot.id}\`${change}`;
  });
}

function changeLines(latest: SynthesisRunRecord | undefined): string[] {
  if (!latest?.delta) return ['- 首次快照或旧版快照没有可比较的变化。'];
  const delta = latest.delta;
  const lines = [
    `- 新增课堂：${delta.addedClassroomIds.length}；更新课堂：${delta.updatedClassroomIds.length}；移出课堂：${delta.removedClassroomIds.length}`,
    `- 掌握加强：${delta.strengthened.length}；需要巩固：${delta.weakened.length}；关系变化：${delta.relationChanges.length}`,
  ];
  if (delta.conflicts.length === 0) {
    lines.push('- 未标记冲突：系统不会仅凭图谱形状猜测事实冲突。');
  } else {
    lines.push(`- 有证据支持的冲突：${delta.conflicts.length}`);
  }
  return lines;
}

function candidateLines(latest: SynthesisRunRecord | undefined): string[] {
  if (!latest?.taskCandidates.length) return ['- 当前没有新的复习或迁移任务候选。'];
  return latest.taskCandidates.slice(0, 12).map((candidate) => {
    const priority = candidate.priority === 'high' ? '高优先级' : '普通优先级';
    return `- [${priority}] ${cleanInline(candidate.title, candidate.id)}：${cleanInline(candidate.rationale, '查看关联快照')}`;
  });
}

export function renderSynthesisIndex(input: {
  synthesisIndexId: string;
  schedule: SynthesisScheduleRecord;
  snapshots: readonly SynthesisRunRecord[];
  now: Date;
}): RenderedSynthesisIndex {
  const latest = input.snapshots[0];
  const title = cleanInline(input.schedule.name, '周期归纳');
  const summary = block(
    'summary',
    [
      '## 周期归纳概览',
      '',
      `- 计划：${title}`,
      `- 周期：${schedulePeriodLabel(input.schedule)}（${input.schedule.timezone}）`,
      `- 状态：${input.schedule.status === 'active' ? '启用中' : '已暂停'}`,
      `- 范围：${scopeLabel(input.schedule.scope)}`,
      `- 成功快照：${input.snapshots.length} 份`,
      `- 最近快照：${latest ? `${latest.createdAt.toISOString()}（\`${latest.id}\`）` : '尚无'}`,
      `- 最近更新：${input.now.toISOString()}`,
    ].join('\n'),
  );
  const snapshots = block(
    'snapshots', ['## 不可变快照', '', ...snapshotLines(input.snapshots)].join('\n'));
  const changes = block(
    'changes', ['## 最近一次变化', '', ...changeLines(latest)].join('\n'));
  const candidates = block(
    'candidates', ['## 复习与迁移候选（需你确认）', '', ...candidateLines(latest)].join('\n'));
  const links = block(
    'links',
    [
      '## 使用边界与入口',
      '',
      `- 计划 ID：\`${input.schedule.id}\``,
      '- 每份历史归纳快照保持不可变；本索引只汇总和链接它们。',
      '- 原始 Obsidian 笔记保持只读；学习进度仍只回写到各自唯一的伴随笔记。',
      '- 本索引下方“我的补充”由你自由编辑，Vaultide 不会修改。',
    ].join('\n'),
  );
  const managedBlocks = [summary, snapshots, changes, candidates, links];
  const relativePath = `${SYNTHESIS_INDEX_ROOT}/${pathSegment(title)}--${input.schedule.id.slice(-8)}.md`;
  return {
    relativePath,
    content: [
      `# 周期归纳索引｜${title}`,
      '',
      '> 此索引由知洄 Vaultide 管理，用于持续汇总一项周期归纳计划。它不是原始笔记，也不会覆盖任何历史快照。',
      '',
      ...managedBlocks.flatMap((item) => [renderBlock(item, input.synthesisIndexId), '']),
      '## 我的补充',
      '',
      '> 此区域由你自由编辑，Vaultide 永远不会修改。',
      '',
    ].join('\n'),
    frontmatter: {
      maic_note_id: input.synthesisIndexId,
      maic_synthesis_index_id: input.synthesisIndexId,
      maic_synthesis_schedule_id: input.schedule.id,
      maic_managed: true,
      maic_status: 'active',
      maic_updated_at: input.now.toISOString(),
      tags: ['vaultide', 'synthesis-index', 'knowledge-graph'],
      aliases: [`周期归纳索引 ${title}`],
    },
    managedBlocks,
  };
}

export function synthesisIndexDraftBlocks(
  desired: readonly ManagedBlockState[],
  document: SynthesisIndexDocumentRecord,
): ManagedBlockDraft[] {
  if (!document.lastContentHash) return desired.map((item) => ({ ...item }));
  const previous = new Map(document.managedBlocks.map((item) => [item.id, item]));
  return desired.map((item) => {
    const current = previous.get(item.id);
    if (!current) throw new Error(`Synthesis index is missing managed block ${item.id}.`);
    return { ...item, expectedHash: current.contentHash };
  });
}
