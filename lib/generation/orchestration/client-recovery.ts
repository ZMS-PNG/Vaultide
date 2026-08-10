export const COURSE_JOB_TRANSPORT_RECOVERY_DELAY_MS = 2_500;
export const COURSE_JOB_ADVANCE_COOLDOWN_MS = 30_000;

const TRANSIENT_FETCH_MESSAGE =
  /failed to fetch|fetch failed|network(?:error| request failed)|load failed|connection (?:closed|reset)|internet disconnected/iu;

/**
 * A durable course job must outlive the browser connection that triggered it.
 * Embedded browsers can drop a long-running fetch while Vercel continues and
 * commits the generation step. Only transport-level failures are recoverable;
 * explicit HTTP and quality errors must still surface to the learner.
 */
export function isTransientCourseJobTransportError(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  return TRANSIENT_FETCH_MESSAGE.test(message);
}
