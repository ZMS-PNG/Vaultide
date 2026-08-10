// Loaded by the consolidated Vercel API dispatcher.
import {
  LEARNING_EVENT_SCHEMA_VERSION,
  LEARNING_PROTOCOL_VERSION,
  PROJECT_BINDING_SCHEMA_VERSION,
  SOURCE_ARCHIVE_SCHEMA_VERSION,
  SOURCE_BUNDLE_SCHEMA_VERSION,
  SOURCE_UPLOAD_INTENT_SCHEMA_VERSION,
  SOURCE_ORIGINS,
  WRITEBACK_COMMAND_SCHEMA_VERSION,
  WRITEBACK_FRONTMATTER_KEYS,
  WRITEBACK_OPERATIONS,
} from '@openmaic/learning-protocol';
import { NextRequest } from 'next/server';
import {
  learningProgressIsConfigured,
  pairingIsConfigured,
  sourceUploadIsConfigured,
} from '@/lib/learning/config';
import {
  learningJson,
  learningRequestContext,
  requireLearningProtocol,
} from '@/lib/learning/http/api';

export const dynamic = 'force-dynamic';

const MAX_FUNCTION_BODY_BYTES = 4_500_000;

/**
 * Public bootstrap endpoint used before pairing. Omitting the client version is
 * allowed here so a new plugin can discover the minimum supported protocol.
 */
export function GET(request: NextRequest) {
  const context = learningRequestContext(request);
  const protocolError = requireLearningProtocol(request, context, { allowMissing: true });
  if (protocolError) return protocolError;

  return learningJson(context, {
    protocol: {
      serverVersion: LEARNING_PROTOCOL_VERSION,
      minimumClientVersion: LEARNING_PROTOCOL_VERSION,
      requestHeader: 'X-MAIC-Protocol-Version',
    },
    schemas: {
      sourceBundle: SOURCE_BUNDLE_SCHEMA_VERSION,
      sourceArchive: SOURCE_ARCHIVE_SCHEMA_VERSION,
      learningEvent: LEARNING_EVENT_SCHEMA_VERSION,
      writebackCommand: WRITEBACK_COMMAND_SCHEMA_VERSION,
      projectBinding: PROJECT_BINDING_SCHEMA_VERSION,
      sourceUploadIntent: SOURCE_UPLOAD_INTENT_SCHEMA_VERSION,
      projectRetrieval: 'project-retrieval/1',
    },
    sourceOrigins: SOURCE_ORIGINS,
    writeback: {
      operations: WRITEBACK_OPERATIONS,
      frontmatterKeys: WRITEBACK_FRONTMATTER_KEYS,
    },
    features: {
      pairing: pairingIsConfigured(),
      sourceUpload: sourceUploadIsConfigured(),
      projectBindings: sourceUploadIsConfigured(),
      projectAwareSourceUploads: sourceUploadIsConfigured(),
      sourceUploadStatus: sourceUploadIsConfigured(),
      markdownChunkIndex: sourceUploadIsConfigured(),
      projectGoalRetrieval: sourceUploadIsConfigured(),
      researchCitations: learningProgressIsConfigured(),
      synthesis: learningProgressIsConfigured(),
      learningEvents: learningProgressIsConfigured(),
      writeback: learningProgressIsConfigured(),
      depositionAutomation: learningProgressIsConfigured(),
      masteryEvidenceV2: learningProgressIsConfigured(),
    },
    limits: {
      functionBodyBytes: MAX_FUNCTION_BODY_BYTES,
      directUploadRequiredAboveBytes: MAX_FUNCTION_BODY_BYTES,
    },
    phase: 'project-retrieval',
  });
}
