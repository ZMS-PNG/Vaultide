import { describe, expect, it } from 'vitest';
import {
  createLearningProjectBrief,
  isLearningProjectBrief,
  learningProjectPromptContext,
  updateLearningProjectBrief,
} from '@/lib/learning/domain/learning-project-plan';

describe('learning project plan', () => {
  it('changes observable success criteria with the intended outcome', () => {
    const initial = createLearningProjectBrief('lp_test', '2026-07-24T00:00:00.000Z');
    const updated = updateLearningProjectBrief(
      initial,
      {
        goal: '理解智能体记忆架构并完成一个可验证实验',
        sourceMode: 'hybrid',
        outcome: 'build',
        priorKnowledge: 'basic',
      },
      '2026-07-24T01:00:00.000Z',
    );

    expect(updated.successCriteria).toContain('能够产出一个可运行或可验证的成果');
    expect(updated.sourceMode).toBe('hybrid');
    expect(isLearningProjectBrief(updated)).toBe(true);
  });

  it('renders a pedagogy contract for generation without changing the learner goal', () => {
    const project = updateLearningProjectBrief(
      createLearningProjectBrief('lp_test', '2026-07-24T00:00:00.000Z'),
      {
        goal: '比较三种方案',
        outcome: 'compare',
        knownContext: '知道术语，但不清楚适用边界。',
      },
    );
    const prompt = learningProjectPromptContext(project);

    expect(prompt).toContain('Learning Project Contract');
    expect(prompt).toContain('ask for active recall');
    expect(prompt).toContain('适用边界');
    expect(project.goal).toBe('比较三种方案');
  });

  it('prevents an unavailable supplement from being presented as externally verified', () => {
    const project = updateLearningProjectBrief(createLearningProjectBrief('lp_test'), {
      sourceMode: 'hybrid',
      goal: '理解私有项目',
    });
    const prompt = learningProjectPromptContext(project, {
      mode: 'supplemental',
      status: 'unavailable',
      warning: 'External provider unavailable.',
    });

    expect(prompt).toContain('External evidence boundary: unavailable');
    expect(prompt).toContain('External provider unavailable.');
    expect(prompt).toContain('Never describe internal-only evidence as current');
  });
});
