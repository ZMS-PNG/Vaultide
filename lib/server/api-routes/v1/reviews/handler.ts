// Loaded by the consolidated Vercel API dispatcher.
import { NextRequest } from 'next/server';
import { requireLearningAdmin } from '@/lib/learning/http/admin-auth';
import {
  learningError,
  learningJson,
  learningRequestContext,
  requireLearningProtocol,
} from '@/lib/learning/http/api';
import { learningProgressErrorResponse } from '@/lib/learning/http/learning-progress-error';
import { getLearningProgressService } from '@/lib/learning/learning-progress';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function positiveLimit(value: string | null): number | undefined {
  if (value === null) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 200 ? parsed : undefined;
}

export async function GET(request: NextRequest) {
  const context = learningRequestContext(request);
  const protocolError = requireLearningProtocol(request, context);
  if (protocolError) return protocolError;
  const authError = requireLearningAdmin(request, context);
  if (authError) return authError;

  const projectId = request.nextUrl.searchParams.get('projectId');
  const dueOnly = request.nextUrl.searchParams.get('dueOnly');
  const limit = positiveLimit(request.nextUrl.searchParams.get('limit'));
  if (
    (projectId !== null && !/^prj_[a-f0-9]{32}$/.test(projectId)) ||
    (dueOnly !== null && dueOnly !== 'true' && dueOnly !== 'false') ||
    (request.nextUrl.searchParams.has('limit') && limit === undefined)
  ) {
    return learningError(context, 'invalid_request', 400, 'Invalid review queue filter.');
  }
  try {
    return learningJson(context, {
      reviews: await getLearningProgressService().listReviewQueue({
        ...(projectId ? { projectId } : {}),
        ...(dueOnly === 'true' ? { dueOnly: true } : {}),
        ...(limit ? { limit } : {}),
      }),
    });
  } catch (error) {
    return learningProgressErrorResponse(context, error);
  }
}
