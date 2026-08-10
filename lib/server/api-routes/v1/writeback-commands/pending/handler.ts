// Loaded by the consolidated Vercel API dispatcher.
import { NextRequest } from 'next/server';
import { WRITEBACK_OPERATIONS, type WritebackOperation } from '@openmaic/learning-protocol';
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

export async function GET(request: NextRequest) {
  const context = learningRequestContext(request);
  const protocolError = requireLearningProtocol(request, context);
  if (protocolError) return protocolError;

  try {
    const token = bearerToken(request);
    if (!token)
      return learningError(context, 'token_invalid', 401, 'Device credential is required.');
    const principal = await getDeviceTokenService().authenticateAccess(token, 'writebacks:read');
    const rawLimit = Number(request.nextUrl.searchParams.get('limit') ?? 10);
    const requestedOperations = request.nextUrl.searchParams.getAll('operation');
    const operations = requestedOperations.length
      ? requestedOperations.filter((operation): operation is WritebackOperation =>
          (WRITEBACK_OPERATIONS as readonly string[]).includes(operation),
        )
      : undefined;
    if (requestedOperations.length && operations?.length !== requestedOperations.length) {
      return learningError(context, 'invalid_request', 400, 'Unsupported writeback operation filter.');
    }
    const result = await getLearningProgressService().leaseWritebackCommands(
      principal,
      Number.isFinite(rawLimit) ? rawLimit : 10,
      { operations },
    );
    return learningJson(context, result);
  } catch (error) {
    return learningProgressErrorResponse(context, error);
  }
}
