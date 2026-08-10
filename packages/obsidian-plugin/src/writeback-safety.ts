import { normalizePath, TFile, TFolder, type App } from 'obsidian';
import {
  WRITEBACK_FRONTMATTER_KEYS,
  validateWritebackCommand,
  type CreateManagedNoteCommand,
  type JsonObject,
  type ReplaceManagedBlocksCommand,
  type ReplaceProjectIndexBlocksCommand,
  type ReplaceSynthesisIndexBlocksCommand,
  type ReplaceVaultOverviewBlocksCommand,
  type WritebackCommand,
} from '@openmaic/learning-protocol';

export const DEFAULT_MANAGED_ROOT = 'Vaultide';
const WINDOWS_INVALID = /[<>:"|?*\u0000-\u001f\u007f]/;

export class WritebackSafetyError extends Error {
  constructor(
    message: string,
    readonly outcome: 'conflicted' | 'failed' = 'failed',
  ) {
    super(message);
    this.name = 'WritebackSafetyError';
  }
}

function safeSegments(value: string): string[] {
  const slashPath = value.trim().replaceAll('\\', '/');
  if (!slashPath || slashPath.startsWith('/') || /^[A-Za-z]:/.test(slashPath)) {
    throw new WritebackSafetyError('Writeback path must be relative to the Vault.');
  }
  const segments = slashPath.split('/');
  if (
    segments.some(
      (segment) =>
        !segment ||
        segment === '.' ||
        segment === '..' ||
        WINDOWS_INVALID.test(segment) ||
        /[. ]$/.test(segment),
    )
  ) {
    throw new WritebackSafetyError('Writeback path contains an unsafe segment.');
  }
  return segments;
}

export function normalizeManagedRoot(value: string): string {
  const segments = safeSegments(value);
  return normalizePath(segments.join('/'));
}

export function resolveManagedWritebackPath(relativePath: string, managedRoot: string): string {
  const root = normalizeManagedRoot(managedRoot);
  const path = normalizePath(safeSegments(relativePath).join('/'));
  if (!path.endsWith('.md'))
    throw new WritebackSafetyError('Writeback target must be a Markdown file.');
  if (path === root || !path.startsWith(`${root}/`)) {
    throw new WritebackSafetyError(`Writeback target must stay inside ${root}/.`);
  }
  return path;
}

export function renderManagedNote(content: string, frontmatter?: JsonObject): string {
  const values = frontmatter ?? {};
  const allowed = new Set<string>(WRITEBACK_FRONTMATTER_KEYS);
  const lines: string[] = [];
  for (const [key, value] of Object.entries(values)) {
    if (!allowed.has(key)) throw new WritebackSafetyError(`Frontmatter key ${key} is not allowed.`);
    if (
      value !== null &&
      typeof value !== 'string' &&
      typeof value !== 'number' &&
      typeof value !== 'boolean' &&
      !(Array.isArray(value) && value.every((item) => typeof item === 'string'))
    ) {
      throw new WritebackSafetyError(`Frontmatter value for ${key} is not safe.`);
    }
    lines.push(`${key}: ${JSON.stringify(value)}`);
  }
  const body = content.replace(/^\s+/, '');
  return lines.length > 0 ? `---\n${lines.join('\n')}\n---\n\n${body}` : body;
}

async function ensureFolders(app: App, filePath: string): Promise<void> {
  const parts = filePath.split('/');
  parts.pop();
  let current = '';
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    const existing = app.vault.getAbstractFileByPath(current);
    if (existing instanceof TFolder) continue;
    if (existing)
      throw new WritebackSafetyError(`${current} exists but is not a folder.`, 'conflicted');
    try {
      await app.vault.createFolder(current);
    } catch (error) {
      if (!(app.vault.getAbstractFileByPath(current) instanceof TFolder)) throw error;
    }
  }
}

