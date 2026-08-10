import { requestUrl } from 'obsidian';
import {
  LEARNING_PROTOCOL_VERSION,
  stampProjectBindingRequest,
  validateProjectBindingRequest,
  validateProjectBindingResponse,
  type ProjectBindingResponse,
} from '@openmaic/learning-protocol';
import { normalizeServerUrl } from './server-url';

const PROJECT_ID_PATTERN = /^prj_[a-f0-9]{32}$/;
const SOURCE_ID_PATTERN = /^sou_[a-f0-9]{32}$/;
const SOURCE_BUNDLE_ID_PATTERN = /^src_[a-f0-9]{32}$/;
const PROJECT_MANIFEST_ID_PATTERN = /^prm_[a-f0-9]{32}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export interface FinalizedProjectSync {
  projectId: string;
  projectRevision: number;
  manifestId: string;
  manifestSha256: string;
  sourceCount: number;
}

function serverError(value: unknown, fallback: string): string {
  if (typeof value !== 'object' || value === null) return fallback;
  const error = (value as { error?: unknown }).error;
  if (typeof error !== 'object' || error === null) return fallback;
  const message = (error as { message?: unknown }).message;
  return typeof message === 'string' && message.length > 0 ? message : fallback;
}

export async function registerProjectBinding(options: {
  serverUrl: string;
  accessToken: string;
  projectId: string;
  displayName: string;
  folderPath: string;
  expectedBindingRevision?: number;
}): Promise<ProjectBindingResponse> {
  const request = stampProjectBindingRequest({
    projectId: options.projectId,
    kind: 'obsidian-folder',
    displayName: options.displayName,
    folderPath: options.folderPath,
    expectedBindingRevision: options.expectedBindingRevision,
  });
  const requestValidation = validateProjectBindingRequest(request);
  if (!requestValidation.valid) {
    throw new Error(
      `Project binding request is invalid (${requestValidation.errors[0]?.path ?? '/'}).`,
    );
  }
  const serverUrl = normalizeServerUrl(options.serverUrl);
  const response = await requestUrl({
    url: `${serverUrl}/api/v1/projects`,
    method: 'POST',
    headers: {
      Authorization: `Bearer ${options.accessToken}`,
      'Content-Type': 'application/json',
      'X-MAIC-Protocol-Version': LEARNING_PROTOCOL_VERSION,
    },
    body: JSON.stringify(request),
    throw: false,
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(
      serverError(response.json, `Project registration failed with HTTP ${response.status}.`),
    );
  }
  const responseValidation = validateProjectBindingResponse(response.json);
  if (!responseValidation.valid) {
    throw new Error(
      `Project binding response is invalid (${responseValidation.errors[0]?.path ?? '/'}).`,
    );
  }
  const binding = response.json as ProjectBindingResponse;
  if (
    binding.projectId !== request.projectId ||
    binding.kind !== request.kind ||
    binding.folderPath !== request.folderPath
  ) {
    throw new Error('Project binding response does not match the requested project.');
  }
  return binding;
}

export async function finalizeProjectSync(options: {
  serverUrl: string;
  accessToken: string;
  projectId: string;
  expectedProjectRevision: number;
  sourceIds: readonly string[];
  sourceBundleId?: string;
}): Promise<FinalizedProjectSync> {
  if (!PROJECT_ID_PATTERN.test(options.projectId)) {
    throw new Error('Project finalization project id is invalid.');
  }
  if (
    !Number.isSafeInteger(options.expectedProjectRevision) ||
    options.expectedProjectRevision < 0
  ) {
    throw new Error('Project finalization revision is invalid.');
  }
  const sourceIds = [...options.sourceIds].sort((left, right) => left.localeCompare(right));
  if (
    sourceIds.length === 0 ||
    sourceIds.some((sourceId) => !SOURCE_ID_PATTERN.test(sourceId)) ||
    new Set(sourceIds).size !== sourceIds.length
  ) {
    throw new Error('Project finalization requires unique canonical source ids.');
  }
  if (
    options.sourceBundleId !== undefined &&
    !SOURCE_BUNDLE_ID_PATTERN.test(options.sourceBundleId)
  ) {
    throw new Error('Project finalization source bundle id is invalid.');
  }

  const serverUrl = normalizeServerUrl(options.serverUrl);
  const response = await requestUrl({
    url: `${serverUrl}/api/v1/projects/${encodeURIComponent(options.projectId)}/finalize-sync`,
    method: 'POST',
    headers: {
      Authorization: `Bearer ${options.accessToken}`,
      'Content-Type': 'application/json',
      'X-MAIC-Protocol-Version': LEARNING_PROTOCOL_VERSION,
    },
    body: JSON.stringify({
      expectedProjectRevision: options.expectedProjectRevision,
      sourceIds,
      ...(options.sourceBundleId ? { sourceBundleId: options.sourceBundleId } : {}),
    }),
    throw: false,
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(
      serverError(response.json, `Project finalization failed with HTTP ${response.status}.`),
    );
  }
  if (typeof response.json !== 'object' || response.json === null) {
    throw new Error('Project finalization response is invalid.');
  }
  const envelope = response.json as Record<string, unknown>;
  // Accept the short-lived nested production response as a compatibility
  // bridge. New servers return the strict flat contract below.
  const value =
    typeof envelope.revision === 'object' &&
    envelope.revision !== null &&
    !Array.isArray(envelope.revision)
      ? (envelope.revision as Record<string, unknown>)
      : envelope;
  if (
    value.projectId !== options.projectId ||
    !Number.isSafeInteger(value.projectRevision) ||
    Number(value.projectRevision) !== options.expectedProjectRevision + 1 ||
    typeof value.manifestId !== 'string' ||
    !PROJECT_MANIFEST_ID_PATTERN.test(value.manifestId) ||
    typeof value.manifestSha256 !== 'string' ||
    !SHA256_PATTERN.test(value.manifestSha256) ||
    !Number.isSafeInteger(value.sourceCount) ||
    Number(value.sourceCount) !== sourceIds.length
  ) {
    throw new Error('Project finalization response does not match the requested revision.');
  }
  return {
    projectId: value.projectId,
    projectRevision: Number(value.projectRevision),
    manifestId: value.manifestId,
    manifestSha256: value.manifestSha256,
    sourceCount: Number(value.sourceCount),
  };
}
