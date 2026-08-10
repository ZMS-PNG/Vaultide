import { createHash } from 'node:crypto'

import { z } from 'zod'

export const LEARNING_CONTRACT_SCHEMA_VERSION = 3 as const

const NonEmptyText = z.string().trim().min(1)
const StringList = z.array(NonEmptyText).max(64)

export const LearningObjectTypeSchema = z.enum([
  'repository',
  'paper',
  'patent',
  'technical-article',
  'meeting',
  'manuscript',
  'knowledge-project',
  'mixed',
])

export const SourceModeSchema = z.enum(['external', 'obsidian', 'hybrid'])

export const LearningDepthSchema = z.enum(['orientation', 'working', 'expert'])

export const LearnerLevelSchema = z.enum(['novice', 'intermediate', 'advanced'])

export const LearningArtifactContractSchema = z.object({
  artifactType: z.enum([
    'decision-record',
    'implementation-plan',
    'concept-map',
    'research-brief',
    'project-review',
    'study-note',
  ]),
  requiredSections: StringList.min(2).max(8),
  verificationMethod: NonEmptyText,
  destination: z.enum(['obsidian-companion-note', 'obsidian-synthesis', 'both']),
})

export const LearningContractSchema = z.object({
  schemaVersion: z.literal(LEARNING_CONTRACT_SCHEMA_VERSION),
  contractId: z.string().regex(/^lct_[a-f0-9]{32}$/),
  projectId: NonEmptyText,
  sourceMode: SourceModeSchema,
  objectType: LearningObjectTypeSchema,
  goal: NonEmptyText.max(600),
  observableCapability: NonEmptyText.max(600),
  targetMinutes: z.number().int().min(10).max(360),
  depth: LearningDepthSchema,
  learnerLevel: LearnerLevelSchema,
  requiredConceptIds: StringList.min(1),
  sourcePolicy: z.object({
    authorityRequirement: z.enum(['primary-required', 'authoritative-preferred', 'balanced']),
    freshnessRequired: z.boolean(),
    allowedOrigins: z.array(z.enum(['internal', 'external'])).min(1).max(2),
  }),
  artifact: LearningArtifactContractSchema,
  exclusions: StringList.max(16),
  confirmedAt: z.string().datetime({ offset: true }),
})

export type LearningContract = z.infer<typeof LearningContractSchema>
export type LearningObjectType = z.infer<typeof LearningObjectTypeSchema>
export type SourceMode = z.infer<typeof SourceModeSchema>
export type LearningArtifactContract = z.infer<typeof LearningArtifactContractSchema>

export class LearningContractValidationError extends Error {
  readonly issues: z.ZodIssue[]

  constructor(issues: z.ZodIssue[]) {
    super(`Invalid LearningContract: ${issues.map((issue) => issue.message).join('; ')}`)
    this.name = 'LearningContractValidationError'
    this.issues = issues
  }
}

export function parseLearningContract(value: unknown): LearningContract {
  const result = LearningContractSchema.safeParse(value)
  if (!result.success) {
    throw new LearningContractValidationError(result.error.issues)
  }
  return result.data
}

export interface CreateLearningContractInput {
  projectId: string
  sourceMode: SourceMode
  objectType: LearningObjectType
  goal: string
  targetMinutes?: number
  depth?: z.infer<typeof LearningDepthSchema>
  learnerLevel?: z.infer<typeof LearnerLevelSchema>
  now?: Date
}

function stableContractId(input: CreateLearningContractInput): string {
  const fingerprint = JSON.stringify({
    projectId: input.projectId.trim(),
    sourceMode: input.sourceMode,
    objectType: input.objectType,
    goal: input.goal.trim(),
    targetMinutes: input.targetMinutes ?? 45,
    depth: input.depth ?? 'working',
    learnerLevel: input.learnerLevel ?? 'novice',
  })
  return `lct_${createHash('sha256').update(fingerprint).digest('hex').slice(0, 32)}`
}

function artifactFor(objectType: LearningObjectType): LearningArtifactContract {
  switch (objectType) {
    case 'repository':
    case 'knowledge-project':
      return {
        artifactType: 'implementation-plan',
        requiredSections: ['Problem framing', 'Architecture or workflow', 'First executable step'],
        verificationMethod: 'The artifact names the trigger, runtime or engine, minimum permissions, an executable verification step, and a failure-recovery action; each consequential choice is linked to source evidence.',
        destination: 'both',
      }
    case 'paper':
    case 'patent':
      return {
        artifactType: 'research-brief',
        requiredSections: ['Claim', 'Evidence', 'Limitations', 'Transfer decision'],
        verificationMethod: 'The brief separates the source claim, direct evidence, limitation, and transfer hypothesis, then names a concrete check that could disconfirm the proposed application.',
        destination: 'both',
      }
    default:
      return {
        artifactType: 'study-note',
        requiredSections: ['Core model', 'Example', 'Decision or action'],
        verificationMethod: 'The note applies the model to one concrete situation, names the supporting evidence, and records the next action or open uncertainty.',
        destination: 'obsidian-companion-note',
      }
  }
}

function sourcePolicyFor(sourceMode: SourceMode): LearningContract['sourcePolicy'] {
  if (sourceMode === 'external') {
    return {
      authorityRequirement: 'primary-required',
      freshnessRequired: true,
      allowedOrigins: ['external'],
    }
  }

  if (sourceMode === 'obsidian') {
    return {
      authorityRequirement: 'balanced',
      freshnessRequired: false,
      allowedOrigins: ['internal'],
    }
  }

  return {
    authorityRequirement: 'authoritative-preferred',
    freshnessRequired: true,
    allowedOrigins: ['internal', 'external'],
  }
}

/**
 * Builds a conservative contract before planning. It deliberately contains no
 * model-authored claims; concepts and evidence are enriched only after source
 * selection has been frozen.
 */
export function createLearningContract(input: CreateLearningContractInput): LearningContract {
  const goal = input.goal.trim()
  const now = input.now ?? new Date()
  const objectType = input.objectType

  return parseLearningContract({
    schemaVersion: LEARNING_CONTRACT_SCHEMA_VERSION,
    contractId: stableContractId(input),
    projectId: input.projectId.trim(),
    sourceMode: input.sourceMode,
    objectType,
    goal,
    observableCapability: `Use the source material to make and justify one concrete decision about: ${goal}`,
    targetMinutes: input.targetMinutes ?? 45,
    depth: input.depth ?? 'working',
    learnerLevel: input.learnerLevel ?? 'novice',
    requiredConceptIds: ['goal:core'],
    sourcePolicy: sourcePolicyFor(input.sourceMode),
    artifact: artifactFor(objectType),
    exclusions: ['Do not treat unsupported inference as source fact.'],
    confirmedAt: now.toISOString(),
  })
}
