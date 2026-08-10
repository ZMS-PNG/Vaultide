import type { FinalizedProjectSync } from './project-client';
import type { ProjectBinding, ProjectFileCandidate, ProjectFileState } from './project-folder';

const SOURCE_ID_PATTERN = /^sou_[a-f0-9]{32}$/;

export interface ProjectSyncStagingState {
  currentProjectRevision: number;
  baseManifestHash?: string;
  completedBatches: number;
  indexedChunks: number;
  lastBundleId?: string;
  stagedFiles: Record<string, ProjectFileState>;
}

export function createProjectSyncStagingState(options: {
  projectRevision: number;
  baseManifestHash?: string;
}): ProjectSyncStagingState {
  if (!Number.isSafeInteger(options.projectRevision) || options.projectRevision < 0) {
    throw new Error('Project synchronization revision is invalid.');
  }
  return {
    currentProjectRevision: options.projectRevision,
    ...(options.baseManifestHash ? { baseManifestHash: options.baseManifestHash } : {}),
    completedBatches: 0,
    indexedChunks: 0,
    stagedFiles: {},
  };
}

export function stageValidatedProjectBatch(
  state: ProjectSyncStagingState,
  batch: {
    expectedProjectRevision: number;
    projectRevision: number;
    manifestHash: string;
    bundleId: string;
    indexedChunkCount: number;
    files: Readonly<Record<string, ProjectFileState>>;
  },
): ProjectSyncStagingState {
  if (
    batch.expectedProjectRevision !== state.currentProjectRevision ||
    batch.projectRevision !== batch.expectedProjectRevision + 1
  ) {
    throw new Error('Validated project batch does not continue the staged revision chain.');
  }
  return {
    currentProjectRevision: batch.projectRevision,
    baseManifestHash: batch.manifestHash,
    completedBatches: state.completedBatches + 1,
    indexedChunks: state.indexedChunks + batch.indexedChunkCount,
    lastBundleId: batch.bundleId,
    stagedFiles: { ...state.stagedFiles, ...batch.files },
  };
}

/**
 * A project revision is a complete allowlisted view, not merely the latest
 * upload batch. Previously committed notes that still exist remain present;
 * selected notes use their newly staged versions; deleted notes disappear.
 */
export function sourceIdsForProjectFinalization(options: {
  binding: ProjectBinding;
  allCandidates: readonly ProjectFileCandidate[];
  selectedCandidates: readonly ProjectFileCandidate[];
}): string[] {
  const selectedPaths = new Set(options.selectedCandidates.map((candidate) => candidate.file.path));
  const sourceIds = new Set<string>();
  for (const candidate of options.allCandidates) {
    const path = candidate.file.path;
    if (!selectedPaths.has(path) && !options.binding.files[path]) continue;
    const sourceId = options.binding.sourceIds[path];
    if (!sourceId || !SOURCE_ID_PATTERN.test(sourceId)) {
      throw new Error(`Stable source id is missing for ${path}.`);
    }
    sourceIds.add(sourceId);
  }
  if (sourceIds.size === 0) {
    throw new Error('Project finalization has no authorized sources.');
  }
  return [...sourceIds].sort((left, right) => left.localeCompare(right));
}

export function commitFinalizedProjectBinding(options: {
  binding: ProjectBinding;
  allCandidates: readonly ProjectFileCandidate[];
  selectedCandidates: readonly ProjectFileCandidate[];
  staged: ProjectSyncStagingState;
  finalized: FinalizedProjectSync;
  sourceIds: readonly string[];
  finalizedAt: string;
}): ProjectBinding {
  if (
    options.finalized.projectId !== options.binding.id ||
    options.finalized.projectRevision !== options.staged.currentProjectRevision + 1 ||
    options.finalized.sourceCount !== options.sourceIds.length ||
    !options.staged.lastBundleId
  ) {
    throw new Error('Finalized project revision does not match the staged synchronization.');
  }

  const selectedPaths = new Set(options.selectedCandidates.map((candidate) => candidate.file.path));
  const finalizedSourceIds = new Set(options.sourceIds);
  const files: Record<string, ProjectFileState> = {};
  const sourceIds: Record<string, string> = {};
  for (const candidate of options.allCandidates) {
    const path = candidate.file.path;
    const sourceId = options.binding.sourceIds[path];
    if (!sourceId || !finalizedSourceIds.has(sourceId)) continue;
    sourceIds[path] = sourceId;
    const state = selectedPaths.has(path)
      ? options.staged.stagedFiles[path]
      : options.binding.files[path];
    if (!state) {
      throw new Error(`Finalized project file state is missing for ${path}.`);
    }
    files[path] = state;
  }

  if (
    Object.keys(sourceIds).length !== options.sourceIds.length ||
    Object.keys(files).length !== options.sourceIds.length
  ) {
    throw new Error('Finalized project source set is incomplete.');
  }

  return {
    ...options.binding,
    files,
    sourceIds,
    projectRevision: options.finalized.projectRevision,
    lastBundleId: options.staged.lastBundleId,
    lastManifestId: options.finalized.manifestId,
    lastManifestHash: options.finalized.manifestSha256,
    lastSourceCount: options.finalized.sourceCount,
    lastUploadedAt: options.finalizedAt,
    lastFinalizedAt: options.finalizedAt,
  };
}
