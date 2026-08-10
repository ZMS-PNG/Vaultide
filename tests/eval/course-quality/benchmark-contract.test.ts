import { describe, expect, it } from 'vitest';
import {
  ACCEPTED_COURSE_BENCHMARKS,
  COURSE_QUALITY_EVAL_SCHEMA_VERSION,
  compareCandidateToAcceptedBenchmarks,
  type MachineCourseEvaluation,
} from '@/eval/course-quality/benchmark-contract';
import { CORE_COURSE_QUALITY_DIMENSIONS } from '@/lib/generation/course-quality';

function evaluation(
  id: string,
  score: number,
  dimensionScore = score,
  overrides: Partial<MachineCourseEvaluation['dimensions']> = {},
): MachineCourseEvaluation {
  return {
    id,
    label: id,
    passed: true,
    score,
    dimensions: {
      structure: dimensionScore,
      instructionalDepth: dimensionScore,
      pedagogy: dimensionScore,
      grounding: dimensionScore,
      accuracy: dimensionScore,
      distinctiveness: dimensionScore,
      transfer: dimensionScore,
      ...overrides,
    },
    issues: [],
    metrics: {},
  };
}

function acceptedBaselines(score = 90): MachineCourseEvaluation[] {
  return ACCEPTED_COURSE_BENCHMARKS.map((entry) => evaluation(entry.id, score, score));
}

describe('accepted course benchmark contract', () => {
  it('passes exactly at baseline average plus five with no dimension regression', () => {
    const result = compareCandidateToAcceptedBenchmarks(
      evaluation('candidate', 95, 95),
      acceptedBaselines(90),
    );

    expect(result.passed, JSON.stringify(result, null, 2)).toBe(true);
    expect(result.schemaVersion).toBe(COURSE_QUALITY_EVAL_SCHEMA_VERSION);
    expect(result.scoreDelta).toBe(5);
    expect(result.requiredCandidateScore).toBe(95);
    expect(Object.keys(result.dimensions)).toEqual([...CORE_COURSE_QUALITY_DIMENSIONS]);
  });

  it('blocks a candidate that improves by only 4.9 points', () => {
    const candidate = evaluation('candidate', 94.9, 95);
    const result = compareCandidateToAcceptedBenchmarks(candidate, acceptedBaselines(90));

    expect(result.passed).toBe(false);
    expect(result.scoreGatePassed).toBe(false);
  });

  it('blocks any core-dimension regression even when total score improves by five', () => {
    const baselines = acceptedBaselines(90).map((entry) => ({
      ...entry,
      dimensions: { ...entry.dimensions, structure: 96 },
    }));
    const candidate = evaluation('candidate', 95, 95);
    const result = compareCandidateToAcceptedBenchmarks(candidate, baselines);

    expect(result.passed).toBe(false);
    expect(result.dimensions.structure.passed).toBe(false);
    expect(result.dimensions.structure.delta).toBe(-1);
  });

  it('blocks grounding or accuracy below the normalized 95 floor', () => {
    const candidate = evaluation('candidate', 95, 95, { grounding: 94.9 });
    const result = compareCandidateToAcceptedBenchmarks(candidate, acceptedBaselines(90));

    expect(result.passed).toBe(false);
    expect(result.groundingAccuracyGatePassed).toBe(false);
  });

  it('rejects an incomplete or incorrectly named benchmark set', () => {
    const result = compareCandidateToAcceptedBenchmarks(
      evaluation('candidate', 100, 100),
      acceptedBaselines(90).slice(0, 3),
    );

    expect(result.passed).toBe(false);
    expect(result.benchmarkSetValid).toBe(false);
    expect(result.reasons[0]).toContain('Exactly 4 named accepted benchmarks');
  });
});
