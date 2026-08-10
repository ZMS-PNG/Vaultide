import {
  LEARNING_PROTOCOL_VERSION,
  PROJECT_BINDING_SCHEMA_VERSION,
} from '@openmaic/learning-protocol';
import { describe, expect, it, vi } from 'vitest';
import type { DeviceTokenService } from '@/lib/learning/application/device-token-service';
import { ProjectService, ProjectServiceError } from '@/lib/learning/application/project-service';
import type { DeviceTokenPrincipal } from '@/lib/learning/domain/device-token';
import type { LearningProjectRecord } from '@/lib/learning/domain/project';
import type { ProjectRepository } from '@/lib/learning/ports/project-repository';

const NOW = new Date('2026-07-23T08:00:00.000Z');
const principal: DeviceTokenPrincipal = {
  ownerId: `own_${'1'.repeat(32)}`,
  deviceId: `dev_${'2'.repeat(32)}`,
  vaultBindingId: `vlt_${'3'.repeat(32)}`,
  scopes: ['sources:write'],
};

function request(extra: Record<string, unknown> = {}) {
  return {
    protocolVersion: LEARNING_PROTOCOL_VERSION,
    schemaVersion: PROJECT_BINDING_SCHEMA_VERSION,
    projectId: `prj_${'4'.repeat(32)}`,
    kind: 'obsidian-folder',
    displayName: 'OpenMAIC 学习项目',
    folderPath: 'Projects/OpenMAIC',
    ...extra,
  };
}

