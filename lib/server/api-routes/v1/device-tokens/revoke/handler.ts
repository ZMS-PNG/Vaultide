// Loaded by the consolidated Vercel API dispatcher.
import { NextRequest } from 'next/server';
import { DeviceTokenServiceError } from '@/lib/learning/application/device-token-service';
import { LearningConfigurationError } from '@/lib/learning/config';
import { getDeviceTokenService } from '@/lib/learning/device-tokens';
import {
  learningError,
  learningJson,
  learningRequestContext,
  requireLearningProtocol,
} from '@/lib/learning/http/api';
import { bearerToken } from '@/lib/learning/http/bearer';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const context = learningRequestContext(request);
  const protocolError = requireLearningProtocol(request, context);
  if (protocolError) return protocolError;

  try {
    const principal = await getDeviceTokenService().revoke(bearerToken(request) ?? '');
    return learningJson(context, {
      revoked: true,
      deviceId: principal.deviceId,
      vaultBindingId: principal.vaultBindingId,
    });
  } catch (error) {
    if (error instanceof DeviceTokenServiceError) {
      return learningError(context, error.code, error.status, error.message);
    }
    if (error instanceof LearningConfigurationError) {
      return learningError(
        context,
        'dependency_unavailable',
        503,
        'Device credentials are not configured.',
      );
    }
    console.error('Unable to revoke learning device token.', { requestId: context.requestId });
    return learningError(
      context,
      'dependency_unavailable',
      503,
      'Token revocation is temporarily unavailable.',
      { retryable: true },
    );
  }
}
