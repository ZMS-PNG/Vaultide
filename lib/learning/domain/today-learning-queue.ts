export type TodayLearningQueueKind = 'review' | 'weak' | 'transfer' | 'continue';

export interface TodayLearningReview {
  id: string;
  classroomId: string;
  conceptId: string;
  goal: string;
  projectName?: string;
  masteryEstimate: number | null;
  masteryEvidenceCount: number;
  dueAt: string;
  isDue: boolean;
}

export interface TodayLearningMastery {
  sprintId: string;
  conceptId: string;
  estimate: number | null;
  confidence: number;
  evidenceCount: number;
  evidenceTypes?: string[];
  classroomId?: string;
  goal?: string;
  projectName?: string;
  nextReviewAt?: string;
  computedAt: string;
}

export interface TodayLearningClassroom {
  id: string;
  name: string;
  description?: string;
  updatedAt: number;
}

export interface TodayLearningQueueItem {
  id: string;
  kind: TodayLearningQueueKind;
  title: string;
  description: string;
  href: string;
  priority: number;
}

export interface TodayLearningQueue {
  items: TodayLearningQueueItem[];
  summary: {
    dueReviews: number;
    weakConcepts: number;
    transferNeeded: number;
    recentClassrooms: number;
  };
}

function conceptLabel(conceptId: string): string {
  const withoutNamespace = conceptId.includes(':')
    ? conceptId.slice(conceptId.lastIndexOf(':') + 1)
    : conceptId;
  const normalized = withoutNamespace.replaceAll(/[_-]+/g, ' ').trim();
  return normalized || '待检验知识点';
}

function isGenericConceptLabel(label: string): boolean {
  return (
    /^(classroom|concept|knowledge|scene|待检验知识点)$/i.test(label) ||
    (/^[A-Za-z0-9]{12,}$/.test(label) && !/\s/.test(label))
  );
}

