// Loaded by the consolidated Vercel API dispatcher.
import { NextRequest } from 'next/server';
import { ProjectRetrievalServiceError } from '@/lib/learning/application/project-retrieval-service';
import { LearningConfigurationError } from '@/lib/learning/config';
import { requireLearningAdmin } from '@/lib/learning/http/admin-auth';
import {
  learningError,
  learningJson,
  learningRequestContext,
  requireLearningProtocol,
} from '@/lib/learning/http/api';
import { getProjectRetrievalService } from '@/lib/learning/project-retrieval';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ bundleId: string }> },
) {
  const context = learningRequestContext(request);
  const protocolError = requireLearningProtocol(request, context);
  if (protocolError) return protocolError;
  const authError = requireLearningAdmin(request, context);
  if (authError) return authError;

  try {
    const { bundleId } = await params;
    const project = await getProjectRetrievalService().bundleContext(bundleId);
    return learningJson(context, {
      project: project
        ? {
            projectId: project.projectId,
            displayName: project.displayName,
            projectRevision: project.projectRevision,
            uploadedProjectRevision: project.uploadedProjectRevision,
            coverage: project.coverage,
            sourceCount: project.activeSourceCount,
            searchableSourceCount: project.searchableSourceCount,
            pendingSourceCount: project.pendingSourceCount,
            failedSourceCount: project.failedSourceCount,
            indexedChunkCount: project.indexedChunkCount,
            ...(project.lastIndexedAt
              ? { lastIndexedAt: project.lastIndexedAt.toISOString() }
              : {}),
          }
        : null,
    });
  } catch (error) {
    if (error instanceof ProjectRetrievalServiceError) {
      return learningError(context, error.code, error.status, error.message, {
        retryable: error.retryable,
      });
    }
    if (error instanceof LearningConfigurationError) {
      return learningError(
        context,
        'dependency_unavailable',
        503,
        'Project retrieval is not configured.',
      );
    }
    console.error('Unable to read SourceBundle project context.', {
      requestId: context.requestId,
    });
    return learningError(
      context,
      'dependency_unavailable',
      503,
      'Project context is temporarily unavailable.',
      { retryable: true },
    );
  }
}
