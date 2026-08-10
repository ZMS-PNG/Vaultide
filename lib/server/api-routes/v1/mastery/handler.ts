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

function optionalId(value: string | null, pattern: RegExp): string | undefined {
  return value && pattern.test(value) ? value : undefined;
}

export async function GET(request: NextRequest) {
  const context = learningRequestContext(request);
  const protocolError = requireLearningProtocol(request, context);
  if (protocolError) return protocolError;
  const authError = requireLearningAdmin(request, context);
  if (authError) return authError;

  const sprintId = optionalId(request.nextUrl.searchParams.get('sprintId'), /^spr_[a-f0-9]{32}$/);
  const projectId = optionalId(request.nextUrl.searchParams.get('projectId'), /^prj_[a-f0-9]{32}$/);
  const conceptId = request.nextUrl.searchParams.get('conceptId') ?? undefined;
  if (
    (request.nextUrl.searchParams.has('sprintId') && !sprintId) ||
    (request.nextUrl.searchParams.has('projectId') && !projectId) ||
    (conceptId !== undefined && (conceptId.length === 0 || conceptId.length > 256))
  ) {
    return learningError(context, 'invalid_request', 400, 'Invalid mastery filter.');
  }
  try {
    const projections = await getLearningProgressService().listMastery({
      ...(sprintId ? { sprintId } : {}),
      ...(projectId ? { projectId } : {}),
      ...(conceptId ? { conceptId } : {}),
    });
    return learningJson(context, { projections });
  } catch (error) {
    return learningProgressErrorResponse(context, error);
  }
}
