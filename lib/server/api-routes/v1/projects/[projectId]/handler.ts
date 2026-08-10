// Loaded by the consolidated Vercel API dispatcher.
import { NextRequest } from 'next/server';
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
import { getProjectService } from '@/lib/learning/projects';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const context = learningRequestContext(request);
  const protocolError = requireLearningProtocol(request, context);
  if (protocolError) return protocolError;

  try {
    const token = bearerToken(request);
    if (!token) {
      return learningError(context, 'token_invalid', 401, 'Device credential is required.');
    }
    const { projectId } = await params;
    const project = await getProjectService().status(token, projectId);
    return learningJson(context, { project });
  } catch (error) {
    if (error instanceof DeviceTokenServiceError || error instanceof ProjectServiceError) {
      return learningError(context, error.code, error.status, error.message);
    }
    if (error instanceof LearningConfigurationError) {
      return learningError(
        context,
        'dependency_unavailable',
        503,
        'Project status is not configured.',
      );
    }
    console.error('Unable to read learning project status.', { requestId: context.requestId });
    return learningError(
      context,
      'dependency_unavailable',
      503,
      'Project status is temporarily unavailable.',
      { retryable: true },
    );
  }
}
