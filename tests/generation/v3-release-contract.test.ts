import { describe, expect, it } from 'vitest';

import { assessV3OutlineQuality } from '@/lib/generation/course-quality';
import {
  describeCompletedCourseSnapshotViolation,
  describeV3OutlineReleaseViolation,
} from '@/lib/generation/outline-release-contract';
import { buildV3PlanRun } from '@/lib/generation/planning/v3-plan-run';
import { createLearningContract } from '@/lib/learning/domain/v3/learning-contract';

function outlines() {
  return buildV3PlanRun({
    requirements: {
      requirement:
        'Learn a source-grounded durable workflow and make a verifiable transfer decision.',
      learningContract: createLearningContract({
        projectId: 'project-v3',
        sourceMode: 'obsidian',
        objectType: 'knowledge-project',
        goal: 'Learn a source-grounded durable workflow and make a verifiable transfer decision.',
        targetMinutes: 25,
      }),
    },
    sourceContext: [
      '# Lease',
      'A worker claims one durable step before it writes the accepted result.',
      '',
      '# Release',
      'The release verifies every scene and its evidence before publishing the classroom.',
    ].join('\n'),
  }).outlines;
}

describe('V3 outline release contract', () => {
  it('uses the same 9–12 activity envelope as the durable classroom job ledger', () => {
    const planned = outlines();
    expect(planned.length).toBeGreaterThanOrEqual(9);
    expect(planned.length).toBeLessThanOrEqual(12);
    expect(describeV3OutlineReleaseViolation(planned)).toBeNull();
    expect(assessV3OutlineQuality(planned).passed).toBe(true);
  });

  it('uses the V3 completion contract when all outlines carry V3 activities', () => {
    const planned = outlines();
    expect(
      describeCompletedCourseSnapshotViolation({
        outlines: planned,
        sceneOrders: planned.map((outline) => outline.order),
      }),
    ).toBeNull();
  });

  it('rejects raw Markdown source links from learner-facing scene titles', () => {
    const planned = outlines();
    const contaminated = planned.map((outline, index) =>
      index === 0
        ? { ...outline, title: 'Learning map: [raw source](https://example.com/source)' }
        : outline,
    );

    expect(describeV3OutlineReleaseViolation(contaminated)).toContain('exposes raw source markup');
  });

  it('allows a V3 plan when no frozen evidence labels exist (thin or empty source)', () => {
    const planned = outlines().map((outline) =>
      outline.activity
        ? { ...outline, activity: { ...outline.activity, evidenceLabels: [] } }
        : outline,
    );

    expect(describeV3OutlineReleaseViolation(planned)).toBeNull();
    expect(assessV3OutlineQuality(planned).passed).toBe(true);
  });

  it('still requires evidence labels when at least one activity is grounded', () => {
    const planned = outlines().map((outline, index) =>
      index === 1 && outline.activity
        ? { ...outline, activity: { ...outline.activity, evidenceLabels: [] } }
        : outline,
    );

    expect(describeV3OutlineReleaseViolation(planned)).toContain('missing frozen evidence labels');
  });
});
