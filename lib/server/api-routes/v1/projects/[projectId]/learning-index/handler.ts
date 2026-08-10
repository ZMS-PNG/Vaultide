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

async function projectId(
  params: Promise<{ projectId: string }>,
): Promise<string | undefined> {
  const { projectId } = await params;
  return /^prj_[a-f0-9]{32}$/.test(projectId) ? projectId : undefined;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const context = learningRequestContext(request);
  const protocolError = requireLearningProtocol(request, context);
  if (protocolError) return protocolError;
  const authError = requireLearningAdmin(request, context);
  if (authError) return authError;
  const id = await projectId(params);
  if (!id) return learningError(context, 'invalid_request', 400, 'Invalid project id.');
  try {
    return learningJson(context, {
      index: await getLearningProgressService().projectLearningIndex(id),
    });
  } catch (error) {
    return learningProgressErrorResponse(context, error);
  }
}

/** First creation remains a visible Obsidian confirmation; later updates use CAS blocks. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const context = learningRequestContext(request);
  const protocolError = requireLearningProtocol(request, context);
  if (protocolError) return protocolError;
  const authError = requireLearningAdmin(request, context);
  if (authError) return authError;
  const id = await projectId(params);
  if (!id) return learningError(context, 'invalid_request', 400, 'Invalid project id.');
  try {
    return learningJson(context, {
      draft: await getLearningProgressService().createProjectLearningIndexDraft(id),
    });
  } catch (error) {
    return learningProgressErrorResponse(context, error);
  }
}
