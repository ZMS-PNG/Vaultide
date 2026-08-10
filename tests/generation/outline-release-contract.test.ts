import { describe, expect, test } from 'vitest';
import {
  describeCompletedCourseSnapshotViolation,
  describeOutlineReleaseViolation,
} from '@/lib/generation/outline-release-contract';
import type { SceneOutline } from '@/lib/types/generation';

function outlines(count: number): SceneOutline[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `scene-${index + 1}`,
    type: index === count - 2 ? 'quiz' : 'slide',
    title: `Distinct instructional scene ${index + 1}`,
    description: `Teach the distinct mechanism, evidence, and learner decision assigned to scene ${
      index + 1
    }.`,
    keyPoints: [
      `Mechanism boundary ${index + 1}`,
      `Evidence condition ${index + 1}`,
      `Learner decision ${index + 1}`,
    ],
    order: index + 1,
  }));
}

describe('outline release contract', () => {
  test.each([1, 2, 8, 13])('rejects a %i-scene classroom', (count) => {
    expect(describeOutlineReleaseViolation(outlines(count))).toContain('requires 9-12 outlines');
  });

  test.each([9, 12])('accepts a complete %i-scene classroom', (count) => {
    expect(describeOutlineReleaseViolation(outlines(count))).toBeNull();
    expect(
      describeCompletedCourseSnapshotViolation({
        outlines: outlines(count),
        sceneOrders: Array.from({ length: count }, (_, index) => index + 1),
      }),
    ).toBeNull();
  });

  test('rejects completion when a durable scene is missing', () => {
    expect(
      describeCompletedCourseSnapshotViolation({
        outlines: outlines(9),
        sceneOrders: [1, 2, 3],
      }),
    ).toContain('exactly one durable scene per outline');
  });

  test('rejects duplicate and unexpected durable scene orders', () => {
    expect(
      describeCompletedCourseSnapshotViolation({
        outlines: outlines(9),
        sceneOrders: [1, 2, 3, 4, 5, 6, 7, 8, 8],
      }),
    ).toContain('duplicate scene orders');
    expect(
      describeCompletedCourseSnapshotViolation({
        outlines: outlines(9),
        sceneOrders: [1, 2, 3, 4, 5, 6, 7, 8, 10],
      }),
    ).toContain('unexpected orders: 10');
  });

  test('task-engine mode cannot escape the 9-12 release contract', () => {
    expect(describeOutlineReleaseViolation(outlines(1), true)).toContain('requires 9-12 outlines');
  });
});
