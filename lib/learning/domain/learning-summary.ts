import type { JsonObject } from '@openmaic/learning-protocol';
import type {
  ClassroomLearningSnapshot,
  LearningProgressSnapshot,
  LearningSprintRecord,
  StoredLearningEvent,
} from './learning-progress';
import {
  isKnowledgeSnapshotRecord,
  knowledgeSnapshotMarkdownSections,
  projectKnowledgeSnapshot,
  type KnowledgeSnapshotProjection,
  type KnowledgeSnapshotRecord,
} from './knowledge-snapshot';
import { CLASSROOM_MASTERY_CONCEPT_ID, type MasteryProjection } from './mastery-evidence';
import { researchFreshness, researchFreshnessLabel, sourceAuthorityLabel } from './source-quality';

const MANAGED_LEARNING_ROOT = 'Vaultide/学习记录';

function cleanInline(value: string, fallback: string): string {
  const cleaned = value
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || fallback;
}

function pathSegment(value: string): string {
  const cleaned = cleanInline(value, '未命名课堂')
    .replace(/[<>:"/\\|?*]/g, '-')
    .replace(/\.{2,}/g, '.')
    .replace(/[. ]+$/g, '')
    .slice(0, 72);
  return cleaned || '未命名课堂';
}

function markdownLabel(value: string): string {
  return cleanInline(value, '未命名来源').replace(/[\[\]]/g, '\\$&');
}

function safeResearchUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function projectDirectory(sprint: LearningSprintRecord): string | undefined {
  if (!sprint.projectId) return undefined;
  const name = pathSegment(sprint.projectName ?? '未命名项目');
  return `${name}--${sprint.projectId.slice(-8)}`;
}

function progressLines(
  snapshot: LearningProgressSnapshot,
  classroom: ClassroomLearningSnapshot,
): string[] {
  const current = classroom.scenes.find((scene) => scene.id === snapshot.currentSceneId);
  const lines = [
    `- 课堂场景：${classroom.scenes.length} 个`,
    `- 当前停留：${current ? cleanInline(current.title, current.id) : '尚未记录'}`,
  ];
  if (snapshot.quizSummaries.length === 0) {
    lines.push('- 练习记录：尚无已提交测验');
    return lines;
  }
  lines.push('- 练习记录：');
  for (const quiz of snapshot.quizSummaries) {
    const score =
      quiz.earned !== undefined && quiz.possible ? `，得分 ${quiz.earned}/${quiz.possible}` : '';
    lines.push(
      `  - ${cleanInline(quiz.title, quiz.sceneId)}：已答 ${quiz.answered}/${quiz.total}${score}`,
    );
  }
  return lines;
}

function eventLines(events: readonly StoredLearningEvent[]): string[] {
  const learningEvents = events.filter(
    (event) => event.eventType !== 'writebackApproved' && event.eventType !== 'writebackApplied',
  );
  if (learningEvents.length === 0) return ['- 详细学习事件：尚未产生'];

  const counts = new Map<string, number>();
  const feedbackScores: number[] = [];
  for (const event of learningEvents) {
    counts.set(event.eventType, (counts.get(event.eventType) ?? 0) + 1);
    if (event.eventType === 'feedbackReceived' && typeof event.payload.score === 'number') {
      feedbackScores.push(event.payload.score);
    }
  }
  const labels: Record<string, string> = {
    diagnosisAnswered: '诊断回答',
    retrievalAttempted: '主动回忆',
    hintRequested: '请求提示',
    answerRevealed: '查看答案',
    explanationSubmitted: '费曼解释',
    practiceSubmitted: '练习提交',
    feedbackReceived: '反馈',
    evidenceSubmitted: '证据提交',
    evidenceEvaluated: '证据评估',
    transferTaskCompleted: '迁移任务',
    reviewCompleted: '复习完成',
  };
  const lines = [...counts.entries()].map(
    ([eventType, count]) => `- ${labels[eventType] ?? eventType}：${count} 次`,
  );
  if (feedbackScores.length > 0) {
    const average = feedbackScores.reduce((sum, score) => sum + score, 0) / feedbackScores.length;
    lines.push(`- 平均反馈得分：${Math.round(average * 100)}%`);
  }
  return lines;
}

function masteryLines(projections: readonly MasteryProjection[] | undefined): string[] {
  const classroom = projections?.find(
    (projection) => projection.conceptId === CLASSROOM_MASTERY_CONCEPT_ID,
  );
  if (!classroom || classroom.estimate === null) {
    return ['- 当前掌握度：未知（尚无主动学习证据；仅浏览和完成标记不会形成分数）'];
  }
  return [
    `- 当前掌握度：${Math.round(classroom.estimate * 100)}%`,
    `- 置信度：${Math.round(classroom.confidence * 100)}%（${classroom.evidenceCount} 条主动证据）`,
    ...(classroom.nextReviewAt ? [`- 建议下次复习：${classroom.nextReviewAt.slice(0, 10)}`] : []),
  ];
}

export interface RenderLearningSummaryInput {
  classroom: ClassroomLearningSnapshot;
  sprint: LearningSprintRecord;
  progress: LearningProgressSnapshot;
  events: readonly StoredLearningEvent[];
  mastery?: readonly MasteryProjection[];
  knowledgeSnapshot?: KnowledgeSnapshotRecord | KnowledgeSnapshotProjection;
  now: Date;
}

export interface RenderedLearningSummary {
  relativePath: string;
  content: string;
  frontmatter: JsonObject;
}

export function renderLearningSummary(input: RenderLearningSummaryInput): RenderedLearningSummary {
  const { classroom, sprint, progress, events, now } = input;
  const knowledgeSnapshot =
    input.knowledgeSnapshot ?? projectKnowledgeSnapshot({ events: input.events });
  const knowledgeSections = knowledgeSnapshotMarkdownSections(knowledgeSnapshot);
  const title = cleanInline(classroom.stage.name, '未命名课堂');
  const date = now.toISOString().slice(0, 10);
  const sources = classroom.stage.learningContext?.researchSources ?? [];
  const sourceLines: string[] = [];
  if (sprint.sourceBundleId) {
    sourceLines.push(`- Obsidian 私有快照：\`${sprint.sourceBundleId}\``);
  }
  if (sprint.researchRunId) {
    sourceLines.push(`- 外部检索记录：\`${sprint.researchRunId}\`（仅保存引用元数据）`);
    const fetchedAt = classroom.stage.learningContext?.researchFetchedAt;
    sourceLines.push(
      `- 外部证据时效：${researchFreshnessLabel(researchFreshness(fetchedAt, now))}${fetchedAt ? `（采集于 ${fetchedAt}）` : ''}`,
    );
    sourceLines.push('- 链接可访问性：以网页课堂“本课堂来源 → 实时复核链接”的最近结果为准');
  }
  if (sprint.retrievalRunId) {
    sourceLines.push(
      `- 项目目标检索记录：\`${sprint.retrievalRunId}\`（精确分块与 [V#] 引用保存在服务端）`,
    );
    const context = classroom.stage.learningContext;
    sourceLines.push(
      `- 本轮选入：${context?.retrievedSourceCount ?? '未知'} 份来源、${context?.retrievedChunkCount ?? '未知'} 个分块`,
    );
    sourceLines.push(
      `- 匹配质量：${context?.retrievalMatchQuality === 'weak' ? '较弱（用户已在网页确认）' : '明确'}`,
    );
    sourceLines.push(
      `- 授权范围索引覆盖：${context?.projectCoverageState === 'authorized-index-complete' ? '当前授权来源均可检索' : '部分授权来源未参与'}；不可用来源或候选 ${context?.retrievalUnavailableSourceCount ?? 0} 个`,
    );
    for (const citation of context?.retrievalCitations?.slice(0, 30) ?? []) {
      const heading =
        citation.headingPath.length > 0 ? ` › ${citation.headingPath.join(' › ')}` : '';
      sourceLines.push(
        `  - [${cleanInline(citation.citationId, 'V?')}] ${cleanInline(citation.relativePath, '未知路径')}${heading}（\`${citation.sourceVersionId}\`）`,
      );
    }
  }
  for (const source of sources.slice(0, 30)) {
    const url = safeResearchUrl(source.url);
    if (url) {
      const citation = source.citationId ? `[${source.citationId}] ` : '';
      const quality = ` · ${sourceAuthorityLabel(source.authority)}`;
      sourceLines.push(`- ${citation}[${markdownLabel(source.title)}](${url})${quality}`);
    }
  }
  if (sourceLines.length === 0) sourceLines.push('- 本课堂未记录可追溯来源');

  const orderedScenes = [...classroom.scenes].sort((a, b) => a.order - b.order);
  const sceneLines = orderedScenes.map(
    (scene, index) =>
      `- [ ] ${index + 1}. ${cleanInline(scene.title, `场景 ${index + 1}`)}（${scene.type}）`,
  );
  const projectLines = sprint.projectId
    ? [
        '',
        '## 所属项目',
        '',
        `- 项目：${cleanInline(sprint.projectName ?? '未命名项目', '未命名项目')}`,
        `- 项目 ID：\`${sprint.projectId}\``,
        ...(sprint.projectRevision ? [`- 学习时项目版本：${sprint.projectRevision}`] : []),
      ]
    : [];
  const learningProject = classroom.stage.learningContext?.learningProject;
  const learningContractLines = learningProject
    ? [
        '',
        '## 学习合同',
        '',
        `- 学习项目：\`${learningProject.id}\``,
        `- 资料范围：${learningProject.sourceMode}`,
        `- 起点水平：${learningProject.priorKnowledge}`,
        `- 预期成果：${learningProject.outcome}`,
        `- 证据策略：${learningProject.evidencePolicy}`,
        ...(learningProject.knownContext
          ? [`- 已有理解与卡点：${cleanInline(learningProject.knownContext, '未记录')}`]
          : []),
        '- 可验证完成标准：',
        ...learningProject.successCriteria.map(
          (criterion) => `  - [ ] ${cleanInline(criterion, '未命名标准')}`,
        ),
      ]
    : [];

  const content = [
    `# 知洄 Vaultide 学习记录｜${title}`,
    '',
    '> 此笔记由知洄 Vaultide 生成，并经你在网页端批准、在 Obsidian 端确认后写入。原始笔记未被修改。',
    ...projectLines,
    '',
    '## 学习目标',
    '',
    sprint.goal || '尚未记录明确目标。',
    ...learningContractLines,
    '',
    '## 学习进度',
    '',
    ...progressLines(progress, classroom),
    '',
    '## 掌握度与复习',
    '',
    ...masteryLines(input.mastery),
    '',
    '## 学习活动',
    '',
    ...eventLines(events),
    '',
    '## 课堂结构',
    '',
    ...(sceneLines.length > 0 ? sceneLines : ['- 尚无课堂场景']),
    '',
    '## 来源与引用',
    '',
    ...sourceLines,
    '',
    '## 已验证知识快照',
    '',
    '> 这里只呈现通过系统评估且具有追溯信息的知识。学习者自由回答、自评分和未通过评估的内容不会写入。',
    '',
    ...knowledgeSections.flatMap((section) => [`### ${section.title}`, '', ...section.lines, '']),
    '## 后续行动',
    '',
    '- [ ] 回到知洄 Vaultide 完成尚未掌握的场景',
    '- [ ] 用自己的语言补充本笔记，而不是复制课堂原文',
    '- [ ] 安排一次间隔复习并记录结果',
    '',
    `课堂链接：/classroom/${classroom.id}`,
    `生成时间：${now.toISOString()}`,
    '',
  ].join('\n');

  const directory = projectDirectory(sprint);
  return {
    relativePath: `${MANAGED_LEARNING_ROOT}/${directory ? `${directory}/` : ''}${date}-${pathSegment(title)}-${classroom.id}.md`,
    content,
    frontmatter: {
      maic_note_id: `learning-${classroom.id}`,
      ...(sprint.projectId ? { maic_project_id: sprint.projectId } : {}),
      ...(sprint.projectRevision ? { maic_project_revision: sprint.projectRevision } : {}),
      ...(isKnowledgeSnapshotRecord(knowledgeSnapshot)
        ? {
            maic_knowledge_snapshot_id: knowledgeSnapshot.id,
            maic_knowledge_snapshot_revision: knowledgeSnapshot.revision,
          }
        : {}),
      ...(sprint.retrievalRunId
        ? {
            maic_retrieval_run_id: sprint.retrievalRunId,
            maic_coverage_state:
              classroom.stage.learningContext?.projectCoverageState ?? 'authorized-index-partial',
            maic_selected_source_count: classroom.stage.learningContext?.retrievedSourceCount ?? 0,
          }
        : {}),
      maic_sprint_id: sprint.id,
      ...(learningProject ? { maic_learning_project_id: learningProject.id } : {}),
      ...(sprint.researchRunId ? { maic_research_run_id: sprint.researchRunId } : {}),
      maic_status: 'active',
      maic_updated_at: now.toISOString(),
      tags: ['vaultide', 'openmaic', 'learning', ...(sprint.projectId ? ['project-learning'] : [])],
      aliases: [`知洄 Vaultide 学习记录 ${title}`],
    },
  };
}
