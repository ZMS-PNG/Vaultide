// Loaded by the consolidated Vercel API dispatcher.
import { NextRequest } from 'next/server';
import { DeviceTokenServiceError } from '@/lib/learning/application/device-token-service';
import { SourceUploadServiceError } from '@/lib/learning/application/source-upload-service';
import { LearningConfigurationError } from '@/lib/learning/config';
import {
  learningError,
  learningJson,
  learningRequestContext,
  requireLearningProtocol,
} from '@/lib/learning/http/api';
import { bearerToken } from '@/lib/learning/http/bearer';
import { getSourceUploadService } from '@/lib/learning/source-uploads';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ bundleId: string }> },
) {
  const context = learningRequestContext(request);
  const protocolError = requireLearningProtocol(request, context);
  if (protocolError) return protocolError;

  try {
    const token = bearerToken(request);
    if (!token) {
      return learningError(context, 'token_invalid', 401, 'Device credential is required.');
    }
    const { bundleId } = await params;
    const upload = await getSourceUploadService().uploadStatus(token, bundleId);
    return learningJson(context, { upload });
  } catch (error) {
    if (error instanceof DeviceTokenServiceError || error instanceof SourceUploadServiceError) {
      return learningError(context, error.code, error.status, error.message, {
        retryable: 'retryable' in error ? error.retryable : false,
      });
    }
    if (error instanceof LearningConfigurationError) {
      return learningError(
        context,
        'dependency_unavailable',
        503,
        'Source upload status is not configured.',
      );
    }
    console.error('Unable to read source upload status.', { requestId: context.requestId });
    return learningError(
      context,
      'dependency_unavailable',
      503,
      'Source upload status is temporarily unavailable.',
      { retryable: true },
    );
  }
}
