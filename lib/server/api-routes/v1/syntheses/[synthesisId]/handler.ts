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
  { params }: { params: Promise<{ synthesisId: string }> },
) {
  const context = learningRequestContext(request);
  const protocolError = requireLearningProtocol(request, context);
  if (protocolError) return protocolError;
  const authError = requireLearningAdmin(request, context);
  if (authError) return authError;
  try {
    const { synthesisId } = await params;
    if (!/^syn_[a-f0-9]{32}$/.test(synthesisId)) {
      return learningError(context, 'invalid_request', 400, 'Invalid synthesis id.');
    }
    const synthesis = await getSynthesisService().get(synthesisId);
    return learningJson(context, { synthesis });
  } catch (error) {
    return synthesisErrorResponse(context, error);
  }
}
