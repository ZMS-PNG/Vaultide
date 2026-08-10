import { LEARNING_PROTOCOL_VERSION } from '@openmaic/learning-protocol';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAccessToken } from '@/lib/server/access-token';

const mocks = vi.hoisted(() => ({
  listSchedules: vi.fn(),
  createSchedule: vi.fn(),
  updateSchedule: vi.fn(),
  runDueSchedules: vi.fn(),
  createSynthesisIndexDraft: vi.fn(),
  diff: vi.fn(),
}));

vi.mock('@/lib/learning/synthesis', () => ({
  getSynthesisService: () => mocks,
}));

import { GET as listSchedules, POST as createSchedule } from '@/lib/server/api-routes/v1/synthesis-schedules/handler';
import { PATCH as updateSchedule } from '@/lib/server/api-routes/v1/synthesis-schedules/[scheduleId]/handler';
import { POST as runDue } from '@/lib/server/api-routes/v1/synthesis-schedules/run-due/handler';
import { POST as createIndexDraft } from '@/lib/server/api-routes/v1/synthesis-schedules/[scheduleId]/index-drafts/handler';
import { GET as diff } from '@/lib/server/api-routes/v1/syntheses/[synthesisId]/diff/[baselineId]/handler';

const ACCESS_CODE = 'synthesis-schedule-route-access';
const SCHEDULE_ID = `sch_${'1'.repeat(32)}`;
const SYNTHESIS_ID = `syn_${'2'.repeat(32)}`;
const BASELINE_ID = `syn_${'3'.repeat(32)}`;
const originalAccessCode = process.env.ACCESS_CODE;

function request(url: string, method = 'GET', body?: unknown, authenticated = true): NextRequest {
  return new NextRequest(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-MAIC-Protocol-Version': LEARNING_PROTOCOL_VERSION,
      ...(authenticated ? { Cookie: `openmaic_access=${createAccessToken(ACCESS_CODE)}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe('synthesis schedule routes', () => {
  beforeEach(() => {
    process.env.ACCESS_CODE = ACCESS_CODE;
    Object.values(mocks).forEach((mock) => mock.mockReset());
  });

  afterEach(() => {
    if (originalAccessCode === undefined) delete process.env.ACCESS_CODE;
    else process.env.ACCESS_CODE = originalAccessCode;
  });

  it('requires the site administrator cookie before returning schedules', async () => {
    const response = await listSchedules(
      request('http://localhost/api/v1/synthesis-schedules', 'GET', undefined, false),
    );
    expect(response.status).toBe(401);
    expect(mocks.listSchedules).not.toHaveBeenCalled();
  });

  it('accepts a strict schedule, patch, due run, and historical diff request', async () => {
    const schedule = {
      id: SCHEDULE_ID,
      ownerId: `own_${'a'.repeat(32)}`,
      name: 'Weekly review',
      period: 'weekly',
      timezone: 'UTC',
      mode: 'combined',
      scope: { projectIds: [`prj_${'4'.repeat(32)}`] },
      scopeHash: 'f'.repeat(64),
      status: 'active',
      nextRunAt: new Date('2026-07-24T08:00:00.000Z'),
      createdAt: new Date('2026-07-23T08:00:00.000Z'),
      updatedAt: new Date('2026-07-23T08:00:00.000Z'),
    };
    mocks.listSchedules.mockResolvedValue([schedule]);
    mocks.createSchedule.mockResolvedValue(schedule);
    mocks.updateSchedule.mockResolvedValue({ ...schedule, status: 'paused' });
    mocks.runDueSchedules.mockResolvedValue({
      attempted: 1,
      succeeded: 1,
      skipped: 0,
      failed: 0,
      syntheses: [],
    });
    mocks.createSynthesisIndexDraft.mockResolvedValue({
      id: `wbd_${'5'.repeat(32)}`,
      revision: 1,
      draftKind: 'synthesis-index',
      targetVaultName: 'J-obsidian',
      operation: 'createManagedNote',
      relativePath: 'Vaultide/归纳/周期/索引/weekly.md',
      content: '# 周期归纳索引',
      status: 'generated',
    });
    mocks.diff.mockResolvedValue({ schemaVersion: 'synthesis-delta/1', conflicts: [] });

    const createResponse = await createSchedule(
      request('http://localhost/api/v1/synthesis-schedules', 'POST', {
        name: 'Weekly review',
        period: 'weekly',
        timezone: 'UTC',
        mode: 'combined',
        scope: { projectIds: [`prj_${'4'.repeat(32)}`] },
      }),
    );
    expect(createResponse.status).toBe(201);
    expect(mocks.createSchedule).toHaveBeenCalledWith({
      name: 'Weekly review',
      period: 'weekly',
      timezone: 'UTC',
      mode: 'combined',
      scope: { projectIds: [`prj_${'4'.repeat(32)}`] },
    });

    const patchResponse = await updateSchedule(
      request(`http://localhost/api/v1/synthesis-schedules/${SCHEDULE_ID}`, 'PATCH', {
        status: 'paused',
      }),
      { params: Promise.resolve({ scheduleId: SCHEDULE_ID }) },
    );
    expect(patchResponse.status).toBe(200);
    expect(mocks.updateSchedule).toHaveBeenCalledWith(SCHEDULE_ID, { status: 'paused' });

    const runResponse = await runDue(
      request('http://localhost/api/v1/synthesis-schedules/run-due', 'POST', { limit: 4 }),
    );
    expect(runResponse.status).toBe(200);
    expect(mocks.runDueSchedules).toHaveBeenCalledWith(4);

    const indexDraftResponse = await createIndexDraft(
      request(
        `http://localhost/api/v1/synthesis-schedules/${SCHEDULE_ID}/index-drafts`,
        'POST',
      ),
      { params: Promise.resolve({ scheduleId: SCHEDULE_ID }) },
    );
    expect(indexDraftResponse.status).toBe(201);
    expect(mocks.createSynthesisIndexDraft).toHaveBeenCalledWith(SCHEDULE_ID);

    const diffResponse = await diff(
      request(`http://localhost/api/v1/syntheses/${SYNTHESIS_ID}/diff/${BASELINE_ID}`),
      { params: Promise.resolve({ synthesisId: SYNTHESIS_ID, baselineId: BASELINE_ID }) },
    );
    expect(diffResponse.status).toBe(200);
    expect(mocks.diff).toHaveBeenCalledWith(SYNTHESIS_ID, BASELINE_ID);
  });

  it('rejects unknown schedule fields before calling the service', async () => {
    const response = await createSchedule(
      request('http://localhost/api/v1/synthesis-schedules', 'POST', {
        name: 'Forged',
        period: 'daily',
        mode: 'timeline',
        scope: {},
        ownerId: `own_${'f'.repeat(32)}`,
      }),
    );
    expect(response.status).toBe(400);
    expect(mocks.createSchedule).not.toHaveBeenCalled();
  });
});
