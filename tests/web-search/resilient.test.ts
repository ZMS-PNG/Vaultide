import { describe, expect, it, vi } from 'vitest';
import { buildAuthorityRescueQuery, searchWebResilient } from '@/lib/server/resilient-web-search';
import { WebSearchProviderError } from '@/lib/web-search/provider-error';

const groundedResult = {
  answer: '',
  sources: [
    {
      title: 'NIST publication',
      url: 'https://www.nist.gov/example',
      content: 'Evidence',
      score: 0.8,
    },
  ],
  query: 'q',
  responseTime: 0.2,
};

describe('resilient web search', () => {
  it('falls back after public Brave is rate limited', async () => {
    const search = vi
      .fn()
      .mockRejectedValueOnce(
        new WebSearchProviderError(
          'brave',
          'public-page',
          'rate_limited',
          429,
          true,
          undefined,
          'limited',
        ),
      )
      .mockResolvedValueOnce(groundedResult);

    const value = await searchWebResilient({
      requestedProviderId: 'brave',
      candidates: [
        { providerId: 'brave', apiKey: '', mode: 'public-page' },
        { providerId: 'tavily', apiKey: 'test', mode: 'official-api' },
      ],
      query: 'NIST publication',
      search,
      now: () => new Date('2026-07-21T00:00:00.000Z'),
    });

    expect(value.provenance.providerId).toBe('tavily');
    expect(value.provenance.attempts).toHaveLength(2);
    expect(value.result.sources[0]).toMatchObject({ citationId: 'S1', authority: 'primary' });
  });

  it('performs one bounded retry when the provider reset is short', async () => {
    const search = vi
      .fn()
      .mockRejectedValueOnce(
        new WebSearchProviderError(
          'tavily',
          'official-api',
          'rate_limited',
          429,
          true,
          1_000,
          'limited',
        ),
      )
      .mockResolvedValueOnce(groundedResult);
    const wait = vi.fn().mockResolvedValue(undefined);

    const value = await searchWebResilient({
      requestedProviderId: 'tavily',
      candidates: [{ providerId: 'tavily', apiKey: 'test', mode: 'official-api' }],
      query: 'NIST publication',
      search,
      wait,
    });

    expect(wait).toHaveBeenCalledWith(1_000);
    expect(search).toHaveBeenCalledTimes(2);
    expect(value.provenance.attempts.map((attempt) => attempt.try)).toEqual([1, 2]);
  });

  it('fails with an actionable error instead of returning an answer without citations', async () => {
    const search = vi.fn().mockResolvedValue({
      answer: 'Uncited answer',
      sources: [],
      query: 'q',
      responseTime: 0.1,
    });

    await expect(
      searchWebResilient({
        requestedProviderId: 'brave',
        candidates: [{ providerId: 'brave', apiKey: '', mode: 'public-page' }],
        query: 'NIST publication',
        search,
      }),
    ).rejects.toMatchObject({
      status: 422,
      code: 'NO_QUALIFYING_SOURCES',
      message: expect.stringContaining('No primary or authoritative sources'),
    });
  });

  it('retries with an authority-focused query and excludes ordinary sources', async () => {
    const search = vi
      .fn()
      .mockResolvedValueOnce({
        ...groundedResult,
        sources: [
          {
            title: 'Commercial learning blog',
            url: 'https://example.com/learning',
            content: 'NIST publication',
            score: 0.99,
          },
        ],
      })
      .mockResolvedValueOnce(groundedResult);

    const value = await searchWebResilient({
      requestedProviderId: 'tavily',
      candidates: [{ providerId: 'tavily', apiKey: 'test', mode: 'official-api' }],
      query: 'NIST publication',
      search,
    });

    expect(search).toHaveBeenCalledTimes(2);
    expect(search.mock.calls[1][0].query).toBe(buildAuthorityRescueQuery('NIST publication'));
    expect(value.provenance.attempts.map((attempt) => attempt.strategy)).toEqual([
      'original',
      'authority-rescue',
    ]);
    expect(value.result.sources).toHaveLength(1);
    expect(value.result.sources[0].authority).toBe('primary');
    expect(buildAuthorityRescueQuery('NIST publication')).not.toContain('site:');
    expect(buildAuthorityRescueQuery('NIST publication')).not.toContain(' OR ');
  });

  it('fails closed when neither the original nor rescue query finds authority', async () => {
    const search = vi.fn().mockResolvedValue({
      ...groundedResult,
      sources: [
        {
          title: 'Ordinary page',
          url: 'https://example.com/page',
          content: 'active recall and spaced repetition',
          score: 0.9,
        },
      ],
    });

    await expect(
      searchWebResilient({
        requestedProviderId: 'tavily',
        candidates: [{ providerId: 'tavily', apiKey: 'test', mode: 'official-api' }],
        query: 'active recall and spaced repetition',
        search,
      }),
    ).rejects.toMatchObject({
      status: 422,
      code: 'NO_QUALIFYING_SOURCES',
      message: expect.stringContaining('No primary or authoritative sources'),
    });
    expect(search).toHaveBeenCalledTimes(2);
  });
});
