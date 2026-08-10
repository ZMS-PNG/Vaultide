// Loaded by the consolidated Vercel API dispatcher.
import { NextRequest } from 'next/server';
import { knowledgeGraphV2Flags } from '@/lib/learning/knowledge-graph-v2-flags';
import { getKnowledgeGraphRefreshService } from '@/lib/learning/knowledge-graph-refresh';
import { requireLearningAdmin } from '@/lib/learning/http/admin-auth';
import {
  learningRequestContext,
  learningJson,
  requireLearningProtocol,
} from '@/lib/learning/http/api';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Admin-only metadata for monitoring queue health without exposing Vault content. */
export async function GET(request: NextRequest) {
  const context = learningRequestContext(request);
  const authError =
    requireLearningProtocol(request, context) ?? requireLearningAdmin(request, context);
  if (authError) return authError;
  const queue = await getKnowledgeGraphRefreshService().queueStatus();
  const flags = knowledgeGraphV2Flags();
  return learningJson(
    context,
    {
      queue: {
        ...queue,
        ...(queue.oldestAvailableAt ? { oldestAvailableAt: queue.oldestAvailableAt.toISOString() } : {}),
      },
      flags,
      generatedAt: new Date().toISOString(),
    },
    200,
  );
}
