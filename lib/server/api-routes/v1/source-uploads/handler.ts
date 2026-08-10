// Loaded by the consolidated Vercel API dispatcher.
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { NextRequest } from 'next/server';
import { DeviceTokenServiceError } from '@/lib/learning/application/device-token-service';
import { SourceUploadServiceError } from '@/lib/learning/application/source-upload-service';
import { LearningConfigurationError } from '@/lib/learning/config';
import {
  MAX_SOURCE_ARCHIVE_BYTES,
  SOURCE_ARCHIVE_CONTENT_TYPE,
} from '@/lib/learning/domain/source-upload';
import {
  learningError,
  learningJson,
  learningRequestContext,
  requireLearningProtocol,
} from '@/lib/learning/http/api';
import { bearerToken } from '@/lib/learning/http/bearer';
import { readHandleUploadBody } from '@/lib/learning/http/source-upload-body';
import { getSourceUploadService } from '@/lib/learning/source-uploads';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

const OBSIDIAN_APP_ORIGIN = 'app://obsidian.md';
const OBSIDIAN_CORS_HEADERS = 'Authorization, Content-Type, X-MAIC-Protocol-Version';

function trustedObsidianOrigin(request: NextRequest): string | undefined {
  const origin = request.headers.get('origin');
  return origin === OBSIDIAN_APP_ORIGIN ? origin : undefined;
}

function applyObsidianCors(request: NextRequest, response: Response): Response {
  const origin = trustedObsidianOrigin(request);
  if (!origin) return response;
  response.headers.set('Access-Control-Allow-Origin', origin);
  response.headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  response.headers.set('Access-Control-Allow-Headers', OBSIDIAN_CORS_HEADERS);
  response.headers.set('Access-Control-Max-Age', '600');
  response.headers.append('Vary', 'Origin');
  return response;
}

export function OPTIONS(request: NextRequest): Response {
  if (!trustedObsidianOrigin(request)) {
    return new Response(null, { status: 403, headers: { Vary: 'Origin' } });
  }
  return applyObsidianCors(request, new Response(null, { status: 204 }));
}

export async function POST(request: NextRequest) {
  const context = learningRequestContext(request);
  const respond = (response: Response) => applyObsidianCors(request, response);
  let body: HandleUploadBody;
  try {
    body = await readHandleUploadBody(request);
  } catch {
    return respond(learningError(context, 'invalid_request', 400, 'Invalid Blob upload request.'));
  }

  if (body.type === 'blob.generate-client-token') {
    const protocolError = requireLearningProtocol(request, context);
    if (protocolError) return respond(protocolError);
  }

  const service = getSourceUploadService();
  try {
    const result = await handleUpload({
      request,
      body,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const payload = await service.authorizeUpload({
          accessToken: bearerToken(request) ?? '',
          pathname,
          clientPayload,
        });
        return {
          allowedContentTypes: [SOURCE_ARCHIVE_CONTENT_TYPE],
          maximumSizeInBytes: MAX_SOURCE_ARCHIVE_BYTES,
          validUntil: Date.now() + 5 * 60 * 1000,
          addRandomSuffix: false,
          allowOverwrite: false,
          cacheControlMaxAge: 60,
          tokenPayload: JSON.stringify(payload),
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        await service.completeUpload({ blob, tokenPayload });
      },
    });
    return respond(learningJson(context, result));
  } catch (error) {
    if (error instanceof DeviceTokenServiceError || error instanceof SourceUploadServiceError) {
      return respond(
        learningError(context, error.code, error.status, error.message, {
          retryable: 'retryable' in error ? error.retryable : false,
        }),
      );
    }
    if (error instanceof LearningConfigurationError) {
      return respond(
        learningError(
          context,
          'dependency_unavailable',
          503,
          'Private source storage is not configured.',
        ),
      );
    }
    console.error('Unable to handle private SourceArchive upload.', {
      requestId: context.requestId,
    });
    return respond(
      learningError(
        context,
        'dependency_unavailable',
        503,
        'Private source upload is temporarily unavailable.',
        { retryable: true },
      ),
    );
  }
}