export async function sha256Text(content: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Keep hash checks stable across Windows and Unix line endings. */
export function normalizeManagedBlockContent(content: string): string {
  return content.replaceAll('\r\n', '\n').replaceAll('\r', '\n').trim();
}

interface ManagedBlockMatch {
  id: string;
  identityKind: 'companion' | 'project-index' | 'synthesis-index' | 'vault-overview';
  identityId: string;
  content: string;
  contentStart: number;
  contentEnd: number;
}

const MANAGED_BLOCK_PATTERN =
  /<!-- vaultide:managed\s+block=([a-z][a-z0-9-]{0,63})\s+(companion|project-index|synthesis-index|vault-overview)=((?:cmp|pdx|sdx|vdx)_[a-f0-9]{32})\s*-->(\r?\n)?([\s\S]*?)<!-- \/vaultide:managed -->/g;

function managedBlocks(content: string): ManagedBlockMatch[] {
  const matches: ManagedBlockMatch[] = [];
  for (const match of content.matchAll(MANAGED_BLOCK_PATTERN)) {
    const start = match.index;
    if (start === undefined) continue;
    const header = match[0].match(/^<!-- vaultide:managed[\s\S]*?-->/)?.[0];
    if (!header) continue;
    const lineBreak = match[4] ?? '';
    const blockContent = match[5] ?? '';
    const contentStart = start + header.length + lineBreak.length;
    matches.push({
      id: match[1] ?? '',
      identityKind:
        match[2] === 'project-index'
          ? 'project-index'
          : match[2] === 'synthesis-index'
            ? 'synthesis-index'
            : match[2] === 'vault-overview'
              ? 'vault-overview'
              : 'companion',
      identityId: match[3] ?? '',
      content: blockContent,
      contentStart,
      contentEnd: contentStart + blockContent.length,
    });
  }
  return matches;
}

function hasManagedIdentityFrontmatter(content: string, key: string, id: string): boolean {
  const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1];
  if (!frontmatter) return false;
  const managed = /^maic_managed:\s*true\s*$/m.test(frontmatter);
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const identity = new RegExp(`^${key}:\\s*"?${escaped}"?\\s*$`, 'm').test(frontmatter);
  return managed && identity;
}

function hasManagedProjectIndexFrontmatter(
  content: string,
  projectIndexId: string,
  projectId: string,
): boolean {
  if (!hasManagedIdentityFrontmatter(content, 'maic_project_index_id', projectIndexId))
    return false;
  const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1] ?? '';
  const escapedProjectId = projectId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^maic_project_id:\\s*"?${escapedProjectId}"?\\s*$`, 'm').test(frontmatter);
}

function hasManagedSynthesisIndexFrontmatter(
  content: string,
  synthesisIndexId: string,
  scheduleId: string,
): boolean {
  if (!hasManagedIdentityFrontmatter(content, 'maic_synthesis_index_id', synthesisIndexId)) {
    return false;
  }
  const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1] ?? '';
  const escapedScheduleId = scheduleId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^maic_synthesis_schedule_id:\\s*"?${escapedScheduleId}"?\\s*$`, 'm').test(
    frontmatter,
  );
}

function hasManagedVaultOverviewFrontmatter(content: string, vaultOverviewId: string): boolean {
  return hasManagedIdentityFrontmatter(content, 'maic_vault_overview_id', vaultOverviewId);
}

export async function applyCreateManagedNote(options: {
  app: App;
  command: WritebackCommand;
  managedRoot: string;
}): Promise<{ path: string; contentHash: string }> {
  const validation = validateWritebackCommand(options.command);
  if (!validation.valid) {
    throw new WritebackSafetyError(
      `WritebackCommand failed validation at ${validation.errors[0]?.path ?? '/'}.`,
    );
  }
  if (options.command.operation !== 'createManagedNote') {
    throw new WritebackSafetyError('This plugin version only permits creating a new managed note.');
  }
  const command = options.command as CreateManagedNoteCommand;
  const path = resolveManagedWritebackPath(command.arguments.relativePath, options.managedRoot);
  if (options.app.vault.getAbstractFileByPath(path)) {
    throw new WritebackSafetyError(`Target already exists: ${path}`, 'conflicted');
  }
  const content = renderManagedNote(command.arguments.content, command.arguments.frontmatter);
  await ensureFolders(options.app, path);
  const file = await options.app.vault.create(path, content);
  if (!(file instanceof TFile))
    throw new WritebackSafetyError('Obsidian did not create a Markdown file.');
  const persisted = await options.app.vault.read(file);
  return { path, contentHash: await sha256Text(persisted) };
}

