import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createLearningContract } from '@/lib/learning/domain/v3/learning-contract'

const planningService = vi.hoisted(() => ({
  beginOutline: vi.fn(),
  compileContext: vi.fn(),
  completeOutline: vi.fn(),
  failOutline: vi.fn(),
  view: vi.fn(),
}))
const resolveModelFromRequestMock = vi.hoisted(() => vi.fn())
const streamLLMMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/generation/planning/service', () => ({
  getCoursePlanningService: () => planningService,
}))

vi.mock('@/lib/server/resolve-model', () => ({
  resolveModelFromRequest: resolveModelFromRequestMock,
}))

vi.mock('@/lib/ai/llm', () => ({
  streamLLM: streamLLMMock,
}))

const originalFlag = process.env.OPENMAIC_CONTENT_ENGINE_V3

describe('V3 outline route', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    process.env.OPENMAIC_CONTENT_ENGINE_V3 = 'true'
    const contract = createLearningContract({
      projectId: 'project-v3-route',
      sourceMode: 'obsidian',
      objectType: 'knowledge-project',
      goal: 'Understand the durable workflow and create a source-backed implementation decision.',
    })
    const sourceText = [
      '# Durable workflow',
      'A worker leases an individual step, persists its accepted output, and only then advances the durable job state.',
      'A release is published after every planned scene has an auditable source trail and a learner-visible result.',
    ]
      .join('\n')
      .repeat(12)
    planningService.beginOutline.mockResolvedValue({
      leaseToken: 'lease-v3',
      reusedReadyResult: false,
      run: {
        input: {
          requirements: {
            requirement: contract.goal,
            learningContract: contract,
          },
          documentText: sourceText,
          researchText: '',
          sourceContextExpectedChars: sourceText.length,
        },
      },
    })
    planningService.compileContext.mockResolvedValue({ sourceText, learnerKnowledgeText: '' })
    planningService.completeOutline.mockResolvedValue({ id: 'cpl_complete' })
    planningService.failOutline.mockResolvedValue(true)
    resolveModelFromRequestMock.mockResolvedValue({
      model: { provider: 'test', modelId: 'semantic-model' },
      modelInfo: { capabilities: {} },
      modelString: 'test:semantic-model',
      thinkingConfig: undefined,
    })
    streamLLMMock.mockReturnValue({
      textStream: (async function* () {
        // A non-parseable response must never be presented as a generic
        // source-template classroom. The user receives a precise retry state
        // while the frozen plan remains available for diagnostics.
        yield 'not a JSON outline envelope'
      })(),
    })
  })

  afterEach(() => {
    if (originalFlag === undefined) delete process.env.OPENMAIC_CONTENT_ENGINE_V3
    else process.env.OPENMAIC_CONTENT_ENGINE_V3 = originalFlag
  })

  it('withholds the deterministic template when the one semantic pass is unusable', async () => {
    const { POST } = await import('@/lib/server/api-routes/generate/scene-outlines-stream/handler')
    const response = await POST({
      json: async () => ({
        planningRunId: 'cpl_0123456789abcdef0123456789abcdef',
        enforceQualityContract: true,
      }),
      headers: { get: () => null },
    } as never)
    const body = await response.text()

    expect(response.status).toBe(200)
    expect(resolveModelFromRequestMock).toHaveBeenCalledTimes(1)
    expect(streamLLMMock).toHaveBeenCalledTimes(1)
    expect(planningService.completeOutline).not.toHaveBeenCalled()
    expect(planningService.failOutline).toHaveBeenCalledWith(
      expect.objectContaining({
        planningRunId: 'cpl_0123456789abcdef0123456789abcdef',
        leaseToken: 'lease-v3',
        errorCode: 'OUTLINE_PARSE_FAILED',
      }),
    )
    expect(body).toContain('"type":"error"')
    expect(body).not.toContain('deterministic-v3-fallback')
  })
})
