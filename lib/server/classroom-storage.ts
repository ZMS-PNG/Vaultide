import { promises as fs } from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import type { NextRequest } from 'next/server';
import type { Scene, Stage } from '@/lib/types/stage';
import type { ClassroomGenerationSnapshot } from '@/lib/classroom/classroom-snapshot';
import { loadPairingConfig } from '@/lib/learning/config';
import { NeonClassroomRepository } from '@/lib/learning/adapters/neon/classroom-repository';
import { VercelClassroomBlobStore } from '@/lib/learning/adapters/vercel/classroom-blob-store';

export const CLASSROOMS_DIR = path.join(process.cwd(), 'data', 'classrooms');
export const CLASSROOM_JOBS_DIR = path.join(process.cwd(), 'data', 'classroom-jobs');

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

export async function ensureClassroomsDir() {
  await ensureDir(CLASSROOMS_DIR);
}

export async function ensureClassroomJobsDir() {
  await ensureDir(CLASSROOM_JOBS_DIR);
}

export async function writeJsonFileAtomic(filePath: string, data: unknown) {
  const dir = path.dirname(filePath);
  await ensureDir(dir);

  const tempFilePath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const content = JSON.stringify(data, null, 2);
  await fs.writeFile(tempFilePath, content, 'utf-8');
  await fs.rename(tempFilePath, filePath);
}

function firstForwardedHeaderValue(value: string | null): string | undefined {
  const first = value?.split(',')[0]?.trim();
  return first || undefined;
}

/**
 * Build an internal workflow origin from a proxied request without trusting a
 * raw forwarded-header string as a URL. Proxies may append comma-separated
 * values, and a malformed forwarded value must not turn a valid local request
 * into a durable workflow that fails later with `Invalid URL`.
 */
