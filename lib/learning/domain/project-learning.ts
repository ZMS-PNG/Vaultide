import { createHash } from 'node:crypto';
import type { JsonObject } from '@openmaic/learning-protocol';
import type { LearningProjectRecord } from './project';
import type { ManagedBlockDraft, ManagedBlockState } from './learning-progress';

export const PROJECT_INDEX_ROOT = 'Vaultide/系统/索引';

export type ProjectSourceLearningState = 'pending' | 'learning' | 'review' | 'verified';

export interface ProjectSourceCompanionLink {
  id: string;
  relativePath: string;
}

export interface ProjectSourceSprintLink {
  id: string;
  classroomId: string;
  status: 'active' | 'completed' | 'archived';
  sourceVersionId: string;
  updatedAt: Date;
}

export interface ProjectSourceMastery {
  estimate: number | null;
  confidence: number;
  evidenceCount: number;
  nextReviewAt?: Date;
}

export interface ProjectSourceReviewLink {
  id: string;
  state: 'scheduled' | 'due' | 'completed' | 'cancelled';
  dueAt: Date;
}

export interface ProjectSourceLearningRecord {
  sourceId: string;
  title: string;
  relativePath: string;
  latestVersionId: string;
  latestContentHash: string;
  indexStatus: 'pending' | 'ready' | 'failed' | 'purged' | 'missing';
  indexedChunkCount: number;
  lastSeenAt: Date;
  companion?: ProjectSourceCompanionLink;
  latestSprint?: ProjectSourceSprintLink;
  latestCompletedSourceVersionId?: string;
  mastery?: ProjectSourceMastery;
  review?: ProjectSourceReviewLink;
  learningState: ProjectSourceLearningState;
  sourceUpdated: boolean;
}

export interface ProjectLearningIndexRecord {
  project: LearningProjectRecord;
  sources: ProjectSourceLearningRecord[];
  generatedAt: Date;
}

export interface ProjectLearningIndexSummary {
  sourceCount: number;
  pendingCount: number;
  learningCount: number;
  reviewCount: number;
  verifiedCount: number;
  sourceUpdatedCount: number;
  unindexedCount: number;
}

