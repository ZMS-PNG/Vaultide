/**
 * One registry for every Vaultide-owned Obsidian output.
 *
 * The current product reserves the complete `Vaultide/` tree. Older builds
 * wrote into a smaller set of `知洄/` and `OpenMAIC/` subdirectories, so those
 * legacy locations remain quarantined as well. A canonical-source compiler
 * must use this registry instead of maintaining its own partial regex.
 */
export const VAULTIDE_MANAGED_PATHS = Object.freeze({
  root: 'Vaultide',
  overview: 'Vaultide/知洄总览.md',
  learningRecords: 'Vaultide/学习记录',
  companions: 'Vaultide/伴随笔记',
  sourceLibrary: 'Vaultide/资料库',
  synthesis: 'Vaultide/归纳',
  system: 'Vaultide/系统',
  projectIndexes: 'Vaultide/系统/索引',
  synthesisIndexes: 'Vaultide/归纳/周期/索引',
});

export type VaultideManagedPathKind = 'current' | 'legacy';

const LEGACY_MANAGED_CHILDREN = new Set(
  [
    'learning',
    '_system',
    '学习伴生',
    '伴随笔记',
    '学习记录',
    '知识归纳',
    '归纳',
    '项目索引',
    '外部知识卡片',
    '资料库',
    '运行记录',
    '系统',
  ].map((value) => value.normalize('NFKC').toLocaleLowerCase()),
);

function decodePath(value: string): string {
  let decoded = value;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (!decoded.includes('%')) break;
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      break;
    }
  }
  return decoded;
}

function locatorPath(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  if (/^https?:\/\//iu.test(trimmed)) return undefined;

  if (/^obsidian:\/\//iu.test(trimmed)) {
    try {
      const file = new URL(trimmed).searchParams.get('file');
      return file ? decodePath(file) : undefined;
    } catch {
      return undefined;
    }
  }

  if (/^file:\/\//iu.test(trimmed)) {
    try {
      return decodePath(new URL(trimmed).pathname);
    } catch {
      return decodePath(trimmed.replace(/^file:\/+/iu, ''));
    }
  }

  // Other URI schemes are external identifiers, not Obsidian paths.
  if (/^[a-z][a-z0-9+.-]*:/iu.test(trimmed) && !/^[a-z]:[\\/]/iu.test(trimmed)) {
    return undefined;
  }
  return decodePath(trimmed);
}

function pathSegments(value: string): string[] {
  const raw = value
    .replaceAll('\\', '/')
    .split('/')
    .map((segment) =>
      segment
        .replace(/[\u0000-\u001f\u007f]/gu, '')
        .trim()
        .normalize('NFKC'),
    )
    .filter(Boolean);
  const normalized: string[] = [];
  for (const segment of raw) {
    if (segment === '.') continue;
    if (segment === '..') {
      normalized.pop();
      continue;
    }
    normalized.push(segment);
  }
  return normalized;
}

function classifySegments(segments: readonly string[]): VaultideManagedPathKind | undefined {
  const folded = segments.map((segment) => segment.toLocaleLowerCase());
  if (folded.includes('vaultide')) return 'current';

  for (let index = 0; index < folded.length; index += 1) {
    const segment = folded[index];
    if (segment !== 'openmaic' && segment !== '知洄') continue;
    const child = folded[index + 1];
    if (index === 0 && child === undefined) return 'legacy';
    if (child && LEGACY_MANAGED_CHILDREN.has(child)) return 'legacy';
  }
  return undefined;
}

export function classifyManagedVaultidePath(
  locator: string | undefined,
): VaultideManagedPathKind | undefined {
  const path = locatorPath(String(locator ?? ''));
  if (!path) return undefined;

  // Inspect both unresolved and resolved segments. This keeps traversal-shaped
  // locators such as `Vaultide/../Notes/x.md` quarantined.
  const unresolved = path
    .replaceAll('\\', '/')
    .split('/')
    .map((segment) =>
      segment
        .replace(/[\u0000-\u001f\u007f]/gu, '')
        .trim()
        .normalize('NFKC'),
    )
    .filter(Boolean);
  return classifySegments(unresolved) ?? classifySegments(pathSegments(path));
}

export function isManagedVaultidePath(locator: string | undefined): boolean {
  return classifyManagedVaultidePath(locator) !== undefined;
}

export function normalizeVaultideLocator(locator: string | undefined): string {
  const path = locatorPath(String(locator ?? ''));
  return (
    path
      ? pathSegments(path).join('/')
      : String(locator ?? '').replace(/[\u0000-\u001f\u007f]/gu, '')
  ).trim();
}

/**
 * A second line of defence for legacy aggregate uploads that have no per-file
 * locator. These markers are emitted only by Vaultide-managed notes.
 */
export function containsVaultideManagedMarkers(text: string | undefined): boolean {
  const value = String(text ?? '');
  const managedBlockMarker = new RegExp('<!--\\s*\\/?vaultide:managed\\b', 'iu');
  return (
    managedBlockMarker.test(value) ||
    /(?:^|\n)\s*maic_managed\s*:\s*(?:true|yes|1)\s*(?:\n|$)/iu.test(value) ||
    /(?:^|\n)\s*maic_(?:companion|synthesis|project_index|vault_overview)_id\s*:/iu.test(value)
  );
}
