// Loaded by the consolidated Vercel API dispatcher.
import { NextRequest } from 'next/server';
import { NeonResearchRepository } from '@/lib/learning/adapters/neon/research-repository';
import { loadPairingConfig } from '@/lib/learning/config';
import { requireLearningAdmin } from '@/lib/learning/http/admin-auth';
import {
  learningError,
  learningJson,
  learningRequestContext,
  requireLearningProtocol,
} from '@/lib/learning/http/api';
import { verifyResearchSources } from '@/lib/server/research-source-verifier';
import { recordLearningOperation } from '@/lib/learning/adapters/neon/operation-event-repository';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function authorize(request: NextRequest) {
  const context = learningRequestContext(request);
  const protocolError = requireLearningProtocol(request, context);
  if (protocolError) return { context, error: protocolError };
  return { context, error: requireLearningAdmin(request, context) };
}

function validResearchRunId(value: string): boolean {
  return /^rrn_[a-f0-9]{32}$/.test(value);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ researchRunId: string }> },
) {
  const { context, error } = authorize(request);
  if (error) return error;
  const { researchRunId } = await params;
  if (!validResearchRunId(researchRunId)) {
    return learningError(context, 'invalid_request', 400, 'Invalid research run id.');
  }
  const { ownerId } = loadPairingConfig();
  const sources = await new NeonResearchRepository().sourceHealth(ownerId, researchRunId);
  if (sources.length === 0) {
    return learningError(context, 'invalid_request', 404, 'Research run was not found.');
  }
  return learningJson(context, { researchRunId, sources });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ researchRunId: string }> },
) {
  const { context, error } = authorize(request);
  if (error) return error;
  const { researchRunId } = await params;
  if (!validResearchRunId(researchRunId)) {
    return learningError(context, 'invalid_request', 400, 'Invalid research run id.');
  }
  const { ownerId } = loadPairingConfig();
  const repository = new NeonResearchRepository();
  const sources = await repository.sourceHealth(ownerId, researchRunId);
  if (sources.length === 0) {
    return learningError(context, 'invalid_request', 404, 'Research run was not found.');
  }
  const verified = await verifyResearchSources(sources);
  const persisted = await repository.updateSourceHealth(ownerId, researchRunId, verified);
  await recordLearningOperation({
    ownerId,
    kind: 'source-verification',
    operationId: researchRunId,
    state: persisted.some(
      (source) => source.availability === 'unreachable' || source.availability === 'unsafe',
    )
      ? 'failed'
      : 'succeeded',
    ...(persisted.some(
      (source) => source.availability === 'unreachable' || source.availability === 'unsafe',
    )
      ? { errorCode: 'source_unreachable' }
      : {}),
    detail: {
      checked: persisted.length,
      available: persisted.filter(
        (source) => source.availability === 'available' || source.availability === 'redirected',
      ).length,
      failed: persisted.filter(
        (source) => source.availability === 'unreachable' || source.availability === 'unsafe',
      ).length,
    },
  }).catch(() => undefined);
  return learningJson(context, { researchRunId, sources: persisted });
}
