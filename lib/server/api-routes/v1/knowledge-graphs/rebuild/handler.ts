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
    const synthesisId = typeof body.synthesisId === 'string' ? body.synthesisId : '';
    if (!synthesisId) {
      return learningError(context, 'invalid_request', 400, 'synthesisId is required.');
    }
    const projection = await getKnowledgeGraphProjectionService().createProjection(synthesisId, {
      force: true,
    });
    return learningJson(context, { projection }, 201);
  } catch (reason) {
    return knowledgeGraphErrorResponse(context, reason);
  }
}
