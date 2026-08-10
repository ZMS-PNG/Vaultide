// Loaded by the consolidated Vercel API dispatcher.
import { NextRequest } from 'next/server';
import { requireLearningAdmin } from '@/lib/learning/http/admin-auth';
import {
  learningJson,
  learningRequestContext,
  requireLearningProtocol,
} from '@/lib/learning/http/api';
import { learningProgressErrorResponse } from '@/lib/learning/http/learning-progress-error';
import { getProductOverviewService } from '@/lib/learning/product-overview';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const context = learningRequestContext(request);
  const protocolError = requireLearningProtocol(request, context);
  if (protocolError) return protocolError;
  const authError = requireLearningAdmin(request, context);
  if (authError) return authError;
  try {
    const health = await getProductOverviewService().health();
    return learningJson(context, { health });
  } catch (error) {
    return learningProgressErrorResponse(context, error);
  }
}
