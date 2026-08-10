import type { App, TFile, TFolder } from 'obsidian';

export const MAX_PROJECT_SOURCE_ITEMS = 50;
export const MAX_PROJECT_SOURCE_BYTES = 8_000_000;
export const MAX_PROJECT_ARCHIVE_BYTES = 10_000_000;
export const MAX_PROJECT_FILE_BYTES = 2_000_000;
export const TARGET_PROJECT_BATCH_BYTES = 4_000_000;
export const MAX_PROJECT_FILES = 500;
export const MAX_PROJECT_TOTAL_BYTES = 50_000_000;

const TEMPLATE_FOLDER_NAMES = new Set(['template', 'templates', '模板']);
const DEPENDENCY_FOLDER_NAMES = new Set(['node_modules', 'bower_components']);

export type ProjectExclusionReason =
  | 'managed-root'
  | 'hidden-folder'
  | 'template-folder'
  | 'dependency-folder'
  | 'oversized';
export type ProjectFileStatus = 'new' | 'modified' | 'unchanged';

export interface ProjectFileState {
  sourceMtime: string;
  byteSize: number;
  contentHash: string;
}

export interface ProjectBinding {
  id: string;
  folderPath: string;
  files: Record<string, ProjectFileState>;
  sourceIds: Record<string, string>;
  bindingRevision?: number;
  projectRevision?: number;
  registeredAt?: string;
  lastBundleId?: string;
  lastManifestId?: string;
  lastManifestHash?: string;
  lastSourceCount?: number;
  lastUploadedAt?: string;
  lastFinalizedAt?: string;
}

export interface ProjectFileCandidate {
  file: TFile;
  relativePath: string;
  byteSize: number;
  status: ProjectFileStatus;
}

export interface ExcludedProjectFile {
  relativePath: string;
  reason: ProjectExclusionReason;
}

export interface UnsupportedProjectFile {
  relativePath: string;
  extension: string;
}

export interface ProjectFolderScan {
  folderPath: string;
  candidates: ProjectFileCandidate[];
  excluded: ExcludedProjectFile[];
  unsupported: UnsupportedProjectFile[];
}

export interface ProjectSelectionMetrics {
  itemCount: number;
  byteSize: number;
}

function cleanPath(value: string): string {
  return value.replaceAll('\\', '/').replace(/^\/+|\/+$/g, '');
}

function pathIsWithin(path: string, parent: string): boolean {
  const normalizedPath = cleanPath(path);
  const normalizedParent = cleanPath(parent);
  if (!normalizedParent) return true;
  return normalizedPath === normalizedParent || normalizedPath.startsWith(`${normalizedParent}/`);
}

function pathRelativeToFolder(path: string, folderPath: string): string {
  const normalizedPath = cleanPath(path);
  const normalizedFolder = cleanPath(folderPath);
  if (!normalizedFolder) return normalizedPath;
  return normalizedPath.slice(normalizedFolder.length + 1);
}

export function exclusionReasonForProjectFile(options: {
  path: string;
  folderPath: string;
  managedRoot: string;
}): ProjectExclusionReason | undefined {
  if (pathIsWithin(options.path, options.managedRoot)) return 'managed-root';
  const relativePath = pathRelativeToFolder(options.path, options.folderPath);
  const directories = relativePath.split('/').slice(0, -1);
  if (directories.some((segment) => segment.startsWith('.'))) return 'hidden-folder';
  if (directories.some((segment) => TEMPLATE_FOLDER_NAMES.has(segment.toLowerCase()))) {
    return 'template-folder';
  }
  if (directories.some((segment) => DEPENDENCY_FOLDER_NAMES.has(segment.toLowerCase()))) {
    return 'dependency-folder';
  }
  return undefined;
}

export function scanProjectFolder(
  app: App,
  folder: TFolder,
  managedRoot: string,
  previousFiles: Record<string, ProjectFileState> = {},
): ProjectFolderScan {
  const candidates: ProjectFileCandidate[] = [];
  const excluded: ExcludedProjectFile[] = [];
  const unsupported: UnsupportedProjectFile[] = [];
  const allFiles =
    typeof app.vault.getFiles === 'function' ? app.vault.getFiles() : app.vault.getMarkdownFiles();
  const files = allFiles
    .filter((file) => pathIsWithin(file.path, folder.path))
    .sort((left, right) => left.path.localeCompare(right.path));

  for (const file of files) {
    const relativePath = pathRelativeToFolder(file.path, folder.path);
    const reason = exclusionReasonForProjectFile({
      path: file.path,
      folderPath: folder.path,
      managedRoot,
    });
    if (reason) {
      excluded.push({ relativePath, reason });
      continue;
    }
    if (file.extension.toLowerCase() !== 'md') {
      unsupported.push({
        relativePath,
        extension: file.extension.toLowerCase() || 'unknown',
      });
      continue;
    }
    if (file.stat.size > MAX_PROJECT_FILE_BYTES) {
      excluded.push({ relativePath, reason: 'oversized' });
      continue;
    }
    candidates.push({
      file,
      relativePath,
      byteSize: file.stat.size,
      status: previousFiles[file.path]
        ? previousFiles[file.path]?.sourceMtime === new Date(file.stat.mtime).toISOString() &&
          previousFiles[file.path]?.byteSize === file.stat.size
          ? 'unchanged'
          : 'modified'
        : 'new',
    });
  }

  return {
    folderPath: cleanPath(folder.path),
    candidates,
    excluded,
    unsupported,
  };
}

