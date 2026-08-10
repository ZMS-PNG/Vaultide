import {
  isJsonObject,
  type LearningEvent,
  type LearningEventType,
  type WritebackReceipt,
} from '@openmaic/learning-protocol';
import type { WebLearningEventInput } from '../application/learning-progress-service';
import type { LearningProgressSnapshot, QuizProgressSummary } from '../domain/learning-progress';

const MAX_JSON_BODY_BYTES = 1_000_000;
const EVENT_TYPES = new Set<LearningEventType>([
  'diagnosisAnswered',
  'retrievalAttempted',
  'hintRequested',
  'answerRevealed',
  'explanationSubmitted',
  'practiceSubmitted',
  'sceneViewed',
  'sceneCompleted',
  'whiteboardNoteAdded',
  'discussionParticipated',
  'evidenceSubmitted',
  'transferTaskCompleted',
  'reviewCompleted',
]);

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export async function readLearningJson(request: Request): Promise<unknown> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_JSON_BODY_BYTES)
    throw new Error('body_too_large');
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_JSON_BODY_BYTES) {
    throw new Error('body_too_large');
  }
  return JSON.parse(text);
}

export function parseProgressSnapshot(value: unknown): LearningProgressSnapshot | undefined {
  const body = record(value);
  const progress = record(body?.progress);
  if (!progress) return undefined;
  if (progress.currentSceneId !== undefined && typeof progress.currentSceneId !== 'string') {
    return undefined;
  }
  if (!Array.isArray(progress.quizSummaries) || progress.quizSummaries.length > 100)
    return undefined;
  const summaries: QuizProgressSummary[] = [];
  for (const item of progress.quizSummaries) {
    const quiz = record(item);
    if (
      !quiz ||
      typeof quiz.sceneId !== 'string' ||
      quiz.sceneId.length > 128 ||
      typeof quiz.title !== 'string' ||
      quiz.title.length > 500 ||
      !Number.isInteger(quiz.answered) ||
      !Number.isInteger(quiz.total) ||
      (quiz.answered as number) < 0 ||
      (quiz.total as number) < 0 ||
      (quiz.answered as number) > (quiz.total as number)
    ) {
      return undefined;
    }
    const earned = quiz.earned;
    const possible = quiz.possible;
    if (
      (earned !== undefined &&
        (typeof earned !== 'number' || !Number.isFinite(earned) || earned < 0)) ||
      (possible !== undefined &&
        (typeof possible !== 'number' || !Number.isFinite(possible) || possible <= 0)) ||
      (typeof earned === 'number' && typeof possible === 'number' && earned > possible)
    ) {
      return undefined;
    }
    summaries.push({
      sceneId: quiz.sceneId,
      title: quiz.title,
      answered: quiz.answered as number,
      total: quiz.total as number,
      ...(typeof earned === 'number' ? { earned } : {}),
      ...(typeof possible === 'number' ? { possible } : {}),
    });
  }
  return {
    ...(typeof progress.currentSceneId === 'string'
      ? { currentSceneId: progress.currentSceneId.slice(0, 128) }
      : {}),
    quizSummaries: summaries,
  };
}

export function parseWebLearningEvents(value: unknown): WebLearningEventInput[] | undefined {
  const body = record(value);
  if (!Array.isArray(body?.events) || body.events.length === 0 || body.events.length > 100) {
    return undefined;
  }
  const events: WebLearningEventInput[] = [];
  for (const item of body.events) {
    const event = record(item);
    if (
      !event ||
      typeof event.eventType !== 'string' ||
      !EVENT_TYPES.has(event.eventType as LearningEventType) ||
      typeof event.clientEventId !== 'string' ||
      event.clientEventId.length < 1 ||
      event.clientEventId.length > 160 ||
      typeof event.occurredAt !== 'string' ||
      Number.isNaN(Date.parse(event.occurredAt)) ||
      !isJsonObject(event.payload) ||
      (event.causationId !== undefined && typeof event.causationId !== 'string') ||
      (event.correlationId !== undefined && typeof event.correlationId !== 'string')
    ) {
      return undefined;
    }
    events.push({
      eventType: event.eventType as LearningEventType,
      clientEventId: event.clientEventId,
      occurredAt: event.occurredAt,
      payload: event.payload,
      ...(typeof event.causationId === 'string' ? { causationId: event.causationId } : {}),
      ...(typeof event.correlationId === 'string' ? { correlationId: event.correlationId } : {}),
    });
  }
  return events;
}

