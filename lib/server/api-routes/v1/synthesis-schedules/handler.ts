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
import { parseSynthesisScheduleCreate } from '@/lib/learning/http/synthesis-input';
import { getSynthesisService } from '@/lib/learning/synthesis';

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
    const parsedLimit = Number(request.nextUrl.searchParams.get('limit') ?? '50');
    const schedules = await getSynthesisService().listSchedules(
      Number.isFinite(parsedLimit) ? parsedLimit : 50,
    );
    return learningJson(context, { schedules });
  } catch (reason) {
    return synthesisErrorResponse(context, reason);
  }
}

export async function POST(request: NextRequest) {
  const { context, error } = authorize(request);
  if (error) return error;
  try {
    const input = parseSynthesisScheduleCreate(await readLearningJson(request));
    if (!input) return learningError(context, 'invalid_request', 400, 'Invalid synthesis schedule.');
    const schedule = await getSynthesisService().createSchedule(input);
    return learningJson(context, { schedule }, 201);
  } catch (reason) {
    return synthesisErrorResponse(context, reason);
  }
}
