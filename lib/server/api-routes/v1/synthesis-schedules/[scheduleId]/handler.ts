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
import { parseSynthesisSchedulePatch } from '@/lib/learning/http/synthesis-input';
import { getSynthesisService } from '@/lib/learning/synthesis';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ scheduleId: string }> },
) {
  const context = learningRequestContext(request);
  const protocolError = requireLearningProtocol(request, context);
  if (protocolError) return protocolError;
  const authError = requireLearningAdmin(request, context);
  if (authError) return authError;
  try {
    const { scheduleId } = await params;
    if (!/^sch_[a-f0-9]{32}$/.test(scheduleId)) {
      return learningError(context, 'invalid_request', 400, 'Invalid synthesis schedule id.');
    }
    const patch = parseSynthesisSchedulePatch(await readLearningJson(request));
    if (!patch) return learningError(context, 'invalid_request', 400, 'Invalid synthesis schedule patch.');
    const schedule = await getSynthesisService().updateSchedule(scheduleId, patch);
    return learningJson(context, { schedule });
  } catch (reason) {
    return synthesisErrorResponse(context, reason);
  }
}
