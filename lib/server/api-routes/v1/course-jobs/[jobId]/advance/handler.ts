// Loaded by the consolidated Vercel API dispatcher.
import { type NextRequest } from 'next/server';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { getCourseGenerationService } from '@/lib/generation/orchestration/service';
import { processCourseGenerationStep } from '@/lib/generation/orchestration/worker';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await params;
  const service = getCourseGenerationService();
  const existing = await service.find(jobId);
  if (!existing) return apiError('INVALID_REQUEST', 404, 'Course generation job was not found.');
  try {
    const command = (await request.json().catch(() => ({}))) as { retryFailed?: boolean };
    if (command.retryFailed === true) {
      const resumed = await service.resumeFailed(jobId);
      if (!resumed) {
        return apiError(
          'INVALID_REQUEST',
          409,
          'Only a recoverable failed generation step can be resumed.',
        );
      }
      const job = await service.view(jobId);
      if (!job) return apiError('INTERNAL_ERROR', 500, 'Course generation job disappeared.');
      return apiSuccess(
        {
          result: { jobId, outcome: 'advanced' as const },
          job,
          queueMode: resumed.queueMode,
        },
        202,
      );
    }
    const result = await processCourseGenerationStep(jobId);
    if (result.outcome === 'advanced') {
      const advanced = await service.find(jobId);
      if (advanced) await service.publishNext(advanced);
    }
    const job = await service.view(jobId);
    if (!job) return apiError('INTERNAL_ERROR', 500, 'Course generation job disappeared.');
    return apiSuccess({ result, job });
  } catch (error) {
    return apiError(
      'GENERATION_FAILED',
      500,
      'The durable generation step could not be advanced.',
      error instanceof Error ? error.message : String(error),
    );
  }
}
