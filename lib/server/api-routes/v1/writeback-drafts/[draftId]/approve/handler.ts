// Loaded by the consolidated Vercel API dispatcher.
import { NextRequest } from 'next/server';
import { requireLearningAdmin } from '@/lib/learning/http/admin-auth';
import {
  learningError,
  learningJson,
  learningRequestContext,
  requireLearningProtocol,
} from '@/lib/learning/http/api';
import { learningProgressErrorResponse } from '@/lib/learning/http/learning-progress-error';
import { parseDraftApproval, readLearningJson } from '@/lib/learning/http/learning-progress-input';
import { getLearningProgressService } from '@/lib/learning/learning-progress';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ draftId: string }> },
) {
  const context = learningRequestContext(request);
  const protocolError = requireLearningProtocol(request, context);
  if (protocolError) return protocolError;
  const authError = requireLearningAdmin(request, context);
  if (authError) return authError;

  try {
    const { draftId } = await params;
    if (!/^wbd_[a-f0-9]{32}$/.test(draftId)) {
      return learningError(context, 'invalid_request', 400, 'Invalid writeback draft id.');
    }
    const approval = parseDraftApproval(await readLearningJson(request));
    if (!approval) return learningError(context, 'invalid_request', 400, 'Invalid draft approval.');
    const command = await getLearningProgressService().approveWritebackDraft(
      draftId,
      approval.draftRevision,
    );
    return learningJson(context, { command }, 202);
  } catch (error) {
    return learningProgressErrorResponse(context, error);
  }
}
