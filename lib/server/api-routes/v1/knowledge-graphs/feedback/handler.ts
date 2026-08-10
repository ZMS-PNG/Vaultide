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
import { readLearningJson } from '@/lib/learning/http/learning-progress-input';
import { getKnowledgeGraphProjectionService } from '@/lib/learning/knowledge-graphs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const context = learningRequestContext(request);
  const authError =
    requireLearningProtocol(request, context) ?? requireLearningAdmin(request, context);
  if (authError) return authError;
  try {
    const body = (await readLearningJson(request)) as Record<string, unknown>;
    const relationId = typeof body.relationId === 'string' ? body.relationId : '';
    const action = body.action === 'confirm' || body.action === 'reject' ? body.action : undefined;
    const reason = typeof body.reason === 'string' ? body.reason : undefined;
    if (!relationId || !action) {
      return learningError(context, 'invalid_request', 400, 'Valid relation feedback is required.');
    }
    const feedback = await getKnowledgeGraphProjectionService().feedback({
      relationId,
      action,
      ...(reason ? { reason } : {}),
    });
    return learningJson(context, { feedback }, 201);
  } catch (reason) {
    return knowledgeGraphErrorResponse(context, reason);
  }
}
