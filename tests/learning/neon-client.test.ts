import { describe, expect, it, vi } from 'vitest';

import {
  createPreTlsRetryingFetch,
  isSafePreTlsRetry,
} from '@/lib/learning/adapters/neon/client';

describe('Neon pre-TLS retry boundary', () => {
  it('retries only a connection reset that occurred before TLS', async () => {
    const error = Object.assign(
      new Error('fetch failed', {
        cause: Object.assign(
          new Error('Client network socket disconnected before secure TLS connection was established'),
          { code: 'ECONNRESET' },
        ),
      }),
      { code: 'ECONNRESET' },
    );
    const fetcher = vi
      .fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce(new Response('ok'));
    const sleep = vi.fn().mockResolvedValue(undefined);

    const response = await createPreTlsRetryingFetch(fetcher, sleep)('https://neon.example/sql');

    expect(await response.text()).toBe('ok');
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it('does not retry an ambiguous application or database failure', async () => {
    const error = Object.assign(new Error('duplicate key value violates unique constraint'), {
      code: '23505',
    });
    const fetcher = vi
      .fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
      .mockRejectedValueOnce(error);
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(createPreTlsRetryingFetch(fetcher, sleep)('https://neon.example/sql')).rejects.toBe(
      error,
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
    expect(isSafePreTlsRetry(error)).toBe(false);
  });
});
