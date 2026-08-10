import { describe, expect, it } from 'vitest';
import { applyCourseStepRepairContract } from '@/lib/generation/orchestration/quality-repair-contract';
import type { CourseGenerationStepRecord } from '@/lib/generation/orchestration/types';
import type { SceneOutline } from '@/lib/types/generation';

describe('durable quality repair contract', () => {
  it('turns persisted slide metrics into a measurable Chinese repair contract', () => {
    const outline: SceneOutline = {
      id: 'scene-4',
      order: 4,
      type: 'slide',
      title: '预约状态机与家长可见映射',
      description: '解释预约状态如何映射到家长可见状态。',
      keyPoints: ['状态机约束', '家长可见映射', '异常回退'],
    };
    const step = {
      id: 'cgs_test',
      ownerId: 'owner',
      jobId: 'job',
      sceneOrder: 4,
      phase: 'content',
      status: 'leased',
      attemptCount: 6,
      maxAttempts: 8,
      inputHash: 'a'.repeat(64),
      lastErrorDetail: 'Regenerate the slide with enough visible explanation.',
      quality: {
        passed: false,
        score: 94.1,
        issues: [
          {
            code: 'scene_slide_depth',
            message: 'too shallow',
            retryInstruction: 'Add visible mechanism, evidence, and a learner decision.',
            severity: 'error',
            sceneOrder: 4,
          },
        ],
        metrics: {
          elementCount: 8,
          textChars: 181,
          substantiveTextElements: 2,
          semanticTokenCount: 31,
        },
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    } satisfies CourseGenerationStepRecord;

    const repaired = applyCourseStepRepairContract(outline, step, '中文');

    expect(repaired.description).toBe(outline.description);
    expect(repaired.generationRepairDirective).toContain('textChars=181');
    expect(repaired.generationRepairDirective).toContain('五区结构');
    expect(repaired.generationRepairDirective).toContain('260–420');
    expect(repaired.generationRepairDirective).toContain('学习者');
    expect(repaired.generationRepairDirective).toContain('[scene_slide_depth]');
  });

  it('does not change an outline before a persisted rejection exists', () => {
    const outline = {
      id: 'scene-1',
      order: 1,
      type: 'slide',
      title: 'Overview',
      description: 'Original description.',
      keyPoints: ['Context', 'Mechanism', 'Decision'],
    } satisfies SceneOutline;
    const step = {
      id: 'cgs_test',
      ownerId: 'owner',
      jobId: 'job',
      sceneOrder: 1,
      phase: 'content',
      status: 'leased',
      attemptCount: 1,
      maxAttempts: 5,
      inputHash: 'a'.repeat(64),
      createdAt: new Date(),
      updatedAt: new Date(),
    } satisfies CourseGenerationStepRecord;

    expect(applyCourseStepRepairContract(outline, step)).toBe(outline);
  });

  it('turns a whole-course final-transfer rejection into a concrete scene repair contract', () => {
    const outline = {
      id: 'scene-10',
      order: 10,
      type: 'slide',
      title: 'Final transfer',
      description: 'Apply the course to a new project.',
      keyPoints: ['Synthesis', 'Transfer', 'Evidence'],
    } satisfies SceneOutline;
    const step = {
      id: 'cgs_final',
      ownerId: 'owner',
      jobId: 'job',
      sceneOrder: 10,
      phase: 'content',
      status: 'leased',
      attemptCount: 4,
      maxAttempts: 8,
      inputHash: 'c'.repeat(64),
      lastErrorDetail: 'Regenerate the final scene with explicit transfer.',
      quality: {
        passed: false,
        score: 85.89,
        issues: [
          {
            code: 'course_final_transfer_not_delivered',
            message: 'final transfer was not delivered',
            retryInstruction:
              'Synthesize the course and transfer it to a new project with observable evidence.',
            severity: 'error',
            sceneOrder: 10,
          },
        ],
        metrics: {
          finalSceneHasTransfer: false,
          finalSceneHasSynthesis: false,
          finalSceneHasObservableResult: true,
        },
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    } satisfies CourseGenerationStepRecord;

    const repaired = applyCourseStepRepairContract(outline, step, 'English');

    expect(repaired.description).toBe(outline.description);
    expect(repaired.generationRepairDirective).toContain('2–3 core concepts');
    expect(repaired.generationRepairDirective).toContain('genuinely new project');
    expect(repaired.generationRepairDirective).toContain('observable artifact');
    expect(repaired.generationRepairDirective).toContain('measurable completion criteria');
    expect(repaired.generationRepairDirective).toContain('[course_final_transfer_not_delivered]');
  });

  it('keeps quiz variety and transfer requirements together across retries', () => {
    const outline = {
      id: 'scene-5',
      order: 5,
      type: 'quiz',
      title: '状态迁移判断练习',
      description: '检查学习者能否判断状态迁移。',
      keyPoints: ['状态约束', '异常迁移', '家长可见状态'],
    } satisfies SceneOutline;
    const step = {
      id: 'cgs_quiz',
      ownerId: 'owner',
      jobId: 'job',
      sceneOrder: 5,
      phase: 'content',
      status: 'leased',
      attemptCount: 4,
      maxAttempts: 5,
      inputHash: 'b'.repeat(64),
      lastErrorDetail: 'Add a transfer question.',
      quality: {
        passed: false,
        score: 69.3,
        issues: [
          {
            code: 'scene_quiz_transfer_missing',
            message: 'missing transfer',
            retryInstruction: 'Add a new-context transfer question.',
            severity: 'error',
            sceneOrder: 5,
          },
        ],
        metrics: {
          questionCount: 3,
          questionTypeCount: 3,
          hasTransferQuestion: false,
        },
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    } satisfies CourseGenerationStepRecord;

    const repaired = applyCourseStepRepairContract(outline, step, '中文');

    expect(repaired.description).toBe(outline.description);
    expect(repaired.generationRepairDirective).toContain('至少两种题型');
    expect(repaired.generationRepairDirective).toContain('新情境');
    expect(repaired.generationRepairDirective).toContain('不得牺牲题型多样性或迁移题');
  });
});
