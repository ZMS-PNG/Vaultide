// Loaded by the consolidated Vercel API dispatcher.
import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getSourceUploadService } from '@/lib/learning/source-uploads';

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
      { error: 'Retention maintenance is not configured.' },
      { status: 503 },
    );
  }
  if (!authorized(request)) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  const result = await getSourceUploadService().purgeExpired();
  return NextResponse.json(
    { ok: result.failed === 0, ...result },
    {
      status: result.failed === 0 ? 200 : 500,
      headers: { 'Cache-Control': 'no-store' },
    },
  );
}
