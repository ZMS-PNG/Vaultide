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

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ synthesisId: string; baselineId: string }> },
) {
  const context = learningRequestContext(request);
  const protocolError = requireLearningProtocol(request, context);
  if (protocolError) return protocolError;
  const authError = requireLearningAdmin(request, context);
  if (authError) return authError;
  try {
    const { synthesisId, baselineId } = await params;
    if (!/^syn_[a-f0-9]{32}$/.test(synthesisId) || !/^syn_[a-f0-9]{32}$/.test(baselineId)) {
      return learningError(context, 'invalid_request', 400, 'Invalid synthesis snapshot id.');
    }
    if (synthesisId === baselineId) {
      return learningError(context, 'invalid_request', 400, 'A snapshot cannot be compared with itself.');
    }
    const delta = await getSynthesisService().diff(synthesisId, baselineId);
    return learningJson(context, { delta });
  } catch (reason) {
    return synthesisErrorResponse(context, reason);
  }
}
