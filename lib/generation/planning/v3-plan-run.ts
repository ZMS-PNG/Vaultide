import {
  assessInstructionalPlan,
  buildSemanticInstructionalPlan,
  buildInstructionalPlan,
  instructionalPlanToOutlines,
  type CourseInstructionalPlan,
} from './instructional-blueprint'
import { freezeCanonicalEvidence } from '@/lib/learning/domain/v3/frozen-evidence'
import { parseLearningContract } from '@/lib/learning/domain/v3/learning-contract'
import { describeV3OutlineReleaseViolation } from '@/lib/generation/outline-release-contract'
import type { SceneOutline, UserRequirements } from '@/lib/types/generation'

export class V3PlanBuildError extends Error {
  constructor(
    readonly code: 'CONTRACT_INVALID' | 'SOURCE_INSUFFICIENT' | 'PLAN_INVALID',
    message: string,
  ) {
    super(message)
    this.name = 'V3PlanBuildError'
  }
}

export interface V3PlanRunResult {
  plan: CourseInstructionalPlan
  outlines: SceneOutline[]
  courseTitle: string
  languageDirective: string
}

function sourceAndContract(input: {
  requirements: UserRequirements
  sourceContext: string
}): { contract: ReturnType<typeof parseLearningContract>; evidence: ReturnType<typeof freezeCanonicalEvidence> } {
  if (!input.requirements.learningContract) {
    throw new V3PlanBuildError(
      'CONTRACT_INVALID',
      'A confirmed LearningContract is required before V3 course planning.',
    )
  }
  const contract = parseLearningContract(input.requirements.learningContract)
  const evidence = freezeCanonicalEvidence(input.sourceContext)
  if (evidence.entries.length === 0) {
    throw new V3PlanBuildError(
      'SOURCE_INSUFFICIENT',
      'The reviewed source set has no substantive evidence blocks for a learning plan.',
    )
  }
  return { contract, evidence }
}

function checkedResult(input: {
  plan: CourseInstructionalPlan
  contract: ReturnType<typeof parseLearningContract>
  evidence: ReturnType<typeof freezeCanonicalEvidence>
}): V3PlanRunResult {
  const assessment = assessInstructionalPlan(input.plan, input.evidence)
  if (!assessment.passed) {
    throw new V3PlanBuildError(
      'PLAN_INVALID',
      `The V3 learning plan did not satisfy its contract: ${assessment.violations.join(', ')}`,
    )
  }
  const outlines = instructionalPlanToOutlines(input.plan)
  const outlineViolation = describeV3OutlineReleaseViolation(outlines)
  if (outlineViolation) {
    throw new V3PlanBuildError('PLAN_INVALID', `The V3 release contract rejected the plan: ${outlineViolation}`)
  }
  return {
    plan: input.plan,
    outlines,
    courseTitle: courseTitle(input.contract.goal),
    languageDirective: languageDirective(input.contract.goal),
  }
}

function courseTitle(requirement: string): string {
  const title = requirement.replace(/\s+/gu, ' ').trim().slice(0, 110)
  return title || 'Source-grounded learning journey'
}

function languageDirective(requirement: string): string {
  return /[\u3400-\u9fff]/u.test(requirement)
    ? 'Teach in Simplified Chinese. Keep source labels such as [S1] next to supported claims.'
    : 'Teach in the learner request language. Keep source labels such as [S1] next to supported claims.'
}

/**
 * The V3 first-pass planner has no LLM dependency. It converts a frozen source
 * set and an already-confirmed learning contract into a complete activity plan
 * before any renderer/model call is permitted. This removes the previous
 * failure mode where a free-form outline had to guess the release contract.
 */
export function buildV3PlanRun(input: {
  requirements: UserRequirements
  sourceContext: string
}): V3PlanRunResult {
  const { contract, evidence } = sourceAndContract(input)
  return checkedResult({ plan: buildInstructionalPlan({ contract, evidence }), contract, evidence })
}

/**
 * Semantic-first V3 planning. The caller supplies a one-pass LLM teaching arc;
 * this function binds it to the same frozen evidence and durable learner
 * activity contract as the deterministic baseline. It intentionally throws for
 * vague/underspecified semantic drafts so the orchestration layer can publish
 * its already-built baseline without a second user-visible attempt.
 */
export function buildSemanticV3PlanRun(input: {
  requirements: UserRequirements
  sourceContext: string
  semanticOutlines: readonly SceneOutline[]
  courseTitle?: string | null
  languageDirective?: string | null
}): V3PlanRunResult {
  const { contract, evidence } = sourceAndContract(input)
  const result = checkedResult({
    plan: buildSemanticInstructionalPlan({
      contract,
      evidence,
      semanticOutlines: input.semanticOutlines,
    }),
    contract,
    evidence,
  })
  return {
    ...result,
    ...(typeof input.courseTitle === 'string' && input.courseTitle.trim()
      ? { courseTitle: courseTitle(input.courseTitle) }
      : {}),
    ...(typeof input.languageDirective === 'string' && input.languageDirective.trim()
      ? { languageDirective: input.languageDirective.trim().slice(0, 800) }
      : {}),
  }
}
