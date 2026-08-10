// Loaded by the consolidated Vercel API dispatcher.
import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getKnowledgeGraphRefreshService } from '@/lib/learning/knowledge-graph-refresh';
import { getSynthesisService } from '@/lib/learning/synthesis';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

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
      { error: 'Knowledge graph maintenance is not configured.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  if (!authorized(request)) {
    return NextResponse.json(
      { error: 'Unauthorized.' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  let schedules:
    | Awaited<ReturnType<ReturnType<typeof getSynthesisService>['runDueSchedules']>>
    | undefined;
  let scheduleError: string | undefined;
  try {
    schedules = await getSynthesisService().runDueSchedules(10);
  } catch (error) {
    scheduleError = error instanceof Error ? error.message.slice(0, 500) : 'scheduled_synthesis_failed';
  }

  const refresh = await getKnowledgeGraphRefreshService().processPending(10);
  const ok = !scheduleError && refresh.failed === 0 && (schedules?.failed ?? 0) === 0;
  return NextResponse.json(
    {
      ok,
      ...(schedules ? { schedules } : {}),
      ...(scheduleError ? { scheduleError } : {}),
      refresh,
    },
    {
      status: ok ? 200 : 500,
      headers: { 'Cache-Control': 'no-store' },
    },
  );
}
