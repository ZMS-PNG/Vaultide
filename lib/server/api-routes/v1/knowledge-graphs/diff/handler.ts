// Loaded by the consolidated Vercel API dispatcher.
import { NextRequest } from 'next/server';
import { requireLearningAdmin } from '@/lib/learning/http/admin-auth';
import {
  learningError,
  learningJson,
  learningRequestContext,
  requireLearningProtocol,
} from '@/lib/learning/http/api';
import { diffKnowledgeGraphs } from '@/lib/learning/domain/knowledge-graph-v2/graph-diff';
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
    const from = request.nextUrl.searchParams.get('from');
    const to = request.nextUrl.searchParams.get('to');
    if (!from || !to) {
      return learningError(context, 'invalid_request', 400, 'from and to are required.');
    }
    const service = getKnowledgeGraphProjectionService();
    const [before, after] = await Promise.all([
      service.getProjection(from, { includeCandidates: true }),
      service.getProjection(to, { includeCandidates: true }),
    ]);
    return learningJson(context, { diff: diffKnowledgeGraphs(before.graph, after.graph) });
  } catch (reason) {
    return knowledgeGraphErrorResponse(context, reason);
  }
}
