import { describe, expect, it } from 'vitest'

import { createLearningV3Error, learningV3ErrorResponse } from '@/lib/learning/http/v3-error'

describe('learning v3 error contract', () => {
  it('returns a stable user-safe error envelope', async () => {
    const error = createLearningV3Error({
      code: 'SOURCE_UNAVAILABLE',
      stage: 'source',
      userMessage: 'External sources are temporarily unavailable.',
      suggestedAction: 'Continue with the frozen internal sources or try again later.',
      retryable: true,
      correlationId: 'corr_test',
    })
    const response = learningV3ErrorResponse(error, 503)

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({ success: false, error })
  })
})
