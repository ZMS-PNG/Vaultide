import { describe, expect, it, vi } from 'vitest';
import { KnowledgeGraphRefreshService } from '@/lib/learning/application/knowledge-graph-refresh-service';
import type { KnowledgeGraphRefreshRequestRecord } from '@/lib/learning/domain/knowledge-graph-refresh';
import type { KnowledgeGraphRefreshRepository } from '@/lib/learning/ports/knowledge-graph-refresh-repository';

const OWNER_ID = `own_${'1'.repeat(32)}`;
const PROJECT_ID = `prj_${'2'.repeat(32)}`;
const SYNTHESIS_ID = `syn_${'3'.repeat(32)}`;
const REQUEST_ID = `kgq_${'4'.repeat(32)}`;
const PROJECTION_ID = `kgp_${'5'.repeat(32)}`;
const NOW = new Date('2026-07-24T10:00:00.000Z');

function refreshRecord(
  overrides: Partial<KnowledgeGraphRefreshRequestRecord> = {},
): KnowledgeGraphRefreshRequestRecord {
  return {
    id: REQUEST_ID,
    ownerId: OWNER_ID,
    dedupeKey: '6'.repeat(64),
    triggerKind: 'learning-event',
    triggerId: 'event-batch',
    projectId: PROJECT_ID,
    state: 'processing',
    attemptCount: 1,
    availableAt: NOW,
    result: { synthesisIds: [], projectionIds: [] },
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe('KnowledgeGraphRefreshService', () => {
  it('deduplicates triggers and rebuilds only the affected current synthesis', async () => {
    let saved = refreshRecord({ state: 'pending', attemptCount: 0 });
    const repository = {
      enqueue: vi.fn(async (input) => {
        saved = {
          ...saved,
          id: input.id,
          dedupeKey: input.dedupeKey,
          triggerKind: input.triggerKind,
          triggerId: input.triggerId,
          projectId: input.projectId,
        };
        return { record: saved, enqueued: true };
      }),
      claimPending: vi.fn(async () => [refreshRecord()]),
      findAffectedSynthesisIds: vi.fn(async () => [SYNTHESIS_ID]),
      complete: vi.fn(async () => undefined),
    } as unknown as KnowledgeGraphRefreshRepository;
    const projections = {
      createProjection: vi.fn(async () => ({ id: PROJECTION_ID })),
    };
    const service = new KnowledgeGraphRefreshService({
      ownerId: OWNER_ID,
      repository,
      projections,
      now: () => NOW,
      identifier: () => REQUEST_ID,
    });

    await expect(
      service.enqueue({
        triggerKind: 'learning-event',
        triggerId: 'event-batch',
        projectId: PROJECT_ID,
      }),
    ).resolves.toEqual({ id: REQUEST_ID, enqueued: true });
    const processed = await service.processPending();

    expect(processed).toEqual({
      attempted: 1,
      succeeded: 1,
      skipped: 0,
      failed: 0,
      projectionIds: [PROJECTION_ID],
    });
    expect(repository.findAffectedSynthesisIds).toHaveBeenCalledWith(
      OWNER_ID,
      expect.objectContaining({ projectId: PROJECT_ID }),
      20,
    );
    expect(projections.createProjection).toHaveBeenCalledWith(SYNTHESIS_ID, { force: true });
    expect(repository.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        state: 'succeeded',
        synthesisIds: [SYNTHESIS_ID],
        projectionIds: [PROJECTION_ID],
      }),
    );
  });

  it('marks a scoped refresh as skipped when no synthesis has ever covered it', async () => {
    const repository = {
      enqueue: vi.fn(),
      claimPending: vi.fn(async () => [refreshRecord()]),
      findAffectedSynthesisIds: vi.fn(async () => []),
      complete: vi.fn(async () => undefined),
    } as unknown as KnowledgeGraphRefreshRepository;
    const projections = { createProjection: vi.fn() };
    const service = new KnowledgeGraphRefreshService({
      ownerId: OWNER_ID,
      repository,
      projections,
      now: () => NOW,
    });

    const result = await service.processPending();

    expect(result).toMatchObject({ attempted: 1, succeeded: 0, skipped: 1, failed: 0 });
    expect(projections.createProjection).not.toHaveBeenCalled();
    expect(repository.complete).toHaveBeenCalledWith(
      expect.objectContaining({ state: 'skipped', synthesisIds: [], projectionIds: [] }),
    );
  });

  it('keeps failed work retryable without losing the durable request', async () => {
    const repository = {
      enqueue: vi.fn(),
      claimPending: vi.fn(async () => [refreshRecord({ attemptCount: 2 })]),
      findAffectedSynthesisIds: vi.fn(async () => [SYNTHESIS_ID]),
      complete: vi.fn(async () => undefined),
    } as unknown as KnowledgeGraphRefreshRepository;
    const service = new KnowledgeGraphRefreshService({
      ownerId: OWNER_ID,
      repository,
      projections: {
        createProjection: vi.fn(async () => {
          throw new Error('temporary database failure');
        }),
      },
      now: () => NOW,
    });

    const result = await service.processPending();

    expect(result).toMatchObject({ attempted: 1, succeeded: 0, skipped: 0, failed: 1 });
    expect(repository.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        state: 'failed',
        errorDetail: 'temporary database failure',
        retryAt: new Date('2026-07-24T10:02:00.000Z'),
      }),
    );
  });
});