export function parseLearningEventBatch(value: unknown): LearningEvent[] | undefined {
  const body = record(value);
  return Array.isArray(body?.events) && body.events.length > 0 && body.events.length <= 100
    ? (body.events as LearningEvent[])
    : undefined;
}

export function parseDraftApproval(value: unknown): { draftRevision: number } | undefined {
  const body = record(value);
  return body && Number.isInteger(body.draftRevision) && (body.draftRevision as number) > 0
    ? { draftRevision: body.draftRevision as number }
    : undefined;
}

export function parseSprintCompletion(
  value: unknown,
): { completionVersion: 1; completedSceneIds: string[] } | undefined {
  // Retained for route compatibility only. The server no longer accepts a
  // client-supplied completion declaration because it could manufacture a
  // completed sprint without verified learning evidence.
  void value;
  return undefined;
}

export function parseReviewCompletion(
  value: unknown,
):
  | {
      attemptId: string;
      response: string;
      rating: 'again' | 'hard' | 'good' | 'easy';
      durationMs?: number;
    }
  | undefined {
  const body = record(value);
  const rating = body?.rating;
  const attemptId = typeof body?.attemptId === 'string' ? body.attemptId.trim() : '';
  const response = typeof body?.response === 'string' ? body.response.trim() : '';
  const durationMs = body?.durationMs;
  if (
    !/^[A-Za-z0-9:_-]{8,120}$/.test(attemptId) ||
    response.length < 20 ||
    response.length > 4_000 ||
    !(
      rating === 'again' ||
      rating === 'hard' ||
      rating === 'good' ||
      rating === 'easy'
    ) ||
    (durationMs !== undefined &&
      (!Number.isInteger(durationMs) || (durationMs as number) < 0 || (durationMs as number) > 86_400_000))
  ) {
    return undefined;
  }
  return {
    attemptId,
    response,
    rating,
    ...(typeof durationMs === 'number' ? { durationMs } : {}),
  };
}

export function parseDepositionPolicy(value: unknown):
  | {
      mode: 'manual' | 'batch' | 'managed-auto';
      managedAutoEnabled: boolean;
      allowCompanionUpdates: boolean;
      allowSynthesisIndexUpdates?: boolean;
      allowExternalCards?: boolean;
    }
  | undefined {
  const body = record(value);
  if (
    !body ||
    !['manual', 'batch', 'managed-auto'].includes(String(body.mode)) ||
    typeof body.managedAutoEnabled !== 'boolean' ||
    typeof body.allowCompanionUpdates !== 'boolean' ||
    (body.allowSynthesisIndexUpdates !== undefined &&
      typeof body.allowSynthesisIndexUpdates !== 'boolean') ||
    (body.allowExternalCards !== undefined && typeof body.allowExternalCards !== 'boolean')
  ) {
    return undefined;
  }
  return {
    mode: body.mode as 'manual' | 'batch' | 'managed-auto',
    managedAutoEnabled: body.managedAutoEnabled,
    allowCompanionUpdates: body.allowCompanionUpdates,
    ...(typeof body.allowSynthesisIndexUpdates === 'boolean'
      ? { allowSynthesisIndexUpdates: body.allowSynthesisIndexUpdates }
      : {}),
    ...(typeof body.allowExternalCards === 'boolean'
      ? { allowExternalCards: body.allowExternalCards }
      : {}),
  };
}

export function parseWritebackReceipt(value: unknown): WritebackReceipt | undefined {
  const body = record(value);
  if (!body) return undefined;
  return body.receipt && record(body.receipt)
    ? (body.receipt as unknown as WritebackReceipt)
    : (body as unknown as WritebackReceipt);
}
