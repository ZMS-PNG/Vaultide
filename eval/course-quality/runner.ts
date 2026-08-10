import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import {
  CORE_COURSE_QUALITY_DIMENSIONS,
  COURSE_AVERAGE_QUALITY_RELEASE_FLOOR,
  assessCourseQuality,
  type CourseQualityDimension,
} from '@/lib/generation/course-quality';
import {
  GROUNDING_ACCURACY_RELEASE_FLOOR,
  assessOutlineEvidenceIntegrity,
  assessSceneEvidenceIntegrity,
  combineQualityAssessments,
} from '@/lib/generation/evidence-quality';
import type { SceneOutline } from '@/lib/types/generation';
import type { Scene, Stage } from '@/lib/types/stage';
import {
  ACCEPTED_COURSE_BENCHMARKS,
  COURSE_QUALITY_EVAL_SCHEMA_VERSION,
  compareCandidateToAcceptedBenchmarks,
  type MachineCourseEvaluation,
} from './benchmark-contract';

export interface ClassroomSnapshot {
  stage: Stage;
  scenes: Scene[];
  generation?: {
    outlines?: SceneOutline[];
    sourceContext?: string;
  };
  outline?: {
    outlines?: SceneOutline[];
  };
  sourceContext?: string;
}

interface BenchmarkSource {
  id: string;
  label: string;
  source: string;
}

interface CliInput {
  scenario: string;
  candidate: string;
  candidateLabel: string;
  baselines: BenchmarkSource[];
  output?: string;
}

export interface CourseQualityEvalReport {
  schemaVersion: typeof COURSE_QUALITY_EVAL_SCHEMA_VERSION;
  evaluatedAt: string;
  scenario: string;
  passed: boolean;
  contract: {
    sceneFloor: 90;
    courseAverageFloor: 93;
    groundingAccuracyFloor: 95;
    requiredBenchmarkDelta: 5;
    acceptedBenchmarks: typeof ACCEPTED_COURSE_BENCHMARKS;
  };
  candidate: MachineCourseEvaluation;
  acceptedBenchmarks: MachineCourseEvaluation[];
  comparison: ReturnType<typeof compareCandidateToAcceptedBenchmarks>;
}

function usage(): string {
  return [
    'Usage:',
    'pnpm --silent eval:course-quality -- --scenario <id> --candidate <snapshot>',
    ...ACCEPTED_COURSE_BENCHMARKS.map((entry) => `  --baseline ${entry.id}=<snapshot>`),
    '[--output <machine-result.json>]',
  ].join('\n');
}

function parseBaselineSpec(value: string): BenchmarkSource {
  const separator = value.indexOf('=');
  if (separator <= 0 || separator === value.length - 1) {
    throw new Error(`Invalid --baseline value "${value}". Expected <benchmark-id>=<source>.`);
  }
  const id = value.slice(0, separator);
  const source = value.slice(separator + 1);
  const accepted = ACCEPTED_COURSE_BENCHMARKS.find((entry) => entry.id === id);
  if (!accepted) {
    throw new Error(
      `Unknown benchmark "${id}". Expected one of: ${ACCEPTED_COURSE_BENCHMARKS.map(
        (entry) => entry.id,
      ).join(', ')}.`,
    );
  }
  return { id, label: accepted.label, source };
}

export function parseCourseQualityCli(argv: readonly string[]): CliInput {
  let scenario = 'unspecified';
  let candidate = '';
  let candidateLabel = 'upgrade candidate';
  let output: string | undefined;
  const baselines: BenchmarkSource[] = [];

  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    const value = argv[index + 1];
    if (!token.startsWith('--') || !value) {
      throw new Error(usage());
    }
    if (token === '--scenario') scenario = value;
    else if (token === '--candidate') candidate = value;
    else if (token === '--candidate-label') candidateLabel = value;
    else if (token === '--baseline') baselines.push(parseBaselineSpec(value));
    else if (token === '--output') output = value;
    else throw new Error(`Unknown argument "${token}".\n${usage()}`);
    index++;
  }

  if (!candidate) throw new Error(`Candidate snapshot is required.\n${usage()}`);
  return { scenario, candidate, candidateLabel, baselines, ...(output ? { output } : {}) };
}

async function loadJson(source: string): Promise<unknown> {
  if (/^https?:\/\//iu.test(source)) {
    const response = await fetch(source, {
      headers: process.env.ACCESS_CODE
        ? { 'x-openmaic-access-code': process.env.ACCESS_CODE }
        : undefined,
    });
    if (!response.ok) throw new Error(`Unable to fetch ${source}: HTTP ${response.status}`);
    return response.json();
  }
  return JSON.parse(await readFile(resolve(source), 'utf8'));
}

function unwrapSnapshot(value: unknown): ClassroomSnapshot {
  const root = value as {
    data?: { classroom?: ClassroomSnapshot };
    classroom?: ClassroomSnapshot;
    stage?: Stage;
    scenes?: Scene[];
    generation?: ClassroomSnapshot['generation'];
    outline?: ClassroomSnapshot['outline'];
    sourceContext?: string;
  };
  const snapshot = root.data?.classroom ?? root.classroom ?? root;
  if (!snapshot.stage || !Array.isArray(snapshot.scenes)) {
    throw new Error('Benchmark input does not contain a classroom stage and scenes array.');
  }
  return snapshot as ClassroomSnapshot;
}

function snapshotOutlines(snapshot: ClassroomSnapshot): SceneOutline[] | undefined {
  return snapshot.generation?.outlines ?? snapshot.outline?.outlines;
}

