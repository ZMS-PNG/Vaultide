// Loaded by the consolidated Vercel API dispatcher.
import { NextRequest } from 'next/server';
import { requireLearningAdmin } from '@/lib/learning/http/admin-auth';
import {
  learningError,
  learningJson,
  learningRequestContext,
  requireLearningProtocol,
} from '@/lib/learning/http/api';
import { synthesisErrorResponse } from '@/lib/learning/http/synthesis-error';
import { getSynthesisService } from '@/lib/learning/synthesis';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Create a separately reviewed draft for the schedule's one mutable index. */
export async function POST(
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
    const draft = await getSynthesisService().createSynthesisIndexDraft(scheduleId);
    return learningJson(context, { draft }, 201);
  } catch (error) {
    return synthesisErrorResponse(context, error);
  }
}
