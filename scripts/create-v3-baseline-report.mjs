/**
 * Produces a redacted, reproducible Phase-0 baseline for the V3 release.
 *
 * It deliberately records file paths, hashes, build artifacts, and Git state
 * only. It never reads environment values, note contents, or database rows.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();
const generatedAt = new Date().toISOString();
const releaseId = process.argv[2] ?? `g0-${generatedAt.replace(/[:.]/g, '-')}`;
const reportDir = join(root, 'reports', 'content-engine-v3', releaseId);

function command(...args) {
  return execFileSync(args[0], args.slice(1), {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function sha256(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function classify(path) {
  if (
    path === 'vitest.config.ts' ||
    path === 'lib/config/feature-flags.ts' ||
    path === 'tests/config/feature-flags.test.ts' ||
    path === 'scripts/create-v3-baseline-report.mjs'
  ) {
    return { category: 'phase-0-validation-change', owner: 'current execution', disposition: 'retain-and-verify' };
  }
  if (/^(tests|eval)\//.test(path)) return { category: 'verification-and-evaluation', owner: 'pre-existing worktree', disposition: 'retain; ownership pending review' };
  if (/^(app|components)\//.test(path)) return { category: 'product-ui-and-api-surface', owner: 'pre-existing worktree', disposition: 'retain; ownership pending review' };
  if (/^(lib|db|workflows)\//.test(path)) return { category: 'v3-domain-and-runtime', owner: 'pre-existing worktree', disposition: 'retain; ownership pending review' };
  if (/^packages\//.test(path)) return { category: 'integration-package', owner: 'pre-existing worktree', disposition: 'retain; ownership pending review' };
  if (/^(package\.json|pnpm-lock\.yaml|next\.config\.ts|vercel\.json|middleware\.ts|\.gitignore)$/.test(path)) return { category: 'release-or-runtime-configuration', owner: 'pre-existing worktree', disposition: 'retain; ownership pending review' };
  if (/^(output|tmp|\.playwright-cli)\//.test(path)) return { category: 'generated-or-local-artifact', owner: 'pre-existing worktree', disposition: 'exclude from release commit until reviewed' };
  if (/^scripts\//.test(path)) return { category: 'tooling-and-operations', owner: 'pre-existing worktree', disposition: 'retain; ownership pending review' };
  return { category: 'other', owner: 'pre-existing worktree', disposition: 'retain; ownership pending review' };
}

function parseStatus() {
  const output = command('git', 'status', '--porcelain=v1');
  if (!output) return [];
  return output.split(/\r?\n/).filter(Boolean).map((line) => {
    const status = line.slice(0, 2);
    const rawPath = line.slice(3).trim();
    const path = rawPath.includes(' -> ') ? rawPath.split(' -> ').at(-1) : rawPath;
    return { status, path, ...classify(path) };
  }).filter((entry) => !entry.path.startsWith('reports/content-engine-v3/'))
    .sort((a, b) => a.path.localeCompare(b.path));
}

const executionPackDir = join(root, 'docs', 'content-engine-v3', 'execution-pack');
const executionPack = existsSync(executionPackDir)
  ? readdirSync(executionPackDir)
      .filter((name) => /^\d\d-.*\.md$/.test(name))
      .sort()
      .map((name) => ({ name, sha256: sha256(join(executionPackDir, name)) }))
  : [];

const buildArtifacts = [
  '.next/BUILD_ID',
  '.next/required-server-files.json',
  '.next/routes-manifest.json',
  '.next/prerender-manifest.json',
].map((path) => {
  const filePath = join(root, path);
  return existsSync(filePath)
    ? { path, bytes: statSync(filePath).size, sha256: sha256(filePath) }
    : { path, missing: true };
});

const baseline = {
  schemaVersion: 1,
  releaseId,
  generatedAt,
  git: {
    head: command('git', 'rev-parse', 'HEAD'),
    branch: command('git', 'branch', '--show-current'),
    upstream: (() => {
      try { return command('git', 'remote', 'get-url', 'origin'); } catch { return null; }
    })(),
  },
  safety: {
    secretValuesCaptured: false,
    vaultContentCaptured: false,
    databaseRowsCaptured: false,
    note: 'This manifest is safe to attach to release evidence; it contains metadata only.',
  },
  worktree: parseStatus(),
  executionPack,
  buildArtifacts,
};

const categories = Object.entries(
  baseline.worktree.reduce((summary, entry) => {
    summary[entry.category] = (summary[entry.category] ?? 0) + 1;
    return summary;
  }, {}),
).sort(([left], [right]) => left.localeCompare(right));

const markdown = [
  '# V3 Phase-0 baseline manifest',
  '',
  `- Release evidence ID: \`${baseline.releaseId}\``,
  `- Generated (UTC): \`${baseline.generatedAt}\``,
  `- Git HEAD: \`${baseline.git.head}\``,
  `- Branch: \`${baseline.git.branch}\``,
  `- Dirty entries: **${baseline.worktree.length}**`,
  '- Secret values, Vault content, and database rows: **not captured**.',
  '',
  '## Classification',
  '',
  '| Category | Count |',
  '| --- | ---: |',
  ...categories.map(([category, count]) => `| ${category} | ${count} |`),
  '',
  '## Gate interpretation',
  '',
  '- Every dirty entry is classified, but pre-existing ownership still requires a release-owner decision before commit or production release.',
  '- Generated/local artifacts remain outside release commits until individually reviewed.',
  '- This manifest is an inventory, not a backup or restore-drill attestation.',
  '',
  '## Files',
  '',
  '| Git state | Path | Category | Owner | Disposition |',
  '| --- | --- | --- | --- | --- |',
  ...baseline.worktree.map((entry) => `| \`${entry.status}\` | \`${entry.path}\` | ${entry.category} | ${entry.owner} | ${entry.disposition} |`),
  '',
  '## Build artifacts',
  '',
  '| Path | Bytes | SHA-256 |',
  '| --- | ---: | --- |',
  ...baseline.buildArtifacts.map((artifact) => artifact.missing
    ? `| \`${artifact.path}\` | missing | — |`
    : `| \`${artifact.path}\` | ${artifact.bytes} | \`${artifact.sha256}\` |`),
  '',
].join('\n');

mkdirSync(reportDir, { recursive: true });
writeFileSync(join(reportDir, 'baseline-manifest.json'), `${JSON.stringify(baseline, null, 2)}\n`, 'utf8');
writeFileSync(join(reportDir, 'baseline-manifest.md'), markdown, 'utf8');
console.log(relative(root, reportDir).replaceAll('\\', '/'));
