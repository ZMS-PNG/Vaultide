import { describe, expect, it, vi } from 'vitest';
import { discoverOfficialSources } from '@/lib/server/official-source-discovery';

describe('official source discovery fallback', () => {
  it('discovers current arXiv papers from the official Atom API', async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request) =>
      new Response(
        `<?xml version="1.0"?>
        <feed xmlns="http://www.w3.org/2005/Atom">
          <entry>
            <id>http://arxiv.org/abs/2607.12345v1</id>
            <title>Reliable Code Agents with Verifiable Execution</title>
            <published>2026-07-29T00:00:00Z</published>
            <summary>${'A source-grounded study of code agents, verification, execution traces, and reproducible evaluation. '.repeat(3)}</summary>
            <author><name>Researcher One</name></author>
          </entry>
        </feed>`,
        { status: 200, headers: { 'content-type': 'application/atom+xml' } },
      ),
    );
    const fetcher = fetchMock as unknown as typeof fetch;

    const discovered = await discoverOfficialSources(
      'latest paper about reliable code agents and verification',
      fetcher,
    );

    expect(discovered?.providerId).toBe('arxiv-official');
    expect(discovered?.result.sources[0]).toMatchObject({
      authority: 'primary',
      domain: 'arxiv.org',
      url: 'https://arxiv.org/abs/2607.12345v1',
    });
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('sortBy=submittedDate');
  });

  it('discovers GitHub repositories and enriches them with the official README endpoint', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/search/repositories')) {
        return new Response(
          JSON.stringify({
            items: [
              {
                full_name: 'example/reliable-agent',
                html_url: 'https://github.com/example/reliable-agent',
                description: 'A reliable agent workflow implementation.',
                stargazers_count: 1200,
                forks_count: 80,
                language: 'TypeScript',
                topics: ['agents', 'verification'],
                updated_at: '2026-07-30T00:00:00Z',
                default_branch: 'main',
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response(
        `# Reliable Agent\n\n${'This README explains the architecture, durable state machine, verification gates, recovery semantics, and deployment workflow. '.repeat(8)}`,
        { status: 200 },
      );
    });
    const fetcher = fetchMock as unknown as typeof fetch;

    const discovered = await discoverOfficialSources(
      'valuable GitHub repository for reliable agent workflows',
      fetcher,
    );

    expect(discovered?.providerId).toBe('github-official');
    expect(discovered?.result.sources[0]).toMatchObject({
      title: 'example/reliable-agent README',
      authority: 'primary',
      domain: 'raw.githubusercontent.com',
    });
    expect(discovered?.result.sources.some((source) => source.content.includes('durable state machine'))).toBe(true);
    expect(discovered?.result.sources[0]?.content).toContain('\n\n');
    // README-only repositories trigger one bounded documentation-index lookup.
    // A non-JSON/mock response is safely ignored, leaving the README usable.
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('uses an explicitly named owner/repository as the official source target', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/repos/microsoft/markitdown/readme')) {
        return new Response(
          `# MarkItDown\n\n${'This README explains conversion boundaries, extension points, input safety, and verification for document-to-Markdown workflows. '.repeat(8)}`,
          { status: 200 },
        );
      }
      if (url.includes('/repos/microsoft/markitdown')) {
        return new Response(
          JSON.stringify({
            full_name: 'microsoft/markitdown',
            html_url: 'https://github.com/microsoft/markitdown',
            description: 'A document conversion tool.',
            stargazers_count: 5000,
            forks_count: 300,
            language: 'Python',
            topics: ['markdown', 'conversion'],
            updated_at: '2026-08-01T00:00:00Z',
            default_branch: 'main',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response('Not found', { status: 404 });
    });

    const discovered = await discoverOfficialSources(
      'Learn GitHub project microsoft/markitdown and its conversion pipeline.',
      fetchMock as unknown as typeof fetch,
    );

    expect(discovered?.providerId).toBe('github-official');
    expect(discovered?.result.query).toBe('microsoft/markitdown');
    expect(discovered?.result.sources).toHaveLength(1);
    expect(discovered?.result.sources[0]?.url).toBe(
      'https://raw.githubusercontent.com/microsoft/markitdown/main/README.md',
    );
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/search/repositories'))).toBe(false);
  });

  it('expands a GitHub README into linked primary setup and architecture documents', async () => {
    const body = (topic: string) => `# ${topic}\n\n${`This official ${topic} document explains the concrete mechanism, operational constraint, verification evidence, and recovery decision for a production workflow. `.repeat(5)}`;
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/repos/example/learning-repo/readme')) {
        return new Response(
          [
            '# Learning Repo',
            'Read [Quick Start](https://github.com/example/learning-repo/blob/main/docs/setup/quick-start.mdx).',
            'Read [Architecture](https://github.com/example/learning-repo/blob/main/docs/introduction/architecture.mdx).',
            body('README'),
          ].join('\n\n'),
          { status: 200 },
        );
      }
      if (url.includes('/repos/example/learning-repo')) {
        return new Response(
          JSON.stringify({
            full_name: 'example/learning-repo',
            html_url: 'https://github.com/example/learning-repo',
            default_branch: 'main',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (url.includes('quick-start.mdx')) return new Response(body('Quick Start'), { status: 200 });
      if (url.includes('architecture.mdx')) return new Response(body('Architecture'), { status: 200 });
      return new Response('Not found', { status: 404 });
    });

    const discovered = await discoverOfficialSources(
      'Learn GitHub project example/learning-repo with its setup and architecture.',
      fetchMock as unknown as typeof fetch,
    );

    expect(discovered?.providerId).toBe('github-official');
    expect(discovered?.result.sources).toHaveLength(3);
    expect(discovered?.result.sources.map((source) => source.title)).toEqual(
      expect.arrayContaining([
        'example/learning-repo README',
        'example/learning-repo · quick-start.mdx',
        'example/learning-repo · architecture.mdx',
      ]),
    );
    expect(discovered?.result.sources.every((source) => source.authority === 'primary')).toBe(true);
  });

  it('does not promote a short linked agent prompt into a classroom source', async () => {
    const readme = [
      '# Learning Repo',
      'Read [Create](https://github.com/example/learning-repo/blob/main/create.md).',
      `${'This README explains the workflow architecture, safe configuration, verification evidence, and recovery decision. '.repeat(8)}`,
    ].join('\n\n');
    const agentPrompt = [
      '# Create',
      `${'This prompt guides you, a coding agent, to create or update workflows. Check the CLI version before continuing. '.repeat(8)}`,
    ].join('\n\n');
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/repos/example/learning-repo/readme')) return new Response(readme, { status: 200 });
      if (url.includes('/repos/example/learning-repo')) {
        return new Response(
          JSON.stringify({
            full_name: 'example/learning-repo',
            html_url: 'https://github.com/example/learning-repo',
            default_branch: 'main',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (url.includes('/create.md')) return new Response(agentPrompt, { status: 200 });
      return new Response('Not found', { status: 404 });
    });

    const discovered = await discoverOfficialSources(
      'Learn GitHub project example/learning-repo and create a safe workflow.',
      fetchMock as unknown as typeof fetch,
    );

    expect(agentPrompt.length).toBeGreaterThan(600);
    expect(discovered?.result.sources).toHaveLength(1);
    expect(discovered?.result.sources[0]?.title).toBe('example/learning-repo README');
  });

  it('keeps official CLI and operations evidence when a linked prompt is discarded after retrieval', async () => {
    const body = (topic: string) => `# ${topic}\n\n${`This official ${topic} document explains a concrete command, verification record, recovery decision, and operational constraint for a production workflow. `.repeat(7)}`;
    const readme = [
      '# Learning Repo',
      'Read [Architecture](https://github.com/example/learning-repo/blob/main/docs/architecture.mdx).',
      'Read [How it works](https://github.com/example/learning-repo/blob/main/docs/how-they-work.mdx).',
      'Read [Quick Start](https://github.com/example/learning-repo/blob/main/docs/quick-start.mdx).',
      'Read [CLI](https://github.com/example/learning-repo/blob/main/docs/reference/cli.mdx).',
      'Read [Operations](https://github.com/example/learning-repo/blob/main/docs/operations/monitoring.mdx).',
      'Read [Create](https://github.com/example/learning-repo/blob/main/create.md).',
      body('README'),
    ].join('\n\n');
    const agentPrompt = `# Create\n\n${'This prompt guides you, a coding agent, to create workflows. '.repeat(20)}`;
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/repos/example/learning-repo/readme')) return new Response(readme, { status: 200 });
      if (url.includes('/repos/example/learning-repo')) {
        return new Response(JSON.stringify({
          full_name: 'example/learning-repo',
          html_url: 'https://github.com/example/learning-repo',
          default_branch: 'main',
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url.includes('/create.md')) return new Response(agentPrompt, { status: 200 });
      if (/architecture|how-they-work|quick-start|cli|monitoring/.test(url)) return new Response(body(url.split('/').at(-1) ?? 'Doc'), { status: 200 });
      return new Response('Not found', { status: 404 });
    });

    const discovered = await discoverOfficialSources(
      'Learn GitHub project example/learning-repo with setup, CLI verification, and recovery operations.',
      fetchMock as unknown as typeof fetch,
    );

    const titles = discovered?.result.sources.map((source) => source.title) ?? [];
    expect(titles.some((title) => title.endsWith('cli.mdx'))).toBe(true);
    expect(titles.some((title) => title.endsWith('monitoring.mdx'))).toBe(true);
    expect(titles.some((title) => title.includes('create.md'))).toBe(false);
    expect(discovered?.result.sources).toHaveLength(6);
  });

  it('fills missing verification and recovery lanes from the repository documentation tree', async () => {
    const body = (topic: string) => `# ${topic}\n\n${`This official ${topic} document defines a concrete mechanism, required input, verification signal, and recovery decision for a production workflow. `.repeat(8)}`;
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/repos/example/indexed-repo/readme')) {
        return new Response([
          '# Indexed Repo',
          'Read [Architecture](https://github.com/example/indexed-repo/blob/main/docs/architecture.mdx).',
          'Read [How it works](https://github.com/example/indexed-repo/blob/main/docs/how-they-work.mdx).',
          'Read [Quick Start](https://github.com/example/indexed-repo/blob/main/docs/quick-start.mdx).',
          body('README'),
        ].join('\n\n'), { status: 200 });
      }
      if (url.includes('/repos/example/indexed-repo/git/trees/main')) {
        return new Response(JSON.stringify({
          truncated: false,
          tree: [
            { type: 'blob', path: 'docs/architecture.mdx' },
            { type: 'blob', path: 'docs/how-they-work.mdx' },
            { type: 'blob', path: 'docs/quick-start.mdx' },
            { type: 'blob', path: 'docs/setup/cli.mdx' },
            { type: 'blob', path: 'docs/troubleshooting/common-issues.md' },
            { type: 'blob', path: 'docs/troubleshooting/schema-validation.md' },
            { type: 'blob', path: 'docs/experimental/monitoring-pattern.md' },
            { type: 'blob', path: 'docs/reference/command-triggers.md' },
            { type: 'blob', path: '.github/aw/agent-prompt.md' },
          ],
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url.includes('/repos/example/indexed-repo')) {
        return new Response(JSON.stringify({
          full_name: 'example/indexed-repo',
          html_url: 'https://github.com/example/indexed-repo',
          default_branch: 'main',
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (/architecture|how-they-work|quick-start|cli|common-issues|validation|monitoring|command-triggers/.test(url)) {
        return new Response(body(url.split('/').at(-1) ?? 'Doc'), { status: 200 });
      }
      return new Response('Not found', { status: 404 });
    });

    const discovered = await discoverOfficialSources(
      'Learn GitHub project example/indexed-repo with runnable setup, CLI verification, and recovery.',
      fetchMock as unknown as typeof fetch,
    );

    const titles = discovered?.result.sources.map((source) => source.title) ?? [];
    expect(titles.some((title) => title.endsWith('cli.mdx'))).toBe(true);
    expect(titles.some((title) => title.endsWith('common-issues.md'))).toBe(true);
    expect(titles.some((title) => title.endsWith('schema-validation.md'))).toBe(false);
    expect(titles.some((title) => title.endsWith('monitoring-pattern.md'))).toBe(false);
    expect(titles.some((title) => title.includes('agent-prompt.md'))).toBe(false);
    expect(discovered?.result.sources).toHaveLength(6);
  });

  it('does not broaden an unrelated internal-project request into web discovery', async () => {
    const fetchMock = vi.fn();
    const fetcher = fetchMock as unknown as typeof fetch;
    const discovered = await discoverOfficialSources('理解内部系统状态迁移', fetcher);

    expect(discovered).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
