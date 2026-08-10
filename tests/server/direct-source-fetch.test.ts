import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  validateUrlForSSRF: vi.fn(),
}));

vi.mock('@/lib/server/ssrf-guard', () => ({
  validateUrlForSSRF: mocks.validateUrlForSSRF,
}));

describe('direct source fetch', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    mocks.validateUrlForSSRF.mockReset();
  });

  it('extracts explicit URLs and arXiv identifiers without duplicates', async () => {
    const { extractDirectSourceUrls } = await import('@/lib/server/direct-source-fetch');
    expect(
      extractDirectSourceUrls(
        'Read arXiv:2607.22520 and https://github.com/InternScience/InternAgent。',
      ),
    ).toEqual(['https://github.com/InternScience/InternAgent', 'https://arxiv.org/abs/2607.22520']);
  });

  it('fetches and normalizes an explicit arXiv source after SSRF validation', async () => {
    mocks.validateUrlForSSRF.mockResolvedValue(null);
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            '<html><head><title>The Regression Tax</title></head><body><h1>The Regression Tax</h1><p>This primary paper studies agent skill regressions, grounding displacement, and verification displacement in nearly six thousand runs.</p></body></html>',
            { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
          ),
        ),
    );

    const { fetchDirectSourcesFromRequirement } = await import('@/lib/server/direct-source-fetch');
    const result = await fetchDirectSourcesFromRequirement({
      requirement: 'Study arXiv:2607.22520 regression tax',
      sourcePolicy: 'prefer-primary',
      now: vi.fn().mockReturnValueOnce(1_000).mockReturnValueOnce(1_250),
    });

    expect(result?.sources).toHaveLength(1);
    expect(result?.sources[0]).toMatchObject({
      title: 'The Regression Tax',
      url: 'https://arxiv.org/abs/2607.22520',
      authority: 'primary',
      citationId: 'S1',
    });
    expect(result?.responseTime).toBe(0.25);
    expect(mocks.validateUrlForSSRF).toHaveBeenCalledWith('https://arxiv.org/abs/2607.22520');
  });

  it('defers a GitHub repository landing page to official discovery instead of fetching page chrome', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { fetchDirectSourcesFromRequirement } = await import('@/lib/server/direct-source-fetch');
    const result = await fetchDirectSourcesFromRequirement({
      requirement: 'Learn https://github.com/github/gh-aw as an external repository.',
      sourcePolicy: 'prefer-primary',
    });

    expect(result).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.validateUrlForSSRF).not.toHaveBeenCalled();
  });

  it('rejects private or otherwise unsafe direct URLs before fetching', async () => {
    mocks.validateUrlForSSRF.mockResolvedValue('Local/private network URLs are not allowed');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { fetchDirectSourcesFromRequirement } = await import('@/lib/server/direct-source-fetch');
    const result = await fetchDirectSourcesFromRequirement({
      requirement: 'Read http://127.0.0.1/internal',
      sourcePolicy: 'balanced',
    });

    expect(result).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
