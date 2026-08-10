import { describe, expect, it } from 'vitest';
import { assessGeneratedSceneContent } from '@/lib/generation/course-quality';
import { stabilizeGeneratedQuizAssessment } from '@/lib/generation/quiz-assessment-repair';
import type { SceneOutline } from '@/lib/types/generation';
import type { QuizQuestion } from '@/lib/types/stage';

const outline: SceneOutline = {
  id: 'scene-5',
  order: 5,
  type: 'quiz',
  title: '状态迁移判断练习',
  description: '用判断练习验证状态机约束、家长可见映射和异常状态回退。',
  keyPoints: ['状态机约束', '家长可见映射', '异常状态回退'],
};

function single(id: string, question: string): QuizQuestion {
  return {
    id,
    type: 'single',
    question,
    options: [
      { value: 'A', label: '方案 A' },
      { value: 'B', label: '方案 B' },
      { value: 'C', label: '方案 C' },
    ],
    answer: ['B'],
    hasAnswer: true,
    analysis:
      '方案 B 正确，因为它同时检查状态机约束和家长可见映射；其他方案忽略异常状态回退或验证证据。',
    points: 10,
  };
}

describe('quiz assessment stabilization', () => {
  it('repairs variety and transfer together instead of oscillating', () => {
    const generated = [
      single('q1', '状态机约束要求检查什么？'),
      single('q2', '家长可见映射应该如何判断？'),
      single('q3', '异常状态回退应该在何时触发？'),
    ];

    const repaired = stabilizeGeneratedQuizAssessment(outline, generated, '中文');
    const result = assessGeneratedSceneContent(outline, { questions: repaired });

    expect(new Set(repaired.map((question) => question.type)).size).toBeGreaterThanOrEqual(2);
    expect(repaired.at(-1)?.type).toBe('short_answer');
    expect(repaired.at(-1)?.question).toContain('新项目迁移');
    expect(repaired.at(-1)?.commentPrompt).toContain('评分规则');
    expect(result.issues.map((entry) => entry.code)).not.toContain('scene_quiz_variety');
    expect(result.issues.map((entry) => entry.code)).not.toContain('scene_quiz_transfer_missing');
  });

  it('adds an objective format when the model returns only short answers', () => {
    const generated: QuizQuestion[] = [1, 2, 3].map((index) => ({
      id: `q${index}`,
      type: 'short_answer',
      question: `解释状态机约束 ${index}`,
      analysis: '根据课程机制比较状态、条件和可观察结果，并说明为什么其他处理方式不成立。',
      commentPrompt: '按机制、证据和解释评分。',
      hasAnswer: false,
      points: 20,
    }));

    const repaired = stabilizeGeneratedQuizAssessment(outline, generated, '中文');

    expect(repaired[0].type).toBe('single');
    expect(repaired.at(-1)?.type).toBe('short_answer');
    expect(new Set(repaired.map((question) => question.type)).size).toBe(2);
  });
});
