import { describe, expect, it } from 'vitest';
import { inferLearningObjectType } from '@/lib/generation/planning/service';

function input(requirement: string) {
  return {
    clientSessionId: 'session-123',
    requirements: { requirement },
    sourceMode: 'external' as const,
    sourceReferences: [],
    documentText: '',
    researchText: '',
  };
}

describe('course planning object classification', () => {
  it('classifies a natural-language GitHub project request as a repository before search sources exist', () => {
    expect(inferLearningObjectType(input('学习 GitHub 项目 openai/openai-agents-python 的多智能体工作流。'))).toBe(
      'repository',
    );
  });

  it('keeps paper and patent classifications specific', () => {
    expect(inferLearningObjectType(input('精读 arXiv 最新论文并复现关键实验。'))).toBe('paper');
    expect(inferLearningObjectType(input('分析这项专利的权利要求与实施边界。'))).toBe('patent');
  });
});
