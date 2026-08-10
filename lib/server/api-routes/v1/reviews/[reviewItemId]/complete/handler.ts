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
import { parseReviewCompletion, readLearningJson } from '@/lib/learning/http/learning-progress-input';
import { getLearningProgressService } from '@/lib/learning/learning-progress';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ reviewItemId: string }> },
) {
  const context = learningRequestContext(request);
  const protocolError = requireLearningProtocol(request, context);
  if (protocolError) return protocolError;
  const authError = requireLearningAdmin(request, context);
  if (authError) return authError;
  const { reviewItemId } = await params;
  if (!/^rvi_[a-f0-9]{32}$/.test(reviewItemId)) {
    return learningError(context, 'invalid_request', 400, 'Invalid review item id.');
  }
  try {
    const completion = parseReviewCompletion(await readLearningJson(request));
    if (!completion) return learningError(context, 'invalid_request', 400, 'Invalid review completion.');
    return learningJson(
      context,
      await getLearningProgressService().completeReview(reviewItemId, completion),
      202,
    );
  } catch (error) {
    return learningProgressErrorResponse(context, error);
  }
}
