import esbuild from 'esbuild';
import process from 'node:process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const production = process.argv[2] === 'production';
const here = dirname(fileURLToPath(import.meta.url));

const context = await esbuild.context({
  entryPoints: ['src/main.ts'],
  alias: {
    '@openmaic/learning-protocol': resolve(here, '../@openmaic/learning-protocol/src/index.ts'),
  },
  bundle: true,
  external: ['obsidian', 'electron', '@codemirror/*', '@lezer/*'],
  format: 'cjs',
  target: 'es2018',
  logLevel: 'info',
  sourcemap: production ? false : 'inline',
  treeShaking: true,
  minify: production,
  outfile: 'main.js',
});

if (production) {
  await context.rebuild();
  await context.dispose();
} else {
  await context.watch();
}
