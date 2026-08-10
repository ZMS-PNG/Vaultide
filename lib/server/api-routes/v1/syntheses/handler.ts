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
import { parseSynthesisRequest } from '@/lib/learning/http/synthesis-input';
import { getSynthesisService } from '@/lib/learning/synthesis';
import { randomUUID } from 'node:crypto';
import { recordDefaultLearningOperation } from '@/lib/learning/adapters/neon/operation-event-repository';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function authorize(request: NextRequest) {
  const context = learningRequestContext(request);
  const protocolError = requireLearningProtocol(request, context);
  if (protocolError) return { context, error: protocolError };
  const authError = requireLearningAdmin(request, context);
  return { context, error: authError };
}

export async function GET(request: NextRequest) {
  const { context, error } = authorize(request);
  if (error) return error;
  try {
    const limit = Number(request.nextUrl.searchParams.get('limit') ?? '20');
    const service = getSynthesisService();
    const [syntheses, filters] = await Promise.all([
      service.list(Number.isFinite(limit) ? limit : 20),
      service.filterOptions(),
    ]);
    return learningJson(context, { syntheses, filters });
  } catch (reason) {
    return synthesisErrorResponse(context, reason);
  }
}

export async function POST(request: NextRequest) {
  const { context, error } = authorize(request);
  if (error) return error;
  const operationId = `manual-${randomUUID()}`;
  try {
    const input = parseSynthesisRequest(await readLearningJson(request));
    if (!input) return learningError(context, 'invalid_request', 400, 'Invalid synthesis scope.');
    await recordDefaultLearningOperation({
      kind: 'synthesis-generation',
      operationId,
      state: 'started',
    });
    const synthesis = await getSynthesisService().generate(input);
    await recordDefaultLearningOperation({
      kind: 'synthesis-generation',
      operationId,
      state: 'succeeded',
      detail: { synthesisId: synthesis.id },
    });
    return learningJson(context, { synthesis }, 201);
  } catch (reason) {
    await recordDefaultLearningOperation({
      kind: 'synthesis-generation',
      operationId,
      state: 'failed',
      errorCode: 'synthesis_failed',
      detail: {
        message: (reason instanceof Error ? reason.message : 'Synthesis failed.').slice(0, 1000),
      },
    });
    return synthesisErrorResponse(context, reason);
  }
}
