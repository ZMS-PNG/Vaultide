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
import { readLearningJson } from '@/lib/learning/http/learning-progress-input';
import { getProjectRetrievalService } from '@/lib/learning/project-retrieval';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringArray(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new ProjectRetrievalServiceError(
      'invalid_request',
      400,
      'Project source controls are invalid.',
    );
  }
  return value as string[];
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const context = learningRequestContext(request);
  const protocolError = requireLearningProtocol(request, context);
  if (protocolError) return protocolError;
  const authError = requireLearningAdmin(request, context);
  if (authError) return authError;

  try {
    const body = record(await readLearningJson(request));
    if (!body || typeof body.goal !== 'string') {
      return learningError(context, 'invalid_request', 400, 'A learning goal is required.');
    }
    const allowed = new Set([
      'goal',
      'anchorBundleId',
      'maxContextChars',
      'requiredSourceIds',
      'excludedSourceIds',
    ]);
    if (Object.keys(body).some((key) => !allowed.has(key))) {
      return learningError(
        context,
        'invalid_request',
        400,
        'Project retrieval request contains an unknown field.',
      );
    }
    if (body.anchorBundleId !== undefined && typeof body.anchorBundleId !== 'string') {
      return learningError(context, 'invalid_request', 400, 'Anchor bundle id is invalid.');
    }
    if (body.maxContextChars !== undefined && typeof body.maxContextChars !== 'number') {
      return learningError(context, 'invalid_request', 400, 'Context budget is invalid.');
    }
    const { projectId } = await params;
    const result = await getProjectRetrievalService().retrieve({
      projectId,
      goal: body.goal,
      ...(typeof body.anchorBundleId === 'string' ? { anchorBundleId: body.anchorBundleId } : {}),
      ...(typeof body.maxContextChars === 'number'
        ? { maxContextChars: body.maxContextChars }
        : {}),
      ...(body.requiredSourceIds !== undefined
        ? { requiredSourceIds: stringArray(body.requiredSourceIds) }
        : {}),
      ...(body.excludedSourceIds !== undefined
        ? { excludedSourceIds: stringArray(body.excludedSourceIds) }
        : {}),
    });
    return learningJson(context, { retrieval: result }, 201);
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
    if (
      error instanceof SyntaxError ||
      (error instanceof Error && error.message === 'body_too_large')
    ) {
      return learningError(
        context,
        'invalid_request',
        400,
        'Project retrieval request is invalid.',
      );
    }
    const databaseError =
      typeof error === 'object' && error !== null
        ? (error as { code?: unknown; detail?: unknown; hint?: unknown })
        : undefined;
    console.error('Unable to retrieve project learning context.', {
      requestId: context.requestId,
      errorName: error instanceof Error ? error.name : typeof error,
      errorMessage: error instanceof Error ? error.message : String(error),
      errorCode: databaseError?.code === undefined ? undefined : String(databaseError.code),
      // SQL diagnostics only; request content and learning sources are intentionally not logged.
      errorDetail: databaseError?.detail === undefined ? undefined : String(databaseError.detail),
      errorHint: databaseError?.hint === undefined ? undefined : String(databaseError.hint),
    });
    return learningError(
      context,
      'dependency_unavailable',
      503,
      'Project retrieval is temporarily unavailable.',
      { retryable: true },
    );
  }
}
