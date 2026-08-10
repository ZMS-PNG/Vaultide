import {
  CORE_COURSE_QUALITY_DIMENSIONS,
  type CourseQualityDimension,
} from '@/lib/generation/course-quality';

export const COURSE_QUALITY_EVAL_SCHEMA_VERSION = 'vaultide.course-quality-eval.v2';
export const REQUIRED_ACCEPTED_BENCHMARK_COUNT = 4;
export const REQUIRED_BENCHMARK_SCORE_DELTA = 5;

export const ACCEPTED_COURSE_BENCHMARKS = [
  {
    id: 'codex-architecture-task-flow',
    label: 'Codex 架构与任务流程',
  },
  {
    id: 'grok-build-quickstart',
    label: 'Grok Build 快速上手',
  },
  {
    id: 'grok-build-introduction',
    label: 'Grok Build快速入门',
  },
  {
    id: 'code-agent-verification-paper',
    label: '代码代理自动验证论文精读',
  },
] as const;

export interface MachineCourseEvaluation {
  id: string;
  label: string;
  source?: string;
  passed: boolean;
  score: number;
  dimensions: Record<CourseQualityDimension, number>;
  issues: string[];
  metrics: Record<string, number | string | boolean>;
}

export interface BenchmarkDimensionComparison {
  candidate: number;
  baselineAverage: number;
  delta: number;
  passed: boolean;
}

export interface BenchmarkAcceptanceResult {
  schemaVersion: typeof COURSE_QUALITY_EVAL_SCHEMA_VERSION;
  passed: boolean;
  requiredBenchmarkCount: number;
  requiredScoreDelta: number;
  candidateScore: number;
  baselineAverageScore: number;
  scoreDelta: number;
  requiredCandidateScore: number;
  scoreGatePassed: boolean;
  candidateContractPassed: boolean;
  benchmarkSetValid: boolean;
  groundingAccuracyGatePassed: boolean;
  dimensions: Record<CourseQualityDimension, BenchmarkDimensionComparison>;
  reasons: string[];
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function mean(values: readonly number[]): number {
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function validBenchmarkIdentitySet(baselines: readonly MachineCourseEvaluation[]): boolean {
  if (baselines.length !== REQUIRED_ACCEPTED_BENCHMARK_COUNT) return false;
  const expected = new Set(ACCEPTED_COURSE_BENCHMARKS.map((entry) => entry.id));
  const actual = new Set(baselines.map((entry) => entry.id));
  return actual.size === expected.size && [...expected].every((id) => actual.has(id));
}

/**
 * Compares one strict-contract candidate with the average of the four accepted
 * reference courses. The candidate must improve the aggregate by five points
 * and may not regress on any core dimension.
 */
export function compareCandidateToAcceptedBenchmarks(
  candidate: MachineCourseEvaluation,
  baselines: readonly MachineCourseEvaluation[],
): BenchmarkAcceptanceResult {
  const benchmarkSetValid = validBenchmarkIdentitySet(baselines);
  const baselineAverageScore = mean(baselines.map((entry) => entry.score));
  const requiredCandidateScore = baselineAverageScore + REQUIRED_BENCHMARK_SCORE_DELTA;
  const scoreDelta = candidate.score - baselineAverageScore;
  const scoreGatePassed =
    benchmarkSetValid && scoreDelta + Number.EPSILON >= REQUIRED_BENCHMARK_SCORE_DELTA;
  const dimensionComparisons = {} as Record<CourseQualityDimension, BenchmarkDimensionComparison>;

  for (const dimension of CORE_COURSE_QUALITY_DIMENSIONS) {
    const baselineAverage = mean(baselines.map((entry) => entry.dimensions[dimension]));
    const candidateScore = candidate.dimensions[dimension];
    const delta = candidateScore - baselineAverage;
    dimensionComparisons[dimension] = {
      candidate: round(candidateScore),
      baselineAverage: round(baselineAverage),
      delta: round(delta),
      passed: benchmarkSetValid && delta + Number.EPSILON >= 0,
    };
  }

  const candidateContractPassed = candidate.passed;
  const groundingAccuracyGatePassed =
    candidate.dimensions.grounding >= 95 && candidate.dimensions.accuracy >= 95;
  const dimensionsPassed = Object.values(dimensionComparisons).every((entry) => entry.passed);
  const reasons: string[] = [];

  if (!benchmarkSetValid) {
    reasons.push(
      `Exactly ${REQUIRED_ACCEPTED_BENCHMARK_COUNT} named accepted benchmarks are required: ${ACCEPTED_COURSE_BENCHMARKS.map(
        (entry) => entry.id,
      ).join(', ')}.`,
    );
  }
  if (!candidateContractPassed) {
    reasons.push('The candidate fails the absolute course-quality release contract.');
  }
  if (!scoreGatePassed) {
    reasons.push(
      `Candidate score ${round(candidate.score)} must be at least five points above the accepted-benchmark average ${round(
        baselineAverageScore,
      )}.`,
    );
  }
  if (!dimensionsPassed) {
    const regressions = Object.entries(dimensionComparisons)
      .filter(([, comparison]) => !comparison.passed)
      .map(([dimension, comparison]) => `${dimension} (${comparison.delta})`);
    reasons.push(`Core quality dimensions regressed: ${regressions.join(', ')}.`);
  }
  if (!groundingAccuracyGatePassed) {
    reasons.push('Normalized grounding and accuracy must both be at least 95.');
  }

  return {
    schemaVersion: COURSE_QUALITY_EVAL_SCHEMA_VERSION,
    passed:
      benchmarkSetValid &&
      candidateContractPassed &&
      scoreGatePassed &&
      dimensionsPassed &&
      groundingAccuracyGatePassed,
    requiredBenchmarkCount: REQUIRED_ACCEPTED_BENCHMARK_COUNT,
    requiredScoreDelta: REQUIRED_BENCHMARK_SCORE_DELTA,
    candidateScore: round(candidate.score),
    baselineAverageScore: round(baselineAverageScore),
    scoreDelta: round(scoreDelta),
    requiredCandidateScore: round(requiredCandidateScore),
    scoreGatePassed,
    candidateContractPassed,
    benchmarkSetValid,
    groundingAccuracyGatePassed,
    dimensions: dimensionComparisons,
    reasons,
  };
}
