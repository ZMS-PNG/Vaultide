// Loaded by the consolidated Vercel API dispatcher.
import { NextRequest } from 'next/server';
import { requireLearningAdmin } from '@/lib/learning/http/admin-auth';
import {
  learningError,
  learningJson,
  learningRequestContext,
  requireLearningProtocol,
} from '@/lib/learning/http/api';
import { knowledgeGraphErrorResponse } from '@/lib/learning/http/knowledge-graph-error';
import { getKnowledgeGraphProjectionService } from '@/lib/learning/knowledge-graphs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const context = learningRequestContext(request);
  const authError =
    requireLearningProtocol(request, context) ?? requireLearningAdmin(request, context);
  if (authError) return authError;
  try {
    const projectionId = request.nextUrl.searchParams.get('projectionId');
    const from = request.nextUrl.searchParams.get('from');
    const to = request.nextUrl.searchParams.get('to');
    if (!projectionId || !from || !to || from.length > 320 || to.length > 320) {
      return learningError(
        context,
        'invalid_request',
        400,
        'projectionId, from and to are required.',
      );
    }
    const path = await getKnowledgeGraphProjectionService().path(projectionId, from, to);
    return learningJson(context, { path });
  } catch (reason) {
    return knowledgeGraphErrorResponse(context, reason);
  }
}
