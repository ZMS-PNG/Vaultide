import { describe, expect, it } from 'vitest';
import {
  deriveHomeLearningPhase,
  learningSessionStage,
} from '@/lib/learning/domain/learning-session';

describe('learning session state machine', () => {
  it('keeps a new session at the goal stage until a goal exists', () => {
    const phase = deriveHomeLearningPhase({
      hasGoal: false,
      classroomCount: 3,
    });

    expect(phase).toBe('goal-empty');
    expect(learningSessionStage(phase)).toBe('goal');
  });

  it('moves a ready goal toward the classroom', () => {
    const phase = deriveHomeLearningPhase({
      hasGoal: true,
      classroomCount: 0,
    });

    expect(phase).toBe('goal-ready');
    expect(learningSessionStage(phase)).toBe('classroom');
  });

  it('prioritizes pending Obsidian writeback over review work', () => {
    const phase = deriveHomeLearningPhase({
      hasGoal: true,
      classroomCount: 2,
      dueReviewCount: 4,
      pendingWritebackCount: 1,
    });

    expect(phase).toBe('writeback-pending');
    expect(learningSessionStage(phase)).toBe('writeback');
  });
});
