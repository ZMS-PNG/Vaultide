import type { SourceBundle } from './source.js';
import { validateSourceBundle, type ValidationIssue, type ValidationResult } from './validate.js';
import { LEARNING_PROTOCOL_VERSION, SOURCE_ARCHIVE_SCHEMA_VERSION } from './version.js';

export interface SourceArchiveContent {
  snapshotId: string;
  utf8Content: string;
}

/** Private-Blob payload: the immutable manifest plus explicitly approved source text. */
export interface SourceArchive {
  protocolVersion: typeof LEARNING_PROTOCOL_VERSION;
  schemaVersion: typeof SOURCE_ARCHIVE_SCHEMA_VERSION;
  bundle: SourceBundle;
  contents: SourceArchiveContent[];
}

export function stampSourceArchive(
  archive: Omit<SourceArchive, 'protocolVersion' | 'schemaVersion'>,
): SourceArchive {
  return {
    ...archive,
    protocolVersion: LEARNING_PROTOCOL_VERSION,
    schemaVersion: SOURCE_ARCHIVE_SCHEMA_VERSION,
  };
}

function invalid(errors: ValidationIssue[]): ValidationResult {
  return errors.length > 0 ? { valid: false, errors } : { valid: true };
}

export function validateSourceArchive(value: unknown): ValidationResult {
  const errors: ValidationIssue[] = [];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {
      valid: false,
      errors: [{ path: '/', code: 'type', message: 'expected SourceArchive object' }],
    };
  }
  const archive = value as Record<string, unknown>;
  for (const key of Object.keys(archive)) {
    if (!['protocolVersion', 'schemaVersion', 'bundle', 'contents'].includes(key)) {
      errors.push({ path: `/${key}`, code: 'unknown_field', message: 'field is not allowed' });
    }
  }
  if (archive.protocolVersion !== LEARNING_PROTOCOL_VERSION) {
    errors.push({
      path: '/protocolVersion',
      code: 'protocol_version',
      message: 'unsupported protocol version',
    });
  }
  if (archive.schemaVersion !== SOURCE_ARCHIVE_SCHEMA_VERSION) {
    errors.push({
      path: '/schemaVersion',
      code: 'schema_version',
      message: `expected ${SOURCE_ARCHIVE_SCHEMA_VERSION}`,
    });
  }

  const bundleResult = validateSourceBundle(archive.bundle);
  if (!bundleResult.valid) {
    errors.push(
      ...bundleResult.errors.map((error) => ({ ...error, path: `/bundle${error.path}` })),
    );
  }
  if (!Array.isArray(archive.contents)) {
    errors.push({ path: '/contents', code: 'type', message: 'expected content array' });
    return invalid(errors);
  }

  const bundle = archive.bundle as SourceBundle | undefined;
  const snapshots = Array.isArray(bundle?.snapshots) ? bundle.snapshots : [];
  const expected = new Map(snapshots.map((snapshot) => [snapshot.id, snapshot.byteSize]));
  const seen = new Set<string>();
  for (let index = 0; index < archive.contents.length; index += 1) {
    const item = archive.contents[index];
    const path = `/contents/${index}`;
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      errors.push({ path, code: 'type', message: 'expected content object' });
      continue;
    }
    const record = item as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (!['snapshotId', 'utf8Content'].includes(key)) {
        errors.push({
          path: `${path}/${key}`,
          code: 'unknown_field',
          message: 'field is not allowed',
        });
      }
    }
    if (typeof record.snapshotId !== 'string' || !expected.has(record.snapshotId)) {
      errors.push({
        path: `${path}/snapshotId`,
        code: 'reference',
        message: 'content must reference a bundle snapshot',
      });
      continue;
    }
    if (seen.has(record.snapshotId)) {
      errors.push({
        path: `${path}/snapshotId`,
        code: 'duplicate',
        message: 'snapshot content is duplicated',
      });
    }
    seen.add(record.snapshotId);
    if (typeof record.utf8Content !== 'string') {
      errors.push({
        path: `${path}/utf8Content`,
        code: 'type',
        message: 'expected source text',
      });
      continue;
    }
    if (
      new TextEncoder().encode(record.utf8Content).byteLength !== expected.get(record.snapshotId)
    ) {
      errors.push({
        path: `${path}/utf8Content`,
        code: 'byte_size',
        message: 'content byte size does not match its snapshot',
      });
    }
  }
  for (const snapshotId of expected.keys()) {
    if (!seen.has(snapshotId)) {
      errors.push({
        path: '/contents',
        code: 'missing',
        message: `content is missing for snapshot ${snapshotId}`,
      });
    }
  }
  return invalid(errors);
}