function goalSubject(goal: string): string {
  const quoted = goal.match(/[《“"]([^》”"]{2,80})[》”"]/u)?.[1]?.trim();
  if (quoted) return quoted;
  const withoutUrls = goal
    .replaceAll(/https?:\/\/\S+/gu, '')
    .replaceAll(/\s+/g, ' ')
    .trim();
  const firstClause = withoutUrls.split(/[。！？；\n]/u)[0]?.trim();
  if (!firstClause) return '课堂核心内容';
  return firstClause.length > 34 ? `${firstClause.slice(0, 34)}…` : firstClause;
}

function reviewLabel(review: TodayLearningReview): string {
  const label = conceptLabel(review.conceptId);
  return isGenericConceptLabel(label) ? goalSubject(review.goal) : label;
}

function masteryLabel(mastery: TodayLearningMastery): string {
  const label = conceptLabel(mastery.conceptId);
  return isGenericConceptLabel(label) && mastery.goal ? goalSubject(mastery.goal) : label;
}

function isWeakMastery(item: TodayLearningMastery): boolean {
  return item.estimate !== null && item.estimate < 0.7 && item.confidence >= 0.25;
}

function needsTransferEvidence(item: TodayLearningMastery): boolean {
  return (
    item.estimate !== null &&
    item.estimate >= 0.7 &&
    item.confidence >= 0.25 &&
    item.evidenceCount > 0 &&
    !(item.evidenceTypes ?? []).includes('transferTaskCompleted')
  );
}

export function buildTodayLearningQueue(input: {
  reviews: readonly TodayLearningReview[];
  mastery: readonly TodayLearningMastery[];
  classrooms: readonly TodayLearningClassroom[];
  limit?: number;
}): TodayLearningQueue {
  const limit = Math.max(1, Math.min(8, Math.trunc(input.limit ?? 5)));
  const dueReviews = input.reviews
    .filter((review) => review.isDue)
    .sort(
      (left, right) =>
        Date.parse(left.dueAt) - Date.parse(right.dueAt) ||
        (left.masteryEstimate ?? 1) - (right.masteryEstimate ?? 1),
    );
  const reviewConcepts = new Set(dueReviews.map((review) => review.conceptId));
  const reviewGroups = new Map<string, { review: TodayLearningReview; count: number }>();
  for (const review of dueReviews) {
    const group = reviewGroups.get(review.classroomId);
    if (group) {
      group.count += 1;
    } else {
      reviewGroups.set(review.classroomId, { review, count: 1 });
    }
  }
  const weakMastery = input.mastery
    .filter((projection) => isWeakMastery(projection) && !reviewConcepts.has(projection.conceptId))
    .sort(
      (left, right) =>
        (left.estimate ?? 1) - (right.estimate ?? 1) ||
        right.confidence - left.confidence ||
        right.evidenceCount - left.evidenceCount,
    );
  const transferGroups = new Map<string, TodayLearningMastery>();
  for (const projection of input.mastery.filter(needsTransferEvidence)) {
    const key = projection.classroomId ?? projection.sprintId;
    const current = transferGroups.get(key);
    if (
      !current ||
      projection.confidence > current.confidence ||
      (projection.confidence === current.confidence &&
        projection.evidenceCount > current.evidenceCount)
    ) {
      transferGroups.set(key, projection);
    }
  }
  const transferNeeded = [...transferGroups.values()].sort(
    (left, right) =>
      right.confidence - left.confidence ||
      (right.estimate ?? 0) - (left.estimate ?? 0) ||
      right.evidenceCount - left.evidenceCount,
  );
  const recentClassrooms = [...input.classrooms].sort(
    (left, right) => right.updatedAt - left.updatedAt,
  );

  const recommendations: TodayLearningQueueItem[] = [
    ...[...reviewGroups.values()].map(({ review, count }, index) => ({
      id: `review:${review.classroomId}`,
      kind: 'review' as const,
      title: `复习：${reviewLabel(review)}`,
      description: `${count > 1 ? `${count} 个到期知识点 · ` : ''}${
        review.projectName ?? goalSubject(review.goal)
      } · ${
        review.masteryEstimate === null
          ? '掌握度待检验'
          : `掌握度 ${Math.round(review.masteryEstimate * 100)}%`
      } · ${review.masteryEvidenceCount} 条证据`,
      href: `/classroom/${encodeURIComponent(review.classroomId)}?reviewItemId=${encodeURIComponent(
        review.id,
      )}#rumination`,
      priority: 120 - index,
    })),
    ...weakMastery.map((projection, index) => ({
      id: `weak:${projection.sprintId}:${projection.conceptId}`,
      kind: 'weak' as const,
      title: `补强：${masteryLabel(projection)}`,
      description: `掌握度 ${Math.round((projection.estimate ?? 0) * 100)}% · ${
        projection.evidenceCount
      } 条学习证据，建议先查看错因和先修关系`,
      href: '/knowledge',
      priority: 90 - index,
    })),
    ...transferNeeded.map((projection, index) => ({
      id: `transfer:${projection.classroomId ?? projection.sprintId}:${projection.conceptId}`,
      kind: 'transfer' as const,
      title: `迁移检验：${masteryLabel(projection)}`,
      description: `${
        projection.projectName ?? projection.goal ?? '当前知识点'
      } · 已有掌握证据，但还缺少新情境迁移；进入课堂完成一道应用或对比任务`,
      href: projection.classroomId
        ? `/classroom/${encodeURIComponent(projection.classroomId)}`
        : '/knowledge',
      priority: 75 - index,
    })),
    ...recentClassrooms.slice(0, 2).map((classroom, index) => ({
      id: `continue:${classroom.id}`,
      kind: 'continue' as const,
      title: `继续：${classroom.name}`,
      description: classroom.description?.trim() || '从上次课堂继续，完成本轮学习并沉淀结果。',
      href: `/classroom/${encodeURIComponent(classroom.id)}`,
      priority: 60 - index,
    })),
  ];

  const seen = new Set<string>();
  const items = recommendations
    .sort((left, right) => right.priority - left.priority)
    .filter((item) => {
      const key = `${item.kind}:${item.href}:${item.title}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);

  return {
    items,
    summary: {
      dueReviews: dueReviews.length,
      weakConcepts: weakMastery.length,
      transferNeeded: transferNeeded.length,
      recentClassrooms: recentClassrooms.length,
    },
  };
}
