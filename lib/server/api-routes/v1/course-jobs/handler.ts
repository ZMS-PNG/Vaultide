// Loaded by the consolidated Vercel API dispatcher.
import { type NextRequest } from 'next/server';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { buildRequestOrigin } from '@/lib/server/classroom-storage';
import { getCourseGenerationService } from '@/lib/generation/orchestration/service';
import type { CourseGenerationJobInput } from '@/lib/generation/orchestration/types';
import {
  readCourseInputReference,
  type CourseInputReference,
} from '@/lib/generation/orchestration/course-input-storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function POST(request: NextRequest) {
  try {
    const raw = (await request.json()) as {
      input?: CourseGenerationJobInput;
      inputRef?: CourseInputReference;
      idempotencyKey?: string;
    };
    if (
      (raw.input ? 1 : 0) + (raw.inputRef ? 1 : 0) !== 1 ||
      (raw.input && typeof raw.input !== 'object')
    ) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'Course generation input is required.');
    }
    const rawInput = raw.input ?? (await readCourseInputReference(raw.inputRef!));
    const input: CourseGenerationJobInput = {
      ...rawInput,
      baseUrl: buildRequestOrigin(request),
    };
    const created = await getCourseGenerationService().create({
      jobInput: input,
      ...(raw.idempotencyKey ? { idempotencyKey: raw.idempotencyKey } : {}),
    });
    const view = await getCourseGenerationService().view(created.job.id);
    if (!view) return apiError('INTERNAL_ERROR', 500, 'Course job was not persisted.');
    return apiSuccess(
      {
        job: view,
        queueMode: created.queueMode,
        pollIntervalMs: created.queueMode === 'qstash' ? 2_500 : 1_500,
      },
      202,
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const qualityFailure =
      detail.startsWith('outline_quality_rejected:') ||
      detail.startsWith('outline_release_rejected:');
    return apiError(
      qualityFailure ? 'QUALITY_GATE_FAILED' : 'INVALID_REQUEST',
      qualityFailure ? 422 : 400,
      qualityFailure
        ? 'The reviewed outline did not meet the locked release contract.'
        : 'Course generation job could not be created.',
      detail,
    );
  }
}
