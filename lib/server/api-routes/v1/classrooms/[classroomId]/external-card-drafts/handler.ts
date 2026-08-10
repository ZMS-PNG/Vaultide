// Loaded by the consolidated Vercel API dispatcher.
import { NextRequest } from 'next/server';
import { isValidClassroomId } from '@/lib/server/classroom-storage';
import { requireLearningAdmin } from '@/lib/learning/http/admin-auth';
import {
  learningError,
  learningJson,
  learningRequestContext,
  requireLearningProtocol,
} from '@/lib/learning/http/api';
import { learningProgressErrorResponse } from '@/lib/learning/http/learning-progress-error';
import { getLearningProgressService } from '@/lib/learning/learning-progress';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

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
    return learningJson(context, {
      draft: await getLearningProgressService().createExternalKnowledgeCardDraft(classroomId),
    }, 201);
  } catch (error) {
    return learningProgressErrorResponse(context, error);
  }
}
