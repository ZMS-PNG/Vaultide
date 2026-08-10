// Loaded by the consolidated Vercel API dispatcher.
import { NextRequest } from 'next/server';
import {
  LEARNING_PROTOCOL_VERSION,
  PROJECT_BINDING_SCHEMA_VERSION,
  type ProjectBindingResponse,
} from '@openmaic/learning-protocol';
import { DeviceTokenServiceError } from '@/lib/learning/application/device-token-service';
import { ProjectServiceError } from '@/lib/learning/application/project-service';
import { LearningConfigurationError } from '@/lib/learning/config';
import {
  learningError,
  learningJson,
  learningRequestContext,
  requireLearningProtocol,
} from '@/lib/learning/http/api';
import { bearerToken } from '@/lib/learning/http/bearer';
import { readLearningJson } from '@/lib/learning/http/learning-progress-input';
import { getProjectService } from '@/lib/learning/projects';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const context = learningRequestContext(request);
  const protocolError = requireLearningProtocol(request, context);
  if (protocolError) return protocolError;

  try {
    const token = bearerToken(request);
    if (!token) {
      return learningError(context, 'token_invalid', 401, 'Device credential is required.');
    }
    const project = await getProjectService().register(token, await readLearningJson(request));
    const response: ProjectBindingResponse = {
      protocolVersion: LEARNING_PROTOCOL_VERSION,
      schemaVersion: PROJECT_BINDING_SCHEMA_VERSION,
      projectId: project.id,
      kind: project.kind as ProjectBindingResponse['kind'],
      displayName: project.projectName,
      folderPath: project.rootPath,
      bindingRevision: project.bindingRevision,
      projectRevision: project.projectRevision,
      ...(project.latestManifestHash ? { latestManifestHash: project.latestManifestHash } : {}),
      registeredAt: project.updatedAt.toISOString(),
    };
    return learningJson(context, response, project.bindingRevision === 1 ? 201 : 200);
  } catch (error) {
    if (error instanceof DeviceTokenServiceError || error instanceof ProjectServiceError) {
      return learningError(context, error.code, error.status, error.message);
    }
    if (error instanceof LearningConfigurationError) {
      return learningError(
        context,
        'dependency_unavailable',
        503,
        'Project registration is not configured.',
      );
    }
    console.error('Unable to register learning project.', { requestId: context.requestId });
    return learningError(
      context,
      'dependency_unavailable',
      503,
      'Project registration is temporarily unavailable.',
      { retryable: true },
    );
  }
}
