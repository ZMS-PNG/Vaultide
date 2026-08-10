import type {
  PersistedGenerationParams,
  PersistedGenerationStatus,
  StageOutlinesRecord,
} from '@/lib/utils/database';
import { db } from '@/lib/utils/database';

export interface ClassroomGenerationCheckpoint {
  stageId: string;
  params?: PersistedGenerationParams;
  status: PersistedGenerationStatus;
  failedOutlineIds: string[];
  lastError?: string;
  updatedAt: number;
}

export interface ClassroomGenerationCheckpointPatch {
  params?: PersistedGenerationParams;
  status?: PersistedGenerationStatus;
  failedOutlineIds?: string[];
  lastError?: string;
}

function sanitizeParams(params: PersistedGenerationParams): PersistedGenerationParams {
  return {
    ...params,
    // Extracted images already live in IndexedDB. Persist only their references
    // here so a large base64 payload cannot make the resume checkpoint fragile.
    pdfImages: params.pdfImages?.map((image) => ({
      ...image,
      src: image.storageId ? '' : image.src,
    })),
  };
}

export async function updateStageOutlinesRecord(
  stageId: string,
  patch: Partial<Omit<StageOutlinesRecord, 'stageId' | 'createdAt' | 'updatedAt'>>,
): Promise<StageOutlinesRecord> {
  const now = Date.now();
  const existing = await db.stageOutlines.get(stageId);
  const next: StageOutlinesRecord = {
    ...existing,
    ...patch,
    stageId,
    outlines: patch.outlines ?? existing?.outlines ?? [],
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  await db.stageOutlines.put(next);
  return next;
}

export async function saveClassroomGenerationCheckpoint(
  stageId: string,
  patch: ClassroomGenerationCheckpointPatch,
): Promise<ClassroomGenerationCheckpoint> {
  const existing = await db.stageOutlines.get(stageId);
  const params = patch.params ? sanitizeParams(patch.params) : existing?.generationParams;
  const status = patch.status ?? existing?.generationStatus ?? 'pending';
  const failedOutlineIds = patch.failedOutlineIds ?? existing?.generationFailedOutlineIds ?? [];
  const lastError =
    patch.lastError === undefined ? existing?.lastGenerationError : patch.lastError || undefined;

  const next = await updateStageOutlinesRecord(stageId, {
    generationParams: params,
    generationStatus: status,
    generationFailedOutlineIds: failedOutlineIds,
    lastGenerationError: lastError,
  });

  return {
    stageId,
    params: next.generationParams,
    status: next.generationStatus ?? 'pending',
    failedOutlineIds: next.generationFailedOutlineIds ?? [],
    lastError: next.lastGenerationError,
    updatedAt: next.updatedAt,
  };
}

export async function loadClassroomGenerationCheckpoint(
  stageId: string,
): Promise<ClassroomGenerationCheckpoint | null> {
  const record = await db.stageOutlines.get(stageId);
  if (!record) return null;

  return {
    stageId,
    params: record.generationParams,
    status: record.generationStatus ?? (record.generationComplete ? 'completed' : 'pending'),
    failedOutlineIds: record.generationFailedOutlineIds ?? [],
    lastError: record.lastGenerationError,
    updatedAt: record.updatedAt,
  };
}