export function savedProjectBindings(value: unknown): ProjectBinding[] {
  if (!Array.isArray(value)) return [];
  const bindings: ProjectBinding[] = [];
  for (const item of value) {
    if (typeof item !== 'object' || item === null) continue;
    const candidate = item as Partial<ProjectBinding>;
    if (
      typeof candidate.id !== 'string' ||
      !candidate.id.startsWith('prj_') ||
      typeof candidate.folderPath !== 'string' ||
      typeof candidate.files !== 'object' ||
      candidate.files === null ||
      Array.isArray(candidate.files)
    ) {
      continue;
    }
    const files: Record<string, ProjectFileState> = {};
    for (const [path, state] of Object.entries(candidate.files)) {
      if (typeof state !== 'object' || state === null) continue;
      const fileState = state as Partial<ProjectFileState>;
      if (
        typeof fileState.sourceMtime === 'string' &&
        typeof fileState.byteSize === 'number' &&
        Number.isFinite(fileState.byteSize) &&
        fileState.byteSize >= 0 &&
        typeof fileState.contentHash === 'string' &&
        /^[a-f0-9]{64}$/.test(fileState.contentHash)
      ) {
        files[path] = {
          sourceMtime: fileState.sourceMtime,
          byteSize: fileState.byteSize,
          contentHash: fileState.contentHash,
        };
      }
    }
    const sourceIds: Record<string, string> = {};
    if (
      typeof candidate.sourceIds === 'object' &&
      candidate.sourceIds !== null &&
      !Array.isArray(candidate.sourceIds)
    ) {
      for (const [path, sourceId] of Object.entries(candidate.sourceIds)) {
        if (typeof sourceId === 'string' && /^sou_[a-f0-9]{32}$/.test(sourceId)) {
          sourceIds[path] = sourceId;
        }
      }
    }
    bindings.push({
      id: candidate.id,
      folderPath: cleanPath(candidate.folderPath),
      files,
      sourceIds,
      bindingRevision:
        typeof candidate.bindingRevision === 'number' &&
        Number.isInteger(candidate.bindingRevision) &&
        candidate.bindingRevision >= 1
          ? candidate.bindingRevision
          : undefined,
      projectRevision:
        typeof candidate.projectRevision === 'number' &&
        Number.isInteger(candidate.projectRevision) &&
        candidate.projectRevision >= 0
          ? candidate.projectRevision
          : undefined,
      registeredAt: typeof candidate.registeredAt === 'string' ? candidate.registeredAt : undefined,
      lastBundleId:
        typeof candidate.lastBundleId === 'string' &&
        /^src_[a-f0-9]{32}$/.test(candidate.lastBundleId)
          ? candidate.lastBundleId
          : undefined,
      lastManifestId:
        typeof candidate.lastManifestId === 'string' &&
        /^prm_[a-f0-9]{32}$/.test(candidate.lastManifestId)
          ? candidate.lastManifestId
          : undefined,
      lastManifestHash:
        typeof candidate.lastManifestHash === 'string' &&
        /^[a-f0-9]{64}$/.test(candidate.lastManifestHash)
          ? candidate.lastManifestHash
          : undefined,
      lastSourceCount:
        typeof candidate.lastSourceCount === 'number' &&
        Number.isInteger(candidate.lastSourceCount) &&
        candidate.lastSourceCount >= 0
          ? candidate.lastSourceCount
          : undefined,
      lastUploadedAt:
        typeof candidate.lastUploadedAt === 'string' ? candidate.lastUploadedAt : undefined,
      lastFinalizedAt:
        typeof candidate.lastFinalizedAt === 'string' ? candidate.lastFinalizedAt : undefined,
    });
  }
  return bindings;
}

