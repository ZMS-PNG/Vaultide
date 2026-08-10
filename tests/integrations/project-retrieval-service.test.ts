import { createHash } from 'node:crypto';
import type { SourceArchive } from '@openmaic/learning-protocol';
import { describe, expect, it, vi } from 'vitest';
import { ProjectRetrievalService } from '@/lib/learning/application/project-retrieval-service';
import type { ProjectChunkCandidate } from '@/lib/learning/domain/project-retrieval';
import type { ProjectRetrievalRepository } from '@/lib/learning/ports/project-retrieval-repository';

const NOW = new Date('2026-07-23T12:00:00.000Z');
const OWNER_ID = `own_${'1'.repeat(32)}`;
const PROJECT_ID = `prj_${'2'.repeat(32)}`;

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function hit(
  index: number,
  content: string,
  score: number,
  fallback = false,
): ProjectChunkCandidate {
  return {
    chunkId: `chk_${String(index).padStart(32, '0')}`,
    sourceId: `sou_${String(index).padStart(32, '0')}`,
    sourceVersionId: `svr_${String(index).padStart(32, '0')}`,
    sourceBundleId: `src_${String(index).padStart(32, '0')}`,
    snapshotId: `snp_${String(index).padStart(32, '0')}`,
    title: `Source ${index}`,
    relativePath: `Project/Source-${index}.md`,
    chunkOrdinal: 1,
    startChar: 0,
    endChar: content.length,
    contentHash: sha256(content),
    headingPath: [`Heading ${index}`],
    score,
    fallback,
  };
}

function archive(candidate: ProjectChunkCandidate, content: string): SourceArchive {
  return {
    bundle: { id: candidate.sourceBundleId },
    contents: [{ snapshotId: candidate.snapshotId, utf8Content: content }],
  } as SourceArchive;
}

function repository(
  matched: ProjectChunkCandidate[],
  fallback: ProjectChunkCandidate[],
  required: ProjectChunkCandidate[] = [],
) {
  return {
    findBundleContext: vi.fn(),
    findProject: vi.fn().mockResolvedValue({
      projectId: PROJECT_ID,
      displayName: 'Test project',
      projectRevision: 7,
      activeSourceCount: 4,
      searchableSourceCount: 3,
      pendingSourceCount: 1,
      failedSourceCount: 0,
      indexedChunkCount: 8,
      lastIndexedAt: NOW,
    }),
    searchChunks: vi.fn().mockResolvedValue(matched),
    listFallbackChunks: vi.fn().mockResolvedValue(fallback),
    listSourceChunks: vi.fn().mockResolvedValue(required),
    saveRun: vi.fn().mockResolvedValue(true),
  } satisfies ProjectRetrievalRepository;
}

