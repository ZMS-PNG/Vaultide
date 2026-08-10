import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isDurableClassroomSnapshot,
  markClassroomSnapshotPersisted,
  persistClassroomSnapshot,
  queueClassroomSnapshotSync,
  resetClassroomSyncStateForTests,
  serializeClassroomSnapshot,
} from '@/lib/classroom/sync-classroom';
import type { Scene, Stage } from '@/lib/types/stage';
import type { ClassroomGenerationSnapshot } from '@/lib/classroom/classroom-snapshot';

const stage: Stage = {
  id: 'classroom-a',
  name: 'Classroom A',
  createdAt: 1,
  updatedAt: 1,
};

const scene: Scene = {
  id: 'scene-a',
  stageId: stage.id,
  type: 'slide',
  title: 'Scene A',
  order: 1,
  content: {
    type: 'slide',
    canvas: {
      id: 'canvas-a',
      viewportSize: 1000,
      viewportRatio: 0.5625,
      theme: {
        backgroundColor: '#fff',
        themeColors: ['#000'],
        fontColor: '#000',
        fontName: 'Inter',
      },
      elements: [],
    },
  },
};

const generation: ClassroomGenerationSnapshot = {
  outlines: [
    {
      id: 'outline-a',
      type: 'slide',
      title: 'Scene A',
      description: 'First scene',
      keyPoints: ['A'],
      order: 1,
    },
  ],
  generationComplete: false,
  generationStatus: 'generating',
  failedOutlineIds: [],
};

describe('classroom snapshot sync', () => {
  beforeEach(() => resetClassroomSyncStateForTests());

  it('serializes only the durable classroom document', () => {
    expect(JSON.parse(serializeClassroomSnapshot(stage, [scene]))).toEqual({
      stage,
      scenes: [scene],
    });
  });

  it('includes the complete generation plan when supplied', () => {
    expect(JSON.parse(serializeClassroomSnapshot(stage, [scene], generation))).toEqual({
      stage,
      scenes: [scene],
      generation,
    });
  });

  it('deduplicates identical snapshots', async () => {
    const fetcher = vi.fn(async () => new Response('{"success":true}', { status: 201 }));

    await Promise.all([
      queueClassroomSnapshotSync(stage, [scene], fetcher as unknown as typeof fetch),
      queueClassroomSnapshotSync(stage, [scene], fetcher as unknown as typeof fetch),
    ]);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(
      '/api/classroom',
      expect.objectContaining({ method: 'POST', body: serializeClassroomSnapshot(stage, [scene]) }),
    );
  });

  it('allows the same snapshot to be retried after a non-retryable failure', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response('{"error":"bad request"}', { status: 400 }))
      .mockResolvedValueOnce(new Response('{"success":true}', { status: 201 }));

    await expect(
      queueClassroomSnapshotSync(stage, [scene], fetcher as unknown as typeof fetch),
    ).rejects.toThrow('classroom_sync_failed:400');
    await expect(
      queueClassroomSnapshotSync(stage, [scene], fetcher as unknown as typeof fetch),
    ).resolves.toBeUndefined();

    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('does not upload a snapshot that was just hydrated from the server', async () => {
    const fetcher = vi.fn(async () => new Response('{"success":true}', { status: 201 }));

    markClassroomSnapshotPersisted(stage, [scene]);
    await queueClassroomSnapshotSync(stage, [scene], fetcher as unknown as typeof fetch);

    expect(fetcher).not.toHaveBeenCalled();
  });

  it('never overwrites an immutable durable course release from classroom playback', async () => {
    const fetcher = vi.fn(async () => new Response('{"success":true}', { status: 201 }));
    const durableStage: Stage = {
      ...stage,
      learningContext: {
        generationJobId: `cgj_${'a'.repeat(32)}`,
      },
    };

    expect(isDurableClassroomSnapshot(durableStage)).toBe(true);
    await queueClassroomSnapshotSync(
      durableStage,
      [scene],
      fetcher as unknown as typeof fetch,
      generation,
    );
    await persistClassroomSnapshot(
      durableStage,
      [scene],
      fetcher as unknown as typeof fetch,
      generation,
    );

    expect(fetcher).not.toHaveBeenCalled();
  });
});
