import { NextRequest } from 'next/server';

export function bearerToken(request: NextRequest): string | undefined {
  const header = request.headers.get('authorization');
  if (!header) return undefined;
  const match = /^Bearer ([^\s]+)$/.exec(header);
  return match?.[1];
}
