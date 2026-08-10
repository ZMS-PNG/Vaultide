// Loaded by the consolidated Vercel API dispatcher.
import { NextRequest } from 'next/server';
import { getDeviceTokenService } from '@/lib/learning/device-tokens';
import {
  learningError,
  learningJson,
  learningRequestContext,
  requireLearningProtocol,
} from '@/lib/learning/http/api';
import { bearerToken } from '@/lib/learning/http/bearer';
import { learningProgressErrorResponse } from '@/lib/learning/http/learning-progress-error';
import {
  parseLearningEventBatch,
  readLearningJson,
} from '@/lib/learning/http/learning-progress-input';
import { getLearningProgressService } from '@/lib/learning/learning-progress';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const context = learningRequestContext(request);
  const protocolError = requireLearningProtocol(request, context);
  if (protocolError) return protocolError;

  try {
    const token = bearerToken(request);
    if (!token)
      return learningError(context, 'token_invalid', 401, 'Device credential is required.');
    const principal = await getDeviceTokenService().authenticateAccess(token, 'events:append');
    const events = parseLearningEventBatch(await readLearningJson(request));
    if (!events)
      return learningError(context, 'invalid_request', 400, 'Invalid learning event batch.');
    const result = await getLearningProgressService().appendDeviceEvents(principal, events);
    return learningJson(context, result, 202);
  } catch (error) {
    return learningProgressErrorResponse(context, error);
  }
}
