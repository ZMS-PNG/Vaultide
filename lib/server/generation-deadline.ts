export const GENERATION_STEP_DEADLINE_MS = 225_000;

export interface GenerationDeadline {
  signal: AbortSignal;
  didTimeout: () => boolean;
  run: <T>(operation: Promise<T>) => Promise<T>;
  dispose: () => void;
}

/**
 * Give the durable worker enough time to persist a retryable failure before
 * Vercel's outer 300 second invocation limit terminates the process.
 */
export function createGenerationDeadline(
  parentSignal?: AbortSignal,
  timeoutMs = GENERATION_STEP_DEADLINE_MS,
): GenerationDeadline {
  const controller = new AbortController();
  let timedOut = false;
  const timeoutWaiters = new Set<(error: Error) => void>();

  const abortFromParent = () => {
    if (!controller.signal.aborted) {
      controller.abort(parentSignal?.reason);
    }
  };

  if (parentSignal?.aborted) {
    abortFromParent();
  } else {
    parentSignal?.addEventListener('abort', abortFromParent, { once: true });
  }

  const timer = setTimeout(
    () => {
      timedOut = true;
      const error = new Error('Generation step deadline exceeded.');
      error.name = 'GenerationDeadlineExceededError';
      if (!controller.signal.aborted) {
        controller.abort(new DOMException('Generation step deadline exceeded.', 'TimeoutError'));
      }
      for (const reject of timeoutWaiters) reject(error);
      timeoutWaiters.clear();
    },
    Math.max(1, timeoutMs),
  );
  timer.unref?.();

  return {
    signal: controller.signal,
    didTimeout: () => timedOut,
    run: <T>(operation: Promise<T>) => {
      if (timedOut) {
        return Promise.reject(new Error('Generation step deadline exceeded.'));
      }
      return new Promise<T>((resolve, reject) => {
        const rejectOnTimeout = (error: Error) => reject(error);
        timeoutWaiters.add(rejectOnTimeout);
        operation.then(resolve, reject).finally(() => timeoutWaiters.delete(rejectOnTimeout));
      });
    },
    dispose: () => {
      clearTimeout(timer);
      timeoutWaiters.clear();
      parentSignal?.removeEventListener('abort', abortFromParent);
    },
  };
}
