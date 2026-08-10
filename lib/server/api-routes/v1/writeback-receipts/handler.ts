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
  parseWritebackReceipt,
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
    const principal = await getDeviceTokenService().authenticateAccess(token, 'writebacks:receipt');
    const receipt = parseWritebackReceipt(await readLearningJson(request));
    if (!receipt) return learningError(context, 'invalid_request', 400, 'Invalid receipt body.');
    const result = await getLearningProgressService().recordWritebackReceipt(principal, receipt);
    return learningJson(context, result, result.duplicate ? 200 : 201);
  } catch (error) {
    return learningProgressErrorResponse(context, error);
  }
}
