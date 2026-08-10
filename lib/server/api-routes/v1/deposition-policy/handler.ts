// Loaded by the consolidated Vercel API dispatcher.
import { NextRequest, NextResponse } from 'next/server';
import { getDeviceTokenService } from '@/lib/learning/device-tokens';
import { loadPairingConfig } from '@/lib/learning/config';
import { requireLearningAdmin } from '@/lib/learning/http/admin-auth';
import { bearerToken } from '@/lib/learning/http/bearer';
import {
  learningError,
  learningJson,
  learningRequestContext,
  requireLearningProtocol,
  type LearningRequestContext,
} from '@/lib/learning/http/api';
import { learningProgressErrorResponse } from '@/lib/learning/http/learning-progress-error';
import {
  parseDepositionPolicy,
  readLearningJson,
} from '@/lib/learning/http/learning-progress-input';
import { getLearningProgressService } from '@/lib/learning/learning-progress';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type PolicyActor = { kind: 'device'; ownerId: string } | { kind: 'admin'; ownerId: string };

async function policyActor(
  request: NextRequest,
  context: LearningRequestContext,
): Promise<PolicyActor | NextResponse> {
  const token = bearerToken(request);
  if (token) {
    const principal = await getDeviceTokenService().authenticateAccess(token, 'writebacks:read');
    return { kind: 'device', ownerId: principal.ownerId };
  }
  const adminError = requireLearningAdmin(request, context);
  if (adminError) return adminError;
  return { kind: 'admin', ownerId: loadPairingConfig().ownerId };
}

function isResponse(value: PolicyActor | NextResponse): value is NextResponse {
  return value instanceof NextResponse;
}

export async function GET(request: NextRequest) {
  const context = learningRequestContext(request);
  const protocolError = requireLearningProtocol(request, context);
  if (protocolError) return protocolError;
  try {
    const actor = await policyActor(request, context);
    if (isResponse(actor)) return actor;
    if (actor.ownerId !== loadPairingConfig().ownerId) {
      return learningError(context, 'scope_denied', 403, 'Policy is outside the paired owner scope.');
    }
    return learningJson(context, { policy: await getLearningProgressService().getDepositionPolicy() });
  } catch (error) {
    return learningProgressErrorResponse(context, error);
  }
}

export async function PATCH(request: NextRequest) {
  const context = learningRequestContext(request);
  const protocolError = requireLearningProtocol(request, context);
  if (protocolError) return protocolError;
  try {
    const actor = await policyActor(request, context);
    if (isResponse(actor)) return actor;
    if (actor.ownerId !== loadPairingConfig().ownerId) {
      return learningError(context, 'scope_denied', 403, 'Policy is outside the paired owner scope.');
    }
    const policy = parseDepositionPolicy(await readLearningJson(request));
    if (!policy) return learningError(context, 'invalid_request', 400, 'Invalid deposition policy.');
    // A browser session may relax back to manual/batch, but cannot turn on
    // unattended local writes. Only the paired plugin may attest that its
    // local automation switch is enabled.
    if (
      actor.kind !== 'device' &&
      (policy.mode === 'managed-auto' ||
        policy.managedAutoEnabled ||
        policy.allowCompanionUpdates ||
        policy.allowSynthesisIndexUpdates)
    ) {
      return learningError(
        context,
        'scope_denied',
        403,
        'Managed automation can only be enabled from the paired Obsidian connector.',
      );
    }
    return learningJson(context, {
      policy: await getLearningProgressService().updateDepositionPolicy(policy),
    });
  } catch (error) {
    return learningProgressErrorResponse(context, error);
  }
}
