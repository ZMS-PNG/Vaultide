import type { JsonObject } from '@openmaic/learning-protocol';
import type { ClassroomLearningSnapshot, LearningSprintRecord } from './learning-progress';
import type { MasteryProjection } from './mastery-evidence';
import { researchFreshness, researchFreshnessLabel, sourceAuthorityLabel } from './source-quality';

export type ExternalAssetSourceKind = 'github' | 'paper' | 'article' | 'web';

export interface ExternalSourceReference {
  citationId?: string;
  title: string;
  url: string;
  domain?: string;
  authority?: 'primary' | 'authoritative' | 'general';
  score?: number;
}

export interface ExternalKnowledgeAssetCandidate {
  sourceKind: ExternalAssetSourceKind;
  canonicalKey: string;
  canonicalUrl: string;
  title: string;
  researchRunId: string;
  sources: ExternalSourceReference[];
}

export interface KnowledgeAssetRecord {
  id: string;
  ownerId: string;
  assetKind: 'external-card' | 'project-index' | 'synthesis-index';
  sourceKind: ExternalAssetSourceKind;
  canonicalKey: string;
  canonicalUrl: string;
  title: string;
  status: 'active' | 'archived';
  createdAt: Date;
  updatedAt: Date;
}

export interface KnowledgeAssetVersionRecord {
  id: string;
  ownerId: string;
  assetId: string;
  researchRunId?: string;
  sourceFingerprint: string;
  sourceRefs: ExternalSourceReference[];
  cardMarkdown: string;
  contentHash: string;
  capturedAt: Date;
  createdAt: Date;
}

function cleanInline(value: string, fallback: string): string {
  const cleaned = value
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || fallback;
}

function markdownLabel(value: string): string {
  return cleanInline(value, '未命名来源').replace(/[\[\]]/g, '\\$&');
}

function pathSegment(value: string): string {
  const cleaned = cleanInline(value, '未命名资料')
    .replace(/[<>:"/\\|?*]/g, '-')
    .replace(/\.{2,}/g, '.')
    .replace(/[. ]+$/g, '')
    .slice(0, 72);
  return cleaned || '未命名资料';
}

function safeHttpUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url : null;
  } catch {
    return null;
  }
}

function canonicalExternalUrl(url: URL): {
  sourceKind: ExternalAssetSourceKind;
  canonicalKey: string;
  canonicalUrl: string;
} {
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  const parts = url.pathname.split('/').filter(Boolean);
  if (host === 'github.com' && parts.length >= 2) {
    const owner = parts[0]?.toLowerCase() ?? 'unknown';
    const repository = (parts[1] ?? 'unknown').replace(/\.git$/i, '').toLowerCase();
    return {
      sourceKind: 'github',
      canonicalKey: `github:${owner}/${repository}`,
      canonicalUrl: `https://github.com/${owner}/${repository}`,
    };
  }
  if (host === 'arxiv.org' || host === 'export.arxiv.org') {
    const identifier = (parts[1] ?? parts[0] ?? '').replace(/\.pdf$/i, '').replace(/v\d+$/i, '');
    if (/^\d{4}\.\d{4,5}$/.test(identifier)) {
      return {
        sourceKind: 'paper',
        canonicalKey: `arxiv:${identifier.toLowerCase()}`,
        canonicalUrl: `https://arxiv.org/abs/${identifier}`,
      };
    }
  }
  if (host === 'doi.org' || host === 'dx.doi.org') {
    const doi = decodeURIComponent(parts.join('/')).toLowerCase();
    if (doi) {
      return {
        sourceKind: 'paper',
        canonicalKey: `doi:${doi}`,
        canonicalUrl: `https://doi.org/${encodeURI(doi)}`,
      };
    }
  }
  url.hash = '';
  url.search = '';
  const normalizedPath = url.pathname.replace(/\/+$/, '') || '/';
  const canonicalUrl = `${url.protocol}//${host}${normalizedPath}`;
  return {
    sourceKind: /paper|journal|proceedings|research|science|nature/.test(host)
      ? 'paper'
      : host
        ? 'article'
        : 'web',
    canonicalKey: `url:${canonicalUrl.toLowerCase()}`,
    canonicalUrl,
  };
}

function authorityRank(value: ExternalSourceReference['authority']): number {
  return value === 'primary' ? 3 : value === 'authoritative' ? 2 : 1;
}

/**
 * Selects one stable primary identity while retaining every safe citation as
 * evidence. It does not infer claims from snippets or copied page text.
 */
