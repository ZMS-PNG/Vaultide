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

export async function POST(
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
    const draft = await getSynthesisService().createWritebackDraft(synthesisId);
    return learningJson(context, { draft }, 201);
  } catch (error) {
    return synthesisErrorResponse(context, error);
  }
}
