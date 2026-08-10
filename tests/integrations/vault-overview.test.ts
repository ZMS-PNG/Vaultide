import { describe, expect, it, vi } from 'vitest';
import { ProductOverviewService } from '@/lib/learning/application/product-overview-service';
import { healthMetric, type ProductHealthSnapshot } from '@/lib/learning/domain/product-health';
import {
  renderVaultOverview,
  VAULT_OVERVIEW_PATH,
  vaultOverviewDraftBlocks,
  type VaultOverviewDocumentRecord,
  type VaultOverviewSnapshot,
} from '@/lib/learning/domain/vault-overview';
import type { LearningProgressRepository } from '@/lib/learning/ports/learning-progress-repository';
import type { ProductOverviewRepository } from '@/lib/learning/ports/product-overview-repository';

const NOW = new Date('2026-07-26T12:00:00.000Z');

function health(): ProductHealthSnapshot {
  return {
    generatedAt: NOW.toISOString(),
    windowDays: 7,
    generation: healthMetric({ total: 2, succeeded: 2, failed: 0, pending: 0 }),
    synthesis: healthMetric({ total: 1, succeeded: 1, failed: 0, pending: 0 }),
    writeback: healthMetric({ total: 2, succeeded: 1, failed: 0, pending: 1 }),
    sources: healthMetric({ total: 3, succeeded: 2, failed: 0, pending: 1 }),
  };
}

function snapshot(): VaultOverviewSnapshot {
  return {
    generatedAt: NOW.toISOString(),
    projects: [
      {
        id: `prj_${'1'.repeat(32)}`,
        name: '微信小程序',
        rootPath: 'Architecture-Analysis-Vault/项目3-微信小程序',
        revision: 4,
        sourceCount: 18,
        classroomCount: 3,
        activeSprintCount: 1,
        updatedAt: NOW.toISOString(),
      },
    ],
    recentLearning: [
      {
        sprintId: `spr_${'2'.repeat(32)}`,
        classroomId: 'classroom-one',
        goal: '理解项目架构',
        projectName: '微信小程序',
        status: 'active',
        masteryEstimate: 0.62,
        masteryConfidence: 0.7,
        evidenceCount: 4,
        nextReviewAt: '2026-07-26T08:00:00.000Z',
        updatedAt: NOW.toISOString(),
      },
    ],
    reviews: [
      {
        id: `rvi_${'3'.repeat(32)}`,
        classroomId: 'classroom-one',
        goal: '理解项目架构',
        projectName: '微信小程序',
        dueAt: '2026-07-26T08:00:00.000Z',
        dueCount: 2,
        masteryEstimate: 0.62,
        isDue: true,
      },
    ],
    syntheses: [
      {
        id: `syn_${'4'.repeat(32)}`,
        title: '项目架构阶段归纳',
        mode: 'combined',
        classroomCount: 3,
        nodeCount: 24,
        createdAt: NOW.toISOString(),
      },
    ],
    health: health(),
  };
}

describe('stable Vault overview', () => {
  it('renders one fixed path with independently hashed managed blocks', () => {
    const id = `vdx_${'a'.repeat(32)}`;
    const rendered = renderVaultOverview({ vaultOverviewId: id, snapshot: snapshot(), now: NOW });
    expect(rendered.relativePath).toBe(VAULT_OVERVIEW_PATH);
    expect(rendered.frontmatter.maic_vault_overview_id).toBe(id);
    expect(rendered.content).toContain(`vault-overview=${id}`);
    expect(rendered.content).toContain('## 今日学习行动');
    expect(rendered.content).toContain('## 我的补充');
    expect(new Set(rendered.managedBlocks.map((block) => block.id)).size).toBe(
      rendered.managedBlocks.length,
    );
    expect(rendered.managedBlocks.every((block) => /^[a-f0-9]{64}$/.test(block.contentHash))).toBe(
      true,
    );
  });

  it('uses compare-and-swap hashes after the first applied version', () => {
    const id = `vdx_${'a'.repeat(32)}`;
    const rendered = renderVaultOverview({ vaultOverviewId: id, snapshot: snapshot(), now: NOW });
    const document: VaultOverviewDocumentRecord = {
      id,
      ownerId: `own_${'b'.repeat(32)}`,
      vaultBindingId: `vlt_${'c'.repeat(32)}`,
      relativePath: VAULT_OVERVIEW_PATH,
      status: 'active',
      managedBlocks: rendered.managedBlocks,
      lastContentHash: 'd'.repeat(64),
      createdAt: NOW,
      updatedAt: NOW,
    };
    const drafts = vaultOverviewDraftBlocks(rendered.managedBlocks, document);
    expect(drafts.every((block) => block.expectedHash === block.contentHash)).toBe(true);
  });

  it('creates a first-write draft and preserves the stable document identity', async () => {
    const documentId = `vdx_${'a'.repeat(32)}`;
    const overviewRepository = {
      snapshot: vi.fn().mockResolvedValue(snapshot()),
      health: vi.fn().mockResolvedValue(health()),
      findOrCreateOverview: vi.fn().mockImplementation(async (input) => ({
        id: documentId,
        ownerId: input.ownerId,
        vaultBindingId: input.vaultBindingId,
        relativePath: input.relativePath,
        status: 'active',
        managedBlocks: input.initialManagedBlocks,
        createdAt: NOW,
        updatedAt: NOW,
      })),
    } as unknown as ProductOverviewRepository;
    const learningRepository = {
      findWritebackTarget: vi.fn().mockResolvedValue({
        deviceId: 'device',
        vaultBindingId: `vlt_${'c'.repeat(32)}`,
        vaultName: 'J-obsidian',
      }),
      findOpenDraftByVaultOverview: vi.fn().mockResolvedValue(null),
      createDraft: vi.fn().mockImplementation(async (input) => ({
        ...input,
        revision: 1,
        status: 'generated',
        draftKind: 'vault-overview',
        operation: 'createManagedNote',
        createdAt: NOW,
        updatedAt: NOW,
      })),
    } as unknown as LearningProgressRepository;
    const service = new ProductOverviewService({
      ownerId: `own_${'b'.repeat(32)}`,
      repository: overviewRepository,
      learningProgressRepository: learningRepository,
      now: () => NOW,
    });

    const draft = await service.createVaultOverviewDraft();
    expect(draft.relativePath).toBe(VAULT_OVERVIEW_PATH);
    expect(draft.operation).toBe('createManagedNote');
    expect(draft.vaultOverviewId).toBe(documentId);
    expect(learningRepository.createDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        draftKind: 'vault-overview',
        vaultOverviewId: documentId,
      }),
    );
  });
});
