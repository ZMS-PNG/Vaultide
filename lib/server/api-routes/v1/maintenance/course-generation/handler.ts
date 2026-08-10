// Loaded by the consolidated Vercel API dispatcher.
import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getCourseGenerationService } from '@/lib/generation/orchestration/service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

function authorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  const header = request.headers.get('authorization');
  if (!secret || secret.length < 32 || !header) return false;
  const expected = Buffer.from(`Bearer ${secret}`, 'utf8');
  const actual = Buffer.from(header, 'utf8');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export async function GET(request: NextRequest) {
  if (!process.env.CRON_SECRET || process.env.CRON_SECRET.length < 32) {
    return NextResponse.json(
      { error: 'Course generation recovery is not configured.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  if (!authorized(request)) {
    return NextResponse.json(
      { error: 'Unauthorized.' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  try {
    const recovery = await getCourseGenerationService().recoverDispatches(25);
    return NextResponse.json(
      { ok: true, recovery },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message.slice(0, 500)
            : 'course_generation_recovery_failed',
      },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
