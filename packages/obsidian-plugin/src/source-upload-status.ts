import { requestUrl } from 'obsidian';
import { LEARNING_PROTOCOL_VERSION } from '@openmaic/learning-protocol';
import { normalizeServerUrl } from './server-url';

export type SourceUploadStatusValue = 'deleted' | 'pending' | 'rejected' | 'validated';

export interface SourceUploadStatus {
  bundleId: string;
  status: SourceUploadStatusValue;
  projectId?: string;
  projectRevision?: number;
  expectedProjectRevision?: number;
  failureCode?: string;
  indexedChunkCount?: number;
  chunkIndexStatus?: 'pending' | 'ready' | 'failed' | 'purged';
  chunkIndexFailureCode?: string;
  chunkIndexedAt?: string;
}

function parseSourceUploadStatus(value: unknown): SourceUploadStatus {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Source upload status response is invalid.');
  }
  const envelope = value as Record<string, unknown>;
  const candidate = envelope.upload ?? value;
  if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
    throw new Error('Source upload status response is invalid.');
  }
  const record = candidate as Record<string, unknown>;
  const allowed = new Set([
    'bundleId',
    'status',
    'projectId',
    'projectRevision',
    'expectedProjectRevision',
    'failureCode',
    'coverage',
    'bundleRevision',
    'manifestHash',
    'itemCount',
    'sourceByteSize',
    'archiveByteSize',
    'retentionUntil',
    'createdAt',
    'completedAt',
    'projectIndexedAt',
    'indexedChunkCount',
    'chunkIndexStatus',
    'chunkIndexFailureCode',
    'chunkIndexedAt',
  ]);
  if (Object.keys(record).some((key) => !allowed.has(key))) {
    throw new Error('Source upload status response contains an unknown field.');
  }
  if (
    typeof record.bundleId !== 'string' ||
    !/^src_[a-f0-9]{32}$/.test(record.bundleId) ||
    !['deleted', 'pending', 'rejected', 'validated'].includes(String(record.status)) ||
    (record.projectId !== undefined &&
      (typeof record.projectId !== 'string' || !/^prj_[a-f0-9]{32}$/.test(record.projectId))) ||
    (record.projectRevision !== undefined &&
      (typeof record.projectRevision !== 'number' ||
        !Number.isInteger(record.projectRevision) ||
        record.projectRevision < 0)) ||
    (record.expectedProjectRevision !== undefined &&
      (typeof record.expectedProjectRevision !== 'number' ||
        !Number.isInteger(record.expectedProjectRevision) ||
        record.expectedProjectRevision < 0)) ||
    (record.failureCode !== undefined && typeof record.failureCode !== 'string') ||
    (record.indexedChunkCount !== undefined &&
      (typeof record.indexedChunkCount !== 'number' ||
        !Number.isInteger(record.indexedChunkCount) ||
        record.indexedChunkCount < 0)) ||
    (record.chunkIndexStatus !== undefined &&
      !['pending', 'ready', 'failed', 'purged'].includes(String(record.chunkIndexStatus))) ||
    (record.chunkIndexFailureCode !== undefined &&
      typeof record.chunkIndexFailureCode !== 'string') ||
    (record.chunkIndexedAt !== undefined && typeof record.chunkIndexedAt !== 'string')
  ) {
    throw new Error('Source upload status response is invalid.');
  }
  return record as unknown as SourceUploadStatus;
}

function serverError(value: unknown, fallback: string): string {
  if (typeof value !== 'object' || value === null) return fallback;
  const error = (value as { error?: unknown }).error;
  if (typeof error !== 'object' || error === null) return fallback;
  const message = (error as { message?: unknown }).message;
  return typeof message === 'string' && message.length > 0 ? message : fallback;
}

async function wait(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

export async function waitForValidatedSourceUpload(options: {
  serverUrl: string;
  accessToken: string;
  bundleId: string;
  projectId: string;
  expectedProjectRevision: number;
  attempts?: number;
  intervalMs?: number;
  wait?: (milliseconds: number) => Promise<void>;
  requireReadyIndex?: boolean;
}): Promise<SourceUploadStatus> {
  if (!/^src_[a-f0-9]{32}$/.test(options.bundleId)) throw new Error('Invalid SourceBundle id.');
  if (!/^prj_[a-f0-9]{32}$/.test(options.projectId)) throw new Error('Invalid project id.');
  const attempts = Math.max(1, Math.min(60, Math.trunc(options.attempts ?? 60)));
  const intervalMs = Math.max(0, Math.min(10_000, Math.trunc(options.intervalMs ?? 750)));
  const waitForNext = options.wait ?? wait;
  const serverUrl = normalizeServerUrl(options.serverUrl);

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const response = await requestUrl({
      url: `${serverUrl}/api/v1/source-uploads/${options.bundleId}`,
      method: 'GET',
      headers: {
        Authorization: `Bearer ${options.accessToken}`,
        'X-MAIC-Protocol-Version': LEARNING_PROTOCOL_VERSION,
      },
      throw: false,
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(
        serverError(response.json, `Source upload status failed with HTTP ${response.status}.`),
      );
    }
    const status = parseSourceUploadStatus(response.json);
    if (status.bundleId !== options.bundleId) {
      throw new Error('Source upload status references a different SourceBundle.');
    }
    if (status.status === 'validated') {
      if (
        status.projectId !== options.projectId ||
        (status.projectRevision === undefined &&
          status.expectedProjectRevision !== options.expectedProjectRevision)
      ) {
        throw new Error('Validated upload is missing its confirmed project revision.');
      }
      const validated = {
        ...status,
        projectRevision: status.projectRevision ?? options.expectedProjectRevision + 1,
      };
      if (!options.requireReadyIndex) return validated;
      if (status.chunkIndexStatus === 'ready') return validated;
      if (status.chunkIndexStatus === 'failed' || status.chunkIndexStatus === 'purged') {
        throw new Error(
          `项目上传已校验，但检索索引${status.chunkIndexStatus === 'failed' ? '失败' : '已清除'}${
            status.chunkIndexFailureCode ? `：${status.chunkIndexFailureCode}` : '。'
          }`,
        );
      }
    }
    if (status.status === 'rejected' || status.status === 'deleted') {
      throw new Error(
        `Source upload ${status.status}${status.failureCode ? `: ${status.failureCode}` : '.'}`,
      );
    }
    if (attempt + 1 < attempts) await waitForNext(intervalMs);
  }
  throw new Error(
    options.requireReadyIndex
      ? '项目上传已提交，但检索索引未在等待时间内就绪；请稍后重试同步。'
      : 'Source upload validation timed out; local project state was not updated.',
  );
}
