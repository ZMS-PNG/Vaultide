import { describe, expect, it } from 'vitest';
import { normalizeAndRankWebSearchSources } from '@/lib/web-search/source-quality';

describe('web search source quality', () => {
  it('recognizes official framework documentation hosts at their root URLs', () => {
    const result = normalizeAndRankWebSearchSources(
      [
        {
          title: 'Vite official documentation',
          url: 'https://vite.dev/',
          content: 'Vite build tool official documentation and architecture.',
          score: 0.9,
        },
        {
          title: 'FastAPI official documentation',
          url: 'https://fastapi.tiangolo.com/',
          content: 'FastAPI official API documentation.',
          score: 0.9,
        },
      ],
      'prefer-primary',
      'Vite FastAPI official documentation architecture',
    );

    expect(result).toHaveLength(2);
    expect(result.every((source) => source.authority === 'authoritative')).toBe(true);
  });

  it('canonicalizes, deduplicates, and prioritizes primary sources', () => {
    const sources = normalizeAndRankWebSearchSources(
      [
        {
          title: 'Commentary',
          url: 'https://blog.example.com/post?utm_source=test',
          content: 'secondary',
          score: 0.99,
        },
        {
          title: 'NIST publication',
          url: 'https://www.nist.gov/publication#section',
          content: 'primary',
          score: 0.5,
        },
        {
          title: 'Duplicate commentary',
          url: 'https://blog.example.com/post',
          content: 'duplicate',
          score: 0.1,
        },
      ],
      'prefer-primary',
    );

    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({
      citationId: 'S1',
      domain: 'nist.gov',
      authority: 'primary',
    });
    expect(sources.some((source) => source.authority === 'general')).toBe(false);
  });

  it('removes sources that do not overlap the requested learning topic', () => {
    const sources = normalizeAndRankWebSearchSources(
      [
        {
          title: '请 - Wiktionary',
          url: 'https://en.wiktionary.org/wiki/%E8%AF%B7',
          content: 'Chinese character translation and pronunciation.',
          score: 0.99,
        },
        {
          title: '异步任务队列设计',
          url: 'https://docs.example.com/async-task-queues',
          content: '异步任务系统、重试、幂等性与故障恢复。',
          score: 0.7,
        },
      ],
      'prefer-primary',
      '异步任务系统 重试 幂等性',
    );

    expect(sources).toHaveLength(1);
    expect(sources[0].title).toBe('异步任务队列设计');
  });

  it('rejects low-score authority pages that only weakly overlap the topic', () => {
    const sources = normalizeAndRankWebSearchSources(
      [
        {
          title: 'Behavioral science for health',
          url: 'https://apps.who.int/example.pdf',
          content: 'General behavioral science evidence and practice guidance.',
          score: 0.02,
        },
      ],
      'prefer-primary',
      'active recall and spaced repetition cognitive science evidence practice',
    );

    expect(sources).toHaveLength(0);
  });

  it('accepts a high-score primary source across a language boundary', () => {
    const sources = normalizeAndRankWebSearchSources(
      [
        {
          title: 'Retrieval practice produces more learning than elaborative studying',
          url: 'https://pubmed.ncbi.nlm.nih.gov/21252317/',
          content: 'A peer-reviewed study of retrieval practice and long-term learning.',
          score: 0.82,
        },
      ],
      'prefer-primary',
      '主动回忆与间隔重复的认知科学证据',
    );

    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({ authority: 'primary' });
  });

  it('treats a GitHub repository as the primary source for that repository', () => {
    const sources = normalizeAndRankWebSearchSources(
      [
        {
          title: 'openai/codex',
          url: 'https://github.com/openai/codex',
          content: 'Codex CLI is a coding agent that runs locally in the terminal.',
          score: 0.71,
        },
      ],
      'prefer-primary',
      'openai codex github repository architecture',
    );

    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({ domain: 'github.com', authority: 'primary' });
  });
});
