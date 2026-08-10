import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('durable course workflow migration', () => {
  it('persists workflow identity, status, phase, and terminal timestamps', () => {
    const sql = readFileSync(
      resolve('db/migrations/learning/0032_course_workflow_orchestration.sql'),
      'utf8',
    ).replace(/\r\n/gu, '\n');

    expect(sql).toContain('workflow_run_id');
    expect(sql).toContain('workflow_status');
    expect(sql).toContain('workflow_phase');
    expect(sql).toContain('workflow_started_at');
    expect(sql).toContain('workflow_completed_at');
    expect(sql).toContain("'preflight', 'research', 'outline', 'content', 'actions', 'release'");
  });

  it('types values passed through polymorphic jsonb builders', () => {
    const planningRepository = readFileSync(
      resolve('lib/generation/planning/repository.ts'),
      'utf8',
    ).replace(/\r\n/gu, '\n');
    const orchestrationRepository = readFileSync(
      resolve('lib/generation/orchestration/repository.ts'),
      'utf8',
    ).replace(/\r\n/gu, '\n');

    // PostgreSQL cannot infer the type of a bind parameter used only as a
    // variadic jsonb_build_object value. Keep the production research-freeze
    // and job-create queries explicit so Workflow steps do not fail with
    // SQLSTATE 42P18 after completing expensive model work.
    expect(planningRepository).toContain("'externalEvidenceStatus', $3::text");
    expect(planningRepository).toContain("'planningRunId', $2::text");
    expect(orchestrationRepository).toContain("'classroomId', $3::text");
    expect(orchestrationRepository).toContain("'planningRunId', $4::text");
  });
});
