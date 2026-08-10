import type {
  ProjectBundleContext,
  ProjectChunkCandidate,
  ProjectRetrievalProject,
  SaveProjectRetrievalRun,
} from '../domain/project-retrieval';

export interface ProjectRetrievalRepository {
  findBundleContext(
    ownerId: string,
    bundleId: string,
    now: Date,
  ): Promise<ProjectBundleContext | null>;
  findProject(
    ownerId: string,
    projectId: string,
    now: Date,
  ): Promise<ProjectRetrievalProject | null>;
  searchChunks(
    ownerId: string,
    projectId: string,
    now: Date,
    query: string,
    limit: number,
  ): Promise<ProjectChunkCandidate[]>;
  listFallbackChunks(
    ownerId: string,
    projectId: string,
    now: Date,
    limit: number,
  ): Promise<ProjectChunkCandidate[]>;
  listSourceChunks(
    ownerId: string,
    projectId: string,
    now: Date,
    sourceIds: string[],
    limitPerSource: number,
  ): Promise<ProjectChunkCandidate[]>;
  saveRun(run: SaveProjectRetrievalRun): Promise<boolean>;
}