/**
 * Apply a compare-and-swap update to Vaultide-owned regions only. The caller
 * cannot use this to change frontmatter, the original source note, or a
 * user's free-form text outside the explicit managed markers.
 */
async function applyManagedBlockReplacement(options: {
  app: App;
  command:
    | ReplaceManagedBlocksCommand
    | ReplaceProjectIndexBlocksCommand
    | ReplaceSynthesisIndexBlocksCommand
    | ReplaceVaultOverviewBlocksCommand;
  managedRoot: string;
  expected: {
    identityKind: ManagedBlockMatch['identityKind'];
    identityId: string;
    frontmatterValid: (content: string) => boolean;
    pathError: string;
  };
}): Promise<{ path: string; contentHash: string }> {
  const command = options.command;
  const path = resolveManagedWritebackPath(command.arguments.relativePath, options.managedRoot);
  if (
    options.expected.identityKind === 'project-index' ||
    options.expected.identityKind === 'synthesis-index' ||
    options.expected.identityKind === 'vault-overview'
  ) {
    const root = normalizeManagedRoot(options.managedRoot);
    const requiredRoot =
      options.expected.identityKind === 'project-index'
        ? `${root}/系统/索引/`
        : options.expected.identityKind === 'synthesis-index'
          ? `${root}/归纳/周期/索引/`
          : `${root}/知洄总览.md`;
    const validPath =
      options.expected.identityKind === 'vault-overview'
        ? path === requiredRoot
        : path.startsWith(requiredRoot);
    if (!validPath) {
      throw new WritebackSafetyError(options.expected.pathError, 'conflicted');
    }
  }
  const file = options.app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) {
    throw new WritebackSafetyError(
      `Managed Vaultide document was not found: ${path}`,
      'conflicted',
    );
  }
  const current = await options.app.vault.read(file);
  if (!options.expected.frontmatterValid(current)) {
    throw new WritebackSafetyError(
      'Target is not the expected Vaultide-managed document.',
      'conflicted',
    );
  }

  const matches = managedBlocks(current);
  const byId = new Map<string, ManagedBlockMatch>();
  for (const match of matches) {
    if (
      match.identityKind !== options.expected.identityKind ||
      match.identityId !== options.expected.identityId
    ) {
      continue;
    }
    if (byId.has(match.id)) {
      throw new WritebackSafetyError(
        `Managed Vaultide document contains duplicate block ${match.id}.`,
        'conflicted',
      );
    }
    byId.set(match.id, match);
  }

  const replacements = await Promise.all(
    command.arguments.blocks.map(async (replacement) => {
      const match = byId.get(replacement.id);
      if (!match) {
        throw new WritebackSafetyError(
          `Managed block ${replacement.id} was not found in the expected Vaultide document.`,
          'conflicted',
        );
      }
      const currentHash = await sha256Text(normalizeManagedBlockContent(match.content));
      if (currentHash !== replacement.expectedHash) {
        throw new WritebackSafetyError(
          `Managed block ${replacement.id} changed locally; no content was overwritten.`,
          'conflicted',
        );
      }
      return { match, content: replacement.content };
    }),
  );

  const lineEnding = current.includes('\r\n') ? '\r\n' : '\n';
  let updated = current;
  for (const replacement of replacements.sort(
    (left, right) => right.match.contentStart - left.match.contentStart,
  )) {
    const normalized = normalizeManagedBlockContent(replacement.content).replaceAll(
      '\n',
      lineEnding,
    );
    const nextBody = normalized.length > 0 ? `${normalized}${lineEnding}` : '';
    updated =
      updated.slice(0, replacement.match.contentStart) +
      nextBody +
      updated.slice(replacement.match.contentEnd);
  }
  await options.app.vault.modify(file, updated);
  const persisted = await options.app.vault.read(file);
  return { path, contentHash: await sha256Text(persisted) };
}