export function externalKnowledgeAssetCandidate(input: {
  researchRunId?: string;
  sources?: readonly ExternalSourceReference[];
}): ExternalKnowledgeAssetCandidate | null {
  if (!input.researchRunId || !/^rrn_[a-f0-9]{32}$/.test(input.researchRunId)) return null;
  const safeSources = (input.sources ?? [])
    .map((source, index) => ({ source, index, url: safeHttpUrl(source.url) }))
    .filter((entry): entry is { source: ExternalSourceReference; index: number; url: URL } =>
      Boolean(entry.url),
    )
    .sort(
      (left, right) =>
        authorityRank(right.source.authority) - authorityRank(left.source.authority) ||
        (right.source.score ?? 0) - (left.source.score ?? 0) ||
        left.index - right.index,
    );
  const primary = safeSources[0];
  if (!primary) return null;
  const canonical = canonicalExternalUrl(primary.url);
  return {
    ...canonical,
    title: cleanInline(primary.source.title, canonical.canonicalUrl),
    researchRunId: input.researchRunId,
    sources: safeSources.slice(0, 30).map(({ source, url }) => ({
      citationId: source.citationId,
      title: cleanInline(source.title, url.toString()),
      url: url.toString(),
      ...(source.domain ? { domain: cleanInline(source.domain, url.hostname) } : {}),
      ...(source.authority ? { authority: source.authority } : {}),
      ...(typeof source.score === 'number' && Number.isFinite(source.score)
        ? { score: source.score }
        : {}),
    })),
  };
}

function sourceDirectory(kind: ExternalAssetSourceKind): string {
  if (kind === 'github') return '外部项目';
  if (kind === 'paper') return '论文与科研';
  if (kind === 'article') return '技术与文章';
  return '技术与文章';
}

function masteryLines(projections: readonly MasteryProjection[]): string[] {
  const classroom = projections.find((projection) => projection.conceptId === 'classroom');
  if (!classroom || classroom.estimate === null) {
    return ['- 当前掌握度：未知（尚无主动学习证据）'];
  }
  return [
    `- 当前掌握度：${Math.round(classroom.estimate * 100)}%`,
    `- 证据置信度：${Math.round(classroom.confidence * 100)}%`,
    `- 主动学习证据：${classroom.evidenceCount} 条`,
    ...(classroom.nextReviewAt ? [`- 建议下次复习：${classroom.nextReviewAt.slice(0, 10)}`] : []),
  ];
}

export function renderExternalKnowledgeCard(input: {
  asset: KnowledgeAssetRecord;
  version: KnowledgeAssetVersionRecord;
  classroom: ClassroomLearningSnapshot;
  sprint: LearningSprintRecord;
  mastery: readonly MasteryProjection[];
  now: Date;
}): { relativePath: string; content: string; frontmatter: JsonObject } {
  const { asset, version, classroom, sprint, mastery, now } = input;
  const citations = version.sourceRefs.map((source, index) => {
    const citation = source.citationId ?? `S${index + 1}`;
    const quality = ` · ${sourceAuthorityLabel(source.authority)}`;
    return `- [${citation}] [${markdownLabel(source.title)}](${source.url})${quality}`;
  });
  const researchFetchedAt = classroom.stage.learningContext?.researchFetchedAt;
  const content = [
    `# 资料卡｜${asset.title}`,
    '',
    '> 这是知洄生成的可追溯外部学习资料卡。它保存来源身份、课堂和学习证据，不复制外部正文，也不把模型总结当作来源原文。',
    '',
    '## 来源身份',
    '',
    `- 类型：${asset.sourceKind}`,
    `- 规范链接：[${markdownLabel(asset.title)}](${asset.canonicalUrl})`,
    `- 稳定标识：\`${asset.canonicalKey}\``,
    `- 抓取记录：\`${version.researchRunId ?? '未记录'}\``,
    `- 检索时效：${researchFreshnessLabel(researchFreshness(researchFetchedAt, now))}${researchFetchedAt ? `（采集于 ${researchFetchedAt}）` : ''}`,
    `- 资料版本：\`${version.id}\``,
    '',
    '## 学习目标',
    '',
    sprint.goal || '尚未记录明确目标。',
    '',
    '## 相关课堂',
    '',
    `- 课堂：${cleanInline(classroom.stage.name, classroom.id)}`,
    `- 链接：/classroom/${classroom.id}`,
    `- 课堂场景：${classroom.scenes.length} 个`,
    '',
    '## 可追溯引用',
    '',
    ...(citations.length > 0 ? citations : ['- 本版本仅保存了来源身份，尚无可显示引用。']),
    '',
    '## 学习证据与复习',
    '',
    ...masteryLines(mastery),
    '',
    '## 使用边界',
    '',
    '- 外部内容可能在之后发生变化；请以原链接和版本记录为准。',
    '- 这份资料卡不等同于原论文、仓库或文章全文。',
    '- 若需要归纳多个来源，请在知洄“知识归纳”中选择它们并保留引用链。',
    '',
    '## 我的补充',
    '',
    '此版本是不可变的来源与学习快照；可在这里自由记录自己的判断、问题和迁移想法。',
    '',
    `生成时间：${now.toISOString()}`,
    '',
  ].join('\n');
  return {
    relativePath: `Vaultide/资料库/${sourceDirectory(asset.sourceKind)}/${pathSegment(asset.title)}--${version.id}.md`,
    content,
    frontmatter: {
      maic_note_id: asset.id,
      maic_asset_id: asset.id,
      maic_asset_version_id: version.id,
      maic_research_run_id: version.researchRunId ?? '',
      maic_sprint_id: sprint.id,
      maic_status: 'source-version',
      maic_updated_at: now.toISOString(),
      tags: ['vaultide', 'openmaic', 'external-knowledge', asset.sourceKind],
      aliases: [`资料卡 ${asset.title}`],
    },
  };
}
