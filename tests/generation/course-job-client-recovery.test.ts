import { describe, expect, it } from 'vitest';
import {
  COURSE_JOB_ADVANCE_COOLDOWN_MS,
  COURSE_JOB_TRANSPORT_RECOVERY_DELAY_MS,
  isTransientCourseJobTransportError,
} from '@/lib/generation/orchestration/client-recovery';

describe('durable course job browser recovery', () => {
  it('recovers Obsidian and browser transport failures', () => {
    expect(isTransientCourseJobTransportError(new TypeError('Failed to fetch'))).toBe(true);
    expect(
      isTransientCourseJobTransportError(new Error('NetworkError when attempting fetch')),
    ).toBe(true);
    expect(isTransientCourseJobTransportError('connection reset')).toBe(true);
  });

  it('does not conceal explicit server or quality failures', () => {
    expect(
      isTransientCourseJobTransportError(
        new Error('Scene did not meet the quality contract: architecture'),
      ),
    ).toBe(false);
    expect(isTransientCourseJobTransportError(new Error('Course generation job failed.'))).toBe(
      false,
    );
  });

  it('uses a read-only recovery window long enough to avoid an advance request storm', () => {
    expect(COURSE_JOB_TRANSPORT_RECOVERY_DELAY_MS).toBeGreaterThanOrEqual(2_000);
    expect(COURSE_JOB_ADVANCE_COOLDOWN_MS).toBeGreaterThanOrEqual(10_000);
    expect(COURSE_JOB_ADVANCE_COOLDOWN_MS).toBeGreaterThan(COURSE_JOB_TRANSPORT_RECOVERY_DELAY_MS);
  });
});
