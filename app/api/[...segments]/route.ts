import type { NextRequest } from 'next/server';
import { dispatchConsolidatedApiRequest } from '@/lib/server/api-dispatcher';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

type ConsolidatedRouteContext = {
  params: Promise<{ segments: string[] }>;
};

function dispatch(request: NextRequest, _context: ConsolidatedRouteContext): Promise<Response> {
  return dispatchConsolidatedApiRequest(request);
}

export const GET = dispatch;
export const POST = dispatch;
export const PUT = dispatch;
export const PATCH = dispatch;
export const DELETE = dispatch;
export const HEAD = dispatch;
export const OPTIONS = dispatch;
