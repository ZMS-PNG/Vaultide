import { describe, expect, it } from 'vitest';
import { buildTodayLearningQueue } from '@/lib/learning/domain/today-learning-queue';

describe('today learning queue', () => {
  it('prioritizes due reviews, then weak concepts, then recent classrooms', () => {
    const queue = buildTodayLearningQueue({
      reviews: [
        {
          id: 'review-1',
          classroomId: 'classroom-1',
          conceptId: 'concept:主动回忆',
          goal: '学习记忆方法',
          masteryEstimate: 0.45,
          masteryEvidenceCount: 3,
          dueAt: '2026-07-25T00:00:00.000Z',
          isDue: true,
        },
      ],
      mastery: [
        {
          sprintId: 'sprint-1',
          conceptId: 'concept:间隔复习',
          estimate: 0.55,
          confidence: 0.7,
          evidenceCount: 4,
          computedAt: '2026-07-25T01:00:00.000Z',
        },
      ],
      classrooms: [
        {
          id: 'classroom-2',
          name: '学习科学',
          updatedAt: Date.parse('2026-07-25T02:00:00.000Z'),
        },
      ],
    });

    expect(queue.items.map((item) => item.kind)).toEqual(['review', 'weak', 'continue']);
    expect(queue.items[0]?.href).toBe('/classroom/classroom-1?reviewItemId=review-1#rumination');
    expect(queue.summary).toEqual({
      dueReviews: 1,
      weakConcepts: 1,
      transferNeeded: 0,
      recentClassrooms: 1,
    });
  });

  it('does not duplicate a weak concept that is already in the due review queue', () => {
    const queue = buildTodayLearningQueue({
      reviews: [
        {
          id: 'review-1',
          classroomId: 'classroom-1',
          conceptId: 'concept:证据',
          goal: '项目学习',
          masteryEstimate: 0.4,
          masteryEvidenceCount: 2,
          dueAt: '2026-07-25T00:00:00.000Z',
          isDue: true,
        },
      ],
      mastery: [
        {
          sprintId: 'sprint-1',
          conceptId: 'concept:证据',
          estimate: 0.4,
          confidence: 0.8,
          evidenceCount: 2,
          computedAt: '2026-07-25T01:00:00.000Z',
        },
      ],
      classrooms: [],
    });

    expect(queue.items).toHaveLength(1);
    expect(queue.summary.weakConcepts).toBe(0);
  });

  it('groups due concepts from the same classroom into one actionable task', () => {
    const base = {
      classroomId: 'classroom-1',
      goal: '阅读并讲解《Harnessing Code Agents for Automatic Software Verification》。',
      masteryEstimate: 0.43,
      masteryEvidenceCount: 1,
      dueAt: '2026-07-25T00:00:00.000Z',
      isDue: true,
    };
    const queue = buildTodayLearningQueue({
      reviews: [
        { ...base, id: 'review-1', conceptId: 'z3La4E0Qqt2zguNxnFmZi' },
        { ...base, id: 'review-2', conceptId: 'classroom' },
      ],
      mastery: [],
      classrooms: [],
    });

    expect(queue.items).toHaveLength(1);
    expect(queue.items[0]?.title).toBe(
      '复习：Harnessing Code Agents for Automatic Software Verification',
    );
    expect(queue.items[0]?.description).toContain('2 个到期知识点');
    expect(queue.items[0]?.href).toBe('/classroom/classroom-1?reviewItemId=review-1#rumination');
    expect(queue.summary.dueReviews).toBe(2);
  });

  it('adds one transfer task when learned knowledge has no transfer evidence', () => {
    const queue = buildTodayLearningQueue({
      reviews: [],
      mastery: [
        {
          sprintId: 'sprint-1',
          conceptId: 'concept:证据链',
          estimate: 0.78,
          confidence: 0.52,
          evidenceCount: 5,
          evidenceTypes: ['retrievalAttempted', 'practiceCompleted'],
          classroomId: 'classroom-1',
          goal: '学习自动化软件验证',
          projectName: '软件验证论文',
          computedAt: '2026-07-25T01:00:00.000Z',
        },
      ],
      classrooms: [],
    });

    expect(queue.items).toHaveLength(1);
    expect(queue.items[0]).toMatchObject({
      kind: 'transfer',
      title: '迁移检验：证据链',
      href: '/classroom/classroom-1',
    });
    expect(queue.summary.transferNeeded).toBe(1);
  });
});
