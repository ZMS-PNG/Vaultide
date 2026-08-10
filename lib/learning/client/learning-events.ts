'use client';

import {
  LEARNING_PROTOCOL_VERSION,
  type JsonObject,
  type LearningEventType,
} from '@openmaic/learning-protocol';

export interface BrowserLearningEvent {
  eventType: LearningEventType;
  clientEventId: string;
  occurredAt: string;
  payload: JsonObject;
  causationId?: string;
  correlationId?: string;
}

export interface ClassroomLearningEvaluationFeedback {
  targetEventId: string;
  targetEventType: LearningEventType;
  verdict: 'passed' | 'revise' | 'failed';
  score: number;
  confidence: number;
  sceneId?: string;
  openQuestions: string[];
  corrections: Array<{
    misconception: string;
    correction: string;
  }>;
}

export interface ClassroomLearningVerification {
  learningVerified: boolean;
  passedEvaluationCount: number;
  requiredEvaluationCount: number;
  transferPassed: boolean;
  authoritativeMastery: number;
  authoritativeConfidence: number;
  latestEvaluation?: ClassroomLearningEvaluationFeedback;
}

export interface ClassroomLearningStatus {
  sprintId: string;
  sprintStatus: 'active' | 'completed' | 'archived';
  completion: {
    completedSceneIds: string[];
    totalSceneCount: number;
    completed: boolean;
  };
  mastery: {
    estimate: number | null;
    confidence: number;
    evidenceCount: number;
    nextReviewAt?: string;
  };
  verification: ClassroomLearningVerification;
}

