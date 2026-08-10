import { recordClassroomLearningEvents } from '@/lib/learning/client/learning-events';

export const CLASSROOM_PROGRESS_UPDATED_EVENT = 'vaultide:classroom-progress-updated';
export const OPEN_LEARNING_PROGRESS_EVENT = 'vaultide:open-learning-progress';
export const OPEN_OBSIDIAN_WRITEBACK_EVENT = 'vaultide:open-obsidian-writeback';

function progressKey(classroomId: string): string {
  return `vaultide:classroom-progress:v1:${classroomId}`;
}

export function getClassroomProgressSnapshot(classroomId: string): string {
  try {
    return localStorage.getItem(progressKey(classroomId)) ?? '[]';
  } catch {
    return '[]';
  }
}

export function readPersistedCompletedScenes(classroomId: string): string[] {
  try {
    const value = JSON.parse(getClassroomProgressSnapshot(classroomId));
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
}

export function writePersistedCompletedScenes(
  classroomId: string,
  sceneIds: readonly string[],
): void {
  const completedSceneIds = [...new Set(sceneIds)];
  try {
    localStorage.setItem(progressKey(classroomId), JSON.stringify(completedSceneIds));
  } catch {
    // Local persistence is an experience enhancement. The server event remains authoritative.
  }

  window.dispatchEvent(
    new CustomEvent(CLASSROOM_PROGRESS_UPDATED_EVENT, {
      detail: { classroomId, completedSceneIds },
    }),
  );
}

export async function recordClassroomSceneViewed(input: {
  classroomId: string;
  sceneId: string;
  sceneOrder: number;
  completionKind: 'manual' | 'quiz-submitted';
  completedSceneIds: readonly string[];
}): Promise<string[]> {
  const nextIds = [...new Set([...input.completedSceneIds, input.sceneId])];
  const result = await recordClassroomLearningEvents(input.classroomId, [
    {
      eventType: 'sceneCompleted',
      clientEventId: `scene-completed:${input.classroomId}:${input.sceneId}`.slice(0, 160),
      occurredAt: new Date().toISOString(),
      payload: {
        sceneId: input.sceneId,
        sceneOrder: input.sceneOrder,
        completionKind: input.completionKind,
      },
    },
  ]);
  const acceptedIds = result.completion?.completedSceneIds ?? nextIds;
  writePersistedCompletedScenes(input.classroomId, acceptedIds);
  return acceptedIds;
}

export function subscribeClassroomProgress(
  classroomId: string,
  onStoreChange: () => void,
): () => void {
  const handleProgress = (event: Event) => {
    const detail = (event as CustomEvent<{ classroomId?: string; completedSceneIds?: string[] }>)
      .detail;
    if (detail?.classroomId === classroomId) onStoreChange();
  };
  const handleStorage = (event: StorageEvent) => {
    if (event.key === progressKey(classroomId)) onStoreChange();
  };
  window.addEventListener(CLASSROOM_PROGRESS_UPDATED_EVENT, handleProgress);
  window.addEventListener('storage', handleStorage);
  return () => {
    window.removeEventListener(CLASSROOM_PROGRESS_UPDATED_EVENT, handleProgress);
    window.removeEventListener('storage', handleStorage);
  };
}

export function openClassroomLearningPanel(
  eventName: typeof OPEN_LEARNING_PROGRESS_EVENT | typeof OPEN_OBSIDIAN_WRITEBACK_EVENT,
  classroomId: string,
): void {
  window.dispatchEvent(new CustomEvent(eventName, { detail: { classroomId } }));
}
