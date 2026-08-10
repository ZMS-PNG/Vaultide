import type { DeviceTokenPrincipal } from '../domain/device-token';
import type {
  LearningProjectRecord,
  ProjectBindingInput,
  ProjectStatusRecord,
} from '../domain/project';

export interface ProjectRepository {
  register(
    principal: DeviceTokenPrincipal,
    input: ProjectBindingInput,
    now: Date,
  ): Promise<LearningProjectRecord | null>;
  findStatus(
    principal: DeviceTokenPrincipal,
    projectId: string,
  ): Promise<ProjectStatusRecord | null>;
  listRevisionCandidates(
    principal: DeviceTokenPrincipal,
    projectId: string,
    sourceIds: readonly string[],
  ): Promise<ProjectRevisionCandidate[]>;
  finalizeRevision(
    principal: DeviceTokenPrincipal,
    input: FinalizeProjectRevisionInput,
    now: Date,
  ): Promise<{ projectRevision: number; manifestId: string } | null>;
}

export interface ProjectRevisionCandidate {
  sourceId: string;
  sourceVersionId: string;
  relativePath: string;
  contentHash: string;
  sourceMtime?: Date;
}

export interface FinalizeProjectRevisionInput {
  projectId: string;
  expectedProjectRevision: number;
  manifestId: string;
  manifestSha256: string;
  sourceBundleId?: string;
  entries: ProjectRevisionCandidate[];
}
