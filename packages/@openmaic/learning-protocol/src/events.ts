import type { LearningProtocolVersion } from './version.js';
import { LEARNING_EVENT_SCHEMA_VERSION, LEARNING_PROTOCOL_VERSION } from './version.js';

export interface DiagnosisAnsweredPayload {
  questionId: string;
  response: string;
  correct?: boolean;
}

export interface RetrievalAttemptedPayload {
  promptId: string;
  /** Exact learner-facing task. Keeps server evaluation scoped to this attempt. */
  promptText?: string;
  response: string;
  /** Optional scene binding makes recall usable as concept-level evidence. */
  sceneId?: string;
  /** Learner self-check in [0, 1]; unscored legacy attempts remain low-confidence. */
  score?: number;
  durationMs?: number;
}

export interface HintRequestedPayload {
  promptId: string;
  level: 1 | 2 | 3;
}

export interface AnswerRevealedPayload {
  promptId: string;
  reason?: 'user-requested' | 'attempt-exhausted' | 'instructor-decision';
}

export interface ExplanationSubmittedPayload {
  promptId: string;
  /** Exact learner-facing task. Keeps server evaluation scoped to this attempt. */
  promptText?: string;
  response: string;
  /** Optional scene binding makes an explanation usable as concept-level evidence. */
  sceneId?: string;
  /** Learner self-check in [0, 1]; unscored legacy explanations remain low-confidence. */
  score?: number;
}

export interface PracticeSubmittedPayload {
  taskId: string;
  /** Exact learner-facing task. Keeps server evaluation scoped to this attempt. */
  promptText?: string;
  response: string;
  /** Optional scene binding makes a quiz result usable as concept-level evidence. */
  sceneId?: string;
  /** Normalized score in [0, 1]. Older clients may keep the aggregate in response. */
  score?: number;
}

export interface SceneViewedPayload {
  sceneId: string;
  title?: string;
  sceneOrder?: number;
}

/** A learner-confirmed completion marker. It tracks progress, not mastery. */
export interface SceneCompletedPayload {
  sceneId: string;
  sceneOrder?: number;
  completionKind:
    | 'manual'
    | 'quiz-submitted'
    | 'explanation-submitted'
    | 'practice-submitted'
    | 'transfer-completed';
}

/** Immutable snapshot emitted only when every scene in a classroom is complete. */
export interface SprintCompletedPayload {
  completionVersion: 1;
  completedSceneIds: string[];
  totalSceneCount: number;
}

export interface WhiteboardNoteAddedPayload {
  sceneId: string;
  noteKind: 'understanding' | 'question' | 'connection';
  characterCount: number;
}

export interface DiscussionParticipatedPayload {
  sceneId?: string;
  sessionId: string;
  sessionType: 'qa' | 'discussion';
  messageLength: number;
}

export interface FeedbackReceivedPayload {
  targetEventId: string;
  summary: string;
  score?: number;
}

export interface EvidenceSubmittedPayload {
  evidenceId: string;
  evidenceType: 'code' | 'test' | 'document' | 'design' | 'decision' | 'other';
}

export interface EvidenceEvaluatedPayload {
  evidenceId: string;
  rubricVersion: string;
  verdict: 'passed' | 'revise' | 'failed';
}

export interface TransferTaskCompletedPayload {
  taskId: string;
  /** Exact learner-facing task. Keeps server evaluation scoped to this attempt. */
  promptText?: string;
  /** Scene binding distinguishes the final course transfer gate from local transfer practice. */
  sceneId?: string;
  outcome: string;
  score?: number;
}

export interface WritebackApprovedPayload {
  draftId: string;
  draftRevision: number;
}

export interface WritebackAppliedPayload {
  commandId: string;
  receiptId: string;
  outcome: 'applied';
}

export interface ReviewCompletedPayload {
  reviewItemId: string;
  rating: 'again' | 'hard' | 'good' | 'easy';
  durationMs?: number;
}

export interface LearningEventPayloadMap {
  diagnosisAnswered: DiagnosisAnsweredPayload;
  retrievalAttempted: RetrievalAttemptedPayload;
  hintRequested: HintRequestedPayload;
  answerRevealed: AnswerRevealedPayload;
  explanationSubmitted: ExplanationSubmittedPayload;
  practiceSubmitted: PracticeSubmittedPayload;
  sceneViewed: SceneViewedPayload;
  sceneCompleted: SceneCompletedPayload;
  sprintCompleted: SprintCompletedPayload;
  whiteboardNoteAdded: WhiteboardNoteAddedPayload;
  discussionParticipated: DiscussionParticipatedPayload;
  feedbackReceived: FeedbackReceivedPayload;
  evidenceSubmitted: EvidenceSubmittedPayload;
  evidenceEvaluated: EvidenceEvaluatedPayload;
  transferTaskCompleted: TransferTaskCompletedPayload;
  writebackApproved: WritebackApprovedPayload;
  writebackApplied: WritebackAppliedPayload;
  reviewCompleted: ReviewCompletedPayload;
}

export type LearningEventType = keyof LearningEventPayloadMap;
export type LearningEventSource = 'web' | 'obsidian-plugin' | 'system' | 'import';

export interface LearningEventEnvelope<T extends LearningEventType> {
  protocolVersion: LearningProtocolVersion;
  schemaVersion: typeof LEARNING_EVENT_SCHEMA_VERSION;
  id: string;
  ownerId: string;
  sprintId: string;
  eventType: T;
  clientEventId: string;
  deviceId: string;
  occurredAt: string;
  receivedAt?: string;
  serverSeq?: number;
  source: LearningEventSource;
  causationId?: string;
  correlationId?: string;
  payload: LearningEventPayloadMap[T];
}

/** Explicit union keeps the eventType/payload binding in emitted JSON Schema. */
export type LearningEvent =
  | LearningEventEnvelope<'diagnosisAnswered'>
  | LearningEventEnvelope<'retrievalAttempted'>
  | LearningEventEnvelope<'hintRequested'>
  | LearningEventEnvelope<'answerRevealed'>
  | LearningEventEnvelope<'explanationSubmitted'>
  | LearningEventEnvelope<'practiceSubmitted'>
  | LearningEventEnvelope<'sceneViewed'>
  | LearningEventEnvelope<'sceneCompleted'>
  | LearningEventEnvelope<'sprintCompleted'>
  | LearningEventEnvelope<'whiteboardNoteAdded'>
  | LearningEventEnvelope<'discussionParticipated'>
  | LearningEventEnvelope<'feedbackReceived'>
  | LearningEventEnvelope<'evidenceSubmitted'>
  | LearningEventEnvelope<'evidenceEvaluated'>
  | LearningEventEnvelope<'transferTaskCompleted'>
  | LearningEventEnvelope<'writebackApproved'>
  | LearningEventEnvelope<'writebackApplied'>
  | LearningEventEnvelope<'reviewCompleted'>;

export function stampLearningEvent<T extends LearningEventType>(
  event: Omit<LearningEventEnvelope<T>, 'protocolVersion' | 'schemaVersion'>,
): LearningEventEnvelope<T> {
  return {
    ...event,
    protocolVersion: LEARNING_PROTOCOL_VERSION,
    schemaVersion: LEARNING_EVENT_SCHEMA_VERSION,
  };
}

export function learningEventDedupeKey(
  event: Pick<LearningEvent, 'ownerId' | 'deviceId' | 'clientEventId'>,
): string {
  return `${event.ownerId}:${event.deviceId}:${event.clientEventId}`;
}
