export const LEARNING_RUN_STATES = [
  'created',
  'source_selecting',
  'source_frozen',
  'planning',
  'plan_validated',
  'generating',
  'quality_review',
  'published',
  'learning',
  'deposit_pending',
  'deposited',
  'failed_recoverable',
  'cancelled',
] as const

export type LearningRunState = (typeof LEARNING_RUN_STATES)[number]

const ALLOWED_TRANSITIONS: Record<LearningRunState, readonly LearningRunState[]> = {
  created: ['source_selecting', 'cancelled'],
  source_selecting: ['source_frozen', 'failed_recoverable', 'cancelled'],
  source_frozen: ['planning', 'failed_recoverable', 'cancelled'],
  planning: ['plan_validated', 'failed_recoverable', 'cancelled'],
  plan_validated: ['generating', 'failed_recoverable', 'cancelled'],
  generating: ['quality_review', 'failed_recoverable', 'cancelled'],
  quality_review: ['published', 'failed_recoverable', 'cancelled'],
  published: ['learning', 'deposit_pending', 'cancelled'],
  learning: ['deposit_pending', 'published', 'cancelled'],
  deposit_pending: ['deposited', 'failed_recoverable', 'cancelled'],
  deposited: ['learning', 'cancelled'],
  failed_recoverable: ['source_selecting', 'source_frozen', 'planning', 'generating', 'deposit_pending', 'cancelled'],
  cancelled: [],
}

export class LearningRunTransitionError extends Error {
  constructor(
    readonly from: LearningRunState,
    readonly to: LearningRunState,
  ) {
    super(`Learning run cannot transition from ${from} to ${to}`)
    this.name = 'LearningRunTransitionError'
  }
}

export function canTransitionLearningRun(from: LearningRunState, to: LearningRunState): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to)
}

export function assertLearningRunTransition(from: LearningRunState, to: LearningRunState): void {
  if (!canTransitionLearningRun(from, to)) {
    throw new LearningRunTransitionError(from, to)
  }
}

export function isTerminalLearningRunState(state: LearningRunState): boolean {
  return state === 'cancelled'
}
