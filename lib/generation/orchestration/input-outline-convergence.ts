import {
  assessOutlineQuality,
  type CourseQualityAssessment,
} from '@/lib/generation/course-quality';
import { normalizeQualityFirstOutlines } from '@/lib/generation/outline-generator';
import {
  fortifyOutlinesForRelease,
  OUTLINE_QUALITY_RELEASE_FLOOR,
  repairSafeOutlineQualityIssues,
} from '@/lib/generation/outline-quality-repair';
import type { SceneOutline } from '@/lib/types/generation';
import { normalizeOutlineEnvelope } from '@/lib/generation/outline-envelope-normalization';

const MAX_INPUT_CONVERGENCE_PASSES = 3;

export interface CourseInputOutlineConvergence {
  outlines: SceneOutline[];
  assessment: CourseQualityAssessment;
  changed: boolean;
  repairedIssueCodes: string[];
}

/**
 * Canonicalizes reviewed outlines at the durable-job trust boundary.
 *
 * Browser streaming, review state, and restored sessions can each carry a
 * structurally valid but pre-repair outline snapshot. A repairable pedagogical
 * defect must not become a user-visible 422 after the expensive research and
 * review stages have already completed. This bounded convergence only applies
 * deterministic, source-fact-neutral repairs and always re-runs the complete
 * quality assessment before the job can be persisted.
 */
export function convergeCourseInputOutlines(
  outlines: readonly SceneOutline[],
): CourseInputOutlineConvergence {
  const unwrapped = normalizeOutlineEnvelope([...outlines])?.outlines ?? [...outlines];
  const normalized = normalizeQualityFirstOutlines(
    unwrapped.map((outline) => ({
      ...outline,
      keyPoints: [...(outline.keyPoints ?? [])],
    })),
  );
  const initialAssessment = assessOutlineQuality(normalized);
  let candidate = fortifyOutlinesForRelease(normalized).outlines;
  let changed = JSON.stringify(candidate) !== JSON.stringify(outlines);
  const repairedIssueCodes = new Set<string>();
  let assessment = assessOutlineQuality(candidate);
  const remainingInitialIssues = new Set(assessment.issues.map((issue) => issue.code));
  initialAssessment.issues.forEach((issue) => {
    if (!remainingInitialIssues.has(issue.code)) repairedIssueCodes.add(issue.code);
  });

  for (let pass = 0; pass < MAX_INPUT_CONVERGENCE_PASSES; pass++) {
    if (assessment.passed && assessment.score >= OUTLINE_QUALITY_RELEASE_FLOOR) break;

    const repair = repairSafeOutlineQualityIssues(candidate, assessment);
    if (!repair.changed) break;

    const next = fortifyOutlinesForRelease(
      normalizeQualityFirstOutlines(repair.outlines),
    ).outlines;
    repair.repairedIssueCodes.forEach((code) => repairedIssueCodes.add(code));
    if (JSON.stringify(next) === JSON.stringify(candidate)) break;

    candidate = next;
    changed = true;
    assessment = assessOutlineQuality(candidate);
  }

  return {
    outlines: candidate,
    assessment,
    changed,
    repairedIssueCodes: [...repairedIssueCodes],
  };
}
