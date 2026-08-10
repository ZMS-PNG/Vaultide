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
import { parseKnowledgeGraphQuery } from '@/lib/learning/domain/knowledge-graph-v2/validation';
import { getKnowledgeGraphProjectionService } from '@/lib/learning/knowledge-graphs';
import { knowledgeGraphV2Flags } from '@/lib/learning/knowledge-graph-v2-flags';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function rendererConfiguration() {
  const vaultName = process.env.OBSIDIAN_VAULT_NAME?.trim();
  return {
    webglEnabled: knowledgeGraphV2Flags().webglEnabled,
    ...(vaultName ? { obsidianVaultName: vaultName } : {}),
  };
}

function authorize(request: NextRequest) {
  const context = learningRequestContext(request);
  const error = requireLearningProtocol(request, context) ?? requireLearningAdmin(request, context);
  return { context, error };
}

export async function GET(request: NextRequest) {
  const { context, error } = authorize(request);
  if (error) return error;
  try {
    const synthesisId = request.nextUrl.searchParams.get('synthesisId');
    if (!synthesisId) {
      return learningError(context, 'invalid_request', 400, 'synthesisId is required.');
    }
    const projection = await getKnowledgeGraphProjectionService().latestForSynthesis(
      synthesisId,
      parseKnowledgeGraphQuery(request.nextUrl.searchParams),
    );
    return learningJson(context, {
      projection,
      renderer: rendererConfiguration(),
    });
  } catch (reason) {
    return knowledgeGraphErrorResponse(context, reason);
  }
}

export async function POST(request: NextRequest) {
  const { context, error } = authorize(request);
  if (error) return error;
  try {
    const body = (await readLearningJson(request)) as Record<string, unknown>;
    const synthesisId = typeof body.synthesisId === 'string' ? body.synthesisId : '';
    const force = body.force === true;
    if (!synthesisId) {
      return learningError(context, 'invalid_request', 400, 'synthesisId is required.');
    }
    const projection = await getKnowledgeGraphProjectionService().createProjection(synthesisId, {
      force,
    });
    return learningJson(
      context,
      {
        projection,
        renderer: rendererConfiguration(),
      },
      201,
    );
  } catch (reason) {
    return knowledgeGraphErrorResponse(context, reason);
  }
}
