import { requestUrl } from 'obsidian';
import {
  LEARNING_PROTOCOL_VERSION,
  PROJECT_BINDING_SCHEMA_VERSION,
  SOURCE_UPLOAD_INTENT_SCHEMA_VERSION,
} from '@openmaic/learning-protocol';
import { normalizeServerUrl } from './server-url';

export interface ProjectSyncCapabilities {
  supported: boolean;
  projectBindingSchema?: string;
  sourceUploadIntentSchema?: string;
  goalRetrievalSupported?: boolean;
}

export async function fetchProjectSyncCapabilities(
  serverUrlValue: string,
): Promise<ProjectSyncCapabilities> {
  const serverUrl = normalizeServerUrl(serverUrlValue);
  const response = await requestUrl({
    url: `${serverUrl}/api/v1/integration-capabilities`,
    method: 'GET',
    headers: {
      'X-MAIC-Protocol-Version': LEARNING_PROTOCOL_VERSION,
    },
    throw: false,
  });
  if (response.status === 404) return { supported: false };
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Capability discovery failed with HTTP ${response.status}.`);
  }
  if (typeof response.json !== 'object' || response.json === null) {
    throw new Error('Capability response is invalid.');
  }
  const capabilities = response.json as {
    schemas?: Record<string, unknown>;
    features?: Record<string, unknown>;
  };
  const projectBindingSchema =
    typeof capabilities.schemas?.projectBinding === 'string'
      ? capabilities.schemas.projectBinding
      : undefined;
  const sourceUploadIntentSchema =
    typeof capabilities.schemas?.sourceUploadIntent === 'string'
      ? capabilities.schemas.sourceUploadIntent
      : undefined;
  const supported =
    projectBindingSchema === PROJECT_BINDING_SCHEMA_VERSION &&
    sourceUploadIntentSchema === SOURCE_UPLOAD_INTENT_SCHEMA_VERSION &&
    capabilities.features?.projectBindings === true &&
    capabilities.features?.projectAwareSourceUploads === true &&
    capabilities.features?.sourceUploadStatus === true;
  return {
    supported,
    projectBindingSchema,
    sourceUploadIntentSchema,
    goalRetrievalSupported:
      capabilities.features?.markdownChunkIndex === true &&
      capabilities.features?.projectGoalRetrieval === true,
  };
}
