// Loaded by the consolidated Vercel API dispatcher.
import { type NextRequest } from 'next/server';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import {
  verifyCourseQueueRequest,
} from '@/lib/generation/orchestration/queue';
import { getCourseGenerationService } from '@/lib/generation/orchestration/service';
import { processCourseGenerationStep } from '@/lib/generation/orchestration/worker';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const valid = await verifyCourseQueueRequest({
    signature: request.headers.get('upstash-signature'),
    body: rawBody,
    url: request.url,
  });
  if (!valid) return apiError('INVALID_CREDENTIALS', 401, 'Invalid course worker signature.');

  let jobId = '';
  let recovery:
    | {
        sceneOrder: number;
        phase: 'content' | 'actions' | 'release';
        attemptCount: number;
      }
    | undefined;
  try {
    const body = JSON.parse(rawBody) as {
      jobId?: string;
      recovery?: {
        sceneOrder?: unknown;
        phase?: unknown;
        attemptCount?: unknown;
      };
    };
    jobId = body.jobId ?? '';
    if (body.recovery) {
      const phase = body.recovery.phase;
      if (
        !Number.isInteger(body.recovery.sceneOrder) ||
        (body.recovery.sceneOrder as number) < 0 ||
        (phase !== 'content' && phase !== 'actions' && phase !== 'release') ||
        !Number.isInteger(body.recovery.attemptCount) ||
        (body.recovery.attemptCount as number) < 1
      ) {
        return apiError('INVALID_REQUEST', 400, 'Invalid course recovery guard.');
      }
      recovery = {
        sceneOrder: body.recovery.sceneOrder as number,
        phase,
        attemptCount: body.recovery.attemptCount as number,
      };
    }
  } catch {
    return apiError('INVALID_REQUEST', 400, 'Invalid course worker payload.');
  }
  if (!/^cgj_[a-f0-9]{32}$/.test(jobId)) {
    return apiError('INVALID_REQUEST', 400, 'Invalid course generation job id.');
  }

  const result = await processCourseGenerationStep(jobId, recovery);
  const service = getCourseGenerationService();
  const job = await service.find(jobId);
  if (job && result.outcome === 'advanced') await service.publishNext(job);
  return apiSuccess({ result });
}
