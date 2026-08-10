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

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ nodeId: string }> },
) {
  const context = learningRequestContext(request);
  const authError =
    requireLearningProtocol(request, context) ?? requireLearningAdmin(request, context);
  if (authError) return authError;
  try {
    const projectionId = request.nextUrl.searchParams.get('projectionId');
    const { nodeId } = await params;
    if (!projectionId || nodeId.length < 1 || nodeId.length > 320) {
      return learningError(
        context,
        'invalid_request',
        400,
        'projectionId and a valid node id are required.',
      );
    }
    const node = await getKnowledgeGraphProjectionService().getNode(projectionId, nodeId);
    return learningJson(context, { node });
  } catch (reason) {
    return knowledgeGraphErrorResponse(context, reason);
  }
}
