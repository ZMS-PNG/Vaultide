import {
  LEARNING_PROTOCOL_VERSION,
  PROJECT_BINDING_SCHEMA_VERSION,
  SOURCE_ARCHIVE_SCHEMA_VERSION,
  SOURCE_UPLOAD_INTENT_SCHEMA_VERSION,
} from '@openmaic/learning-protocol';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GET } from '@/lib/server/api-routes/v1/integration-capabilities/handler';

const endpoint = 'http://localhost/api/v1/integration-capabilities';
const managedEnv = [
  'ACCESS_CODE',
  'LEARNING_OWNER_ID',
  'PAIRING_HMAC_SECRET',
  'DATABASE_URL',
  'POSTGRES_URL',
  'BLOB_READ_WRITE_TOKEN',
  'CRON_SECRET',
] as const;
const originalEnv = Object.fromEntries(managedEnv.map((key) => [key, process.env[key]]));

describe('GET /api/v1/integration-capabilities', () => {
  beforeEach(() => managedEnv.forEach((key) => delete process.env[key]));

  afterEach(() => {
    managedEnv.forEach((key) => {
      const value = originalEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
  });

  it('supports unauthenticated protocol discovery without enabling unfinished features', async () => {
    const response = GET(new NextRequest(endpoint));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('X-MAIC-Protocol-Version')).toBe(LEARNING_PROTOCOL_VERSION);
    expect(response.headers.get('X-MAIC-Min-Client-Version')).toBe(LEARNING_PROTOCOL_VERSION);
    expect(body.protocol).toEqual({
      serverVersion: LEARNING_PROTOCOL_VERSION,
      minimumClientVersion: LEARNING_PROTOCOL_VERSION,
      requestHeader: 'X-MAIC-Protocol-Version',
    });
    expect(body.features).toEqual({
      pairing: false,
      sourceUpload: false,
      projectBindings: false,
      projectAwareSourceUploads: false,
      sourceUploadStatus: false,
      markdownChunkIndex: false,
      projectGoalRetrieval: false,
      researchCitations: false,
      synthesis: false,
      learningEvents: false,
      writeback: false,
      depositionAutomation: false,
      masteryEvidenceV2: false,
    });
    expect(body.sourceOrigins).toContain('obsidian');
    expect(body.schemas.sourceArchive).toBe(SOURCE_ARCHIVE_SCHEMA_VERSION);
    expect(body.schemas.projectBinding).toBe(PROJECT_BINDING_SCHEMA_VERSION);
    expect(body.schemas.sourceUploadIntent).toBe(SOURCE_UPLOAD_INTENT_SCHEMA_VERSION);
    expect(body.writeback.operations).toContain('createManagedNote');
    expect(body.limits.directUploadRequiredAboveBytes).toBe(4_500_000);
  });

  it('accepts the current protocol and preserves a safe request id', async () => {
    const response = GET(
      new NextRequest(endpoint, {
        headers: {
          'X-MAIC-Protocol-Version': LEARNING_PROTOCOL_VERSION,
          'X-Request-Id': 'plugin-probe:123',
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('X-Request-Id')).toBe('plugin-probe:123');
  });

  it('rejects an unsupported protocol explicitly instead of ignoring it', async () => {
    const response = GET(
      new NextRequest(endpoint, {
        headers: { 'X-MAIC-Protocol-Version': '2025-legacy' },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(426);
    expect(body.error).toMatchObject({
      code: 'protocol_upgrade_required',
      retryable: false,
      details: {
        reason: 'unsupported',
        serverVersion: LEARNING_PROTOCOL_VERSION,
        minimumClientVersion: LEARNING_PROTOCOL_VERSION,
      },
    });
    expect(body.error.requestId).toEqual(expect.any(String));
  });

  it('advertises only features backed by complete deployment configuration', async () => {
    process.env.ACCESS_CODE = 'access';
    process.env.LEARNING_OWNER_ID = `own_${'a'.repeat(32)}`;
    process.env.PAIRING_HMAC_SECRET = 'x'.repeat(32);
    process.env.DATABASE_URL = 'postgresql://example.invalid/database';

    const withoutBlob = await GET(new NextRequest(endpoint)).json();
    expect(withoutBlob.features).toMatchObject({
      pairing: true,
      sourceUpload: false,
      researchCitations: true,
      synthesis: true,
      learningEvents: true,
      writeback: true,
    });

    process.env.BLOB_READ_WRITE_TOKEN = 'vercel_blob_test';
    process.env.CRON_SECRET = 'c'.repeat(32);
    const withBlob = await GET(new NextRequest(endpoint)).json();
    expect(withBlob.features).toMatchObject({
      pairing: true,
      sourceUpload: true,
      projectBindings: true,
      projectAwareSourceUploads: true,
      sourceUploadStatus: true,
      markdownChunkIndex: true,
      projectGoalRetrieval: true,
    });
  });
});