describe('ProjectRetrievalService', () => {
  it('selects goal-ranked project excerpts, verifies hashes, and freezes citations', async () => {
    const firstText = '核心数据流从 SourceVersion 进入检索器。';
    const secondText = '缓存失效必须绑定项目版本。';
    const overviewText = '项目总览和边界。';
    const first = hit(1, firstText, 0.9);
    const second = hit(2, secondText, 0.8);
    const overview = hit(3, overviewText, 0.04, true);
    const store = repository([first, second], [overview]);
    const archives = new Map([
      [first.sourceBundleId, archive(first, firstText)],
      [second.sourceBundleId, archive(second, secondText)],
      [overview.sourceBundleId, archive(overview, overviewText)],
    ]);
    const service = new ProjectRetrievalService({
      ownerId: OWNER_ID,
      repository: store,
      readArchive: vi.fn(async (_ownerId, bundleId) => archives.get(bundleId) ?? null),
      now: () => NOW,
    });

    const result = await service.retrieve({
      projectId: PROJECT_ID,
      goal: '理解项目数据流和缓存失效',
      anchorBundleId: first.sourceBundleId,
      maxContextChars: 20_000,
    });

    expect(result.context).toContain('[V1]');
    expect(result.context).toContain(firstText);
    expect(result.matchQuality).toBe('strong');
    expect(result.citations[0]?.excerptPreview).toContain('核心数据流');
    expect(result.metrics).toMatchObject({
      activeSourceCount: 4,
      searchableSourceCount: 3,
      unavailableSourceCount: 1,
      matchedSourceCount: 2,
      selectedSourceCount: 3,
    });
    expect(result.citations.map((citation) => citation.citationId)).toEqual(['V1', 'V2', 'V3']);
    expect(store.saveRun).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId: OWNER_ID,
        projectId: PROJECT_ID,
        projectRevision: 7,
        selectedChunkCount: 3,
        selectedSourceCount: 3,
      }),
    );
  });

  it('does not use a candidate whose exact private-blob slice fails hash verification', async () => {
    const validText = 'valid project evidence';
    const valid = hit(4, validText, 0.6);
    const tampered = hit(5, 'expected text', 0.9);
    const store = repository([tampered, valid], []);
    const service = new ProjectRetrievalService({
      ownerId: OWNER_ID,
      repository: store,
      readArchive: vi.fn(async (_ownerId, bundleId) =>
        bundleId === valid.sourceBundleId
          ? archive(valid, validText)
          : archive(tampered, 'tampered text'),
      ),
      now: () => NOW,
    });

    const result = await service.retrieve({
      projectId: PROJECT_ID,
      goal: 'find valid project evidence',
      maxContextChars: 20_000,
    });
    expect(result.context).toContain(validText);
    expect(result.context).not.toContain('tampered text');
    expect(result.citations).toHaveLength(1);
  });

  it('requires a currently searchable project index instead of silently using file order', async () => {
    const store = repository([], []);
    store.findProject.mockResolvedValue({
      projectId: PROJECT_ID,
      displayName: 'Expired project',
      projectRevision: 2,
      activeSourceCount: 4,
      searchableSourceCount: 0,
      pendingSourceCount: 4,
      failedSourceCount: 0,
      indexedChunkCount: 0,
    });
    const service = new ProjectRetrievalService({
      ownerId: OWNER_ID,
      repository: store,
      readArchive: vi.fn(),
      now: () => NOW,
    });

    await expect(
      service.retrieve({ projectId: PROJECT_ID, goal: '理解这个项目的架构' }),
    ).rejects.toMatchObject({ code: 'conflict', status: 409 });
    expect(store.searchChunks).not.toHaveBeenCalled();
  });

  it('never turns overview fallbacks into a green result when the goal matched nothing', async () => {
    const overviewText = '项目总览，但没有用户目标中的专有概念。';
    const overview = hit(6, overviewText, 0.04, true);
    const store = repository([], [overview]);
    const service = new ProjectRetrievalService({
      ownerId: OWNER_ID,
      repository: store,
      readArchive: vi.fn(async () => archive(overview, overviewText)),
      now: () => NOW,
    });

    await expect(
      service.retrieve({
        projectId: PROJECT_ID,
        goal: '定位量子编译流水线中的相位折叠错误',
      }),
    ).rejects.toMatchObject({ code: 'conflict', status: 409 });
    expect(store.saveRun).not.toHaveBeenCalled();
  });

  it('honors required and excluded source controls in the frozen retrieval run', async () => {
    const excludedText = '缓存失效路径 A';
    const matchedText = '缓存失效路径 B';
    const requiredText = '用户指定必须纳入的设计约束';
    const excluded = hit(7, excludedText, 0.9);
    const matched = hit(8, matchedText, 0.7);
    const required = hit(9, requiredText, 0);
    const store = repository([excluded, matched], [], [required]);
    const archives = new Map([
      [excluded.sourceBundleId, archive(excluded, excludedText)],
      [matched.sourceBundleId, archive(matched, matchedText)],
      [required.sourceBundleId, archive(required, requiredText)],
    ]);
    const service = new ProjectRetrievalService({
      ownerId: OWNER_ID,
      repository: store,
      readArchive: vi.fn(async (_ownerId, bundleId) => archives.get(bundleId) ?? null),
      now: () => NOW,
    });

    const result = await service.retrieve({
      projectId: PROJECT_ID,
      goal: '理解缓存失效路径和设计约束',
      requiredSourceIds: [required.sourceId],
      excludedSourceIds: [excluded.sourceId],
    });

    expect(result.citations.map((citation) => citation.sourceId)).toEqual(
      expect.arrayContaining([matched.sourceId, required.sourceId]),
    );
    expect(result.citations.map((citation) => citation.sourceId)).not.toContain(excluded.sourceId);
    expect(
      result.citations.find((citation) => citation.sourceId === required.sourceId)?.selectionReason,
    ).toBe('required-source');
    expect(store.saveRun).toHaveBeenCalledWith(
      expect.objectContaining({
        requiredSourceIds: [required.sourceId],
        excludedSourceIds: [excluded.sourceId],
      }),
    );
  });
});
