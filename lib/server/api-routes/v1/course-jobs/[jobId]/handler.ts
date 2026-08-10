// Loaded by the consolidated Vercel API dispatcher.
import { type NextRequest } from 'next/server';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { getCourseGenerationService } from '@/lib/generation/orchestration/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await params;
  const job = await getCourseGenerationService().view(jobId);
  if (!job) return apiError('INVALID_REQUEST', 404, 'Course generation job was not found.');
  return apiSuccess({ job });
}
