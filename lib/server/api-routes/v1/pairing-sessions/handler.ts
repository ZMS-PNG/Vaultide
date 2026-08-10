// Loaded by the consolidated Vercel API dispatcher.
import { NextRequest } from 'next/server';
import { LearningConfigurationError } from '@/lib/learning/config';
import { getPairingService } from '@/lib/learning/pairing';
import { PairingServiceError } from '@/lib/learning/application/pairing-service';
import { requireLearningAdmin } from '@/lib/learning/http/admin-auth';
import {
  learningError,
  learningJson,
  learningRequestContext,
  requireLearningProtocol,
} from '@/lib/learning/http/api';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const context = learningRequestContext(request);
  const protocolError = requireLearningProtocol(request, context);
  if (protocolError) return protocolError;
  const authError = requireLearningAdmin(request, context);
  if (authError) return authError;

  try {
    return learningJson(context, await getPairingService().createSession(), 201);
  } catch (error) {
    if (error instanceof PairingServiceError) {
      return learningError(context, error.code, error.status, error.message, {
        retryable: error.retryable,
        details: error.details,
      });
    }
    if (error instanceof LearningConfigurationError) {
      return learningError(context, 'dependency_unavailable', 503, 'Pairing is not configured.');
    }
    console.error('Unable to create learning pairing session.', { requestId: context.requestId });
    return learningError(
      context,
      'dependency_unavailable',
      503,
      'Pairing is temporarily unavailable.',
      { retryable: true },
    );
  }
}