export function createBrowserLearningEventId(prefix: string): string {
  const randomPart =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}:${randomPart}`.slice(0, 160);
}

export async function recordClassroomLearningEvents(
  classroomId: string,
  events: readonly BrowserLearningEvent[],
): Promise<{
  accepted: number;
  deduplicated: number;
  sprintId: string;
  completion?: {
    completedSceneIds: string[];
    totalSceneCount: number;
    completed: boolean;
  };
  mastery?: {
    estimate: number | null;
    confidence: number;
    evidenceCount: number;
    nextReviewAt?: string;
  };
  verification?: ClassroomLearningVerification;
}> {
  const response = await fetch(
    `/api/v1/classrooms/${encodeURIComponent(classroomId)}/learning-events`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-MAIC-Protocol-Version': LEARNING_PROTOCOL_VERSION,
      },
      body: JSON.stringify({ events }),
      cache: 'no-store',
      keepalive: true,
    },
  );
  const body = (await response.json()) as {
    accepted?: number;
    deduplicated?: number;
    sprintId?: string;
    completion?: {
      completedSceneIds?: string[];
      totalSceneCount?: number;
      completed?: boolean;
    };
    mastery?: {
      estimate?: number | null;
      confidence?: number;
      evidenceCount?: number;
      nextReviewAt?: string;
    };
    verification?: unknown;
    error?: { message?: string };
  };
  if (!response.ok) {
    throw new Error(body.error?.message || `Learning event request failed (${response.status}).`);
  }
  if (
    typeof body.accepted !== 'number' ||
    typeof body.deduplicated !== 'number' ||
    typeof body.sprintId !== 'string'
  ) {
    throw new Error('Learning event response was invalid.');
  }
  const result = {
    accepted: body.accepted,
    deduplicated: body.deduplicated,
    sprintId: body.sprintId,
  };
  const completion = body.completion;
  const mastery = body.mastery;
  const verification = parseClassroomLearningVerification(body.verification);
  return {
    ...result,
    ...(completion &&
    Array.isArray(completion.completedSceneIds) &&
    typeof completion.totalSceneCount === 'number' &&
    typeof completion.completed === 'boolean'
      ? {
          completion: {
            completedSceneIds: completion.completedSceneIds.filter(
              (sceneId): sceneId is string => typeof sceneId === 'string',
            ),
            totalSceneCount: completion.totalSceneCount,
            completed: completion.completed,
          },
        }
      : {}),
    ...(mastery &&
    (mastery.estimate === null || typeof mastery.estimate === 'number') &&
    typeof mastery.confidence === 'number' &&
    typeof mastery.evidenceCount === 'number'
      ? {
          mastery: {
            estimate: mastery.estimate,
            confidence: mastery.confidence,
            evidenceCount: mastery.evidenceCount,
            ...(typeof mastery.nextReviewAt === 'string' ? { nextReviewAt: mastery.nextReviewAt } : {}),
          },
        }
      : {}),
    ...(verification ? { verification } : {}),
  };
}

export async function readClassroomLearningStatus(
  classroomId: string,
): Promise<ClassroomLearningStatus> {
  const response = await fetch(
    `/api/v1/classrooms/${encodeURIComponent(classroomId)}/learning-events`,
    {
      headers: { 'X-MAIC-Protocol-Version': LEARNING_PROTOCOL_VERSION },
      cache: 'no-store',
    },
  );
  const body = (await response.json()) as {
    sprintId?: string;
    sprintStatus?: string;
    completion?: ClassroomLearningStatus['completion'];
    mastery?: ClassroomLearningStatus['mastery'];
    verification?: unknown;
    error?: { message?: string };
  };
  if (!response.ok) {
    throw new Error(body.error?.message || `Learning status request failed (${response.status}).`);
  }
  const verification = parseClassroomLearningVerification(body.verification);
  if (
    typeof body.sprintId !== 'string' ||
    !['active', 'completed', 'archived'].includes(body.sprintStatus ?? '') ||
    !body.completion ||
    !Array.isArray(body.completion.completedSceneIds) ||
    typeof body.completion.totalSceneCount !== 'number' ||
    typeof body.completion.completed !== 'boolean' ||
    !body.mastery ||
    !(
      body.mastery.estimate === null ||
      typeof body.mastery.estimate === 'number'
    ) ||
    typeof body.mastery.confidence !== 'number' ||
    typeof body.mastery.evidenceCount !== 'number' ||
    !verification
  ) {
    throw new Error('Learning status response was invalid.');
  }
  return {
    sprintId: body.sprintId,
    sprintStatus: body.sprintStatus as ClassroomLearningStatus['sprintStatus'],
    completion: {
      completedSceneIds: body.completion.completedSceneIds.filter(
        (sceneId): sceneId is string => typeof sceneId === 'string',
      ),
      totalSceneCount: body.completion.totalSceneCount,
      completed: body.completion.completed,
    },
    mastery: {
      estimate: body.mastery.estimate,
      confidence: body.mastery.confidence,
      evidenceCount: body.mastery.evidenceCount,
      ...(typeof body.mastery.nextReviewAt === 'string'
        ? { nextReviewAt: body.mastery.nextReviewAt }
        : {}),
    },
    verification,
  };
}

function parseClassroomLearningVerification(
  value: unknown,
): ClassroomLearningVerification | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (
    typeof record.learningVerified !== 'boolean' ||
    typeof record.passedEvaluationCount !== 'number' ||
    typeof record.requiredEvaluationCount !== 'number' ||
    typeof record.transferPassed !== 'boolean' ||
    typeof record.authoritativeMastery !== 'number' ||
    typeof record.authoritativeConfidence !== 'number'
  ) {
    return undefined;
  }
  const feedback = parseEvaluationFeedback(record.latestEvaluation);
  return {
    learningVerified: record.learningVerified,
    passedEvaluationCount: record.passedEvaluationCount,
    requiredEvaluationCount: record.requiredEvaluationCount,
    transferPassed: record.transferPassed,
    authoritativeMastery: record.authoritativeMastery,
    authoritativeConfidence: record.authoritativeConfidence,
    ...(feedback ? { latestEvaluation: feedback } : {}),
  };
}

function parseEvaluationFeedback(
  value: unknown,
): ClassroomLearningEvaluationFeedback | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (
    typeof record.targetEventId !== 'string' ||
    typeof record.targetEventType !== 'string' ||
    !['passed', 'revise', 'failed'].includes(String(record.verdict)) ||
    typeof record.score !== 'number' ||
    typeof record.confidence !== 'number'
  ) {
    return undefined;
  }
  const openQuestions = Array.isArray(record.openQuestions)
    ? record.openQuestions.filter((item): item is string => typeof item === 'string')
    : [];
  const corrections = Array.isArray(record.corrections)
    ? record.corrections.flatMap((item) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
        const correction = item as Record<string, unknown>;
        return typeof correction.misconception === 'string' &&
          typeof correction.correction === 'string'
          ? [
              {
                misconception: correction.misconception,
                correction: correction.correction,
              },
            ]
          : [];
      })
    : [];
  return {
    targetEventId: record.targetEventId,
    targetEventType: record.targetEventType as LearningEventType,
    verdict: record.verdict as ClassroomLearningEvaluationFeedback['verdict'],
    score: record.score,
    confidence: record.confidence,
    ...(typeof record.sceneId === 'string' ? { sceneId: record.sceneId } : {}),
    openQuestions,
    corrections,
  };
}
