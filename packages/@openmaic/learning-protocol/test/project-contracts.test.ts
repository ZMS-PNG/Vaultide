import { describe, expect, it } from 'vitest';
import {
  LEARNING_PROTOCOL_VERSION,
  PROJECT_BINDING_SCHEMA_VERSION,
  SOURCE_UPLOAD_INTENT_SCHEMA_VERSION,
  stampProjectBindingRequest,
  stampSourceUploadIntent,
  validateProjectBindingRequest,
  validateProjectBindingResponse,
  validateSourceUploadIntent,
  type ProjectBindingResponse,
} from '@openmaic/learning-protocol';

const PROJECT_ID = `prj_${'a'.repeat(32)}`;
const BUNDLE_ID = `src_${'b'.repeat(32)}`;
const SNAPSHOT_ID = `snp_${'c'.repeat(32)}`;
const SOURCE_ID = `sou_${'d'.repeat(32)}`;
const MANIFEST_HASH = 'e'.repeat(64);
const NOW = '2026-07-23T08:00:00.000Z';
const LATER = '2026-08-22T08:00:00.000Z';

describe('ProjectBinding contract', () => {
  it('accepts a strict idempotent Obsidian folder registration', () => {
    const request = stampProjectBindingRequest({
      projectId: PROJECT_ID,
      kind: 'obsidian-folder',
      displayName: 'OpenMAIC',
      folderPath: 'Projects/OpenMAIC',
      expectedBindingRevision: 2,
    });

    expect(request.protocolVersion).toBe(LEARNING_PROTOCOL_VERSION);
    expect(request.schemaVersion).toBe(PROJECT_BINDING_SCHEMA_VERSION);
    expect(validateProjectBindingRequest(request)).toEqual({ valid: true });
  });

  it('rejects unknown fields, unsafe paths, and malformed project ids', () => {
    const request = {
      ...stampProjectBindingRequest({
        projectId: 'prj_not-valid',
        kind: 'obsidian-folder',
        displayName: 'OpenMAIC',
        folderPath: '../Secrets',
      }),
      ownerId: `own_${'f'.repeat(32)}`,
    };
    const result = validateProjectBindingRequest(request);

    expect(result.valid).toBe(false);
    if (result.valid) throw new Error('unreachable');
    expect(result.errors.map((error) => error.code)).toEqual(
      expect.arrayContaining(['unknown_field', 'entity_id', 'unsafe_path']),
    );
  });

  it('validates the strict server-confirmed binding response', () => {
    const response: ProjectBindingResponse = {
      protocolVersion: LEARNING_PROTOCOL_VERSION,
      schemaVersion: PROJECT_BINDING_SCHEMA_VERSION,
      projectId: PROJECT_ID,
      kind: 'obsidian-folder',
      displayName: 'OpenMAIC',
      folderPath: 'Projects/OpenMAIC',
      bindingRevision: 1,
      projectRevision: 0,
      registeredAt: NOW,
    };

    expect(validateProjectBindingResponse(response)).toEqual({ valid: true });
    expect(validateProjectBindingResponse({ ...response, serverSecret: true }).valid).toBe(false);
  });
});

describe('SourceUploadIntent contract', () => {
  function validIntent() {
    return stampSourceUploadIntent({
      bundleId: BUNDLE_ID,
      manifestHash: MANIFEST_HASH,
      sourceByteSize: 42,
      itemCount: 1,
      retentionUntil: LATER,
      project: {
        projectId: PROJECT_ID,
        expectedProjectRevision: 0,
        coverage: 'partial',
        sources: [{ snapshotId: SNAPSHOT_ID, sourceId: SOURCE_ID }],
      },
    });
  }

  it('accepts a project-aware partial upload intent', () => {
    const intent = validIntent();
    expect(intent.schemaVersion).toBe(SOURCE_UPLOAD_INTENT_SCHEMA_VERSION);
    expect(validateSourceUploadIntent(intent)).toEqual({ valid: true });
  });

  it('keeps the exact 0.4 upload metadata shape valid and strict', () => {
    const legacy = {
      bundleId: BUNDLE_ID,
      manifestHash: MANIFEST_HASH,
      sourceByteSize: 42,
      itemCount: 1,
      retentionUntil: LATER,
    };
    expect(validateSourceUploadIntent(legacy)).toEqual({ valid: true });
    expect(validateSourceUploadIntent({ ...legacy, projectId: PROJECT_ID }).valid).toBe(false);
  });

  it('rejects unknown nested fields and duplicate stable identities', () => {
    const intent = validIntent();
    const result = validateSourceUploadIntent({
      ...intent,
      project: {
        ...intent.project,
        trustedByClient: true,
        sources: [
          ...intent.project.sources,
          { snapshotId: SNAPSHOT_ID, sourceId: SOURCE_ID },
        ],
      },
      itemCount: 2,
    });

    expect(result.valid).toBe(false);
    if (result.valid) throw new Error('unreachable');
    expect(result.errors.map((error) => error.code)).toEqual(
      expect.arrayContaining(['unknown_field', 'duplicate']),
    );
  });

  it('requires exactly one stable source reference per uploaded item', () => {
    const result = validateSourceUploadIntent({ ...validIntent(), itemCount: 2 });
    expect(result.valid).toBe(false);
    if (result.valid) throw new Error('unreachable');
    expect(result.errors.map((error) => error.code)).toContain('invariant');
  });
});
