import { createGenerator } from 'ts-json-schema-generator';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, '..');

export const ROOTS = {
  SourceBundle: 'source-bundle.schema.json',
  SourceArchive: 'source-archive.schema.json',
  LearningEvent: 'learning-event.schema.json',
  ProjectBindingContract: 'project-binding.schema.json',
  SourceUploadIntent: 'source-upload-intent.schema.json',
  WritebackCommand: 'writeback-command.schema.json',
};

let generator;
function getGenerator() {
  generator ??= createGenerator({
    path: resolve(packageRoot, 'src/schema-roots.ts'),
    tsconfig: resolve(packageRoot, 'tsconfig.json'),
    skipTypeCheck: false,
    topRef: true,
    additionalProperties: false,
    jsDoc: 'extended',
  });
  return generator;
}

export function generateSchema(typeName) {
  if (!(typeName in ROOTS)) throw new Error(`unknown schema root: ${typeName}`);
  return getGenerator().createSchema(typeName);
}

function main() {
  const outputDirectory = resolve(packageRoot, 'dist/schema');
  mkdirSync(outputDirectory, { recursive: true });
  for (const [typeName, fileName] of Object.entries(ROOTS)) {
    writeFileSync(
      resolve(outputDirectory, fileName),
      `${JSON.stringify(generateSchema(typeName), null, 2)}\n`,
    );
    console.log(`wrote dist/schema/${fileName}`);
  }
}

function invokedDirectly() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (invokedDirectly()) main();
