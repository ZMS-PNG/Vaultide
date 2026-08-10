import { NextResponse } from 'next/server';

export const API_ERROR_CODES = {
  MISSING_REQUIRED_FIELD: 'MISSING_REQUIRED_FIELD',
  MISSING_API_KEY: 'MISSING_API_KEY',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  INVALID_REQUEST: 'INVALID_REQUEST',
  SCOPE_DENIED: 'SCOPE_DENIED',
  CLASSROOM_NOT_RELEASED: 'CLASSROOM_NOT_RELEASED',
  PROVIDER_DISABLED: 'PROVIDER_DISABLED',
  VOXCPM_AUTO_VOICE_REQUIRES_CONTEXT: 'VOXCPM_AUTO_VOICE_REQUIRES_CONTEXT',
  INVALID_URL: 'INVALID_URL',
  REDIRECT_NOT_ALLOWED: 'REDIRECT_NOT_ALLOWED',
  TOO_MANY_REDIRECTS: 'TOO_MANY_REDIRECTS',
  CONTENT_SENSITIVE: 'CONTENT_SENSITIVE',
  UPSTREAM_ERROR: 'UPSTREAM_ERROR',
  RATE_LIMITED: 'RATE_LIMITED',
  NO_QUALIFYING_SOURCES: 'NO_QUALIFYING_SOURCES',
  GENERATION_FAILED: 'GENERATION_FAILED',
  INVALID_SCENE_OUTLINE: 'INVALID_SCENE_OUTLINE',
  GENERATION_DEADLINE_EXCEEDED: 'GENERATION_DEADLINE_EXCEEDED',
  COURSE_WORKFLOW_NOT_RESUMABLE: 'COURSE_WORKFLOW_NOT_RESUMABLE',
  COURSE_WORKFLOW_RESUME_FAILED: 'COURSE_WORKFLOW_RESUME_FAILED',
  QUALITY_GATE_FAILED: 'QUALITY_GATE_FAILED',
  SOURCE_CONTEXT_LOST: 'SOURCE_CONTEXT_LOST',
  TRANSCRIPTION_FAILED: 'TRANSCRIPTION_FAILED',
  PARSE_FAILED: 'PARSE_FAILED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[keyof typeof API_ERROR_CODES];

export interface ApiErrorBody {
  success: false;
  errorCode: ApiErrorCode;
  error: string;
  details?: string;
}

export function apiError(
  code: ApiErrorCode,
  status: number,
  error: string,
  details?: string,
): NextResponse<ApiErrorBody> {
  return NextResponse.json(
    {
      success: false as const,
      errorCode: code,
      error,
      ...(details ? { details } : {}),
    },
    { status },
  );
}

export function apiSuccess<T extends Record<string, unknown>>(data: T, status = 200): NextResponse {
  return NextResponse.json({ success: true, ...data }, { status });
}
