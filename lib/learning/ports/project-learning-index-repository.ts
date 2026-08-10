import type { ProjectLearningIndexRecord } from '../domain/project-learning';

export interface ProjectCompanionSourceRecord {
  sourceId: string;
  snapshotId: string;
  relativePath: string;
}

/** Read-only projection over project sources, classrooms and learning evidence. */
export interface ProjectLearningIndexRepository {
  findProjectLearningIndex(
    ownerId: string,
    projectId: string,
    now: Date,
  ): Promise<ProjectLearningIndexRecord | null>;
  listProjectBundleCompanionSources(
    ownerId: string,
    projectId: string,
    sourceBundleId: string,
    vaultBindingId: string,
  ): Promise<ProjectCompanionSourceRecord[]>;
}
