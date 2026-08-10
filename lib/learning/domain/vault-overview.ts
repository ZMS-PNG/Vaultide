import type { JsonObject } from '@openmaic/learning-protocol';
import type { ManagedBlockDraft, ManagedBlockState } from './learning-progress';
import { managedBlockHash, normalizeManagedBlockContent } from './learning-companion';
import { productHealthStateLabel, type ProductHealthSnapshot } from './product-health';

export const VAULT_OVERVIEW_PATH = 'Vaultide/知洄总览.md';

export interface VaultOverviewDocumentRecord {
  id: string;
  ownerId: string;
  vaultBindingId: string;
  relativePath: string;
  status: 'active' | 'archived';
  managedBlocks: ManagedBlockState[];
  lastContentHash?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface VaultOverviewProject {
  id: string;
  name: string;
  rootPath: string;
  revision: number;
  sourceCount: number;
  classroomCount: number;
  activeSprintCount: number;
  updatedAt: string;
}

export interface VaultOverviewLearningItem {
  sprintId: string;
  classroomId: string;
  goal: string;
  projectName?: string;
  status: 'active' | 'completed' | 'archived';
  masteryEstimate: number | null;
  masteryConfidence: number;
  evidenceCount: number;
  nextReviewAt?: string;
  updatedAt: string;
}

export interface VaultOverviewReviewItem {
  id: string;
  classroomId: string;
  goal: string;
  projectName?: string;
  dueAt: string;
  dueCount: number;
  masteryEstimate: number | null;
  isDue: boolean;
}

export interface VaultOverviewSynthesisItem {
  id: string;
  title: string;
  mode: 'timeline' | 'domain' | 'combined';
  classroomCount: number;
  nodeCount: number;
  createdAt: string;
}

export interface VaultOverviewSnapshot {
  generatedAt: string;
  projects: VaultOverviewProject[];
  recentLearning: VaultOverviewLearningItem[];
  reviews: VaultOverviewReviewItem[];
  syntheses: VaultOverviewSynthesisItem[];
  health: ProductHealthSnapshot;
}

export interface RenderedVaultOverview {
  relativePath: typeof VAULT_OVERVIEW_PATH;
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

function block(id: string, content: string): ManagedBlockState {
  const normalized = normalizeManagedBlockContent(safeBlockText(content));
  return { id, content: normalized, contentHash: managedBlockHash(normalized) };
}

function renderBlock(item: ManagedBlockState, vaultOverviewId: string): string {
  return [
    `<!-- vaultide:managed block=${item.id} vault-overview=${vaultOverviewId} -->`,
    item.content,
    '<!-- /vaultide:managed -->',
  ].join('\n');
}

function mastery(value: number | null, confidence: number, evidenceCount: number): string {
  if (value === null) return '待形成主动证据';
  return `${Math.round(value * 100)}%（置信度 ${Math.round(confidence * 100)}%，${evidenceCount} 条证据）`;
}

function healthLines(health: ProductHealthSnapshot): string[] {
  return [
    `- 课堂生成：${productHealthStateLabel(health.generation.state)}｜成功 ${health.generation.succeeded}｜失败 ${health.generation.failed}｜处理中 ${health.generation.pending}`,
    `- 知识归纳：${productHealthStateLabel(health.synthesis.state)}｜成功 ${health.synthesis.succeeded}｜失败 ${health.synthesis.failed}｜处理中 ${health.synthesis.pending}`,
    `- Obsidian 回写：${productHealthStateLabel(health.writeback.state)}｜成功 ${health.writeback.succeeded}｜异常 ${health.writeback.failed}｜待应用 ${health.writeback.pending}`,
    `- 外部来源复核：${productHealthStateLabel(health.sources.state)}｜可访问 ${health.sources.succeeded}｜可能失效 ${health.sources.failed}｜未复核 ${health.sources.pending}`,
    ...(health.generation.lastFailureDetail
      ? [`- 最近生成异常：${cleanInline(health.generation.lastFailureDetail, '未提供详情')}`]
      : []),
    ...(health.writeback.lastFailureDetail
      ? [`- 最近回写异常：${cleanInline(health.writeback.lastFailureDetail, '未提供详情')}`]
      : []),
  ];
}

export function renderVaultOverview(input: {
  vaultOverviewId: string;
  snapshot: VaultOverviewSnapshot;
  now: Date;
}): RenderedVaultOverview {
  const { snapshot } = input;
  const due = snapshot.reviews.filter((item) => item.isDue);
  const today = block(
    'today',
    [
      '## 今日学习行动',
      '',
      ...(due.length > 0
        ? due
            .slice(0, 8)
            .map(
              (item) =>
                `- [ ] 复习 ${cleanInline(item.projectName ?? item.goal, item.classroomId)}｜${item.dueCount} 个知识点｜掌握 ${item.masteryEstimate === null ? '待评估' : `${Math.round(item.masteryEstimate * 100)}%`}｜课堂 \`${item.classroomId}\``,
            )
        : ['- [ ] 当前没有到期复习；可从最近课堂选择一个知识点做主动回忆或迁移练习。']),
      '',
      `- 待复习：${due.length} 项；未来 14 天：${snapshot.reviews.length} 项`,
      `- 最近刷新：${input.now.toISOString()}`,
    ].join('\n'),
  );
  const projects = block(
    'projects',
    [
      '## 项目学习地图',
      '',
      ...(snapshot.projects.length > 0
        ? snapshot.projects.map(
            (project) =>
              `- **${cleanInline(project.name, project.id)}**｜来源 ${project.sourceCount}｜课堂 ${project.classroomCount}｜进行中 ${project.activeSprintCount}｜项目版本 ${project.revision}｜\`${project.id}\``,
          )
        : ['- 尚未绑定 Obsidian 项目文件夹。']),
    ].join('\n'),
  );
  const learning = block(
    'learning',
    [
      '## 最近学习与掌握证据',
      '',
      ...(snapshot.recentLearning.length > 0
        ? snapshot.recentLearning.map(
            (item) =>
              `- ${item.updatedAt.slice(0, 10)}｜${cleanInline(item.projectName ?? item.goal, item.classroomId)}｜${mastery(item.masteryEstimate, item.masteryConfidence, item.evidenceCount)}｜\`${item.classroomId}\``,
          )
        : ['- 尚无已持久化的课堂学习进度。']),
    ].join('\n'),
  );
  const synthesis = block(
    'synthesis',
    [
      '## 知识归纳与变化',
      '',
      ...(snapshot.syntheses.length > 0
        ? snapshot.syntheses.map(
            (item) =>
              `- ${item.createdAt.slice(0, 10)}｜${cleanInline(item.title, item.id)}｜${item.classroomCount} 个课堂｜${item.nodeCount} 个节点｜\`${item.id}\``,
          )
        : ['- 尚无知识归纳快照；可在网页“知识归纳”中按时间、板块或项目生成。']),
      '',
      '- 每份归纳快照保持不可变；周期归纳索引只更新自身受管区块。',
    ].join('\n'),
  );
  const health = block(
    'health',
    ['## 沉淀与系统健康', '', ...healthLines(snapshot.health)].join('\n'),
  );
  const boundaries = block(
    'boundaries',
    [
      '## 存放位置与安全边界',
      '',
      '- 课堂学习记录：`Vaultide/学习记录/`',
      '- 原笔记的学习伴随笔记：`Vaultide/伴随笔记/`',
      '- 外部项目、论文与文章资料卡：`Vaultide/资料库/`',
      '- 单次归纳快照：`Vaultide/归纳/`',
      '- 周期归纳与索引：`Vaultide/归纳/周期/`',
      '- 项目学习索引：`Vaultide/系统/索引/`',
      '- 原始 Obsidian 笔记始终只读；知洄只创建受管笔记或替换哈希一致的受管区块。',
      '- 下方“我的补充”由你自由编辑，知洄永远不会修改。',
    ].join('\n'),
  );
  const managedBlocks = [today, projects, learning, synthesis, health, boundaries];
  return {
    relativePath: VAULT_OVERVIEW_PATH,
    content: [
      '# 知洄总览',
      '',
      '> 这是知洄 Vaultide 的稳定学习入口：把项目、课堂、复习、归纳和 Obsidian 沉淀状态汇总到同一处。',
      '',
      ...managedBlocks.flatMap((item) => [renderBlock(item, input.vaultOverviewId), '']),
      '## 我的补充',
      '',
      '> 在这里记录本周重点、长期问题或自己的学习策略。知洄不会修改此区域。',
      '',
    ].join('\n'),
    frontmatter: {
      maic_note_id: input.vaultOverviewId,
      maic_vault_overview_id: input.vaultOverviewId,
      maic_managed: true,
      maic_status: 'active',
      maic_updated_at: input.now.toISOString(),
      tags: ['vaultide', 'learning-dashboard', 'knowledge-management'],
      aliases: ['知洄学习总览', 'Vaultide Overview'],
    },
    managedBlocks,
  };
}

export function vaultOverviewDraftBlocks(
  desired: readonly ManagedBlockState[],
  document: VaultOverviewDocumentRecord,
): ManagedBlockDraft[] {
  if (!document.lastContentHash) return desired.map((item) => ({ ...item }));
  const previous = new Map(document.managedBlocks.map((item) => [item.id, item]));
  return desired.map((item) => {
    const current = previous.get(item.id);
    if (!current) throw new Error(`Vault overview is missing managed block ${item.id}.`);
    return { ...item, expectedHash: current.contentHash };
  });
}
