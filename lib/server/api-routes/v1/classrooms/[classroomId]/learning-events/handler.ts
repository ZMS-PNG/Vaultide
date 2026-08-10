// Loaded by the consolidated Vercel API dispatcher.
import { after, NextRequest } from 'next/server';
import { isValidClassroomId } from '@/lib/server/classroom-storage';
import { requireLearningAdmin } from '@/lib/learning/http/admin-auth';
import {
  learningError,
  learningJson,
  learningRequestContext,
  requireLearningProtocol,
} from '@/lib/learning/http/api';
import { learningProgressErrorResponse } from '@/lib/learning/http/learning-progress-error';
import {
  parseWebLearningEvents,
  readLearningJson,
} from '@/lib/learning/http/learning-progress-input';
import { getLearningProgressService } from '@/lib/learning/learning-progress';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ classroomId: string }> },
) {
  const context = learningRequestContext(request);
  const protocolError = requireLearningProtocol(request, context);
  if (protocolError) return protocolError;
  const authError = requireLearningAdmin(request, context);
  if (authError) return authError;

  try {
    const { classroomId } = await params;
    if (!isValidClassroomId(classroomId)) {
      return learningError(context, 'invalid_request', 400, 'Invalid classroom id.');
    }
    const result = await getLearningProgressService().classroomLearningStatus(classroomId);
    return learningJson(context, result);
  } catch (error) {
    return learningProgressErrorResponse(context, error);
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ classroomId: string }> },
) {
  const context = learningRequestContext(request);
  const protocolError = requireLearningProtocol(request, context);
  if (protocolError) return protocolError;
  const authError = requireLearningAdmin(request, context);
  if (authError) return authError;

  try {
    const { classroomId } = await params;
    if (!isValidClassroomId(classroomId)) {
      return learningError(context, 'invalid_request', 400, 'Invalid classroom id.');
    }
    const events = parseWebLearningEvents(await readLearningJson(request));
    if (!events)
      return learningError(context, 'invalid_request', 400, 'Invalid learning event batch.');
    const service = getLearningProgressService();
    // Persist learner evidence before responding. LLM-backed evaluation is
    // intentionally scheduled after the 202 receipt: a slow provider must not
    // freeze the classroom or turn a correct learning action into a timeout.
    const result = await service.appendWebEvents(classroomId, events, {
      deferEvidenceEvaluation: true,
    });
    const clientEventIds = events
      .filter((event) => ['retrievalAttempted', 'explanationSubmitted', 'practiceSubmitted', 'transferTaskCompleted'].includes(event.eventType))
      .map((event) => event.clientEventId);
    if (clientEventIds.length > 0) {
      after(async () => {
        try {
          await service.evaluateDeferredWebEvidence(classroomId, clientEventIds);
        } catch (error) {
          console.error('Deferred learning evidence evaluation failed.', {
            classroomId,
            eventCount: clientEventIds.length,
            reason: error instanceof Error ? error.message : String(error),
          });
        }
      });
    }
    return learningJson(context, result, 202);
  } catch (error) {
    return learningProgressErrorResponse(context, error);
  }
}
