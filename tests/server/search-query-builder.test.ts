import { describe, expect, it, vi } from 'vitest';
import { buildSearchQuery } from '@/lib/server/search-query-builder';

const genericGoal =
  '请基于这些资料，先诊断我目前的理解，再循序渐进地讲解，并安排主动回忆与实践练习。';

const sourceText = `--- SOURCE: Projects/异步任务系统实战.md ---
# 异步任务系统实战：从诊断到排障
## 重试、幂等性与死信队列
正文内容`;

describe('search query builder', () => {
  it('uses source topics instead of a generic teaching instruction when rewrite is unavailable', async () => {
    const result = await buildSearchQuery(genericGoal, sourceText);

    expect(result.query).toContain('异步任务系统');
    expect(result.query).toContain('重试');
    expect(result.query).not.toContain('请基于这些资料');
  });

  it('rejects an AI rewrite that loses the supplied source topic', async () => {
    const aiCall = vi.fn().mockResolvedValue('{"query":"请 Chinese translation"}');
    const result = await buildSearchQuery(genericGoal, sourceText, aiCall);

    expect(result.query).toContain('异步任务系统');
    expect(result.query).not.toContain('Chinese translation');
  });

  it('keeps a concise direct topic request when no source material is supplied', async () => {
    const result = await buildSearchQuery('学习 PostgreSQL 索引优化', undefined);

    expect(result.query).toBe('学习 PostgreSQL 索引优化');
    expect(result.rewriteAttempted).toBe(false);
  });

  it('rewrites a concise natural-language learning goal into a focused research query', async () => {
    const aiCall = vi
      .fn()
      .mockResolvedValue(
        '{"query":"RAG reranking retrieval augmented generation evaluation latency"}',
      );

    const result = await buildSearchQuery(
      '我想理解 RAG 的核心流程，比较朴素 RAG 与重排 RAG 的取舍，并设计一个可验证的小实验。',
      undefined,
      aiCall,
    );

    expect(result.rewriteAttempted).toBe(true);
    expect(result.query).toBe('RAG reranking retrieval augmented generation evaluation latency');
    expect(aiCall).toHaveBeenCalledTimes(1);
  });

  it('turns a GitHub repository URL into a compact official-source query', async () => {
    const result = await buildSearchQuery(
      '以 https://github.com/openai/codex 为外部项目，学习其架构与执行流程。',
      undefined,
    );

    expect(result.query).toBe(
      'openai/codex GitHub repository official README documentation architecture',
    );
    expect(result.rewriteAttempted).toBe(false);
  });

  it('turns a vague private-project goal into public technology concepts without an LLM', async () => {
    const projectText = `--- SOURCE: private/YUNS/MANUAL.md ---
# YUNS 智慧农业平台
采用 React 19、TypeScript、Vite 6、Capacitor 与 FastAPI。
系统包含无人机任务管理、天气监测和病虫害图像识别。`;
    const aiCall = vi.fn();

    const result = await buildSearchQuery('快速了解该项目', projectText, aiCall);

    expect(result.query).toContain('React');
    expect(result.query).toContain('FastAPI');
    expect(result.query).toContain('smart agriculture');
    expect(result.query).toContain('official documentation');
    expect(result.query).not.toContain('快速了解该项目');
    expect(result.query).not.toContain('private/YUNS');
    expect(result.rewriteAttempted).toBe(false);
    expect(aiCall).not.toHaveBeenCalled();
  });
});
