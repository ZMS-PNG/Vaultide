import { createHash } from 'node:crypto';
import { VercelClassroomBlobStore } from '@/lib/learning/adapters/vercel/classroom-blob-store';
import {
  persistClassroom,
  type PersistedClassroomData,
} from '@/lib/server/classroom-storage';
import type { Scene } from '@/lib/types/stage';
import type { CourseGenerationJobRecord, CourseGenerationStepRecord } from './types';

// Vercel Functions reject request or response payloads above 4.5 MB. Keep a
// deliberate margin for the API success envelope and platform accounting.
export const VERCEL_FUNCTION_MAX_PAYLOAD_BYTES = 4_500_000;
export const CLASSROOM_RESPONSE_SAFETY_MARGIN_BYTES = 250_000;
export const MAX_CLASSROOM_API_RESPONSE_BYTES =
  VERCEL_FUNCTION_MAX_PAYLOAD_BYTES - CLASSROOM_RESPONSE_SAFETY_MARGIN_BYTES;

export interface StagedCourseClassroomSnapshot {
  snapshotSha256: string;
  snapshotByteSize: number;
  storage: 'cloud' | 'filesystem';
  snapshotBlobPathname?: string;
  snapshotBlobUrl?: string;
}

export class CourseClassroomSnapshotTooLargeError extends Error {
  readonly code = 'CLASSROOM_SNAPSHOT_TOO_LARGE';
  readonly retryable = false;

  constructor(
    readonly responseByteSize: number,
    readonly maximumResponseByteSize = MAX_CLASSROOM_API_RESPONSE_BYTES,
  ) {
    super(
      `Classroom snapshot response is ${responseByteSize} bytes; the durable release ceiling is ${maximumResponseByteSize} bytes.`,
    );
    this.name = 'CourseClassroomSnapshotTooLargeError';
  }
}

export class DurableClassroomStorageUnavailableError extends Error {
  readonly code = 'DURABLE_CLASSROOM_STORAGE_UNAVAILABLE';
  readonly retryable = false;

  constructor() {
    super('Durable classroom Blob storage is required for a production course release.');
    this.name = 'DurableClassroomStorageUnavailableError';
  }
}

export function classroomApiResponseByteSize(snapshot: PersistedClassroomData): number {
  return Buffer.byteLength(JSON.stringify({ success: true, classroom: snapshot }), 'utf8');
}

export function assertClassroomSnapshotFitsFunctionResponse(
  snapshot: PersistedClassroomData,
): number {
  const responseByteSize = classroomApiResponseByteSize(snapshot);
  if (responseByteSize > MAX_CLASSROOM_API_RESPONSE_BYTES) {
    throw new CourseClassroomSnapshotTooLargeError(responseByteSize);
  }
  return responseByteSize;
}

export function buildDeterministicClassroomSnapshot(input: {
  job: CourseGenerationJobRecord;
  releaseStep: CourseGenerationStepRecord;
  scenes: Scene[];
}): PersistedClassroomData {
  const updatedAt = (
    input.releaseStep.startedAt ??
    input.job.startedAt ??
    input.job.createdAt
  ).toISOString();
  const generation = {
    outlines: input.job.input.outlines,
    generationComplete: true,
    generationStatus: 'completed' as const,
    failedOutlineIds: [],
  };
  const stage = {
    ...input.job.input.stage,
    updatedAt: new Date(updatedAt).getTime(),
    learningContext: {
      ...input.job.input.stage.learningContext,
      learningSessionId: input.job.sessionId,
      contextPackId: input.job.contextPackId,
      generationJobId: input.job.id,
      ...(input.job.input.stage.learningContext?.knowledgeSnapshotId
        ? { knowledgeSnapshotId: input.job.input.stage.learningContext.knowledgeSnapshotId }
        : {}),
    },
  };
  return {
    id: input.job.classroomId,
    stage,
    scenes: input.scenes,
    generation,
    createdAt: input.job.createdAt.toISOString(),
    updatedAt,
  };
}

function snapshotSha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

function cloudSnapshotPathname(
  ownerId: string,
  classroomId: string,
  snapshotHash: string,
): string {
  return `classrooms/${ownerId}/${classroomId}/snapshots/${snapshotHash}.json`;
}

export async function stageCourseClassroomSnapshot(input: {
  job: CourseGenerationJobRecord;
  releaseStep: CourseGenerationStepRecord;
  scenes: Scene[];
}): Promise<StagedCourseClassroomSnapshot> {
  const snapshot = buildDeterministicClassroomSnapshot(input);
  assertClassroomSnapshotFitsFunctionResponse(snapshot);
  const content = JSON.stringify(snapshot);
  const digest = snapshotSha256(content);

  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const stored = await new VercelClassroomBlobStore().write(
      cloudSnapshotPathname(input.job.ownerId, input.job.classroomId, digest),
      content,
    );
    const expectedByteSize = Buffer.byteLength(content, 'utf8');
    if (stored.byteSize !== expectedByteSize) {
      throw new Error('classroom_snapshot_staging_size_mismatch');
    }
    return {
      snapshotSha256: digest,
      snapshotByteSize: stored.byteSize,
      storage: 'cloud',
      snapshotBlobPathname: stored.pathname,
      snapshotBlobUrl: stored.url,
    };
  }

  if (process.env.VERCEL === '1') {
    throw new DurableClassroomStorageUnavailableError();
  }

  const persisted = await persistClassroom(
    {
      id: snapshot.id,
      stage: snapshot.stage,
      scenes: snapshot.scenes,
      generation: snapshot.generation,
    },
    input.job.input.baseUrl,
  );
  return {
    snapshotSha256: persisted.snapshotSha256,
    snapshotByteSize: persisted.snapshotByteSize,
    storage: 'filesystem',
  };
}