function project(overrides: Partial<LearningProjectRecord> = {}): LearningProjectRecord {
  return {
    id: `prj_${'4'.repeat(32)}`,
    ownerId: principal.ownerId,
    vaultBindingId: principal.vaultBindingId,
    kind: 'obsidian-folder',
    projectName: 'OpenMAIC 学习项目',
    rootPath: 'Projects/OpenMAIC',
    status: 'active',
    bindingRevision: 1,
    projectRevision: 0,
    metadata: {},
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function tokens(): DeviceTokenService {
  return {
    authenticateAccess: vi.fn(async () => principal),
  } as unknown as DeviceTokenService;
}

describe('ProjectService', () => {
  it('registers an owner/Vault-scoped folder and preserves optimistic revisions', async () => {
    const register = vi.fn(async () => project());
    const repository = {
      register,
      findStatus: vi.fn(),
    } as unknown as ProjectRepository;
    const service = new ProjectService(repository, tokens(), () => NOW);

    await expect(
      service.register('maic_at_test', request({ expectedBindingRevision: 0 })),
    ).resolves.toMatchObject({
      id: `prj_${'4'.repeat(32)}`,
      projectName: 'OpenMAIC 学习项目',
      projectRevision: 0,
    });
    expect(register).toHaveBeenCalledWith(
      principal,
      expect.objectContaining({
        projectId: `prj_${'4'.repeat(32)}`,
        vaultBindingId: principal.vaultBindingId,
        rootPath: 'Projects/OpenMAIC',
        expectedBindingRevision: 0,
        bindingKeyHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
      NOW,
    );
  });

  it('fails closed for unknown contract fields and revision conflicts', async () => {
    const repository = {
      register: vi.fn(async () => null),
      findStatus: vi.fn(),
    } as unknown as ProjectRepository;
    const service = new ProjectService(repository, tokens(), () => NOW);

    await expect(
      service.register('maic_at_test', request({ arbitrary: true })),
    ).rejects.toMatchObject({
      code: 'learning_contract_invalid',
      status: 422,
    } satisfies Partial<ProjectServiceError>);
    await expect(service.register('maic_at_test', request())).rejects.toMatchObject({
      code: 'conflict',
      status: 409,
    } satisfies Partial<ProjectServiceError>);
  });

  it('returns project/source/upload status only through the authenticated Vault scope', async () => {
    const repository = {
      register: vi.fn(),
      findStatus: vi.fn(async () => ({
        project: project({
          projectRevision: 2,
          latestManifestHash: 'a'.repeat(64),
          lastIndexedAt: NOW,
        }),
        activeSourceCount: 7,
        latestUpload: {
          bundleId: `src_${'5'.repeat(32)}`,
          manifestHash: 'a'.repeat(64),
          status: 'validated',
          coverage: 'partial',
          bundleRevision: 1,
          itemCount: 7,
          createdAt: NOW,
          completedAt: NOW,
        },
      })),
    } as unknown as ProjectRepository;
    const service = new ProjectService(repository, tokens(), () => NOW);

    await expect(service.status('maic_at_test', `prj_${'4'.repeat(32)}`)).resolves.toMatchObject({
      projectId: `prj_${'4'.repeat(32)}`,
      projectRevision: 2,
      sourceCount: 7,
      latestUpload: {
        status: 'validated',
        coverage: 'partial',
      },
    });
    expect(repository.findStatus).toHaveBeenCalledWith(principal, `prj_${'4'.repeat(32)}`);
  });

  it('finalizes one immutable project revision from the exact current source-version set', async () => {
    const sourceIds = [`sou_${'5'.repeat(32)}`, `sou_${'6'.repeat(32)}`];
    const listRevisionCandidates = vi.fn(async () => [
      {
        sourceId: sourceIds[1]!,
        sourceVersionId: `lsv_${'8'.repeat(32)}`,
        relativePath: 'docs/b.md',
        contentHash: 'b'.repeat(64),
      },
      {
        sourceId: sourceIds[0]!,
        sourceVersionId: `lsv_${'7'.repeat(32)}`,
        relativePath: 'README.md',
        contentHash: 'a'.repeat(64),
      },
    ]);
    const finalizeRevision = vi.fn(async (_principal, input) => ({
      projectRevision: input.expectedProjectRevision + 1,
      manifestId: input.manifestId,
    }));
    const repository = {
      register: vi.fn(),
      findStatus: vi.fn(),
      listRevisionCandidates,
      finalizeRevision,
    } as unknown as ProjectRepository;
    const service = new ProjectService(repository, tokens(), () => NOW);

    await expect(
      service.finalizeRevision('maic_at_test', `prj_${'4'.repeat(32)}`, {
        expectedProjectRevision: 2,
        sourceIds,
        sourceBundleId: `src_${'9'.repeat(32)}`,
      }),
    ).resolves.toMatchObject({
      projectId: `prj_${'4'.repeat(32)}`,
      projectRevision: 3,
      sourceCount: 2,
      manifestId: expect.stringMatching(/^prm_[a-f0-9]{32}$/),
      manifestSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(finalizeRevision).toHaveBeenCalledWith(
      principal,
      expect.objectContaining({
        expectedProjectRevision: 2,
        sourceBundleId: `src_${'9'.repeat(32)}`,
        entries: [
          expect.objectContaining({ sourceId: sourceIds[0], relativePath: 'README.md' }),
          expect.objectContaining({ sourceId: sourceIds[1], relativePath: 'docs/b.md' }),
        ],
      }),
      NOW,
    );
  });

  it('fails closed when project source identities are malformed, duplicated, or stale', async () => {
    const repository = {
      register: vi.fn(),
      findStatus: vi.fn(),
      listRevisionCandidates: vi.fn(async () => []),
      finalizeRevision: vi.fn(),
    } as unknown as ProjectRepository;
    const service = new ProjectService(repository, tokens(), () => NOW);
    const projectId = `prj_${'4'.repeat(32)}`;

    await expect(
      service.finalizeRevision('maic_at_test', projectId, {
        expectedProjectRevision: 0,
        sourceIds: [`sou_${'5'.repeat(32)}`, `sou_${'5'.repeat(32)}`],
      }),
    ).rejects.toMatchObject({ code: 'invalid_request', status: 400 });
    await expect(
      service.finalizeRevision('maic_at_test', projectId, {
        expectedProjectRevision: 0,
        sourceIds: [`sou_${'5'.repeat(32)}`],
      }),
    ).rejects.toMatchObject({ code: 'conflict', status: 409 });
    expect(repository.finalizeRevision).not.toHaveBeenCalled();
  });
});
