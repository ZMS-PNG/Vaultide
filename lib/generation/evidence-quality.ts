import {
  COURSE_QUALITY_CONTRACT_VERSION,
  normalizedReleaseScore,
  plainCourseText,
  type CourseQualityAssessment,
  type CourseQualityDimension,
  type CourseQualityIssue,
} from '@/lib/generation/course-quality';
import type {
  GeneratedInteractiveContent,
  GeneratedPBLContent,
  GeneratedQuizContent,
  GeneratedSlideContent,
  SceneOutline,
} from '@/lib/types/generation';

export const EVIDENCE_QUALITY_CONTRACT_VERSION = 'evidence-quality-v3';
export const GROUNDING_ACCURACY_RELEASE_FLOOR = 95;
export const EXTERNAL_OUTLINE_CITATION_COVERAGE_FLOOR = 0.8;
export const EXTERNAL_CLAIM_TRACEABILITY_FLOOR = 0.75;

const CITATION_PATTERN = /\[(S\d+)\]/giu;
type QualityDimensions = NonNullable<CourseQualityAssessment['dimensions']>;

function citationLabels(value: unknown): Set<string> {
  return new Set(
    [...String(value ?? '').matchAll(CITATION_PATTERN)].map((match) =>
      match[1].toLocaleUpperCase(),
    ),
  );
}

function clamp(value: number, minimum = 0, maximum = 100): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, value));
}

