import { describe, expect, it } from 'vitest';
import { parseRetryAfterMs, webSearchResponseError } from '@/lib/web-search/provider-error';

describe('web search provider errors', () => {
  it('parses Retry-After and Brave reset headers', () => {
    expect(parseRetryAfterMs(new Headers({ 'retry-after': '2' }), 0)).toBe(2_000);
    expect(parseRetryAfterMs(new Headers({ 'x-ratelimit-reset': '1, 1200' }), 0)).toBe(1_000);
  });

  it('does not reflect an upstream HTML error page', async () => {
    const error = await webSearchResponseError({
      providerId: 'brave',
      mode: 'public-page',
      response: new Response('<!doctype html><script>secret()</script>', { status: 429 }),
    });

    expect(error.kind).toBe('rate_limited');
    expect(error.message).toContain('Brave public-page search was rate limited');
    expect(error.message).not.toContain('doctype');
    expect(error.message).not.toContain('secret');
  });
});
