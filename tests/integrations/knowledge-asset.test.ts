import { describe, expect, it, vi } from 'vitest';
import { LearningProgressService } from '@/lib/learning/application/learning-progress-service';
import {
  externalKnowledgeAssetCandidate,
  renderExternalKnowledgeCard,
  type KnowledgeAssetRecord,
  type KnowledgeAssetVersionRecord,
} from '@/lib/learning/domain/knowledge-asset';
import type { LearningSprintRecord } from '@/lib/learning/domain/learning-progress';
import type { KnowledgeAssetRepository } from '@/lib/learning/ports/knowledge-asset-repository';
import type { LearningProgressRepository } from '@/lib/learning/ports/learning-progress-repository';

describe('external knowledge assets', () => {
  it('uses a stable GitHub identity while preserving the whole safe citation set', () => {
    const candidate = externalKnowledgeAssetCandidate({
      researchRunId: `rrn_${'1'.repeat(32)}`,
      sources: [
        {
          citationId: 'S1',
          title: 'README · owner/repo',
          url: 'https://github.com/Owner/Repo/blob/main/README.md?ref=search',
          authority: 'primary',
          score: 0.9,
        },
        {
          citationId: 'S2',
          title: 'Official docs',
          url: 'https://docs.example.com/guide',
          authority: 'authoritative',
          score: 0.8,
        },
      ],
    });
    expect(candidate).toMatchObject({
      sourceKind: 'github',
      canonicalKey: 'github:owner/repo',
      canonicalUrl: 'https://github.com/owner/repo',
    });
    expect(candidate?.sources).toHaveLength(2);
  });

  it('renders an immutable card with citations and learning evidence, not copied source text', () => {
    const now = new Date('2026-07-23T12:00:00.000Z');
    const asset: KnowledgeAssetRecord = {
      id: `kas_${'2'.repeat(32)}`,
      ownerId: `own_${'1'.repeat(32)}`,
      assetKind: 'external-card',
      sourceKind: 'paper',
      canonicalKey: 'arxiv:2501.01234',
      canonicalUrl: 'https://arxiv.org/abs/2501.01234',
      title: 'A useful paper',
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };
    const version: KnowledgeAssetVersionRecord = {
      id: `kav_${'3'.repeat(32)}`,
      ownerId: asset.ownerId,
      assetId: asset.id,
      researchRunId: `rrn_${'4'.repeat(32)}`,
      sourceFingerprint: 'a'.repeat(64),
      sourceRefs: [
        {
          citationId: 'S1',
          title: 'A useful paper',
          url: asset.canonicalUrl,
          authority: 'primary',
        },
      ],
      cardMarkdown: '',
      contentHash: 'b'.repeat(64),
      capturedAt: now,
      createdAt: now,
    };
    const rendered = renderExternalKnowledgeCard({
      asset,
      version,
      classroom: {
        id: 'course_external',
        stage: { id: 'course_external', name: '论文课堂' },
        scenes: [{ id: 'scene_1', title: '核心方法', order: 0, type: 'slide' }],
        createdAt: now.toISOString(),
      },
      sprint: {
        id: `spr_${'5'.repeat(32)}`,
        ownerId: asset.ownerId,
        classroomId: 'course_external',
        researchRunId: version.researchRunId,
        goal: '理解核心方法',
        status: 'completed',
        createdAt: now,
        updatedAt: now,
      },
      mastery: [],
      now,
    });
    expect(rendered.relativePath).toMatch(/^Vaultide\/资料库\/论文与科研\//);
    expect(rendered.content).toContain('[S1] [A useful paper](https://arxiv.org/abs/2501.01234)');
    expect(rendered.content).toContain('当前掌握度：未知');
    expect(rendered.frontmatter).toMatchObject({
      maic_asset_id: asset.id,
      maic_asset_version_id: version.id,
    });
  });

  it('creates an external card alongside the separate learning-record flow for an external-only lesson', async () => {
    const now = new Date('2026-07-23T12:00:00.000Z');
    const ownerId = `own_${'1'.repeat(32)}`;
    const sprint: LearningSprintRecord = {
      id: `spr_${'2'.repeat(32)}`,
      ownerId,
      classroomId: 'course_external_card',
      researchRunId: `rrn_${'3'.repeat(32)}`,
      goal: '学习这个外部仓库',
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };
    const asset: KnowledgeAssetRecord = {
      id: `kas_${'4'.repeat(32)}`,
      ownerId,
      assetKind: 'external-card',
      sourceKind: 'github',
      canonicalKey: 'github:owner/repo',
      canonicalUrl: 'https://github.com/owner/repo',
      title: 'owner/repo',
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };
    const versionCalls: Array<Record<string, unknown>> = [];
    const repository = {
      ensureSprint: vi.fn(async () => sprint),
      findWritebackTarget: vi.fn(async () => ({
        deviceId: `dev_${'5'.repeat(32)}`,
        vaultBindingId: `vlt_${'6'.repeat(32)}`,
        vaultName: 'J-obsidian',
      })),
      listEvents: vi.fn(async () => []),
      findOpenDraftByAssetVersion: vi.fn(async () => null),
      createDraft: vi.fn(async (input) => ({
        id: input.id,
        ownerId: input.ownerId,
        draftKind: input.draftKind ?? 'learning-summary',
        sprintId: input.sprintId,
        assetId: input.assetId,
        assetVersionId: input.assetVersionId,
        targetDeviceId: input.targetDeviceId,
        targetVaultBindingId: input.targetVaultBindingId,
        revision: 1,
        status: 'generated',
        operation: input.operation ?? 'createManagedNote',
        managedBlocks: [],
        relativePath: input.relativePath,
        content: input.content,
        frontmatter: input.frontmatter,
        createdAt: now,
        updatedAt: now,
      })),
    } as unknown as LearningProgressRepository;
    const assets = {
      findOrCreateExternalAsset: vi.fn(async () => asset),
      findOrCreateVersion: vi.fn(async (input) => {
        versionCalls.push(input);
        return {
          id: input.id,
          ownerId: input.ownerId,
          assetId: input.assetId,
          researchRunId: input.researchRunId,
          sourceFingerprint: input.sourceFingerprint,
          sourceRefs: input.sourceRefs,
          cardMarkdown: input.cardMarkdown,
          contentHash: input.contentHash,
          capturedAt: input.capturedAt,
          createdAt: input.now,
        };
      }),
    } as unknown as KnowledgeAssetRepository;
    const service = new LearningProgressService({
      ownerId,
      repository,
      knowledgeAssets: assets,
      now: () => now,
      readClassroom: async () => ({
        id: sprint.classroomId,
        stage: {
          id: sprint.classroomId,
          name: 'GitHub 仓库课堂',
          learningContext: {
            researchRunId: sprint.researchRunId,
            goal: sprint.goal,
            researchSources: [
              {
                citationId: 'S1',
                title: 'owner/repo',
                url: 'https://github.com/owner/repo',
                authority: 'primary',
              },
            ],
          },
        },
        scenes: [{ id: 'scene_1', title: 'README', order: 0, type: 'slide' }],
        createdAt: now.toISOString(),
      }),
    });

    const draft = await service.createExternalKnowledgeCardDraft(sprint.classroomId);
    expect(draft).toMatchObject({
      draftKind: 'external-card',
      assetId: asset.id,
      operation: 'createManagedNote',
    });
    expect(draft.relativePath).toMatch(/^Vaultide\/资料库\/外部项目\//);
    expect(versionCalls).toHaveLength(1);
  });
});
