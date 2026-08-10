import { beforeEach, describe, expect, it, vi } from 'vitest';

const records = vi.hoisted(() => new Map<string, Record<string, unknown>>());

vi.mock('@/lib/utils/database', () => ({
  db: {
    stageOutlines: {
      get: vi.fn(async (stageId: string) => records.get(stageId)),
      put: vi.fn(async (record: Record<string, unknown>) => {
        records.set(record.stageId as string, structuredClone(record));
      }),
    },
  },
}));

import {
  loadClassroomGenerationCheckpoint,
  saveClassroomGenerationCheckpoint,
  updateStageOutlinesRecord,
} from '@/lib/generation/classroom-generation-checkpoint';

describe('classroom generation checkpoint', () => {
  beforeEach(() => {
    records.clear();
  });

  it('keeps resume parameters isolated by classroom id', async () => {
    await saveClassroomGenerationCheckpoint('course-a', {
      params: { userProfile: 'learner-a' },
      status: 'generating',
    });
    await saveClassroomGenerationCheckpoint('course-b', {
      params: { userProfile: 'learner-b' },
      status: 'paused',
    });

    await expect(loadClassroomGenerationCheckpoint('course-a')).resolves.toMatchObject({
      stageId: 'course-a',
      params: { userProfile: 'learner-a' },
      status: 'generating',
    });
    await expect(loadClassroomGenerationCheckpoint('course-b')).resolves.toMatchObject({
      stageId: 'course-b',
      params: { userProfile: 'learner-b' },
      status: 'paused',
    });
  });

  it('preserves outlines while generation status changes', async () => {
    await updateStageOutlinesRecord('course-a', {
      outlines: [
        {
          id: 'outline-1',
          type: 'slide',
          title: 'One',
          description: 'First page',
          keyPoints: ['one'],
          order: 1,
        },
      ],
    });
    await saveClassroomGenerationCheckpoint('course-a', {
      status: 'completed',
      failedOutlineIds: [],
    });

    expect(records.get('course-a')).toMatchObject({
      generationStatus: 'completed',
      outlines: [{ id: 'outline-1', order: 1 }],
    });
  });

  it('stores image references without duplicating IndexedDB base64 payloads', async () => {
    await saveClassroomGenerationCheckpoint('course-a', {
      params: {
        pdfImages: [
          {
            id: 'image-1',
            src: 'data:image/png;base64,very-large-payload',
            storageId: 'stored-image-1',
            pageNumber: 1,
          },
        ],
      },
    });

    await expect(loadClassroomGenerationCheckpoint('course-a')).resolves.toMatchObject({
      params: {
        pdfImages: [{ storageId: 'stored-image-1', src: '' }],
      },
    });
  });
});
