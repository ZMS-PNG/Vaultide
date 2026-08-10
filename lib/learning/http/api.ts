import {
  LEARNING_PROTOCOL_VERSION,
  negotiateProtocol,
  type ApiErrorCode,
} from '@openmaic/learning-protocol';
import { NextRequest, NextResponse } from 'next/server';

export const LEARNING_PROTOCOL_HEADER = 'X-MAIC-Protocol-Version';
export const LEARNING_MINIMUM_CLIENT_HEADER = 'X-MAIC-Min-Client-Version';
export const LEARNING_REQUEST_ID_HEADER = 'X-Request-Id';

export interface LearningRequestContext {
  requestId: string;
}

export function learningRequestContext(request: NextRequest): LearningRequestContext {
  const candidate = request.headers.get(LEARNING_REQUEST_ID_HEADER);
  return {
    requestId:
      candidate && candidate.length <= 128 && /^[A-Za-z0-9._:-]+$/.test(candidate)
        ? candidate
        : crypto.randomUUID(),
  };
}

function responseHeaders(context: LearningRequestContext): HeadersInit {
  return {
    'Cache-Control': 'no-store',
    [LEARNING_PROTOCOL_HEADER]: LEARNING_PROTOCOL_VERSION,
    [LEARNING_MINIMUM_CLIENT_HEADER]: LEARNING_PROTOCOL_VERSION,
    [LEARNING_REQUEST_ID_HEADER]: context.requestId,
  };
}

export function learningJson(
  context: LearningRequestContext,
  body: unknown,
  status = 200,
): NextResponse {
  return NextResponse.json(body, { status, headers: responseHeaders(context) });
}

export function learningError(
  context: LearningRequestContext,
  code: ApiErrorCode,
  status: number,
  message: string,
  options: {
    retryable?: boolean;
    details?: Record<string, string | number | boolean | null>;
    headers?: HeadersInit;
  } = {},
): NextResponse {
  const response = learningJson(
    context,
    {
      error: {
        code,
        message,
        retryable: options.retryable ?? false,
        requestId: context.requestId,
        ...(options.details ? { details: options.details } : {}),
      },
    },
    status,
  );
  if (options.headers) {
    new Headers(options.headers).forEach((value, key) => response.headers.set(key, value));
  }
  return response;
}

export function requireLearningProtocol(
  request: NextRequest,
  context: LearningRequestContext,
  options: { allowMissing?: boolean } = {},
): NextResponse | undefined {
  const clientVersion = request.headers.get(LEARNING_PROTOCOL_HEADER);
  if (!clientVersion && options.allowMissing) return undefined;

  const compatibility = negotiateProtocol(clientVersion);
  if (compatibility.compatible) return undefined;

  return learningError(
    context,
    'protocol_upgrade_required',
    426,
    'The client protocol is not supported by this OpenMAIC deployment.',
    {
      details: {
        reason: compatibility.reason ?? 'unsupported',
        serverVersion: compatibility.serverVersion,
        minimumClientVersion: compatibility.minimumClientVersion,
      },
    },
  );
}