export async function applyReplaceManagedBlocks(options: {
  app: App;
  command: WritebackCommand;
  managedRoot: string;
}): Promise<{ path: string; contentHash: string }> {
  const validation = validateWritebackCommand(options.command);
  if (!validation.valid) {
    throw new WritebackSafetyError(
      `WritebackCommand failed validation at ${validation.errors[0]?.path ?? '/'}.`,
    );
  }
  if (options.command.operation !== 'replaceManagedBlocks') {
    throw new WritebackSafetyError('This operation is not a learning-companion block replacement.');
  }
  const command = options.command as ReplaceManagedBlocksCommand;
  return applyManagedBlockReplacement({
    app: options.app,
    command,
    managedRoot: options.managedRoot,
    expected: {
      identityKind: 'companion',
      identityId: command.arguments.companionId,
      frontmatterValid: (content) =>
        hasManagedIdentityFrontmatter(content, 'maic_companion_id', command.arguments.companionId),
      pathError: 'Learning companion must remain inside the managed Vaultide root.',
    },
  });
}

export async function applyReplaceProjectIndexBlocks(options: {
  app: App;
  command: WritebackCommand;
  managedRoot: string;
}): Promise<{ path: string; contentHash: string }> {
  const validation = validateWritebackCommand(options.command);
  if (!validation.valid) {
    throw new WritebackSafetyError(
      `WritebackCommand failed validation at ${validation.errors[0]?.path ?? '/'}.`,
    );
  }
  if (options.command.operation !== 'replaceProjectIndexBlocks') {
    throw new WritebackSafetyError('This operation is not a project-index block replacement.');
  }
  const command = options.command as ReplaceProjectIndexBlocksCommand;
  return applyManagedBlockReplacement({
    app: options.app,
    command,
    managedRoot: options.managedRoot,
    expected: {
      identityKind: 'project-index',
      identityId: command.arguments.projectIndexId,
      frontmatterValid: (content) =>
        hasManagedProjectIndexFrontmatter(
          content,
          command.arguments.projectIndexId,
          command.arguments.projectId,
        ),
      pathError: 'Project index must remain inside Vaultide/系统/索引/.',
    },
  });
}

export async function applyReplaceSynthesisIndexBlocks(options: {
  app: App;
  command: WritebackCommand;
  managedRoot: string;
}): Promise<{ path: string; contentHash: string }> {
  const validation = validateWritebackCommand(options.command);
  if (!validation.valid) {
    throw new WritebackSafetyError(
      `WritebackCommand failed validation at ${validation.errors[0]?.path ?? '/'}.`,
    );
  }
  if (options.command.operation !== 'replaceSynthesisIndexBlocks') {
    throw new WritebackSafetyError('This operation is not a synthesis-index block replacement.');
  }
  const command = options.command as ReplaceSynthesisIndexBlocksCommand;
  return applyManagedBlockReplacement({
    app: options.app,
    command,
    managedRoot: options.managedRoot,
    expected: {
      identityKind: 'synthesis-index',
      identityId: command.arguments.synthesisIndexId,
      frontmatterValid: (content) =>
        hasManagedSynthesisIndexFrontmatter(
          content,
          command.arguments.synthesisIndexId,
          command.arguments.scheduleId,
        ),
      pathError: 'Synthesis index must remain inside Vaultide/归纳/周期/索引/.',
    },
  });
}

export async function applyReplaceVaultOverviewBlocks(options: {
  app: App;
  command: WritebackCommand;
  managedRoot: string;
}): Promise<{ path: string; contentHash: string }> {
  const validation = validateWritebackCommand(options.command);
  if (!validation.valid) {
    throw new WritebackSafetyError(
      `WritebackCommand failed validation at ${validation.errors[0]?.path ?? '/'}.`,
    );
  }
  if (options.command.operation !== 'replaceVaultOverviewBlocks') {
    throw new WritebackSafetyError('This operation is not a Vault-overview block replacement.');
  }
  const command = options.command as ReplaceVaultOverviewBlocksCommand;
  return applyManagedBlockReplacement({
    app: options.app,
    command,
    managedRoot: options.managedRoot,
    expected: {
      identityKind: 'vault-overview',
      identityId: command.arguments.vaultOverviewId,
      frontmatterValid: (content) =>
        hasManagedVaultOverviewFrontmatter(content, command.arguments.vaultOverviewId),
      pathError: 'Vault overview must remain at Vaultide/知洄总览.md.',
    },
  });
}
