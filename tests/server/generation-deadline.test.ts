import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createGenerationDeadline,
  GENERATION_STEP_DEADLINE_MS,
} from '@/lib/server/generation-deadline';

describe('generation deadline', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('aborts before the outer function deadline and marks a timeout', async () => {
    vi.useFakeTimers();
    const deadline = createGenerationDeadline(undefined, 225);
    const neverSettles = deadline.run(new Promise<string>(() => undefined));
    let observedError: unknown;
    const observeRejection = neverSettles.catch((error) => {
      observedError = error;
    });

    await vi.advanceTimersByTimeAsync(224);
    expect(deadline.signal.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await observeRejection;
    expect(deadline.signal.aborted).toBe(true);
    expect(deadline.didTimeout()).toBe(true);
    expect(observedError).toBeInstanceOf(Error);
    expect((observedError as Error).message).toBe('Generation step deadline exceeded.');
    deadline.dispose();
  });

  it('propagates a parent abort without classifying it as an internal timeout', () => {
    vi.useFakeTimers();
    const parent = new AbortController();
    const deadline = createGenerationDeadline(parent.signal, 225);

    parent.abort(new DOMException('Client disconnected.', 'AbortError'));

    expect(deadline.signal.aborted).toBe(true);
    expect(deadline.didTimeout()).toBe(false);
    deadline.dispose();
  });

  it('keeps a 75 second persistence reserve inside Vercel Hobby limits', () => {
    expect(GENERATION_STEP_DEADLINE_MS).toBe(225_000);
    expect(300_000 - GENERATION_STEP_DEADLINE_MS).toBeGreaterThanOrEqual(60_000);
  });
});
