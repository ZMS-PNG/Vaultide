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
import {
  parseSprintCompletion,
  readLearningJson,
} from '@/lib/learning/http/learning-progress-input';
import { getLearningProgressService } from '@/lib/learning/learning-progress';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sprintId: string }> },
) {
  const context = learningRequestContext(request);
  const protocolError = requireLearningProtocol(request, context);
  if (protocolError) return protocolError;
  const authError = requireLearningAdmin(request, context);
  if (authError) return authError;
  try {
    const { sprintId } = await params;
    if (!/^spr_[a-f0-9]{32}$/.test(sprintId)) {
      return learningError(context, 'invalid_request', 400, 'Invalid learning sprint id.');
    }
    const completion = parseSprintCompletion(await readLearningJson(request));
    if (!completion) return learningError(context, 'invalid_request', 400, 'Invalid sprint completion.');
    return learningJson(context, await getLearningProgressService().completeSprint(sprintId, completion), 202);
  } catch (error) {
    return learningProgressErrorResponse(context, error);
  }
}
