import { describe, expect, it, vi } from 'vitest';
import { recordResearchRunIfConfigured } from '@/lib/learning/research';
import type { ResearchRepository } from '@/lib/learning/domain/research';

describe('research provenance recording', () => {
  it('records citation metadata without embedding source content in the classroom', async () => {
    vi.stubEnv('LEARNING_OWNER_ID', 'own_11111111111111111111111111111111');
    vi.stubEnv('PAIRING_HMAC_SECRET', 'x'.repeat(32));
    vi.stubEnv('ACCESS_CODE', 'test-access');
    vi.stubEnv('DATABASE_URL', 'postgres://example.invalid/test');
    const record = vi.fn().mockResolvedValue({
      id: 'rrn_11111111111111111111111111111111',
      citations: [],
    });
    const repository = { record } as ResearchRepository;

    const result = await recordResearchRunIfConfigured(
      {
        answer: '',
        query: 'grounded topic',
        responseTime: 0.5,
        sources: [
          {
            citationId: 'S1',
            title: 'Official source',
            url: 'https://example.gov/topic',
            domain: 'example.gov',
            authority: 'primary',
            content: 'Short provider excerpt',
            score: 0.9,
          },
        ],
      },
      {
        requestedProviderId: 'brave',
        providerId: 'tavily',
        mode: 'official-api',
        fetchedAt: '2026-07-21T00:00:00.000Z',
        sourcePolicy: 'prefer-primary',
        attempts: [],
        storagePolicy: 'citation-metadata-only',
      },
      repository,
    );

    expect(result?.id).toMatch(/^rrn_/);
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId: 'own_11111111111111111111111111111111',
        usedProviderId: 'tavily',
        responseTimeMs: 500,
      }),
    );
  });
});