export function ensureProjectSourceIds(
  binding: ProjectBinding,
  paths: readonly string[],
  createSourceId: () => string = () => `sou_${crypto.randomUUID().replaceAll('-', '')}`,
): ProjectBinding {
  const sourceIds = { ...binding.sourceIds };
  for (const path of paths) {
    if (/^sou_[a-f0-9]{32}$/.test(sourceIds[path] ?? '')) continue;
    const sourceId = createSourceId();
    if (!/^sou_[a-f0-9]{32}$/.test(sourceId)) {
      throw new Error('Generated project source id is invalid.');
    }
    sourceIds[path] = sourceId;
  }
  return { ...binding, sourceIds };
}

export function projectSelectionMetrics(
  candidates: ProjectFileCandidate[],
): ProjectSelectionMetrics {
  return {
    itemCount: candidates.length,
    byteSize: candidates.reduce((total, candidate) => total + candidate.byteSize, 0),
  };
}

export function projectSelectionLimitError(metrics: ProjectSelectionMetrics): string | undefined {
  if (metrics.itemCount === 0) return '请至少选择一份 Markdown 笔记。';
  if (metrics.itemCount > MAX_PROJECT_SOURCE_ITEMS) {
    return `一次最多选择 ${MAX_PROJECT_SOURCE_ITEMS} 份笔记；请取消部分选择。`;
  }
  if (metrics.byteSize > MAX_PROJECT_SOURCE_BYTES) {
    return '所选笔记总量超过 8 MB；请取消部分大文件后重试。';
  }
  return undefined;
}

export function projectSyncLimitError(metrics: ProjectSelectionMetrics): string | undefined {
  if (metrics.itemCount === 0) return '请至少授权一份 Markdown 笔记。';
  if (metrics.itemCount > MAX_PROJECT_FILES) {
    return `当前版本单项目最多授权 ${MAX_PROJECT_FILES} 份 Markdown；请缩小项目范围。`;
  }
  if (metrics.byteSize > MAX_PROJECT_TOTAL_BYTES) {
    return '当前版本单项目最多授权 50 MB Markdown 正文；请拆分为多个项目。';
  }
  return undefined;
}

export function isProjectEntryCandidate(candidate: ProjectFileCandidate): boolean {
  const normalized = candidate.relativePath.toLocaleLowerCase('en-US');
  const name = normalized.split('/').at(-1) ?? normalized;
  return (
    !normalized.includes('/') &&
    /^(readme|index|overview|summary|moc|项目说明|总览|目录)(?:[.\-_ ]|$)/i.test(name)
  );
}

function prioritizedProjectCandidates(
  candidates: readonly ProjectFileCandidate[],
): ProjectFileCandidate[] {
  return [...candidates].sort((left, right) => {
    const leftEntry = isProjectEntryCandidate(left) ? 0 : 1;
    const rightEntry = isProjectEntryCandidate(right) ? 0 : 1;
    const leftChanged = left.status === 'unchanged' ? 1 : 0;
    const rightChanged = right.status === 'unchanged' ? 1 : 0;
    return (
      leftEntry - rightEntry ||
      leftChanged - rightChanged ||
      left.relativePath.localeCompare(right.relativePath)
    );
  });
}

export function recommendedProjectBatch(
  candidates: readonly ProjectFileCandidate[],
): ProjectFileCandidate[] {
  const prioritized = prioritizedProjectCandidates(candidates);
  const selected: ProjectFileCandidate[] = [];
  let byteSize = 0;
  for (const candidate of prioritized) {
    if (selected.length >= MAX_PROJECT_SOURCE_ITEMS) break;
    if (candidate.byteSize > MAX_PROJECT_FILE_BYTES) continue;
    if (byteSize + candidate.byteSize > TARGET_PROJECT_BATCH_BYTES) continue;
    selected.push(candidate);
    byteSize += candidate.byteSize;
  }
  return selected;
}

export function planProjectBatches(
  candidates: readonly ProjectFileCandidate[],
): ProjectFileCandidate[][] {
  const remaining = prioritizedProjectCandidates(candidates);
  const batches: ProjectFileCandidate[][] = [];
  while (remaining.length > 0) {
    const batch = recommendedProjectBatch(remaining);
    if (batch.length === 0) {
      throw new Error(`无法安全分批：${remaining[0]?.relativePath ?? '未知文件'} 超过单批限制。`);
    }
    batches.push(batch);
    const selected = new Set(batch.map((candidate) => candidate.file.path));
    for (let index = remaining.length - 1; index >= 0; index -= 1) {
      if (selected.has(remaining[index]?.file.path ?? '')) remaining.splice(index, 1);
    }
  }
  return batches;
}

export function projectExclusionLabel(reason: ProjectExclusionReason): string {
  switch (reason) {
    case 'managed-root':
      return '知洄回写目录';
    case 'hidden-folder':
      return '隐藏目录';
    case 'template-folder':
      return '模板目录';
    case 'dependency-folder':
      return '依赖目录';
    case 'oversized':
      return '单文件超过 2 MB';
  }
}
