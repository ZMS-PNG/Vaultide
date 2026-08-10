import { describe, expect, it } from 'vitest';
import { describeGenerationFailure } from '@/app/generation-preview/error-guidance';

describe('generation failure guidance', () => {
  it('turns outline quality failures into resumable quality guidance', () => {
    const guidance = describeGenerationFailure(
      'outline_quality_rejected: The final scene does not require synthesis and transfer.',
    );

    expect(guidance).toMatchObject({ kind: 'quality', canResume: true });
    expect(guidance.recovery).toContain('已保存进度');
  });

  it('does not tell a learner to retry when reviewed source material was lost', () => {
    const guidance = describeGenerationFailure(
      'SOURCE_CONTEXT_LOST: reviewed source material was incomplete',
    );

    expect(guidance).toMatchObject({ kind: 'source', canResume: false });
    expect(guidance.recovery).toContain('来源审查');
  });

  it('explains network recovery without exposing raw transport text', () => {
    const guidance = describeGenerationFailure('Failed to fetch');

    expect(guidance).toMatchObject({ kind: 'network', canResume: true });
    expect(guidance.summary).toContain('服务器');
  });
});
