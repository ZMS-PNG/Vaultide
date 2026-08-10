import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

/**
 * Next's `output: "standalone"` intentionally does not copy public assets or
 * `/.next/static`. Vercel serves those itself, while a self-hosted standalone
 * process must include them alongside `server.js`.
 *
 * Keep this explicit and fail before launch: a visually incomplete local
 * release candidate is not an acceptable substitute for a production check.
 */
const root = process.cwd();
const standalone = resolve(root, '.next', 'standalone');
const assets = [
  [resolve(root, 'public'), resolve(standalone, 'public')],
  [resolve(root, '.next', 'static'), resolve(standalone, '.next', 'static')],
];

if (!existsSync(resolve(standalone, 'server.js'))) {
  throw new Error('Standalone server is missing. Run `pnpm build` before `pnpm prepare:standalone`.');
}

function copyDirectory(from, to) {
  if (process.platform !== 'win32') {
    cpSync(from, to, { recursive: true, force: true });
    return;
  }

  // `fs.cpSync` can terminate the Windows Node process when copying a large
  // Next static tree with native package junctions. Robocopy handles these
  // normal Windows trees reliably; its 0–7 exit codes are successful copies.
  const result = spawnSync(
    'robocopy.exe',
    [from, to, '/E', '/COPY:DAT', '/DCOPY:DAT', '/NFL', '/NDL', '/NJH', '/NJS', '/NC', '/NS'],
    { encoding: 'utf8' },
  );
  if (result.error || (result.status ?? 16) > 7) {
    throw new Error(
      `Unable to package standalone assets from ${from}: ${result.error?.message ?? result.stderr ?? 'robocopy failed'}`,
    );
  }
}

for (const [from, to] of assets) {
  if (!existsSync(from)) {
    throw new Error(`Required standalone asset directory is missing: ${from}`);
  }
  mkdirSync(to, { recursive: true });
  copyDirectory(from, to);
}

console.log('Standalone static assets are ready.');
