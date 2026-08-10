import { describe, expect, it } from 'vitest';

import { applyCourseStepRepairContract } from '@/lib/generation/orchestration/quality-repair-contract';
import type { CourseGenerationStepRecord } from '@/lib/generation/orchestration/types';
import type { SceneOutline } from '@/lib/types/generation';

describe('targeted durable quality convergence', () => {
  it('turns interactive metrics into a complete retry contract', () => {
    const outline = {
      id: 'scene-3',
      order: 3,
      type: 'interactive',
      title: 'Data-flow simulator',
      description: 'Trace state and evidence through the system.',
      keyPoints: ['Inputs', 'State transition', 'Observable result'],
      widgetType: 'simulation',
      widgetOutline: { concept: 'State transition' },
    } satisfies SceneOutline;
    const step = stepRecord({
      id: 'cgs_interactive',
      sceneOrder: 3,
      phase: 'content',
      issues: [
        {
          code: 'scene_interactive_feedback',
          message: 'feedback missing',
          retryInstruction: 'Add visible feedback and reset.',
          severity: 'error',
          sceneOrder: 3,
        },
      ],
      metrics: {
        visibleTextChars: 110,
        controlCount: 2,
        eventCount: 1,
        hasFeedback: false,
        hasReset: false,
      },
    });

    const repaired = applyCourseStepRepairContract(outline, step, 'English');

    expect(repaired.description).toBe(outline.description);
    expect(repaired.generationRepairDirective).toContain('visibleTextChars=110');
    expect(repaired.generationRepairDirective).toContain('hasFeedback=false');
    expect(repaired.generationRepairDirective).toContain('at least 240 learner-visible teaching characters');
    expect(repaired.generationRepairDirective).toContain('working reset or replay path');
  });

  it('turns action metrics into a measurable sequence repair contract', () => {
    const outline = {
      id: 'scene-6',
      order: 6,
      type: 'pbl',
      title: 'Acceptance decision',
      description: 'Produce a reviewable implementation decision.',
      keyPoints: ['Evidence', 'Risk', 'Acceptance'],
    } satisfies SceneOutline;
    const step = stepRecord({
      id: 'cgs_actions',
      sceneOrder: 6,
      phase: 'actions',
      issues: [
        {
          code: 'scene_actions_sparse',
          message: 'too few actions',
          retryInstruction: 'Add orientation, explanation, and learner verification.',
          severity: 'error',
          sceneOrder: 6,
        },
        {
          code: 'scene_pbl_learning_contract',
          message: 'acceptance evidence missing',
          retryInstruction: 'Add acceptance evidence.',
          severity: 'error',
          sceneOrder: 6,
        },
      ],
      metrics: {
        actionCount: 2,
        actionTypeCount: 1,
        speechCount: 1,
        speechChars: 48,
        hasLearnerCue: false,
        taskSignalCount: 2,
      },
    });

    const repaired = applyCourseStepRepairContract(outline, step, 'English');

    expect(repaired.description).toBe(outline.description);
    expect(repaired.generationRepairDirective).toContain('actionCount=2');
    expect(repaired.generationRepairDirective).toContain('speechChars=48');
    expect(repaired.generationRepairDirective).toContain('at least 5 classroom actions');
    expect(repaired.generationRepairDirective).toContain('produce assessable evidence');
  });
});

function stepRecord({
  id,
  sceneOrder,
  phase,
  issues,
  metrics,
}: {
  id: string;
  sceneOrder: number;
  phase: 'content' | 'actions';
  issues: NonNullable<CourseGenerationStepRecord['quality']>['issues'];
  metrics: NonNullable<CourseGenerationStepRecord['quality']>['metrics'];
}): CourseGenerationStepRecord {
  return {
    id,
    ownerId: 'owner',
    jobId: 'job',
    sceneOrder,
    phase,
    status: 'leased',
    attemptCount: 2,
    maxAttempts: 5,
    inputHash: 'e'.repeat(64),
    lastErrorDetail: 'The persisted quality gate rejected this step.',
    quality: {
      passed: false,
      score: 70,
      issues,
      metrics,
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}
