import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import { WebSearchProviderError } from '@/lib/web-search/provider-error';

const mocks = vi.hoisted(() => ({
  searchWeb: vi.fn(),
  formatSearchResultsAsContext: vi.fn(() => 'formatted context'),
  fetchDirectSourcesFromRequirement: vi.fn(),
  resolveModelFromRequest: vi.fn(),
  recordResearchRunIfConfigured: vi.fn(),
}));

vi.mock('@/lib/web-search', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/web-search')>();
  return {
    ...actual,
    searchWeb: mocks.searchWeb,
    formatSearchResultsAsContext: mocks.formatSearchResultsAsContext,
  };
});

vi.mock('@/lib/server/resolve-model', () => ({
  resolveModelFromRequest: mocks.resolveModelFromRequest,
}));

vi.mock('@/lib/ai/llm', () => ({
  callLLM: vi.fn(),
}));

vi.mock('@/lib/learning/research', () => ({
  recordResearchRunIfConfigured: mocks.recordResearchRunIfConfigured,
}));

vi.mock('@/lib/server/direct-source-fetch', () => ({
  fetchDirectSourcesFromRequirement: mocks.fetchDirectSourcesFromRequirement,
}));

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

async function postWebSearch(body: Record<string, unknown>) {
  const { POST } = await import('@/lib/server/api-routes/web-search/handler');
  const request = new Request('http://localhost/api/web-search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return POST(request as unknown as NextRequest);
}

describe('POST /api/web-search', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    delete process.env.TAVILY_API_KEY;
    delete process.env.TAVILY_BASE_URL;
    delete process.env.BOCHA_API_KEY;
    delete process.env.BOCHA_BASE_URL;
    delete process.env.BRAVE_API_KEY;
    delete process.env.BRAVE_BASE_URL;
    delete process.env.BAIDU_API_KEY;
    delete process.env.BAIDU_BASE_URL;
    delete process.env.WEB_SEARCH_MINIMAX_API_KEY;
    delete process.env.WEB_SEARCH_MINIMAX_BASE_URL;
    delete process.env.SEARXNG_BASE_URL;
    mocks.searchWeb.mockReset();
    mocks.formatSearchResultsAsContext.mockClear();
    mocks.fetchDirectSourcesFromRequirement.mockReset();
    mocks.fetchDirectSourcesFromRequirement.mockResolvedValue(undefined);
    mocks.resolveModelFromRequest.mockReset();
    mocks.recordResearchRunIfConfigured.mockReset();
    mocks.recordResearchRunIfConfigured.mockResolvedValue({
      id: 'rrn_11111111111111111111111111111111',
      citations: [],
    });
    mocks.resolveModelFromRequest.mockRejectedValue(new Error('model unavailable'));
    mocks.searchWeb.mockResolvedValue({
      answer: '',
      sources: [
        {
          title: 'Official source for test query and supplied learning topic',
          url: 'https://docs.example.com/topic',
          content:
            'Grounded excerpt for test query, learn a topic from current external sources, and learn the supplied note.',
          score: 0.9,
        },
      ],
      query: 'test query',
      responseTime: 0.1,
    });
  });

  it('rejects client-controlled base URLs outside the provider allowlist (unmanaged provider)', async () => {
    // No server config ⇒ unmanaged ⇒ the client base URL is actually used, so it
    // must be validated against the allowlist.
    const res = await postWebSearch({
      query: 'test query',
      providerId: 'bocha',
      apiKey: 'bocha-client-key',
      baseUrl: 'http://127.0.0.1:3000/internal',
    });
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json).toMatchObject({
      success: false,
      errorCode: 'INVALID_REQUEST',
    });
    expect(mocks.searchWeb).not.toHaveBeenCalled();
  });

  it('ignores a client base URL for a managed (server-configured) provider', async () => {
    vi.stubEnv('BOCHA_API_KEY', 'bocha-server-key');

    // A managed provider is admin-owned: the client base URL (even an invalid
    // one) is dropped rather than rejected, and the server config is used.
    const res = await postWebSearch({
      query: 'test query',
      providerId: 'bocha',
      apiKey: 'bocha-client-key',
      baseUrl: 'http://127.0.0.1:3000/internal',
    });

    expect(res.status).toBe(200);
    expect(mocks.searchWeb).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: 'bocha',
        apiKey: 'bocha-server-key',
      }),
    );
  });

  it('uses server-configured base URL when no client base URL is supplied', async () => {
    vi.stubEnv('BOCHA_API_KEY', 'bocha-server-key');
    vi.stubEnv('BOCHA_BASE_URL', 'http://internal-proxy.local/bocha');

    const res = await postWebSearch({
      query: 'test query',
      providerId: 'bocha',
    });

    expect(res.status).toBe(200);
    expect(mocks.searchWeb).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: 'bocha',
        apiKey: 'bocha-server-key',
        baseUrl: 'http://internal-proxy.local/bocha',
      }),
    );
  });

  it('runs Brave Search without an API key', async () => {
    const res = await postWebSearch({
      query: 'test query',
      providerId: 'brave',
    });

    expect(res.status).toBe(200);
    expect(mocks.searchWeb).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: 'brave',
        apiKey: '',
      }),
    );
  });

  it('uses a supplied direct source before resolving a general search provider', async () => {
    mocks.fetchDirectSourcesFromRequirement.mockResolvedValue({
      answer: '',
      query: 'https://github.com/example/project',
      responseTime: 0.1,
      sources: [
        {
          title: 'example/project',
          url: 'https://github.com/example/project',
          content: 'A primary repository source with enough implementation detail for the learning plan.',
          score: 1,
          citationId: 'S1',
          authority: 'primary',
        },
      ],
    });

    const res = await postWebSearch({
      query: 'https://github.com/example/project',
      providerId: 'tavily',
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toMatchObject({ success: true, fallback: 'direct-url' });
    expect(mocks.searchWeb).not.toHaveBeenCalled();
    expect(mocks.resolveModelFromRequest).not.toHaveBeenCalled();
  });

  it('fails visibly instead of silently dropping requested external research', async () => {
    mocks.searchWeb.mockRejectedValueOnce(
      new WebSearchProviderError(
        'brave',
        'public-page',
        'rate_limited',
        429,
        true,
        60_000,
        'limited',
      ),
    );

    const res = await postWebSearch({
      query: 'learn the supplied note',
      pdfText: 'Trusted source material from an explicitly uploaded note.',
      providerId: 'brave',
    });
    const json = await res.json();

    expect(res.status).toBe(429);
    expect(json).toMatchObject({
      success: false,
      errorCode: 'RATE_LIMITED',
    });
    expect(json.details).toContain('brave/public-page/original:failed(429)');
    expect(mocks.recordResearchRunIfConfigured).not.toHaveBeenCalled();
    expect(mocks.formatSearchResultsAsContext).not.toHaveBeenCalled();
  });

  it('fails closed when search is the only requested source and it is rate limited', async () => {
    mocks.searchWeb.mockRejectedValueOnce(
      new WebSearchProviderError(
        'brave',
        'public-page',
        'rate_limited',
        429,
        true,
        60_000,
        'limited',
      ),
    );

    const res = await postWebSearch({
      query: 'learn a topic from current external sources',
      providerId: 'brave',
    });
    const json = await res.json();

    expect(res.status).toBe(429);
    expect(json).toMatchObject({
      success: false,
      errorCode: 'RATE_LIMITED',
    });
  });

  it('keeps a deep canonical project usable when external evidence is supplemental', async () => {
    mocks.searchWeb.mockResolvedValue({
      answer: '',
      sources: [
        {
          title: 'Unqualified ordinary page',
          url: 'https://example.com/private-project',
          content: 'private project overview',
          score: 0.9,
        },
      ],
      query: 'private project',
      responseTime: 0.1,
    });

    const res = await postWebSearch({
      query: '快速了解该项目',
      pdfText: `# Canonical private project\n${'React TypeScript FastAPI architecture. '.repeat(120)}`,
      providerId: 'brave',
      externalEvidenceMode: 'supplemental',
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toMatchObject({
      success: true,
      degraded: true,
      fallback: 'canonical-source',
      provenance: {
        providerId: 'unavailable',
        mode: 'unavailable',
        outcome: 'unavailable',
      },
    });
    expect(json.warning).toContain('内部原始资料');
  });

  it('still blocks when the learner marks external evidence as required', async () => {
    mocks.searchWeb.mockResolvedValue({
      answer: '',
      sources: [
        {
          title: 'Unqualified ordinary page',
          url: 'https://example.com/private-project',
          content: 'private project overview',
          score: 0.9,
        },
      ],
      query: 'private project',
      responseTime: 0.1,
    });

    const res = await postWebSearch({
      query: '快速了解该项目',
      pdfText: `# Canonical private project\n${'React TypeScript FastAPI architecture. '.repeat(120)}`,
      providerId: 'brave',
      externalEvidenceMode: 'required',
    });

    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json).toMatchObject({
      success: false,
      errorCode: 'NO_QUALIFYING_SOURCES',
    });
  });

  it('uses a user-supplied primary URL before public search can be rate limited', async () => {
    mocks.searchWeb.mockRejectedValueOnce(
      new WebSearchProviderError(
        'brave',
        'public-page',
        'rate_limited',
        429,
        true,
        60_000,
        'limited',
      ),
    );
    mocks.fetchDirectSourcesFromRequirement.mockResolvedValueOnce({
      answer: '',
      sources: [
        {
          title: 'The Regression Tax',
          url: 'https://arxiv.org/abs/2607.22520',
          content: 'Primary paper abstract and metadata.',
          score: 1,
          authority: 'primary',
          domain: 'arxiv.org',
          citationId: 'S1',
        },
      ],
      query: 'arXiv:2607.22520',
      responseTime: 0.2,
    });

    const res = await postWebSearch({
      query: 'study arXiv:2607.22520',
      providerId: 'brave',
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toMatchObject({
      success: true,
      fallback: 'direct-url',
      provenance: {
        providerId: 'direct-url',
        mode: 'direct-url',
      },
    });
    expect(json.degraded).toBeUndefined();
    expect(json.sources).toHaveLength(1);
    expect(mocks.searchWeb).not.toHaveBeenCalled();
    expect(mocks.fetchDirectSourcesFromRequirement).toHaveBeenCalledWith({
      requirement: 'study arXiv:2607.22520',
      sourcePolicy: 'prefer-primary',
    });
  });

  it('falls back to another managed provider after a retryable provider failure', async () => {
    vi.stubEnv('BRAVE_API_KEY', 'brave-server-key');
    vi.stubEnv('TAVILY_API_KEY', 'tavily-server-key');
    mocks.searchWeb
      .mockRejectedValueOnce(
        new WebSearchProviderError(
          'brave',
          'official-api',
          'rate_limited',
          429,
          true,
          60_000,
          'limited',
        ),
      )
      .mockResolvedValueOnce({
        answer: '',
        sources: [
          {
            title: 'Official fallback source for test query',
            url: 'https://www.nist.gov/fallback',
            content: 'Grounded fallback for test query',
            score: 0.8,
          },
        ],
        query: 'test query',
        responseTime: 0.2,
      });

    const res = await postWebSearch({ query: 'test query', providerId: 'brave' });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(mocks.searchWeb).toHaveBeenCalledTimes(2);
    expect(mocks.searchWeb.mock.calls[0][0].providerId).toBe('brave');
    expect(mocks.searchWeb.mock.calls[1][0].providerId).toBe('tavily');
    expect(json.provenance).toMatchObject({
      requestedProviderId: 'brave',
      providerId: 'tavily',
      researchRunId: 'rrn_11111111111111111111111111111111',
    });
  });

  it('passes Baidu sub-source toggles through to the dispatcher', async () => {
    vi.stubEnv('BAIDU_API_KEY', 'baidu-server-key');

    const res = await postWebSearch({
      query: 'test query',
      providerId: 'baidu',
      baiduSubSources: {
        webSearch: false,
        baike: true,
        scholar: false,
      },
    });

    expect(res.status).toBe(200);
    expect(mocks.searchWeb).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: 'baidu',
        apiKey: 'baidu-server-key',
        baiduSubSources: {
          webSearch: false,
          baike: true,
          scholar: false,
        },
      }),
    );
  });

  it('routes MiniMax web search through the dispatcher with server config', async () => {
    vi.stubEnv('WEB_SEARCH_MINIMAX_API_KEY', 'minimax-server-key');
    vi.stubEnv('WEB_SEARCH_MINIMAX_BASE_URL', 'https://api.minimaxi.com');

    const res = await postWebSearch({
      query: 'test query',
      providerId: 'minimax',
    });

    expect(res.status).toBe(200);
    expect(mocks.searchWeb).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: 'minimax',
        apiKey: 'minimax-server-key',
        baseUrl: 'https://api.minimaxi.com',
      }),
    );
  });

  it('prefers server-configured SearXNG over client-selected Brave', async () => {
    vi.stubEnv('SEARXNG_BASE_URL', 'http://192.168.161.100:6060');

    const res = await postWebSearch({
      query: 'test query',
      providerId: 'brave',
    });

    expect(res.status).toBe(200);
    expect(mocks.searchWeb).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: 'searxng',
        baseUrl: 'http://192.168.161.100:6060',
      }),
    );
  });

  it('routes SearXNG web search through the dispatcher with server base URL', async () => {
    vi.stubEnv('SEARXNG_BASE_URL', 'http://192.168.161.100:6060');

    const res = await postWebSearch({
      query: 'test query',
      providerId: 'searxng',
    });

    expect(res.status).toBe(200);
    expect(mocks.searchWeb).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: 'searxng',
        baseUrl: 'http://192.168.161.100:6060',
      }),
    );
  });

  it('rejects SearXNG requests without a configured base URL', async () => {
    const res = await postWebSearch({
      query: 'test query',
      providerId: 'searxng',
    });
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json).toMatchObject({
      success: false,
      errorCode: 'MISSING_REQUIRED_FIELD',
    });
    expect(json.error).toContain('SEARXNG_BASE_URL');
    expect(json.error).not.toContain('Settings');
    expect(mocks.searchWeb).not.toHaveBeenCalled();
  });

  it.each([
    'http://127.0.0.1:6060',
    'http://localhost:6060',
    'http://169.254.169.254',
    'http://192.168.161.100:6060',
  ])('ignores client-supplied SearXNG base URLs without server config (%s)', async (baseUrl) => {
    const res = await postWebSearch({
      query: 'test query',
      providerId: 'searxng',
      baseUrl,
    });

    expect(res.status).toBe(400);
    expect(mocks.searchWeb).not.toHaveBeenCalled();
  });

  it.each([
    'http://127.0.0.1:6060',
    'http://localhost:6060',
    'http://169.254.169.254',
    'http://10.0.0.5:6060',
  ])(
    'uses operator-configured SearXNG URL and ignores client-supplied base URL (%s)',
    async (clientBaseUrl) => {
      vi.stubEnv('SEARXNG_BASE_URL', 'http://192.168.161.100:6060');

      const res = await postWebSearch({
        query: 'test query',
        providerId: 'searxng',
        baseUrl: clientBaseUrl,
      });

      expect(res.status).toBe(200);
      expect(mocks.searchWeb).toHaveBeenCalledWith(
        expect.objectContaining({
          providerId: 'searxng',
          baseUrl: 'http://192.168.161.100:6060',
        }),
      );
    },
  );
});
