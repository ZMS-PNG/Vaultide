import { describe, expect, it } from 'vitest';
import { evaluateClassroomSnapshot, parseCourseQualityCli } from '@/eval/course-quality/runner';
import { ACCEPTED_COURSE_BENCHMARKS } from '@/eval/course-quality/benchmark-contract';
import { CORE_COURSE_QUALITY_DIMENSIONS } from '@/lib/generation/course-quality';
import {
  makeHighQualityOutlines,
  makeHighQualityScenes,
} from '../../generation/course-quality-fixtures';

describe('course quality machine evaluator', () => {
  it('parses one candidate and all four named accepted benchmarks', () => {
    const input = parseCourseQualityCli([
      '--scenario',
      'external-github',
      '--candidate',
      'candidate.json',
      ...ACCEPTED_COURSE_BENCHMARKS.flatMap((entry) => [
        '--baseline',
        `${entry.id}=${entry.id}.json`,
      ]),
      '--output',
      'result.json',
    ]);

    expect(input.scenario).toBe('external-github');
    expect(input.baselines).toHaveLength(4);
    expect(input.baselines.map((entry) => entry.id)).toEqual(
      ACCEPTED_COURSE_BENCHMARKS.map((entry) => entry.id),
    );
    expect(input.output).toBe('result.json');
  });

  it('emits a complete machine-auditable dimension record for a valid classroom', () => {
    const outlines = makeHighQualityOutlines();
    const evaluation = evaluateClassroomSnapshot(
      {
        stage: {
          id: 'stage',
          name: 'Quality fixture',
          createdAt: 1,
          updatedAt: 1,
        },
        scenes: makeHighQualityScenes(outlines),
        generation: { outlines },
      },
      { id: 'candidate', label: 'Candidate' },
    );

    expect(evaluation.passed, JSON.stringify(evaluation, null, 2)).toBe(true);
    expect(Object.keys(evaluation.dimensions)).toEqual([...CORE_COURSE_QUALITY_DIMENSIONS]);
    expect(evaluation.metrics.averageSceneScore).toBeGreaterThanOrEqual(93);
    expect(evaluation.dimensions.grounding).toBe(100);
    expect(evaluation.dimensions.accuracy).toBe(100);
  });
});
