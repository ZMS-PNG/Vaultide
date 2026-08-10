import { createHash, randomUUID } from 'node:crypto';
import {
  validateProjectBindingRequest as validateProjectBindingRegistration,
  type ApiErrorCode,
  type JsonObject,
  type ProjectBindingRequest as ProjectBindingRegistration,
} from '@openmaic/learning-protocol';
import type { DeviceTokenService } from './device-token-service';
import type { DeviceTokenPrincipal } from '../domain/device-token';
import {
  PROJECT_ID_PATTERN,
  type LearningProjectRecord,
  type ProjectBindingInput,
  type ProjectStatusRecord,
  type ProjectStatusView,
} from '../domain/project';
import type { ProjectRepository } from '../ports/project-repository';

const VAULT_ID_PATTERN = /^vlt_[a-f0-9]{32}$/;
const SOURCE_ID_PATTERN = /^sou_[a-f0-9]{32}$/;
const SOURCE_BUNDLE_ID_PATTERN = /^src_[a-f0-9]{32}$/;

interface FinalizeProjectRevisionRequest {
  expectedProjectRevision: number;
  sourceIds: string[];
  sourceBundleId?: string;
}

export interface FinalizedProjectRevision {
  projectId: string;
  projectRevision: number;
  manifestId: string;
  manifestSha256: string;
  sourceCount: number;
}

export class ProjectServiceError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ProjectServiceError';
  }
}

function cleanRootPath(value: string): string {
  const normalized = value
    .normalize('NFC')
    .replaceAll('\\', '/')
    .replace(/\/+/g, '/')
    .replace(/^\/+|\/+$/g, '');
  if (
    normalized.length > 1024 ||
    /[\u0000-\u001f\u007f]/.test(normalized) ||
    normalized.split('/').some((part) => part === '.' || part === '..')
  ) {
    throw new ProjectServiceError('invalid_request', 400, 'Project root path is invalid.');
  }
  return normalized;
}

function cleanDisplayName(value: string, rootPath: string): string {
  const displayName = value
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  if (displayName) return displayName;
  return rootPath.split('/').at(-1) || 'Obsidian Project';
}

function statusView(value: ProjectStatusRecord): ProjectStatusView {
  const project = value.project;
  return {
    projectId: project.id,
    vaultBindingId: project.vaultBindingId,
    kind: project.kind,
    projectName: project.projectName,
    rootPath: project.rootPath,
    status: project.status,
    bindingRevision: project.bindingRevision,
    projectRevision: project.projectRevision,
    ...(project.latestManifestHash ? { latestManifestHash: project.latestManifestHash } : {}),
    sourceCount: value.activeSourceCount,
    ...(project.lastIndexedAt ? { lastIndexedAt: project.lastIndexedAt.toISOString() } : {}),
    ...(value.latestUpload
      ? {
          latestUpload: {
            bundleId: value.latestUpload.bundleId,
            manifestHash: value.latestUpload.manifestHash,
            status: value.latestUpload.status,
            coverage: value.latestUpload.coverage,
            ...(value.latestUpload.bundleRevision !== undefined
              ? { bundleRevision: value.latestUpload.bundleRevision }
              : {}),
            itemCount: value.latestUpload.itemCount,
            createdAt: value.latestUpload.createdAt.toISOString(),
            ...(value.latestUpload.completedAt
              ? { completedAt: value.latestUpload.completedAt.toISOString() }
              : {}),
          },
        }
      : {}),
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  };
}

