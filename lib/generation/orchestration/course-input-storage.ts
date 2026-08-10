import { get } from '@vercel/blob';
import { createHash } from 'node:crypto';
import type { CourseGenerationJobInput } from './types';

export const COURSE_INPUT_CONTENT_TYPE = 'application/vnd.vaultide.course-input+json';
export const MAX_COURSE_INPUT_BYTES = 32 * 1024 * 1024;
const COURSE_INPUT_PATH = /^course-inputs\/cin_[a-f0-9]{32}\.json$/;

export interface CourseInputReference {
  pathname: string;
  sha256: string;
  byteSize: number;
}

export function validateCourseInputReference(value: unknown): value is CourseInputReference {
  if (!value || typeof value !== 'object') return false;
  const reference = value as Partial<CourseInputReference>;
  return (
    typeof reference.pathname === 'string' &&
    COURSE_INPUT_PATH.test(reference.pathname) &&
    typeof reference.sha256 === 'string' &&
    /^[a-f0-9]{64}$/.test(reference.sha256) &&
    Number.isInteger(reference.byteSize) &&
    Number(reference.byteSize) >= 2 &&
    Number(reference.byteSize) <= MAX_COURSE_INPUT_BYTES
  );
}

export async function readCourseInputReference(
  reference: CourseInputReference,
): Promise<CourseGenerationJobInput> {
  if (!validateCourseInputReference(reference)) throw new Error('invalid_course_input_reference');
  const result = await get(reference.pathname, { access: 'private', useCache: false });
  if (!result || result.statusCode !== 200) throw new Error('course_input_blob_not_found');
  if (result.blob.size !== reference.byteSize || result.blob.size > MAX_COURSE_INPUT_BYTES) {
    throw new Error('course_input_blob_size_mismatch');
  }
  const content = await new Response(result.stream).text();
  if (Buffer.byteLength(content, 'utf8') !== reference.byteSize) {
    throw new Error('course_input_blob_size_mismatch');
  }
  const digest = createHash('sha256').update(content, 'utf8').digest('hex');
  if (digest !== reference.sha256) throw new Error('course_input_blob_hash_mismatch');
  const value = JSON.parse(content) as CourseGenerationJobInput;
  if (!value || typeof value !== 'object') throw new Error('course_input_blob_invalid');
  return value;
}
