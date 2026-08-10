import { LEARNING_PROTOCOL_VERSION, stampProjectBindingRequest } from '@openmaic/learning-protocol';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  register: vi.fn(),
  status: vi.fn(),
  finalizeRevision: vi.fn(),
}));

vi.mock('@/lib/learning/projects', () => ({
  getProjectService: () => mocks,
}));

import { GET as getProject } from '@/lib/server/api-routes/v1/projects/[projectId]/handler';
import { POST as finalizeProject } from '@/lib/server/api-routes/v1/projects/[projectId]/finalize-sync/handler';
import { POST as registerProject } from '@/lib/server/api-routes/v1/projects/handler';

const NOW = new Date('2026-07-23T08:00:00.000Z');
const PROJECT_ID = `prj_${'1'.repeat(32)}`;
const headers = {
  Authorization: 'Bearer maic_at_test',
  'Content-Type': 'application/json',
  'X-MAIC-Protocol-Version': LEARNING_PROTOCOL_VERSION,
};

describe('project routes', () => {
  beforeEach(() => {
    mocks.register.mockReset();
    mocks.status.mockReset();
    mocks.finalizeRevision.mockReset();
  });

  it('requires a device bearer and returns the strict project-binding response', async () => {
    const body = stampProjectBindingRequest({
      projectId: PROJECT_ID,
      kind: 'obsidian-folder',
      displayName: '项目',
      folderPath: 'Projects/Test',
    });
    const unauthorized = await registerProject(
      new NextRequest('http://localhost/api/v1/projects', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-MAIC-Protocol-Version': LEARNING_PROTOCOL_VERSION,
        },
        body: JSON.stringify(body),
      }),
    );
    expect(unauthorized.status).toBe(401);
    expect(mocks.register).not.toHaveBeenCalled();

    mocks.register.mockResolvedValue({
      id: PROJECT_ID,
      ownerId: `own_${'2'.repeat(32)}`,
      vaultBindingId: `vlt_${'3'.repeat(32)}`,
      kind: 'obsidian-folder',
      projectName: '项目',
      rootPath: 'Projects/Test',
      status: 'active',
      bindingRevision: 1,
      projectRevision: 0,
      metadata: {},
      createdAt: NOW,
      updatedAt: NOW,
    });
    const response = await registerProject(
      new NextRequest('http://localhost/api/v1/projects', {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      }),
    );
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      protocolVersion: LEARNING_PROTOCOL_VERSION,
      schemaVersion: 'project-binding/1',
      projectId: PROJECT_ID,
      kind: 'obsidian-folder',
      displayName: '项目',
      folderPath: 'Projects/Test',
      bindingRevision: 1,
      projectRevision: 0,
      registeredAt: NOW.toISOString(),
    });
    expect(mocks.register).toHaveBeenCalledWith('maic_at_test', body);
  });

  it('device-authenticates project status requests', async () => {
    const request = new NextRequest(`http://localhost/api/v1/projects/${PROJECT_ID}`, {
      headers: {
        Authorization: 'Bearer maic_at_test',
        'X-MAIC-Protocol-Version': LEARNING_PROTOCOL_VERSION,
      },
    });
    mocks.status.mockResolvedValue({
      projectId: PROJECT_ID,
      vaultBindingId: `vlt_${'3'.repeat(32)}`,
      kind: 'obsidian-folder',
      projectName: '项目',
      rootPath: 'Projects/Test',
      status: 'active',
      bindingRevision: 1,
      projectRevision: 2,
      sourceCount: 4,
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    });

    const response = await getProject(request, {
      params: Promise.resolve({ projectId: PROJECT_ID }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      project: { projectId: PROJECT_ID, projectRevision: 2, sourceCount: 4 },
    });
    expect(mocks.status).toHaveBeenCalledWith('maic_at_test', PROJECT_ID);
  });

  it('returns the finalized revision as the flat connector contract', async () => {
    const body = {
      expectedProjectRevision: 7,
      sourceIds: [`sou_${'4'.repeat(32)}`],
    };
    mocks.finalizeRevision.mockResolvedValue({
      projectId: PROJECT_ID,
      projectRevision: 8,
      manifestId: `prm_${'5'.repeat(32)}`,
      manifestSha256: '6'.repeat(64),
      sourceCount: 1,
    });

    const response = await finalizeProject(
      new NextRequest(`http://localhost/api/v1/projects/${PROJECT_ID}/finalize-sync`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ projectId: PROJECT_ID }) },
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      projectId: PROJECT_ID,
      projectRevision: 8,
      manifestId: `prm_${'5'.repeat(32)}`,
      manifestSha256: '6'.repeat(64),
      sourceCount: 1,
    });
    expect(mocks.finalizeRevision).toHaveBeenCalledWith('maic_at_test', PROJECT_ID, body);
  });
});