export class ProjectService {
  constructor(
    private readonly repository: ProjectRepository,
    private readonly tokens: DeviceTokenService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async register(accessToken: string, value: unknown): Promise<LearningProjectRecord> {
    const principal = await this.tokens.authenticateAccess(accessToken, 'sources:write');
    return this.registerForPrincipal(principal, value);
  }

  async registerForPrincipal(
    principal: DeviceTokenPrincipal,
    value: unknown,
  ): Promise<LearningProjectRecord> {
    const validation = validateProjectBindingRegistration(value);
    if (!validation.valid) {
      throw new ProjectServiceError(
        'learning_contract_invalid',
        422,
        `Project binding is invalid: ${validation.errors[0]?.path ?? '/'}.`,
      );
    }
    const input = this.binding(value as ProjectBindingRegistration, principal.vaultBindingId);
    const saved = await this.repository.register(principal, input, this.now());
    if (!saved) {
      throw new ProjectServiceError(
        'conflict',
        409,
        'Project id or Vault folder is already bound to different immutable metadata.',
      );
    }
    return saved;
  }

  async status(accessToken: string, projectId: string): Promise<ProjectStatusView> {
    if (!PROJECT_ID_PATTERN.test(projectId)) {
      throw new ProjectServiceError('invalid_request', 400, 'Invalid project id.');
    }
    const principal = await this.tokens.authenticateAccess(accessToken, 'sources:write');
    const found = await this.repository.findStatus(principal, projectId);
    if (!found) {
      throw new ProjectServiceError('invalid_request', 404, 'Project was not found.');
    }
    return statusView(found);
  }

  async finalizeRevision(
    accessToken: string,
    projectId: string,
    value: unknown,
  ): Promise<FinalizedProjectRevision> {
    if (!PROJECT_ID_PATTERN.test(projectId)) {
      throw new ProjectServiceError('invalid_request', 400, 'Invalid project id.');
    }
    const principal = await this.tokens.authenticateAccess(accessToken, 'sources:write');
    const input = this.finalizeRevisionInput(value);
    const candidates = await this.repository.listRevisionCandidates(
      principal,
      projectId,
      input.sourceIds,
    );
    if (candidates.length !== input.sourceIds.length) {
      throw new ProjectServiceError(
        'conflict',
        409,
        'Project sources changed during synchronization. Refresh the project and retry.',
      );
    }

    const sourceIds = new Set(candidates.map((candidate) => candidate.sourceId));
    if (input.sourceIds.some((sourceId) => !sourceIds.has(sourceId))) {
      throw new ProjectServiceError(
        'conflict',
        409,
        'One or more project sources are unavailable or no longer current.',
      );
    }

    const entries = [...candidates].sort((left, right) =>
      left.sourceId.localeCompare(right.sourceId),
    );
    const canonicalManifest = JSON.stringify({
      projectId,
      expectedProjectRevision: input.expectedProjectRevision,
      entries: entries.map((entry) => ({
        sourceId: entry.sourceId,
        sourceVersionId: entry.sourceVersionId,
        relativePath: entry.relativePath,
        contentHash: entry.contentHash,
        sourceMtime: entry.sourceMtime?.toISOString() ?? null,
      })),
    });
    const manifestSha256 = createHash('sha256')
      .update(canonicalManifest, 'utf8')
      .digest('hex');
    const manifestId = `prm_${randomUUID().replaceAll('-', '')}`;
    const finalized = await this.repository.finalizeRevision(
      principal,
      {
        projectId,
        expectedProjectRevision: input.expectedProjectRevision,
        manifestId,
        manifestSha256,
        ...(input.sourceBundleId ? { sourceBundleId: input.sourceBundleId } : {}),
        entries,
      },
      this.now(),
    );
    if (!finalized) {
      throw new ProjectServiceError(
        'conflict',
        409,
        'Project sources or revision changed before finalization. Refresh and retry.',
      );
    }
    return {
      projectId,
      projectRevision: finalized.projectRevision,
      manifestId: finalized.manifestId,
      manifestSha256,
      sourceCount: entries.length,
    };
  }

  private binding(value: ProjectBindingRegistration, vaultBindingId: string): ProjectBindingInput {
    const source = value as ProjectBindingRegistration & Record<string, unknown>;
    const projectId = String(source.projectId ?? '');
    const rootPath = cleanRootPath(String(source.folderPath ?? ''));
    const kind = String(source.kind ?? 'obsidian-folder');
    const projectName = cleanDisplayName(String(source.displayName ?? ''), rootPath);
    if (
      !PROJECT_ID_PATTERN.test(projectId) ||
      !VAULT_ID_PATTERN.test(vaultBindingId) ||
      !/^[a-z][a-z0-9-]{1,39}$/.test(kind)
    ) {
      throw new ProjectServiceError('invalid_request', 400, 'Project binding identity is invalid.');
    }
    const metadata = {} as JsonObject;
    const bindingKeyHash = createHash('sha256')
      .update(`${vaultBindingId}\0${rootPath}`, 'utf8')
      .digest('hex');
    return {
      projectId,
      vaultBindingId,
      kind,
      projectName,
      rootPath,
      bindingKeyHash,
      metadata,
      ...(typeof source.expectedBindingRevision === 'number'
        ? { expectedBindingRevision: source.expectedBindingRevision }
        : {}),
    };
  }

  private finalizeRevisionInput(value: unknown): FinalizeProjectRevisionRequest {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new ProjectServiceError('invalid_request', 400, 'Project finalization body is invalid.');
    }
    const source = value as Record<string, unknown>;
    const allowed = new Set(['expectedProjectRevision', 'sourceIds', 'sourceBundleId']);
    if (Object.keys(source).some((key) => !allowed.has(key))) {
      throw new ProjectServiceError(
        'invalid_request',
        400,
        'Project finalization contains unsupported fields.',
      );
    }
    if (
      !Number.isInteger(source.expectedProjectRevision) ||
      Number(source.expectedProjectRevision) < 0
    ) {
      throw new ProjectServiceError(
        'invalid_request',
        400,
        'Expected project revision must be a non-negative integer.',
      );
    }
    if (
      !Array.isArray(source.sourceIds) ||
      source.sourceIds.length > 20_000 ||
      source.sourceIds.some((sourceId) => typeof sourceId !== 'string')
    ) {
      throw new ProjectServiceError('invalid_request', 400, 'Project source ids are invalid.');
    }
    const sourceIds = source.sourceIds.map((sourceId) => String(sourceId));
    if (
      sourceIds.some((sourceId) => !SOURCE_ID_PATTERN.test(sourceId)) ||
      new Set(sourceIds).size !== sourceIds.length
    ) {
      throw new ProjectServiceError(
        'invalid_request',
        400,
        'Project source ids must be unique canonical source identifiers.',
      );
    }
    if (
      source.sourceBundleId !== undefined &&
      (typeof source.sourceBundleId !== 'string' ||
        !SOURCE_BUNDLE_ID_PATTERN.test(source.sourceBundleId))
    ) {
      throw new ProjectServiceError('invalid_request', 400, 'Source bundle id is invalid.');
    }
    return {
      expectedProjectRevision: Number(source.expectedProjectRevision),
      sourceIds,
      ...(typeof source.sourceBundleId === 'string'
        ? { sourceBundleId: source.sourceBundleId }
        : {}),
    };
  }
}
