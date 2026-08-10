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
import { readLearningJson } from '@/lib/learning/http/learning-progress-input';
import { getProjectService } from '@/lib/learning/projects';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(
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
    const revision = await getProjectService().finalizeRevision(
      token,
      projectId,
      await readLearningJson(request),
    );
    // The Obsidian connector consumes the finalized revision as the response
    // body itself. Keep this route aligned with the flat project-registration
    // contract instead of wrapping the result in a second "revision" object.
    return learningJson(context, revision, 201);
  } catch (error) {
    if (error instanceof DeviceTokenServiceError || error instanceof ProjectServiceError) {
      return learningError(context, error.code, error.status, error.message);
    }
    if (error instanceof LearningConfigurationError) {
      return learningError(
        context,
        'dependency_unavailable',
        503,
        'Project finalization is not configured.',
      );
    }
    console.error('Unable to finalize project revision.', { requestId: context.requestId });
    return learningError(
      context,
      'dependency_unavailable',
      503,
      'Project finalization is temporarily unavailable.',
      { retryable: true },
    );
  }
}
