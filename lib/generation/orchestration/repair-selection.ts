import type { CourseQualityAssessment } from '@/lib/generation/course-quality';
import type { SceneOutline } from '@/lib/types/generation';

export function selectTargetedRepairSceneOrders(input: {
  outlines: readonly SceneOutline[];
  quality: CourseQualityAssessment;
  sceneScores: readonly number[];
  limit?: number;
}): number[] {
  const maximum = Math.max(1, Math.min(4, Math.trunc(input.limit ?? 4)));
  const scoreByOrder = new Map(
    input.outlines.map((outline, index) => [outline.order, input.sceneScores[index] ?? 0]),
  );
  const validOrders = new Set(scoreByOrder.keys());
  const issueOrders = input.quality.issues
    .map((issue) => issue.sceneOrder)
    .filter(
      (order): order is number =>
        typeof order === 'number' && Number.isInteger(order) && validOrders.has(order),
    );
  const belowCourseAverage = [...scoreByOrder.entries()]
    .filter(([, score]) => score < 93)
    .sort((left, right) => left[1] - right[1])
    .map(([order]) => order);
  const weakestFallback = [...scoreByOrder.entries()]
    .sort((left, right) => left[1] - right[1])
    .map(([order]) => order);
  const prioritizedIssueOrders = [...new Set(issueOrders)].sort(
    (left, right) => (scoreByOrder.get(left) ?? 0) - (scoreByOrder.get(right) ?? 0),
  );
  if (prioritizedIssueOrders.length > 0) {
    return prioritizedIssueOrders.slice(0, maximum);
  }
  return [...new Set([...belowCourseAverage, ...weakestFallback])].slice(0, maximum);
}
