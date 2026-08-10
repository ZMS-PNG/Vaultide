import type { HandleUploadBody } from '@vercel/blob/client';
import type { NextRequest } from 'next/server';

const MAX_BLOB_CONTROL_BODY_BYTES = 64 * 1024;

export async function readHandleUploadBody(request: NextRequest): Promise<HandleUploadBody> {
  const declaredLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BLOB_CONTROL_BODY_BYTES) {
    throw new Error('body_too_large');
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BLOB_CONTROL_BODY_BYTES) {
    throw new Error('body_too_large');
  }
  const value = JSON.parse(text) as unknown;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('invalid_body');
  }
  const type = (value as { type?: unknown }).type;
  if (type !== 'blob.generate-client-token' && type !== 'blob.upload-completed') {
    throw new Error('invalid_event_type');
  }
  return value as HandleUploadBody;
}
