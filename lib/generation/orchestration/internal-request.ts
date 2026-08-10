import type { NextRequest } from 'next/server';

const internalGenerationRequests = new WeakSet<NextRequest>();

export function markInternalGenerationRequest(request: NextRequest): NextRequest {
  internalGenerationRequests.add(request);
  return request;
}

export function isInternalGenerationRequest(request: NextRequest): boolean {
  return internalGenerationRequests.has(request);
}
