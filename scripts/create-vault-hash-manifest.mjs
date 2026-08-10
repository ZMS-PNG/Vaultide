import { createHash } from 'node:crypto';
import { readdir, readFile, stat, writeFile, mkdir } from 'node:fs/promises';
import { resolve, relative, sep, basename } from 'node:path';

const vaultRoot = process.argv[2];
if (!vaultRoot) {
  throw new Error('Usage: node scripts/create-vault-hash-manifest.mjs <authorized-vault-root>');
}

const resolvedVaultRoot = resolve(vaultRoot);
const reportDirectory = resolve('reports/content-engine-v3/g0-20260802-baseline');
const reportPath = resolve(reportDirectory, 'vault-hash-manifest.json');
const deniedDirectories = new Set(['.obsidian', '.git', 'node_modules']);

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function normalizeRelativePath(path) {
  return path.split(sep).join('/');
}

async function collectMarkdown(directory, files, counters) {
  const children = await readdir(directory, { withFileTypes: true });
  for (const child of children) {
    const absolutePath = resolve(directory, child.name);
    if (child.isSymbolicLink()) {
      counters.excludedSymbolicLinks += 1;
      continue;
    }
    if (child.isDirectory()) {
      if (deniedDirectories.has(child.name)) {
        counters.excludedDirectories += 1;
        continue;
      }
      await collectMarkdown(absolutePath, files, counters);
      continue;
    }
    if (!child.isFile() || !child.name.toLowerCase().endsWith('.md')) {
      counters.excludedNonMarkdown += 1;
      continue;
    }
    const relativePath = normalizeRelativePath(relative(resolvedVaultRoot, absolutePath));
    const content = await readFile(absolutePath);
    const metadata = await stat(absolutePath);
    files.push({
      pathSha256: digest(relativePath),
      contentSha256: digest(content),
      bytes: metadata.size,
      mtimeMs: Math.trunc(metadata.mtimeMs),
      scope: relativePath === 'Vaultide' || relativePath.startsWith('Vaultide/') ? 'vaultide-managed' : 'original',
    });
  }
}

const rootMetadata = await stat(resolvedVaultRoot);
if (!rootMetadata.isDirectory()) throw new Error('Authorized vault root is not a directory.');

const files = [];
const counters = {
  excludedDirectories: 0,
  excludedSymbolicLinks: 0,
  excludedNonMarkdown: 0,
};
await collectMarkdown(resolvedVaultRoot, files, counters);
files.sort((left, right) => left.pathSha256.localeCompare(right.pathSha256));

const original = files.filter((file) => file.scope === 'original');
const managed = files.filter((file) => file.scope === 'vaultide-managed');
const report = {
  version: 1,
  kind: 'authorized-vault-markdown-hash-baseline',
  createdAt: new Date().toISOString(),
  vaultRootIdentifierSha256: digest(resolvedVaultRoot),
  scope: {
    included: 'regular Markdown files only',
    excludedDirectoryNames: [...deniedDirectories].sort(),
    rawPathnamesPersisted: false,
    noteBodiesPersisted: false,
  },
  counters: {
    totalMarkdownFiles: files.length,
    originalMarkdownFiles: original.length,
    vaultideManagedMarkdownFiles: managed.length,
    totalMarkdownBytes: files.reduce((total, file) => total + file.bytes, 0),
    ...counters,
  },
  originalManifestSha256: digest(JSON.stringify(original)),
  vaultideManagedManifestSha256: digest(JSON.stringify(managed)),
  manifestSha256: digest(JSON.stringify(files)),
  files,
};

await mkdir(reportDirectory, { recursive: true });
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({
  status: 'passed',
  markdownFiles: files.length,
  originalMarkdownFiles: original.length,
  vaultideManagedMarkdownFiles: managed.length,
  manifestSha256: report.manifestSha256,
  reportPath: 'reports/content-engine-v3/g0-20260802-baseline/vault-hash-manifest.json',
}));
