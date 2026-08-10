import type { Scene, Stage } from '@/lib/types/stage';
import type { ClassroomGenerationSnapshot } from '@/lib/classroom/classroom-snapshot';

type FetchLike = typeof fetch;

interface SyncState {
  lastQueuedBody: string | null;
  lastPersistedBody: string | null;
  tail: Promise<void>;
}

const syncStates = new Map<string, SyncState>();
const DURABLE_GENERATION_JOB_ID = /^cgj_[a-f0-9]{32}$/;

export function isDurableClassroomSnapshot(stage: Stage): boolean {
  const generationJobId = stage.learningContext?.generationJobId;
  return typeof generationJobId === 'string' && DURABLE_GENERATION_JOB_ID.test(generationJobId);
}

function getSyncState(classroomId: string): SyncState {
  let state = syncStates.get(classroomId);
  if (!state) {
    state = {
      lastQueuedBody: null,
      lastPersistedBody: null,
      tail: Promise.resolve(),
    };
    syncStates.set(classroomId, state);
  }
  return state;
}

async function postSnapshot(body: string, fetcher: FetchLike): Promise<void> {
  let lastError: unknown;
  const retryDelays = [0, 400, 1_200];
  for (let attempt = 0; attempt < retryDelays.length; attempt++) {
    if (retryDelays[attempt] > 0) {
      await new Promise((resolve) => setTimeout(resolve, retryDelays[attempt]));
    }
    try {
      const response = await fetcher('/api/classroom', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body,
      });
      if (response.ok) return;
      const detail = (await response.text()).slice(0, 500);
      const error = new Error(`classroom_sync_failed:${response.status}:${detail}`);
      if (response.status < 500 && response.status !== 429) throw error;
      lastError = error;
    } catch (error) {
      lastError = error;
      if (
        error instanceof Error &&
        error.message.startsWith('classroom_sync_failed:') &&
        !error.message.startsWith('classroom_sync_failed:429:')
      ) {
        const status = Number(error.message.split(':')[1]);
        if (status >= 400 && status < 500) throw error;
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error('classroom_sync_failed');
}

export function serializeClassroomSnapshot(
  stage: Stage,
  scenes: readonly Scene[],
  generation?: ClassroomGenerationSnapshot,
): string {
  return JSON.stringify({ stage, scenes, generation });
}

export async function persistClassroomSnapshot(
  stage: Stage,
  scenes: readonly Scene[],
  fetcher: FetchLike = fetch,
  generation?: ClassroomGenerationSnapshot,
): Promise<void> {
  if (!stage.id || scenes.length === 0 || isDurableClassroomSnapshot(stage)) return;
  await postSnapshot(serializeClassroomSnapshot(stage, scenes, generation), fetcher);
}

export function queueClassroomSnapshotSync(
  stage: Stage,
  scenes: readonly Scene[],
  fetcher: FetchLike = fetch,
  generation?: ClassroomGenerationSnapshot,
): Promise<void> {
  if (!stage.id || scenes.length === 0 || isDurableClassroomSnapshot(stage)) {
    return Promise.resolve();
  }

  const body = serializeClassroomSnapshot(stage, scenes, generation);
  const state = getSyncState(stage.id);
  if (body === state.lastQueuedBody) return state.tail;

  state.lastQueuedBody = body;
  const queued = state.tail
    .catch(() => undefined)
    .then(async () => {
      if (body === state.lastPersistedBody) return;
      await postSnapshot(body, fetcher);
      state.lastPersistedBody = body;
    })
    .catch((error) => {
      if (state.lastQueuedBody === body) state.lastQueuedBody = null;
      throw error;
    });
  state.tail = queued;
  return queued;
}

export function markClassroomSnapshotPersisted(
  stage: Stage,
  scenes: readonly Scene[],
  generation?: ClassroomGenerationSnapshot,
): void {
  if (!stage.id || scenes.length === 0) return;
  const body = serializeClassroomSnapshot(stage, scenes, generation);
  const state = getSyncState(stage.id);
  state.lastQueuedBody = body;
  state.lastPersistedBody = body;
}

export function resetClassroomSyncStateForTests(): void {
  syncStates.clear();
}
