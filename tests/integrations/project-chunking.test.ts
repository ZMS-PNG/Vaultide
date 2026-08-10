import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  chunkMarkdownSource,
  deterministicProjectChunkId,
  projectSearchTerms,
  projectTsQuery,
} from '@/lib/learning/domain/project-retrieval';

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

describe('project Markdown chunking', () => {
  it('covers the exact UTF-16 source without gaps and ignores headings inside code fences', () => {
    const content = [
      '# Architecture',
      '',
      'The real overview.',
      '',
      '```md',
      '# Not a real heading',
      '```',
      '',
      '## Data flow',
      '',
      '输入经过检索后进入课堂。',
    ].join('\n');
    const chunks = chunkMarkdownSource({
      content,
      title: 'Architecture',
      relativePath: 'Project/Architecture.md',
    });

    expect(chunks.map((chunk) => content.slice(chunk.startChar, chunk.endChar)).join('')).toBe(
      content,
    );
    expect(chunks[0]?.headingPath).toEqual(['Architecture']);
    expect(chunks.flatMap((chunk) => chunk.headingPath)).not.toContain('Not a real heading');
    for (const chunk of chunks) {
      expect(chunk.charCount).toBe(chunk.endChar - chunk.startChar);
      expect(chunk.contentHash).toBe(
        sha256(content.slice(chunk.startChar, chunk.endChar)),
      );
    }
  });

  it('bounds very large notes while preserving every character', () => {
    const content = Array.from(
      { length: 500 },
      (_, index) => `## Section ${index}\n\n${'项目数据流 '.repeat(20)}\n`,
    ).join('\n');
    const chunks = chunkMarkdownSource({
      content,
      title: 'Large project',
      relativePath: 'Project/Large.md',
    });

    expect(chunks.length).toBeGreaterThan(1);
    expect(Math.max(...chunks.map((chunk) => chunk.charCount))).toBeLessThanOrEqual(6_000);
    expect(chunks.map((chunk) => content.slice(chunk.startChar, chunk.endChar)).join('')).toBe(
      content,
    );
  });

  it('builds deterministic bilingual search terms and chunk ids', () => {
    const goal = '我想理解项目的数据流、缓存失效和 retrieval pipeline';
    const terms = projectSearchTerms(goal);
    const query = projectTsQuery(goal);
    expect(terms).toEqual(expect.arrayContaining(['数据', '数据流', 'retrieval', 'pipeline']));
    expect(query).toContain("'数据流'");
    expect(query).not.toContain('&');

    const options = {
      sourceId: `sou_${'a'.repeat(32)}`,
      sourceContentHash: 'b'.repeat(64),
      ordinal: 2,
      chunkContentHash: 'c'.repeat(64),
    };
    expect(deterministicProjectChunkId(options)).toBe(
      deterministicProjectChunkId(options),
    );
    expect(deterministicProjectChunkId(options)).toMatch(/^chk_[a-f0-9]{32}$/);
  });
});
