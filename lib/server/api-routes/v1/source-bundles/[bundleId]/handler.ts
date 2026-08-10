// Loaded by the consolidated Vercel API dispatcher.
import { NextRequest } from 'next/server';
import { DeviceTokenServiceError } from '@/lib/learning/application/device-token-service';
import { SourceUploadServiceError } from '@/lib/learning/application/source-upload-service';
import { LearningConfigurationError, loadPairingConfig } from '@/lib/learning/config';
import { requireLearningAdmin } from '@/lib/learning/http/admin-auth';
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
  const authError = requireLearningAdmin(request, context);
  if (authError) return authError;

  try {
    const { bundleId } = await params;
    const archive = await getSourceUploadService().readValidatedArchiveForLearning(
      loadPairingConfig().ownerId,
      bundleId,
    );
    if (!archive) {
      return learningError(context, 'invalid_request', 404, 'SourceBundle was not found.');
    }
    return learningJson(context, archive);
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
        'Private source storage is not configured.',
      );
    }
    console.error('Unable to read private SourceArchive.', { requestId: context.requestId });
    return learningError(
      context,
      'dependency_unavailable',
      503,
      'Private source retrieval is temporarily unavailable.',
      { retryable: true },
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ bundleId: string }> },
) {
  const context = learningRequestContext(request);
  const protocolError = requireLearningProtocol(request, context);
  if (protocolError) return protocolError;

  try {
    const { bundleId } = await params;
    const deleted = await getSourceUploadService().deleteUpload(
      bearerToken(request) ?? '',
      bundleId,
    );
    if (!deleted) {
      return learningError(context, 'invalid_request', 404, 'SourceBundle was not found.');
    }
    return learningJson(context, { deleted: true, bundleId });
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
        'Private source storage is not configured.',
      );
    }
    console.error('Unable to delete private SourceArchive.', { requestId: context.requestId });
    return learningError(
      context,
      'dependency_unavailable',
      503,
      'Source deletion is temporarily unavailable.',
      { retryable: true },
    );
  }
}
