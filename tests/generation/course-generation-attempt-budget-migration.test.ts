import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function migration(name: string): string {
  return readFileSync(resolve('db/migrations/learning', name), 'utf8').replace(/\r\n/gu, '\n');
}

describe('course generation attempt budget migrations', () => {
  it('keeps max attempts, step counters, and attempt numbers on the same upper bound', () => {
    const maxAttempts = migration('0029_course_generation_timeout_recovery.sql');
    const counters = migration('0030_course_generation_attempt_budget.sql');

    expect(maxAttempts).toContain('CHECK (max_attempts BETWEEN 1 AND 15)');
    expect(counters).toContain('CHECK (attempt_count BETWEEN 0 AND 15)');
    expect(counters).toContain('CHECK (attempt_no BETWEEN 1 AND 15)');
  });
});
