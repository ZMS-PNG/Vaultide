import { describe, expect, it } from 'vitest';

import { convergeCourseInputOutlines } from '@/lib/generation/orchestration/input-outline-convergence';
import { makeHighQualityOutlines } from './course-quality-fixtures';

describe('durable course input outline convergence', () => {
  it('repairs the final synthesis and transfer contract before job persistence', () => {
    const outlines = makeHighQualityOutlines();
    const finalIndex = outlines.length - 1;
    outlines[finalIndex] = {
      ...outlines[finalIndex],
      title: 'Course recap',
      description: 'Repeat the terminology and review the preceding lesson.',
      teachingObjective: undefined,
      keyPoints: [
        'Architecture terminology recap',
        'Mechanism terminology recap',
        'Previously listed limitation recap',
      ],
    };

    const result = convergeCourseInputOutlines(outlines);

    expect(result.changed).toBe(true);
    expect(result.repairedIssueCodes).toContain('outline_final_transfer_missing');
    expect(result.assessment.passed, JSON.stringify(result.assessment, null, 2)).toBe(true);
    expect(result.assessment.score).toBeGreaterThanOrEqual(90);
    expect(result.outlines.at(-1)?.description).toContain('new project, decision, or problem');
    expect(result.outlines.at(-1)?.description).toContain('acceptance criteria');
  });

  it('is idempotent after the canonical outline has passed', () => {
    const first = convergeCourseInputOutlines(makeHighQualityOutlines());
    const second = convergeCourseInputOutlines(first.outlines);

    expect(first.assessment.passed).toBe(true);
    expect(second.assessment.passed).toBe(true);
    expect(second.changed).toBe(false);
    expect(second.outlines).toEqual(first.outlines);
  });

  it('does not conceal an unrepairable incomplete course', () => {
    const result = convergeCourseInputOutlines(makeHighQualityOutlines().slice(0, 3));

    expect(result.assessment.passed).toBe(false);
    expect(result.assessment.issues.map((issue) => issue.code)).toContain('outline_count');
  });
});
