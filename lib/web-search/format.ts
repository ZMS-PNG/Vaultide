import type { WebSearchResult } from '@/lib/types/web-search';

// The course planner freezes the formatted context as its auditable evidence
// set. Six primary repository documents at 7k characters each fit inside the
// 44k source budget (including Markdown labels), while the previous 24k cap
// silently dropped CLI and recovery documents after the first four sources.
const MAX_CITABLE_SOURCE_CHARS = 42_000;
const MAX_CHARS_PER_CITABLE_SOURCE = 7_000;

/**
 * Format search results into a markdown context block for LLM prompts.
 */
export function formatSearchResultsAsContext(result: WebSearchResult): string {
  if (!result.answer && result.sources.length === 0) {
    return '';
  }

  const lines: string[] = [];

  if (result.answer) {
    lines.push('Search-provider summary (verify every claim against the cited sources):');
    lines.push(result.answer.slice(0, 2_000));
    lines.push('');
  }

  if (result.sources.length > 0) {
    lines.push(
      'Citable sources (prefer primary/authoritative entries; preserve citation labels in teaching content):',
    );
    // Scene generation keeps this evidence available throughout the course.
    // A 1,200-character search snippet is not enough to teach a repository,
    // paper, or technical system with benchmark depth.
    let remainingCharacters = MAX_CITABLE_SOURCE_CHARS;
    for (const [index, src] of result.sources.entries()) {
      if (remainingCharacters <= 0) break;
      const citationId = src.citationId ?? `S${index + 1}`;
      const quality = src.authority ? `; quality=${src.authority}` : '';
      const excerpt = src.content.slice(0, Math.min(MAX_CHARS_PER_CITABLE_SOURCE, remainingCharacters));
      lines.push(
        `- [${citationId}] [${src.title}](${src.url})${quality}: ${excerpt || '(no excerpt returned)'}`,
      );
      remainingCharacters -= excerpt.length;
    }
  }

  return lines.join('\n');
}