function round(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function mean(values: readonly number[]): number {
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function evidenceAssessment(
  issues: CourseQualityIssue[],
  metrics: CourseQualityAssessment['metrics'],
  dimensions: Pick<Partial<Record<CourseQualityDimension, number>>, 'grounding' | 'accuracy'>,
): CourseQualityAssessment {
  const rawDimensions = Object.fromEntries(
    Object.entries(dimensions).map(([key, value]) => [key, clamp(value ?? 0)]),
  ) as QualityDimensions;
  const scores = Object.values(rawDimensions).filter(
    (value): value is number => typeof value === 'number',
  );
  const rawScore = mean(scores);
  const normalizedDimensions = Object.fromEntries(
    Object.entries(rawDimensions).map(([key, value]) => [key, round(value, 2)]),
  ) as QualityDimensions;
  const score = round(rawScore, 2);
  const errorCount = issues.filter((entry) => entry.severity === 'error').length;
  const warningCount = issues.length - errorCount;
  const dimensionsMeetFloor = scores.every(
    (value) => value + Number.EPSILON >= GROUNDING_ACCURACY_RELEASE_FLOOR,
  );
  return {
    passed:
      errorCount === 0 &&
      dimensionsMeetFloor &&
      rawScore + Number.EPSILON >= GROUNDING_ACCURACY_RELEASE_FLOOR,
    score,
    issues,
    metrics: {
      qualityContractVersion: COURSE_QUALITY_CONTRACT_VERSION,
      evidenceQualityContractVersion: EVIDENCE_QUALITY_CONTRACT_VERSION,
      groundingAccuracyReleaseFloor: GROUNDING_ACCURACY_RELEASE_FLOOR,
      errorCount,
      warningCount,
      ...metrics,
      ...Object.fromEntries(
        Object.entries(normalizedDimensions).map(([key, value]) => [`dimension_${key}`, value]),
      ),
    },
    dimensions: normalizedDimensions,
  };
}

function evidenceIssue(
  code: string,
  message: string,
  retryInstruction: string,
  sceneOrder?: number,
): CourseQualityIssue {
  return {
    code,
    message,
    retryInstruction,
    severity: 'error',
    ...(sceneOrder !== undefined ? { sceneOrder } : {}),
  };
}

function outlineText(outline: SceneOutline): string {
  return `${outline.title}\n${outline.description}\n${(outline.keyPoints ?? []).join('\n')}`;
}

function outlineClaims(outline: SceneOutline): string[] {
  return [outline.description, ...(outline.keyPoints ?? [])].filter(
    (claim) => plainCourseText(claim).length > 0,
  );
}

function generatedElements(content: Record<string, unknown>): unknown[] {
  if (Array.isArray(content.elements)) return content.elements;
  const canvas = content.canvas as { elements?: unknown[] } | undefined;
  return Array.isArray(canvas?.elements) ? canvas.elements : [];
}

export function learnerVisibleGeneratedContentText(content: GeneratedSceneContent): string {
  const record = content as Record<string, unknown>;
  const elements = generatedElements(record);
  if (elements.length > 0) {
    return elements
      .map((element) => {
        const current = element as Record<string, unknown>;
        return plainCourseText(current.content ?? current.text ?? current.alt ?? '');
      })
      .join(' ');
  }

  if (Array.isArray(record.questions)) {
    return record.questions
      .map((question) => {
        const current = question as Record<string, unknown>;
        return [
          plainCourseText(current.question),
          plainCourseText(JSON.stringify(current.options ?? [])),
          plainCourseText(current.analysis),
          plainCourseText(current.commentPrompt),
        ]
          .filter(Boolean)
          .join(' ');
      })
      .join(' ');
  }

  if (typeof record.html === 'string') return plainCourseText(record.html);
  return plainCourseText(JSON.stringify(content));
}

export function contextualizedCitationLabels(value: string): Set<string> {
  const contextualized = new Set<string>();
  for (const match of value.matchAll(CITATION_PATTERN)) {
    const label = match[1].toLocaleUpperCase();
    const index = match.index ?? 0;
    const context = plainCourseText(
      value.slice(Math.max(0, index - 90), Math.min(value.length, index + match[0].length + 90)),
    ).replace(match[0], '');
    if (context.length >= 24) contextualized.add(label);
  }
  return contextualized;
}

/**
 * Citation labels alone prove neither entailment nor freshness. This compact
 * deterministic guard catches a common high-impact failure mode: a generated
 * page attaches a valid [S#] label to a named product, regulation, metric, or
 * API that never appears in the frozen evidence. It intentionally scopes the
 * check to cited windows, so learner exercises can still use hypothetical
 * scenarios without being mistaken for source facts.
 */
function citedEvidenceWindows(value: string): string[] {
  const windows: string[] = [];
  for (const match of value.matchAll(CITATION_PATTERN)) {
    const index = match.index ?? 0;
    windows.push(value.slice(Math.max(0, index - 180), Math.min(value.length, index + 180)));
  }
  return windows;
}

// A learner may deliberately introduce a role, API, or workflow as a design
// proposal. That is not a claim that the frozen source asserted the name.
// Keep this escape hatch narrow and explicit: only text marked as a proposal
// is excluded from the cited-fact name check.
const PROPOSAL_CONTEXT_PATTERN =
  /design proposal|verify independently|not a source fact|hypothetical|learner-authored|设计提案|自行验证|非来源事实|学习者方案/iu;

export function findUnsupportedNamedEvidenceTerms(
  sourceContext: string,
  learnerVisibleText: string,
): string[] {
  const source = plainCourseText(sourceContext).toLocaleLowerCase();
  if (!source) return [];
  const unknown = new Set<string>();
  const namedTermPattern =
    /\b(?:[A-Z]{2,}[A-Z0-9_+.-]*|[A-Za-z]+-\d+(?:\.\d+)?|[A-Za-z_][A-Za-z0-9_]*\(\))\b/gu;

  for (const window of citedEvidenceWindows(learnerVisibleText)) {
    if (PROPOSAL_CONTEXT_PATTERN.test(window)) continue;
    for (const match of window.matchAll(namedTermPattern)) {
      const term = match[0];
      if (/^S\d+$/iu.test(term)) continue;
      if (!source.includes(term.toLocaleLowerCase())) unknown.add(term);
    }
  }
  return [...unknown].sort((left, right) => left.localeCompare(right));
}

export function combineQualityAssessments(
  ...assessments: readonly CourseQualityAssessment[]
): CourseQualityAssessment {
  if (assessments.length === 0) {
    return {
      passed: true,
      score: 100,
      issues: [],
      metrics: {
        qualityContractVersion: COURSE_QUALITY_CONTRACT_VERSION,
        componentCount: 0,
      },
      dimensions: {},
    };
  }

  const issues = assessments.flatMap((entry) => entry.issues);
  const dimensions: QualityDimensions = {};
  for (const dimension of [
    'structure',
    'instructionalDepth',
    'pedagogy',
    'grounding',
    'accuracy',
    'distinctiveness',
    'transfer',
  ] as const) {
    const values = assessments
      .map((entry) => entry.dimensions?.[dimension])
      .filter((value): value is number => typeof value === 'number');
    if (values.length > 0) dimensions[dimension] = Math.min(...values);
  }

  return {
    passed: assessments.every((entry) => entry.passed),
    score: round(Math.min(...assessments.map((entry) => entry.score))),
    issues,
    metrics: {
      qualityContractVersion: COURSE_QUALITY_CONTRACT_VERSION,
      componentCount: assessments.length,
      componentMinimumScore: round(Math.min(...assessments.map((entry) => entry.score))),
      ...Object.assign({}, ...assessments.map((entry) => entry.metrics)),
    },
    dimensions,
  };
}

/**
 * Checks external-evidence identity, scene coverage, claim traceability, source
 * utilization, and final-scene traceability. This is deliberately stricter
 * than "some citations exist": every accepted metric is normalized to at least
 * 95 and an invented label always fails closed.
 */
export function assessOutlineEvidenceIntegrity(
  sourceContext: string | undefined,
  outlines: readonly SceneOutline[],
): CourseQualityAssessment {
  const available = citationLabels(sourceContext);
  if (available.size === 0) {
    return evidenceAssessment(
      [],
      {
        evidenceApplicable: false,
        availableCitationCount: 0,
        referencedCitationCount: 0,
        citedOutlineCount: 0,
        citationCoverage: 1,
        claimTraceability: 1,
        sourceUtilization: 1,
      },
      { grounding: 100, accuracy: 100 },
    );
  }

  const referenced = new Set<string>();
  const validReferenced = new Set<string>();
  const unknown = new Set<string>();
  let citedOutlineCount = 0;
  let claimCount = 0;
  let traceableClaimCount = 0;

  for (const outline of outlines) {
    const labels = citationLabels(outlineText(outline));
    let hasAvailableCitation = false;
    for (const label of labels) {
      referenced.add(label);
      if (available.has(label)) {
        validReferenced.add(label);
        hasAvailableCitation = true;
      } else {
        unknown.add(label);
      }
    }
    if (hasAvailableCitation) citedOutlineCount++;

    for (const claim of outlineClaims(outline)) {
      claimCount++;
      const claimLabels = citationLabels(claim);
      if ([...claimLabels].some((label) => available.has(label))) traceableClaimCount++;
    }
  }

  const citationCoverage = outlines.length > 0 ? citedOutlineCount / outlines.length : 0;
  const claimTraceability = claimCount > 0 ? traceableClaimCount / claimCount : 0;
  const sourceUtilization = validReferenced.size / available.size;
  const sourceUtilizationFloor = available.size <= 2 ? 1 : 0.6;
  const finalOutline = outlines.at(-1);
  const finalTraceable =
    finalOutline !== undefined &&
    [...citationLabels(outlineText(finalOutline))].some((label) => available.has(label));
  const issues: CourseQualityIssue[] = [];

  if (unknown.size > 0) {
    issues.push(
      evidenceIssue(
        'evidence_unknown_citation',
        `The outline invents citation labels absent from retrieved evidence: ${[...unknown].join(
          ', ',
        )}.`,
        'Remove invented labels and cite only labels present in the frozen source evidence.',
      ),
    );
  }
  if (validReferenced.size === 0 || citationCoverage < EXTERNAL_OUTLINE_CITATION_COVERAGE_FLOOR) {
    issues.push(
      evidenceIssue(
        'evidence_outline_coverage',
        `Only ${citedOutlineCount}/${outlines.length} outlines preserve inspectable source labels.`,
        `Ground at least ${Math.round(
          EXTERNAL_OUTLINE_CITATION_COVERAGE_FLOOR * 100,
        )}% of course scenes in specific retrieved findings and preserve their [S#] labels in descriptions or key points.`,
      ),
    );
  }
  if (claimTraceability < EXTERNAL_CLAIM_TRACEABILITY_FLOOR) {
    issues.push(
      evidenceIssue(
        'evidence_claim_traceability',
        `Only ${traceableClaimCount}/${claimCount} instructional claims are directly traceable.`,
        `Attach valid [S#] labels to at least ${Math.round(
          EXTERNAL_CLAIM_TRACEABILITY_FLOOR * 100,
        )}% of descriptions and key points so critical claims can be audited without guessing.`,
      ),
    );
  }
  if (sourceUtilization < sourceUtilizationFloor) {
    issues.push(
      evidenceIssue(
        'evidence_source_underuse',
        `The outline uses ${validReferenced.size}/${available.size} retrieved sources.`,
        `Use at least ${Math.round(
          sourceUtilizationFloor * 100,
        )}% of the frozen source set, while preferring primary and authoritative evidence.`,
      ),
    );
  }
  if (!finalTraceable) {
    issues.push(
      evidenceIssue(
        'evidence_final_synthesis_untraceable',
        'The final synthesis and transfer scene has no inspectable source label.',
        'Cite the evidence that supports the final synthesis and preserve those labels in its transfer task.',
        finalOutline?.order,
      ),
    );
  }

  const groundingScore = mean([
    normalizedReleaseScore(citationCoverage, EXTERNAL_OUTLINE_CITATION_COVERAGE_FLOOR, 1),
    normalizedReleaseScore(claimTraceability, EXTERNAL_CLAIM_TRACEABILITY_FLOOR, 1),
    normalizedReleaseScore(sourceUtilization, sourceUtilizationFloor, 1),
    finalTraceable ? 100 : 0,
  ]);
  const citationAccuracy = referenced.size > 0 ? validReferenced.size / referenced.size : 0;
  const accuracyScore = citationAccuracy * 100;

  return evidenceAssessment(
    issues,
    {
      evidenceApplicable: true,
      availableCitationCount: available.size,
      referencedCitationCount: referenced.size,
      validReferencedCitationCount: validReferenced.size,
      unknownCitationCount: unknown.size,
      citedOutlineCount,
      citationCoverage: round(citationCoverage, 3),
      citationCoverageFloor: EXTERNAL_OUTLINE_CITATION_COVERAGE_FLOOR,
      claimCount,
      traceableClaimCount,
      claimTraceability: round(claimTraceability, 3),
      claimTraceabilityFloor: EXTERNAL_CLAIM_TRACEABILITY_FLOOR,
      sourceUtilization: round(sourceUtilization, 3),
      sourceUtilizationFloor,
      finalTraceable,
      citationAccuracy: round(citationAccuracy, 3),
    },
    { grounding: groundingScore, accuracy: accuracyScore },
  );
}

type GeneratedSceneContent =
  | GeneratedSlideContent
  | GeneratedQuizContent
  | GeneratedInteractiveContent
  | GeneratedPBLContent
  | Record<string, unknown>;

/**
 * Every citation approved for a scene must survive in learner-visible content,
 * next to enough explanatory text to identify the supported claim.
 */
export function assessSceneEvidenceIntegrity(
  sourceContext: string | undefined,
  outline: SceneOutline,
  content: GeneratedSceneContent,
): CourseQualityAssessment {
  const available = citationLabels(sourceContext);
  if (available.size === 0) {
    return evidenceAssessment(
      [],
      {
        evidenceApplicable: false,
        sceneOrder: outline.order,
        availableCitationCount: 0,
        requiredCitationCount: 0,
        matchedCitationCount: 0,
      },
      { grounding: 100, accuracy: 100 },
    );
  }

  const planned = citationLabels(outlineText(outline));
  const plannedUnknown = new Set([...planned].filter((label) => !available.has(label)));
  const required = new Set([...planned].filter((label) => available.has(label)));
  const visibleText = learnerVisibleGeneratedContentText(content);
  const referenced = citationLabels(visibleText);
  const unknown = new Set([...referenced].filter((label) => !available.has(label)));
  const knownReferenced = new Set([...referenced].filter((label) => available.has(label)));
  const matched = new Set([...required].filter((label) => referenced.has(label)));
  const contextualized = contextualizedCitationLabels(visibleText);
  const unsupportedNames = findUnsupportedNamedEvidenceTerms(sourceContext ?? '', visibleText);
  const contextualizedRequired = new Set(
    [...required].filter((label) => contextualized.has(label)),
  );
  const issues: CourseQualityIssue[] = [];

  if (plannedUnknown.size > 0 || unknown.size > 0) {
    issues.push(
      evidenceIssue(
        'evidence_scene_unknown_citation',
        `Scene ${outline.order} contains labels absent from frozen evidence: ${[
          ...new Set([...plannedUnknown, ...unknown]),
        ].join(', ')}.`,
        `Regenerate scene ${outline.order} using only labels supplied in the frozen source evidence.`,
        outline.order,
      ),
    );
  }
  if (required.size > 0 && matched.size !== required.size) {
    const missing = [...required].filter((label) => !matched.has(label));
    issues.push(
      evidenceIssue(
        'evidence_scene_citation_dropped',
        `Scene ${outline.order} dropped approved evidence labels: ${missing.join(', ')}.`,
        `Preserve every approved label (${[...required].join(
          ', ',
        )}) in learner-visible teaching content for scene ${outline.order}.`,
        outline.order,
      ),
    );
  }
  if (required.size > 0 && contextualizedRequired.size !== required.size) {
    const naked = [...required].filter((label) => !contextualizedRequired.has(label));
    issues.push(
      evidenceIssue(
        'evidence_scene_citation_uncontextualized',
        `Scene ${outline.order} shows citation labels without enough adjacent claim text: ${naked.join(
          ', ',
        )}.`,
        'Place each [S#] label next to the concrete mechanism, result, limitation, or decision it supports.',
        outline.order,
      ),
    );
  }
  if (unsupportedNames.length > 0) {
    issues.push(
      evidenceIssue(
        'evidence_scene_unsupported_named_claim',
        `Scene ${outline.order} cites names absent from the frozen evidence: ${unsupportedNames.join(', ')}.`,
        `Remove or recast the unsupported named claims in scene ${outline.order}; a cited name, metric, regulation, product, or API must appear in the frozen source evidence.`,
        outline.order,
      ),
    );
  }

  const requiredCoverage = required.size > 0 ? matched.size / required.size : 1;
  const contextualizedCoverage =
    required.size > 0 ? contextualizedRequired.size / required.size : 1;
  const citationAccuracy =
    referenced.size > 0 ? knownReferenced.size / referenced.size : required.size > 0 ? 0 : 1;
  const namedClaimAccuracy = unsupportedNames.length === 0 ? 1 : 0;
  const groundingScore = mean([
    requiredCoverage * 100,
    contextualizedCoverage * 100,
    namedClaimAccuracy * 100,
  ]);
  const accuracyScore = mean([citationAccuracy * 100, namedClaimAccuracy * 100]);

  return evidenceAssessment(
    issues,
    {
      evidenceApplicable: required.size > 0,
      sceneOrder: outline.order,
      availableCitationCount: available.size,
      plannedCitationCount: planned.size,
      requiredCitationCount: required.size,
      referencedCitationCount: referenced.size,
      matchedCitationCount: matched.size,
      contextualizedCitationCount: contextualizedRequired.size,
      unknownCitationCount: unknown.size + plannedUnknown.size,
      requiredCitationCoverage: round(requiredCoverage, 3),
      contextualizedCitationCoverage: round(contextualizedCoverage, 3),
      citationAccuracy: round(citationAccuracy, 3),
      unsupportedNamedClaimCount: unsupportedNames.length,
      namedClaimAccuracy: round(namedClaimAccuracy, 3),
      visibleTextChars: visibleText.length,
    },
    { grounding: groundingScore, accuracy: accuracyScore },
  );
}
