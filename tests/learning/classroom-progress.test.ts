import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const recordClassroomLearningEvents = vi.hoisted(() => vi.fn());

vi.mock('@/lib/learning/client/learning-events', () => ({
  recordClassroomLearningEvents,
}));

import {
  getClassroomProgressSnapshot,
  recordClassroomSceneViewed,
} from '@/lib/learning/client/classroom-progress';

describe('classroom scene progress', () => {
  const values = new Map<string, string>();

  beforeEach(() => {
    recordClassroomLearningEvents.mockReset();
    values.clear();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    });
    vi.stubGlobal('window', { dispatchEvent: vi.fn() });
    vi.stubGlobal(
      'CustomEvent',
      class<T> {
        constructor(
          readonly type: string,
          readonly init?: { detail?: T },
        ) {}

        get detail(): T | undefined {
          return this.init?.detail;
        }
      },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('records the current scene on the server and persists the authoritative completion list', async () => {
    recordClassroomLearningEvents.mockResolvedValue({
      accepted: 1,
      deduplicated: 0,
      sprintId: 'sprint-1',
      completion: {
        completedSceneIds: ['scene-1', 'scene-2'],
        totalSceneCount: 11,
        completed: false,
      },
    });

    const completed = await recordClassroomSceneViewed({
      classroomId: 'classroom-1',
      sceneId: 'scene-2',
      sceneOrder: 1,
      completionKind: 'manual',
      completedSceneIds: ['scene-1'],
    });

    expect(completed).toEqual(['scene-1', 'scene-2']);
    expect(recordClassroomLearningEvents).toHaveBeenCalledWith('classroom-1', [
      expect.objectContaining({
        eventType: 'sceneCompleted',
        payload: {
          sceneId: 'scene-2',
          sceneOrder: 1,
          completionKind: 'manual',
        },
      }),
    ]);
    expect(JSON.parse(getClassroomProgressSnapshot('classroom-1'))).toEqual([
      'scene-1',
      'scene-2',
    ]);
  });

  it('keeps a safe local completion list when the server omits the optional completion view', async () => {
    recordClassroomLearningEvents.mockResolvedValue({
      accepted: 1,
      deduplicated: 0,
      sprintId: 'sprint-1',
    });

    const completed = await recordClassroomSceneViewed({
      classroomId: 'classroom-1',
      sceneId: 'scene-2',
      sceneOrder: 1,
      completionKind: 'manual',
      completedSceneIds: ['scene-1', 'scene-1'],
    });

    expect(completed).toEqual(['scene-1', 'scene-2']);
    expect(JSON.parse(getClassroomProgressSnapshot('classroom-1'))).toEqual([
      'scene-1',
      'scene-2',
    ]);
  });
});
