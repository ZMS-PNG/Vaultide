import { NextRequest, NextResponse } from 'next/server';
import { verifyAccessToken } from '@/lib/server/access-token';
import { learningError, type LearningRequestContext } from './api';

const ACCESS_COOKIE = 'openmaic_access';

/** Route-level defence: privileged learning APIs must not rely on middleware alone. */
export function requireLearningAdmin(
  request: NextRequest,
  context: LearningRequestContext,
): NextResponse | undefined {
  const accessCode = process.env.ACCESS_CODE;
  if (!accessCode) {
    return learningError(
      context,
      'dependency_unavailable',
      503,
      'OpenMAIC administrator access is not configured.',
      { retryable: false },
    );
  }

  const token = request.cookies.get(ACCESS_COOKIE)?.value;
  if (!token || !verifyAccessToken(token, accessCode)) {
    return learningError(context, 'token_invalid', 401, 'Administrator access is required.');
  }
  return undefined;
}