export function buildRequestOrigin(req: NextRequest): string {
  const forwardedHost = firstForwardedHeaderValue(req.headers.get('x-forwarded-host'));
  const forwardedProto = firstForwardedHeaderValue(req.headers.get('x-forwarded-proto'));
  if (forwardedHost) {
    try {
      const parsed = new URL(`${forwardedProto || 'http'}://${forwardedHost}`);
      if ((parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.hostname) {
        return parsed.origin;
      }
    } catch {
      // Fall through to the request URL. A workflow should remain resumable
      // when an intermediary emits a malformed forwarding header.
    }
  }
  return req.nextUrl.origin;
}

export interface PersistedClassroomData {
  id: string;
  stage: Stage;
  scenes: Scene[];
  generation?: ClassroomGenerationSnapshot;
  createdAt: string;
  updatedAt?: string;
  revision?: number;
}

export function isValidClassroomId(id: string): boolean {
  return id.length >= 1 && id.length <= 128 && /^[a-zA-Z0-9_-]+$/.test(id);
}

function cloudClassroomStorageOwnerId(): string | null {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return null;
  try {
    return loadPairingConfig().ownerId;
  } catch {
    return null;
  }
}

function classroomBlobPathname(
  ownerId: string,
  classroomId: string,
  snapshotSha256: string,
): string {
  return `classrooms/${ownerId}/${classroomId}/snapshots/${snapshotSha256}.json`;
}

function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

function parseClassroomSnapshot(content: string, expectedId: string): PersistedClassroomData {
  const value = JSON.parse(content) as Partial<PersistedClassroomData>;
  if (
    value.id !== expectedId ||
    !value.stage ||
    value.stage.id !== expectedId ||
    !Array.isArray(value.scenes) ||
    typeof value.createdAt !== 'string'
  ) {
    throw new Error('invalid_classroom_snapshot');
  }
  return value as PersistedClassroomData;
}

async function readCloudClassroom(
  ownerId: string,
  id: string,
): Promise<ReadClassroomResult | null> {
  const repository = new NeonClassroomRepository();
  const metadata = await repository.find(ownerId, id);
  if (!metadata) return null;

  const content = await new VercelClassroomBlobStore().read(metadata.snapshotBlobPathname);
  if (content === null) throw new Error('classroom_snapshot_blob_missing');
  if (Buffer.byteLength(content, 'utf8') !== metadata.snapshotByteSize) {
    throw new Error('classroom_snapshot_size_mismatch');
  }
  if (sha256(content) !== metadata.snapshotSha256) {
    throw new Error('classroom_snapshot_hash_mismatch');
  }

  const classroom = parseClassroomSnapshot(content, id);
  return {
    classroom: {
      ...classroom,
      revision: metadata.revision,
      createdAt: metadata.createdAt.toISOString(),
      updatedAt: metadata.updatedAt.toISOString(),
    },
    snapshotSha256: metadata.snapshotSha256,
    snapshotByteSize: metadata.snapshotByteSize,
    snapshotPathname: metadata.snapshotBlobPathname,
  };
}

async function readFilesystemClassroom(id: string): Promise<ReadClassroomResult | null> {
  const filePath = path.join(CLASSROOMS_DIR, `${id}.json`);
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return {
      classroom: JSON.parse(content) as PersistedClassroomData,
      snapshotSha256: sha256(content),
      snapshotByteSize: Buffer.byteLength(content, 'utf8'),
      snapshotPathname: filePath,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

export interface ReadClassroomResult {
  classroom: PersistedClassroomData;
  snapshotSha256: string;
  snapshotByteSize: number;
  snapshotPathname: string;
}

export async function readClassroomWithMetadata(id: string): Promise<ReadClassroomResult | null> {
  const ownerId = cloudClassroomStorageOwnerId();
  if (ownerId) {
    const classroom = await readCloudClassroom(ownerId, id);
    if (classroom) return classroom;
  }
  return readFilesystemClassroom(id);
}

export async function readClassroom(id: string): Promise<PersistedClassroomData | null> {
  return (await readClassroomWithMetadata(id))?.classroom ?? null;
}

export interface PersistedClassroomResult extends PersistedClassroomData {
  url: string;
  snapshotSha256: string;
  snapshotByteSize: number;
  snapshotPathname: string;
}

async function persistCloudClassroom(
  ownerId: string,
  data: {
    id: string;
    stage: Stage;
    scenes: Scene[];
    generation?: ClassroomGenerationSnapshot;
  },
  baseUrl: string,
): Promise<PersistedClassroomResult> {
  const repository = new NeonClassroomRepository();
  const existing = await repository.find(ownerId, data.id);
  const now = new Date();
  const classroomData: PersistedClassroomData = {
    id: data.id,
    stage: data.stage,
    scenes: data.scenes,
    generation: data.generation,
    createdAt: existing?.createdAt.toISOString() ?? now.toISOString(),
    updatedAt: now.toISOString(),
  };
  const content = JSON.stringify(classroomData);
  const digest = sha256(content);
  const pathname = classroomBlobPathname(ownerId, data.id, digest);
  const stored = await new VercelClassroomBlobStore().write(pathname, content);
  const metadata = await repository.save({
    ownerId,
    classroomId: data.id,
    snapshotBlobPathname: stored.pathname,
    snapshotBlobUrl: stored.url,
    snapshotSha256: digest,
    snapshotByteSize: stored.byteSize,
    sceneCount: data.scenes.length,
    now,
  });

  return {
    ...classroomData,
    revision: metadata.revision,
    createdAt: metadata.createdAt.toISOString(),
    updatedAt: metadata.updatedAt.toISOString(),
    url: `${baseUrl}/classroom/${data.id}`,
    snapshotSha256: digest,
    snapshotByteSize: stored.byteSize,
    snapshotPathname: stored.pathname,
  };
}

async function persistFilesystemClassroom(
  data: {
    id: string;
    stage: Stage;
    scenes: Scene[];
    generation?: ClassroomGenerationSnapshot;
  },
  baseUrl: string,
): Promise<PersistedClassroomResult> {
  const now = new Date().toISOString();
  const classroomData: PersistedClassroomData = {
    id: data.id,
    stage: data.stage,
    scenes: data.scenes,
    generation: data.generation,
    createdAt: now,
    updatedAt: now,
  };

  await ensureClassroomsDir();
  const filePath = path.join(CLASSROOMS_DIR, `${data.id}.json`);
  await writeJsonFileAtomic(filePath, classroomData);
  const content = JSON.stringify(classroomData, null, 2);

  return {
    ...classroomData,
    url: `${baseUrl}/classroom/${data.id}`,
    snapshotSha256: sha256(content),
    snapshotByteSize: Buffer.byteLength(content, 'utf8'),
    snapshotPathname: filePath,
  };
}

export async function persistClassroom(
  data: {
    id: string;
    stage: Stage;
    scenes: Scene[];
    generation?: ClassroomGenerationSnapshot;
  },
  baseUrl: string,
): Promise<PersistedClassroomResult> {
  const ownerId = cloudClassroomStorageOwnerId();
  if (ownerId) return persistCloudClassroom(ownerId, data, baseUrl);
  return persistFilesystemClassroom(data, baseUrl);
}