export interface ProjectLearningIndexDocumentRecord {
  id: string;
  ownerId: string;
  projectId: string;
  vaultBindingId: string;
  relativePath: string;
  status: 'active' | 'archived';
  managedBlocks: ManagedBlockState[];
  lastContentHash?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface RenderedProjectLearningIndex {
  relativePath: string;
  content: string;
  frontmatter: JsonObject;
  managedBlocks: ManagedBlockState[];
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function sourceLearningState(input: {
  latestSprint?: ProjectSourceSprintLink;
  mastery?: ProjectSourceMastery;
  review?: ProjectSourceReviewLink;
  now: Date;
}): ProjectSourceLearningState {
  const reviewDue =
    input.review &&
    input.review.state !== 'cancelled' &&
    input.review.state !== 'completed' &&
    input.review.dueAt.getTime() <= input.now.getTime();
  if (reviewDue) return 'review';
  if (!input.latestSprint) return 'pending';
  const mastery = input.mastery;
  if (
    input.latestSprint.status === 'completed' &&
    mastery?.estimate !== null &&
    mastery !== undefined &&
    clamp(mastery.estimate) >= 0.75 &&
    clamp(mastery.confidence) >= 0.3 &&
    mastery.evidenceCount >= 2
  ) {
    return 'verified';
  }
  return 'learning';
}

export function projectLearningIndexSummary(
  index: ProjectLearningIndexRecord,
): ProjectLearningIndexSummary {
  const summary: ProjectLearningIndexSummary = {
    sourceCount: index.sources.length,
    pendingCount: 0,
    learningCount: 0,
    reviewCount: 0,
    verifiedCount: 0,
    sourceUpdatedCount: 0,
    unindexedCount: 0,
  };
  for (const source of index.sources) {
    switch (source.learningState) {
      case 'pending':
        summary.pendingCount += 1;
        break;
      case 'learning':
        summary.learningCount += 1;
        break;
      case 'review':
        summary.reviewCount += 1;
        break;
      case 'verified':
        summary.verifiedCount += 1;
        break;
    }
    if (source.sourceUpdated) summary.sourceUpdatedCount += 1;
    if (source.indexStatus !== 'ready') summary.unindexedCount += 1;
  }
  return summary;
}

function cleanInline(value: string, fallback: string): string {
  const cleaned = value
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/<!--\s*\/?vaultide:managed\b/gi, 'Vaultide managed')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || fallback;
}

function pathSegment(value: string): string {
  const cleaned = cleanInline(value, '未命名项目')
    .replace(/[<>:"/\\|?*]/g, '-')
    .replace(/\.{2,}/g, '.')
    .replace(/[. ]+$/g, '')
    .slice(0, 72);
  return cleaned || '未命名项目';
}

function markdownLinkPath(value: string): string {
  return value.replace(/[\[\]|]/g, '\\$&');
}

function normalizeManagedBlockContent(content: string): string {
  return content.replaceAll('\r\n', '\n').replaceAll('\r', '\n').trim();
}

function managedBlock(id: string, content: string): ManagedBlockState {
  const normalized = normalizeManagedBlockContent(content);
  return {
    id,
    content: normalized,
    contentHash: createHash('sha256').update(normalized, 'utf8').digest('hex'),
  };
}

function renderManagedBlock(block: ManagedBlockState, projectIndexId: string): string {
  return [
    `<!-- vaultide:managed block=${block.id} project-index=${projectIndexId} -->`,
    block.content,
    '<!-- /vaultide:managed -->',
  ].join('\n');
}

function sourceStateLabel(state: ProjectSourceLearningState): string {
  switch (state) {
    case 'pending':
      return '待学习';
    case 'learning':
      return '学习中';
    case 'review':
      return '待复习';
    case 'verified':
      return '已验证';
  }
}

function sourceLines(index: ProjectLearningIndexRecord): string[] {
  if (index.sources.length === 0) return ['- 当前没有已授权的项目来源。'];
  return index.sources.map((source) => {
    const links = [`[[${markdownLinkPath(source.relativePath)}]]`];
    if (source.companion) links.push(`伴随：[[${markdownLinkPath(source.companion.relativePath)}]]`);
    if (source.latestSprint) links.push(`课堂：/classroom/${source.latestSprint.classroomId}`);
    const mastery =
      source.mastery?.estimate === null || source.mastery?.estimate === undefined
        ? '掌握未知'
        : `掌握 ${Math.round(source.mastery.estimate * 100)}%`;
    const update = source.sourceUpdated ? ' · 来源已更新，建议重新学习' : '';
    const indexed = source.indexStatus === 'ready' ? '' : ` · 索引${source.indexStatus}`;
    return `- [${sourceStateLabel(source.learningState)}] ${links.join(' · ')} · ${mastery}${update}${indexed}`;
  });
}

function reviewLines(index: ProjectLearningIndexRecord): string[] {
  const due = index.sources
    .filter((source) => source.learningState === 'review' && source.review)
    .sort((left, right) => (left.review?.dueAt.getTime() ?? 0) - (right.review?.dueAt.getTime() ?? 0));
  if (due.length === 0) return ['- 当前没有到期复习；学习证据会在到期时进入网页复习队列。'];
  return due.map(
    (source) =>
      `- ${source.review?.dueAt.toISOString().slice(0, 10)}｜[[${markdownLinkPath(source.relativePath)}]]｜${source.latestSprint ? `/classroom/${source.latestSprint.classroomId}` : '尚无课堂链接'}`,
  );
}

/** Render the one stable managed index for a folder-like learning project. */
export function renderProjectLearningIndex(input: {
  projectIndexId: string;
  index: ProjectLearningIndexRecord;
  now: Date;
}): RenderedProjectLearningIndex {
  const summary = projectLearningIndexSummary(input.index);
  const projectName = cleanInline(input.index.project.projectName, '未命名项目');
  const summaryBlock = managedBlock(
    'summary',
    [
      '## 项目学习概览',
      '',
      `- 项目：${projectName}`,
      `- 当前项目版本：${input.index.project.projectRevision}`,
      `- 授权来源：${summary.sourceCount} 份（待学习 ${summary.pendingCount}、学习中 ${summary.learningCount}、待复习 ${summary.reviewCount}、已验证 ${summary.verifiedCount}）`,
      `- 需要重新学习：${summary.sourceUpdatedCount} 份来源版本已更新`,
      `- 索引状态：${summary.unindexedCount === 0 ? '全部可检索' : `${summary.unindexedCount} 份来源尚不可检索`}`,
      `- 最近生成：${input.now.toISOString()}`,
    ].join('\n'),
  );
  const coverageBlock = managedBlock(
    'coverage',
    ['## 来源覆盖与学习状态', '', ...sourceLines(input.index)].join('\n'),
  );
  const reviewsBlock = managedBlock('reviews', ['## 待复习', '', ...reviewLines(input.index)].join('\n'));
  const linksBlock = managedBlock(
    'links',
    [
      '## 关联入口',
      '',
      `- 网页归纳入口：/knowledge?projectId=${input.index.project.id}`,
      `- 项目 ID：\`${input.index.project.id}\``,
      '- 原始笔记始终保持只读；每份已创建伴随笔记仅更新其受管区块。',
    ].join('\n'),
  );
  const managedBlocks = [summaryBlock, coverageBlock, reviewsBlock, linksBlock];
  const relativePath = `${PROJECT_INDEX_ROOT}/${pathSegment(projectName)}--${input.index.project.id.slice(-8)}.md`;
  return {
    relativePath,
    content: [
      `# 项目学习索引｜${projectName}`,
      '',
      '> 此索引由知洄 Vaultide 管理，汇总项目学习进度、来源版本与复习计划。它不是原始项目笔记，也不会修改项目内任何原有文件。',
      '',
      ...managedBlocks.flatMap((block) => [renderManagedBlock(block, input.projectIndexId), '']),
      '## 我的补充',
      '',
      '> 此区域由你自由编辑，Vaultide 永远不会修改。',
      '',
    ].join('\n'),
    frontmatter: {
      maic_note_id: input.projectIndexId,
      maic_project_index_id: input.projectIndexId,
      maic_project_id: input.index.project.id,
      maic_project_revision: input.index.project.projectRevision,
      maic_managed: true,
      maic_status: 'active',
      maic_updated_at: input.now.toISOString(),
      tags: ['vaultide', 'project-learning-index'],
      aliases: [`项目学习索引 ${projectName}`],
    },
    managedBlocks,
  };
}

export function projectIndexDraftBlocks(
  desired: readonly ManagedBlockState[],
  document: ProjectLearningIndexDocumentRecord,
): ManagedBlockDraft[] {
  if (!document.lastContentHash) return desired.map((block) => ({ ...block }));
  const previous = new Map(document.managedBlocks.map((block) => [block.id, block]));
  return desired.map((block) => {
    const current = previous.get(block.id);
    if (!current) throw new Error(`Project index is missing managed block ${block.id}.`);
    return { ...block, expectedHash: current.contentHash };
  });
}
