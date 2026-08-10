export type LearningV3ErrorCode =
  | 'CONTRACT_INVALID'
  | 'STATE_TRANSITION_INVALID'
  | 'SOURCE_INSUFFICIENT'
  | 'SOURCE_UNAVAILABLE'
  | 'PLAN_INVALID'
  | 'QUALITY_REJECTED'
  | 'GENERATION_RECOVERABLE'
  | 'WRITEBACK_CONFLICT'
  | 'INTERNAL_ERROR'

export interface LearningV3ErrorPayload {
  code: LearningV3ErrorCode
  stage: 'contract' | 'source' | 'planning' | 'generation' | 'quality' | 'writeback' | 'system'
  userMessage: string
  suggestedAction: string
  retryable: boolean
  correlationId: string
  details?: Record<string, string | number | boolean>
}

export function createLearningV3Error(
  payload: Omit<LearningV3ErrorPayload, 'correlationId'> & { correlationId?: string },
): LearningV3ErrorPayload {
  return {
    ...payload,
    correlationId: payload.correlationId ?? crypto.randomUUID(),
  }
}

export function learningV3ErrorResponse(payload: LearningV3ErrorPayload, status: number): Response {
  return Response.json({ success: false, error: payload }, { status })
}