function snapshotSourceContext(snapshot: ClassroomSnapshot): string {
  const embedded = snapshot.generation?.sourceContext ?? snapshot.sourceContext;
  if (embedded?.trim()) return embedded;
  return (snapshot.stage.learningContext?.researchSources ?? [])
    .map(
      (source) =>
        `[${source.citationId}] ${source.title} ${source.url} ${
          'snippet' in source ? String(source.snippet ?? '') : ''
        }`,
    )
    .join('\n');
}

function round(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function mean(values: readonly number[]): number {
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function missingOutlineEvaluation(
  id: string,
  label: string,
  source?: string,
): MachineCourseEvaluation {
  return {
    id,
    label,
    ...(source ? { source } : {}),
    passed: false,
    score: 0,
    dimensions: Object.fromEntries(
      CORE_COURSE_QUALITY_DIMENSIONS.map((dimension) => [dimension, 0]),
    ) as Record<CourseQualityDimension, number>,
    issues: ['generation.outlines missing; the course cannot be audited reproducibly'],
    metrics: { sceneCount: 0, outlineCount: 0 },
  };
}

export function evaluateClassroomSnapshot(
  snapshot: ClassroomSnapshot,
  identity: { id: string; label: string; source?: string },
): MachineCourseEvaluation {
  const outlines = snapshotOutlines(snapshot);
  if (!outlines?.length) {
    return missingOutlineEvaluation(identity.id, identity.label, identity.source);
  }

  const sourceContext = snapshotSourceContext(snapshot);
  const course = assessCourseQuality(outlines, snapshot.scenes);
  const outlineEvidence = assessOutlineEvidenceIntegrity(sourceContext, outlines);
  const scenesByOrder = new Map(snapshot.scenes.map((scene) => [scene.order, scene]));
  const sceneEvidence = outlines.flatMap((outline) => {
    const scene = scenesByOrder.get(outline.order);
    if (!scene) return [];
    return [
      assessSceneEvidenceIntegrity(
        sourceContext,
        outline,
        scene.content as unknown as Record<string, unknown>,
      ),
    ];
  });
  const combined = combineQualityAssessments(course, outlineEvidence, ...sceneEvidence);
  const dimensions = {} as Record<CourseQualityDimension, number>;
  for (const dimension of CORE_COURSE_QUALITY_DIMENSIONS) {
    dimensions[dimension] = round(combined.dimensions?.[dimension] ?? 0, 2);
  }
  const score = round(mean(CORE_COURSE_QUALITY_DIMENSIONS.map((key) => dimensions[key])), 2);
  const averageSceneScore = Number(course.metrics.averageSceneScore ?? 0);
  const groundingAccuracyPassed =
    dimensions.grounding >= GROUNDING_ACCURACY_RELEASE_FLOOR &&
    dimensions.accuracy >= GROUNDING_ACCURACY_RELEASE_FLOOR;
  const passed =
    combined.passed &&
    averageSceneScore >= COURSE_AVERAGE_QUALITY_RELEASE_FLOOR &&
    groundingAccuracyPassed;

  return {
    id: identity.id,
    label: identity.label,
    ...(identity.source ? { source: identity.source } : {}),
    passed,
    score,
    dimensions,
    issues: [...new Set(combined.issues.map((entry) => `${entry.code}: ${entry.message}`))],
    metrics: {
      ...combined.metrics,
      auditedSceneCount: snapshot.scenes.length,
      auditedOutlineCount: outlines.length,
      averageSceneScore,
      coreDimensionAverage: score,
      groundingAccuracyPassed,
    },
  };
}

export async function runCourseQualityEvaluation(
  input: CliInput,
): Promise<CourseQualityEvalReport> {
  const [candidateSnapshot, ...baselineSnapshots] = await Promise.all([
    loadJson(input.candidate).then(unwrapSnapshot),
    ...input.baselines.map((entry) => loadJson(entry.source).then(unwrapSnapshot)),
  ]);
  const candidate = evaluateClassroomSnapshot(candidateSnapshot, {
    id: `candidate:${input.scenario}`,
    label: input.candidateLabel,
    source: input.candidate,
  });
  const acceptedBenchmarks = baselineSnapshots.map((snapshot, index) => {
    const identity = input.baselines[index];
    return evaluateClassroomSnapshot(snapshot, identity);
  });
  const comparison = compareCandidateToAcceptedBenchmarks(candidate, acceptedBenchmarks);

  return {
    schemaVersion: COURSE_QUALITY_EVAL_SCHEMA_VERSION,
    evaluatedAt: new Date().toISOString(),
    scenario: input.scenario,
    passed: comparison.passed,
    contract: {
      sceneFloor: 90,
      courseAverageFloor: 93,
      groundingAccuracyFloor: 95,
      requiredBenchmarkDelta: 5,
      acceptedBenchmarks: ACCEPTED_COURSE_BENCHMARKS,
    },
    candidate,
    acceptedBenchmarks,
    comparison,
  };
}

async function main(): Promise<void> {
  try {
    const input = parseCourseQualityCli(process.argv.slice(2));
    const report = await runCourseQualityEvaluation(input);
    const json = `${JSON.stringify(report, null, 2)}\n`;
    process.stdout.write(json);
    if (input.output) await writeFile(resolve(input.output), json, 'utf8');
    if (!report.passed) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify(
        {
          schemaVersion: COURSE_QUALITY_EVAL_SCHEMA_VERSION,
          passed: false,
          error: error instanceof Error ? error.message : String(error),
        },
        null,
        2,
      )}\n`,
    );
    process.exitCode = 1;
  }
}

const entry = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (entry === import.meta.url) void main();
