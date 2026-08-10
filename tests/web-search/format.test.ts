import { describe, expect, it } from 'vitest';
import { formatSearchResultsAsContext } from '@/lib/web-search/format';

describe('formatSearchResultsAsContext', () => {
  it('preserves all six bounded primary sources for the durable course planner', () => {
    const result = formatSearchResultsAsContext({
      answer: '',
      query: 'repository quality audit',
      responseTime: 0,
      sources: Array.from({ length: 6 }, (_, index) => ({
        citationId: `S${index + 1}`,
        title: `Official document ${index + 1}`,
        url: `https://docs.example.com/${index + 1}`,
        authority: 'primary' as const,
        content: `${'evidence '.repeat(700)}END-${index + 1}`,
        score: 1,
      })),
    });

    for (let index = 1; index <= 6; index += 1) {
      expect(result).toContain(`[S${index}]`);
      expect(result).toContain(`END-${index}`);
    }
    expect(result.length).toBeLessThan(44_000);
  });
});
