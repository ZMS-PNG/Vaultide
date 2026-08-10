// Loaded by the consolidated Vercel API dispatcher.
import { NextRequest } from 'next/server';
import { requireLearningAdmin } from '@/lib/learning/http/admin-auth';
import {
  learningError,
  learningJson,
  learningRequestContext,
  requireLearningProtocol,
} from '@/lib/learning/http/api';
import { readLearningJson } from '@/lib/learning/http/learning-progress-input';
import { synthesisErrorResponse } from '@/lib/learning/http/synthesis-error';
import { parseRunDueSynthesesRequest } from '@/lib/learning/http/synthesis-input';
import { getSynthesisService } from '@/lib/learning/synthesis';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const context = learningRequestContext(request);
  const protocolError = requireLearningProtocol(request, context);
  if (protocolError) return protocolError;
  const authError = requireLearningAdmin(request, context);
  if (authError) return authError;
  try {
    const input = parseRunDueSynthesesRequest(await readLearningJson(request));
    if (!input) return learningError(context, 'invalid_request', 400, 'Invalid scheduled synthesis request.');
    const result = await getSynthesisService().runDueSchedules(input.limit);
    return learningJson(context, { result });
  } catch (reason) {
    return synthesisErrorResponse(context, reason);
  }
}
