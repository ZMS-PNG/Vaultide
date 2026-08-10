import { describe, expect, it } from 'vitest'

import {
  LearningContractValidationError,
  createLearningContract,
  parseLearningContract,
} from '@/lib/learning/domain/v3/learning-contract'
import {
  LearningRunTransitionError,
  assertLearningRunTransition,
  canTransitionLearningRun,
} from '@/lib/learning/domain/v3/state-machine'
import { TimestampBoundaryError, normalizeTimestamp } from '@/lib/learning/domain/v3/timestamp-boundary'

describe('learning domain v3 contracts', () => {
  it('builds a deterministic, validated contract before source planning', () => {
    const input = {
      projectId: 'project-yuns',
      sourceMode: 'obsidian' as const,
      objectType: 'knowledge-project' as const,
      goal: 'Understand the project architecture and choose a safe next step.',
      now: new Date('2026-08-02T00:00:00.000Z'),
    }

    const first = createLearningContract(input)
    const second = createLearningContract(input)

    expect(first.contractId).toBe(second.contractId)
    expect(first.sourcePolicy.allowedOrigins).toEqual(['internal'])
    expect(first.artifact.destination).toBe('both')
    expect(first.requiredConceptIds).toEqual(['goal:core'])
  })

  it('rejects contracts with a missing observable learning result', () => {
    expect(() => parseLearningContract({ schemaVersion: 3 })).toThrow(LearningContractValidationError)
  })

  it('enforces explicit run transitions instead of arbitrary status mutation', () => {
    expect(canTransitionLearningRun('source_frozen', 'planning')).toBe(true)
    expect(() => assertLearningRunTransition('created', 'published')).toThrow(LearningRunTransitionError)
  })

  it('normalizes valid timestamps and rejects untyped invalid values', () => {
    expect(normalizeTimestamp('2026-08-02T00:00:00.000Z')).toBe('2026-08-02T00:00:00.000Z')
    expect(() => normalizeTimestamp('not-a-time')).toThrow(TimestampBoundaryError)
  })
})
