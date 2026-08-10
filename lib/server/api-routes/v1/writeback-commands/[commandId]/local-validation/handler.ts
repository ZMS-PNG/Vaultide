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
import { getLearningProgressService } from '@/lib/learning/learning-progress';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ commandId: string }> },
) {
  const requestContext = learningRequestContext(request);
  const protocolError = requireLearningProtocol(request, requestContext);
  if (protocolError) return protocolError;
  try {
    const token = bearerToken(request);
    if (!token) {
      return learningError(requestContext, 'token_invalid', 401, 'Device credential is required.');
    }
    const principal = await getDeviceTokenService().authenticateAccess(token, 'writebacks:read');
    const { commandId } = await context.params;
    return learningJson(
      requestContext,
      await getLearningProgressService().markWritebackCommandLocallyValidated(principal, commandId),
    );
  } catch (error) {
    return learningProgressErrorResponse(requestContext, error);
  }
}
