// Loaded by the consolidated Vercel API dispatcher.
import { NextRequest } from 'next/server';
import { requireLearningAdmin } from '@/lib/learning/http/admin-auth';
import {
  learningJson,
  learningRequestContext,
  requireLearningProtocol,
} from '@/lib/learning/http/api';
import { parseKnowledgeGraphQuery } from '@/lib/learning/domain/knowledge-graph-v2/validation';
import { knowledgeGraphErrorResponse } from '@/lib/learning/http/knowledge-graph-error';
import { getKnowledgeGraphProjectionService } from '@/lib/learning/knowledge-graphs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectionId: string }> },
) {
  const context = learningRequestContext(request);
  const authError =
    requireLearningProtocol(request, context) ?? requireLearningAdmin(request, context);
  if (authError) return authError;
  try {
    const { projectionId } = await params;
    const projection = await getKnowledgeGraphProjectionService().getProjection(projectionId, {
      ...parseKnowledgeGraphQuery(request.nextUrl.searchParams),
      lod: parseKnowledgeGraphQuery(request.nextUrl.searchParams).lod ?? 1,
    });
    return learningJson(context, {
      projectionId: projection.id,
      graphHash: projection.graphHash,
      graph: projection.graph,
      nextCursor: null,
    });
  } catch (reason) {
    return knowledgeGraphErrorResponse(context, reason);
  }
}
