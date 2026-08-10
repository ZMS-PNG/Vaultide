import type { LearningProtocolVersion } from './version.js';
import { LEARNING_PROTOCOL_VERSION, PROJECT_BINDING_SCHEMA_VERSION } from './version.js';

export const PROJECT_KINDS = ['obsidian-folder'] as const;

export type ProjectKind = (typeof PROJECT_KINDS)[number];

/**
 * Idempotent registration of one client-generated project id and its location
 * inside the authenticated Vault. The server derives owner/device/Vault
 * identity from the device credential rather than trusting request fields.
 */
export interface ProjectBindingRequest {
  protocolVersion: LearningProtocolVersion;
  schemaVersion: typeof PROJECT_BINDING_SCHEMA_VERSION;
  projectId: string;
  kind: ProjectKind;
  displayName: string;
  folderPath: string;
  expectedBindingRevision?: number;
}

/** Server-confirmed state used as the concurrency base for the next upload. */
export interface ProjectBindingResponse {
  protocolVersion: LearningProtocolVersion;
  schemaVersion: typeof PROJECT_BINDING_SCHEMA_VERSION;
  projectId: string;
  kind: ProjectKind;
  displayName: string;
  folderPath: string;
  bindingRevision: number;
  projectRevision: number;
  latestManifestHash?: string;
  registeredAt: string;
}

/** Published project-binding/1 schema covers both request and response messages. */
export type ProjectBindingContract = ProjectBindingRequest | ProjectBindingResponse;

export function stampProjectBindingRequest(
  request: Omit<ProjectBindingRequest, 'protocolVersion' | 'schemaVersion'>,
): ProjectBindingRequest {
  return {
    ...request,
    protocolVersion: LEARNING_PROTOCOL_VERSION,
    schemaVersion: PROJECT_BINDING_SCHEMA_VERSION,
  };
}
