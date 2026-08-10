// Loaded by the consolidated Vercel API dispatcher.
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { NextRequest, NextResponse } from 'next/server';
import { verifyAccessToken } from '@/lib/server/access-token';
import {
  COURSE_INPUT_CONTENT_TYPE,
  MAX_COURSE_INPUT_BYTES,
  validateCourseInputReference,
} from '@/lib/generation/orchestration/course-input-storage';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

function webAccessAuthorized(request: NextRequest): boolean {
  const accessCode = process.env.ACCESS_CODE;
  if (!accessCode) return true;
  const token = request.cookies.get('openmaic_access')?.value;
  return Boolean(token && verifyAccessToken(token, accessCode));
}

export async function POST(request: NextRequest) {
  let body: HandleUploadBody;
  try {
    body = (await request.json()) as HandleUploadBody;
  } catch {
    return NextResponse.json({ error: 'Invalid Blob upload request.' }, { status: 400 });
  }
  try {
    const result = await handleUpload({
      request,
      body,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        if (!webAccessAuthorized(request)) throw new Error('access_code_required');
        const payload = JSON.parse(clientPayload ?? '{}') as {
          pathname?: unknown;
          sha256?: unknown;
          byteSize?: unknown;
        };
        const reference = {
          pathname,
          sha256: payload.sha256,
          byteSize: payload.byteSize,
        };
        if (
          payload.pathname !== pathname ||
          !validateCourseInputReference(reference)
        ) {
          throw new Error('invalid_course_input_reference');
        }
        return {
          allowedContentTypes: [COURSE_INPUT_CONTENT_TYPE],
          maximumSizeInBytes: MAX_COURSE_INPUT_BYTES,
          validUntil: Date.now() + 5 * 60 * 1_000,
          addRandomSuffix: false,
          allowOverwrite: false,
          cacheControlMaxAge: 60,
          tokenPayload: JSON.stringify(reference),
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        const reference = JSON.parse(tokenPayload ?? '{}') as unknown;
        if (
          !validateCourseInputReference(reference) ||
          blob.pathname !== reference.pathname
        ) {
          throw new Error('course_input_upload_mismatch');
        }
      },
    });
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'course_input_upload_failed';
    const status = detail === 'access_code_required' ? 401 : 400;
    return NextResponse.json(
      { error: 'Course input upload was rejected.', details: detail },
      { status, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
