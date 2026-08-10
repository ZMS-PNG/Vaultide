// Loaded by the consolidated Vercel API dispatcher.
import { NextRequest } from 'next/server';
import { PairingServiceError } from '@/lib/learning/application/pairing-service';
import { LearningConfigurationError } from '@/lib/learning/config';
import {
  learningError,
  learningJson,
  learningRequestContext,
  requireLearningProtocol,
} from '@/lib/learning/http/api';
import {
  PairingInputError,
  pairingRateIdentity,
  readPairingExchangeInput,
} from '@/lib/learning/http/pairing-input';
import { getPairingService } from '@/lib/learning/pairing';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const context = learningRequestContext(request);
  const protocolError = requireLearningProtocol(request, context);
  if (protocolError) return protocolError;

  try {
    const input = await readPairingExchangeInput(request);
    const result = await getPairingService().exchange({
      ...input,
      rateIdentity: pairingRateIdentity(request),
    });
    return learningJson(context, result);
  } catch (error) {
    if (error instanceof PairingInputError) {
      return learningError(context, 'invalid_request', 400, error.message, {
        details: error.field ? { field: error.field } : undefined,
      });
    }
    if (error instanceof PairingServiceError) {
      const retryAfter = error.details?.retryAfterSeconds;
      return learningError(context, error.code, error.status, error.message, {
        retryable: error.retryable,
        details: error.details,
        headers: typeof retryAfter === 'number' ? { 'Retry-After': String(retryAfter) } : undefined,
      });
    }
    if (error instanceof LearningConfigurationError) {
      return learningError(context, 'dependency_unavailable', 503, 'Pairing is not configured.');
    }
    console.error('Unable to exchange learning pairing code.', { requestId: context.requestId });
    return learningError(
      context,
      'dependency_unavailable',
      503,
      'Pairing is temporarily unavailable.',
      { retryable: true },
    );
  }
}
