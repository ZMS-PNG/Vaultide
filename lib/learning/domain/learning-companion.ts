import { createHash } from 'node:crypto';
import type { JsonObject } from '@openmaic/learning-protocol';
import type {
  ClassroomLearningSnapshot,
  LearningProgressSnapshot,
  LearningSprintRecord,
  ManagedBlockState,
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

export const MANAGED_COMPANION_ROOT = 'Vaultide/伴随笔记';

export interface RenderLearningCompanionInput {
  companionId: string;
  sourceId: string;
  sourceSnapshotId?: string;
  originalRelativePath: string;
  classroom: ClassroomLearningSnapshot;
  sprint: LearningSprintRecord;
  progress: LearningProgressSnapshot;
  events: readonly StoredLearningEvent[];
  mastery?: readonly MasteryProjection[];
  knowledgeSnapshot?: KnowledgeSnapshotRecord | KnowledgeSnapshotProjection;
  now: Date;
  previousManagedBlocks?: readonly ManagedBlockState[];
}

export interface RenderedLearningCompanion {
  relativePath: string;
  content: string;
  frontmatter: JsonObject;
  managedBlocks: ManagedBlockState[];
}

function cleanInline(value: string, fallback: string): string {
  const cleaned = value
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/<!--\s*\/?vaultide:managed\b/gi, 'Vaultide managed')
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
  const cleaned = cleanInline(value, '未命名笔记')
    .replace(/[<>:"/\\|?*]/g, '-')
    .replace(/\.{2,}/g, '.')
    .replace(/[. ]+$/g, '')
    .slice(0, 72);
  return cleaned || '未命名笔记';
}

function markdownLinkPath(path: string): string {
  return path.replace(/[\[\]|]/g, '\\$&');
}

export function normalizeManagedBlockContent(content: string): string {
  return content.replaceAll('\r\n', '\n').replaceAll('\r', '\n').trim();
}

export function managedBlockHash(content: string): string {
  return createHash('sha256').update(normalizeManagedBlockContent(content), 'utf8').digest('hex');
}

function managedBlock(id: string, content: string): ManagedBlockState {
  const normalized = normalizeManagedBlockContent(safeBlockText(content));
  return { id, content: normalized, contentHash: managedBlockHash(normalized) };
}

function renderManagedBlock(block: ManagedBlockState, companionId: string): string {
  return [
    `<!-- vaultide:managed block=${block.id} companion=${companionId} -->`,
    block.content,
    '<!-- /vaultide:managed -->',
  ].join('\n');
}

function projectDirectory(sprint: LearningSprintRecord): string | undefined {
  if (!sprint.projectId) return undefined;
  return `${pathSegment(sprint.projectName ?? '未命名项目')}--${sprint.projectId.slice(-8)}`;
}

function sceneProgressLines(
  progress: LearningProgressSnapshot,
  classroom: ClassroomLearningSnapshot,
): string[] {
  const current = classroom.scenes.find((scene) => scene.id === progress.currentSceneId);
  const lines = [
    `- 课堂场景：${classroom.scenes.length} 个`,
    `- 当前停留：${current ? cleanInline(current.title, current.id) : '尚未记录'}`,
  ];
  if (progress.quizSummaries.length === 0) {
    lines.push('- 练习记录：尚无已提交测验');
    return lines;
  }
  lines.push('- 练习记录：');
  for (const quiz of progress.quizSummaries) {
    const score =
      quiz.earned !== undefined && quiz.possible ? `，得分 ${quiz.earned}/${quiz.possible}` : '';
    lines.push(
      `  - ${cleanInline(quiz.title, quiz.sceneId)}：已答 ${quiz.answered}/${quiz.total}${score}`,
    );
  }
  return lines;
}

function masteryLines(
  classroom: ClassroomLearningSnapshot,
  projections: readonly MasteryProjection[] | undefined,
): string[] {
  const classroomProjection = projections?.find(
    (projection) => projection.conceptId === CLASSROOM_MASTERY_CONCEPT_ID,
  );
  if (!classroomProjection || classroomProjection.estimate === null) {
    return ['- 掌握度：未知（尚无主动学习证据；浏览和完成标记不会被当作掌握）'];
  }
  const lines = [
    `- 课堂掌握度：${Math.round(classroomProjection.estimate * 100)}%（置信度 ${Math.round(classroomProjection.confidence * 100)}%，${classroomProjection.evidenceCount} 条证据）`,
    ...(classroomProjection.nextReviewAt
      ? [`- 建议下次复习：${classroomProjection.nextReviewAt.slice(0, 10)}`]
      : []),
  ];
  for (const scene of classroom.scenes.slice(0, 12)) {
    const projection = projections?.find((item) => item.conceptId === `scene:${scene.id}`);
    if (!projection || projection.estimate === null) continue;
    lines.push(
      `  - ${cleanInline(scene.title, scene.id)}：${Math.round(projection.estimate * 100)}%（置信度 ${Math.round(projection.confidence * 100)}%）`,
    );
  }
  return lines;
}

function activitySummary(events: readonly StoredLearningEvent[]): string {
  const counted = new Map<string, number>();
  for (const event of events) {
    if (event.eventType === 'writebackApproved' || event.eventType === 'writebackApplied') continue;
    counted.set(event.eventType, (counted.get(event.eventType) ?? 0) + 1);
  }
  if (counted.size === 0) return '尚无主动学习事件';
  const labels: Record<string, string> = {
    diagnosisAnswered: '诊断回答',
    retrievalAttempted: '主动回忆',
    hintRequested: '请求提示',
    answerRevealed: '查看答案',
    explanationSubmitted: '费曼解释',
    practiceSubmitted: '练习提交',
    sceneViewed: '学习场景浏览',
    sceneCompleted: '场景完成',
    sprintCompleted: '课堂完成',
    whiteboardNoteAdded: '白板笔记',
    discussionParticipated: '讨论参与',
    feedbackReceived: '反馈',
    evidenceSubmitted: '证据提交',
    evidenceEvaluated: '证据评估',
    transferTaskCompleted: '迁移任务',
    reviewCompleted: '复习完成',
  };
  return [...counted.entries()]
    .map(([type, count]) => `${labels[type] ?? type} ${count} 次`)
    .join('；');
}

function historyContent(
  input: RenderLearningCompanionInput,
  previous: readonly ManagedBlockState[],
): string {
  const prior = previous.find((block) => block.id === 'history')?.content;
  const goal = cleanInline(input.sprint.goal, '未记录明确目标');
  const entry = `- ${input.now.toISOString().slice(0, 10)}｜目标：${goal}｜${activitySummary(input.events)}`;
  if (!prior) return ['## 学习历史', '', entry].join('\n');
  const normalized = safeBlockText(prior).trim();
  return normalized.endsWith(entry) ? normalized : `${normalized}\n${entry}`;
}

/**
 * Render a single durable note for one user-owned Obsidian source. Only the
 * four marked blocks are ever eligible for future automated replacement.
 */
export function renderLearningCompanion(
  input: RenderLearningCompanionInput,
): RenderedLearningCompanion {
  const title = cleanInline(input.classroom.stage.name, '未命名课堂');
  const goal = cleanInline(input.sprint.goal, '未记录明确目标');
  const learningProject = input.classroom.stage.learningContext?.learningProject;
  const knowledgeSnapshot =
    input.knowledgeSnapshot ?? projectKnowledgeSnapshot({ events: input.events });
  const knowledgeSections = knowledgeSnapshotMarkdownSections(knowledgeSnapshot);
  const concepts = [...input.classroom.scenes]
    .sort((left, right) => left.order - right.order)
    .slice(0, 16)
    .map(
      (scene) => `- ${cleanInline(scene.title, scene.id)}（${cleanInline(scene.type, 'scene')}）`,
    );
  const summary = managedBlock(
    'summary',
    [
      '## 当前理解',
      '',
      `- 当前学习目标：${goal}`,
      ...(learningProject
        ? [
            `- 学习项目：\`${learningProject.id}\``,
            `- 资料范围：${learningProject.sourceMode}；起点：${learningProject.priorKnowledge}；成果：${learningProject.outcome}`,
            '- 完成标准：',
            ...learningProject.successCriteria.map(
              (criterion) => `  - [ ] ${cleanInline(criterion, '未命名标准')}`,
            ),
          ]
        : []),
      `- 对应课堂：${title}`,
      `- 原始资料快照：\`${input.sourceSnapshotId ?? '未记录'}\``,
      `- 已验证知识：${knowledgeSnapshot.verifiedKnowledge.length} 条；误区修正：${knowledgeSnapshot.misconceptions.length} 条；开放问题：${knowledgeSnapshot.unresolvedItems.length} 条`,
      `- 最近更新：${input.now.toISOString()}`,
    ].join('\n'),
  );
  const conceptBlock = managedBlock(
    'concepts',
    [
      ...knowledgeSections.flatMap((section) => [`## ${section.title}`, '', ...section.lines, '']),
      '## 课堂学习路径（非知识结论）',
      '',
      ...(concepts.length > 0 ? concepts : ['- 尚无课堂场景']),
    ].join('\n'),
  );
  const progressBlock = managedBlock(
    'progress',
    [
      '## 学习进度与证据',
      '',
      ...sceneProgressLines(input.progress, input.classroom),
      '',
      `- 学习活动：${activitySummary(input.events)}`,
      '- 掌握度与复习：',
      ...masteryLines(input.classroom, input.mastery),
    ].join('\n'),
  );
  const historyBlock = managedBlock(
    'history',
    historyContent(input, input.previousManagedBlocks ?? []),
  );
  const managedBlocks = [summary, conceptBlock, progressBlock, historyBlock];
  const projectPath = projectDirectory(input.sprint);
  const relativePath = `${MANAGED_COMPANION_ROOT}/${projectPath ? `${projectPath}/` : '独立笔记/'}${pathSegment(title)}--${input.sourceId.slice(-8)}.md`;

  return {
    relativePath,
    content: [
      `# 学习伴随笔记｜${title}`,
      '',
      `> 原有笔记：[[${markdownLinkPath(input.originalRelativePath)}]]`,
      '> 这份笔记由知洄 Vaultide 管理。原有笔记始终只读；自动更新仅作用于下方已标记的受管区块。',
      '',
      ...managedBlocks.flatMap((block) => [renderManagedBlock(block, input.companionId), '']),
      '## 我的补充',
      '',
      '> 此区域由你自由编辑，Vaultide 永远不会修改。',
      '',
    ].join('\n'),
    frontmatter: {
      maic_note_id: input.companionId,
      maic_companion_id: input.companionId,
      maic_source_id: input.sourceId,
      ...(learningProject ? { maic_learning_project_id: learningProject.id } : {}),
      maic_original_path: input.originalRelativePath,
      maic_managed: true,
      ...(input.sprint.projectId ? { maic_project_id: input.sprint.projectId } : {}),
      ...(input.sprint.projectRevision
        ? { maic_project_revision: input.sprint.projectRevision }
        : {}),
      ...(isKnowledgeSnapshotRecord(knowledgeSnapshot)
        ? {
            maic_knowledge_snapshot_id: knowledgeSnapshot.id,
            maic_knowledge_snapshot_revision: knowledgeSnapshot.revision,
          }
        : {}),
      maic_sprint_id: input.sprint.id,
      maic_status: input.sprint.status,
      maic_updated_at: input.now.toISOString(),
      tags: [
        'vaultide',
        'learning-companion',
        ...(input.sprint.projectId ? ['project-learning'] : []),
      ],
      aliases: [`学习伴随笔记 ${title}`],
    },
    managedBlocks,
  };
}
