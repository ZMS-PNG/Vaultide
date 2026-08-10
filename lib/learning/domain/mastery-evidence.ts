import type { LearningEventType } from '@openmaic/learning-protocol';
import type { ClassroomLearningSnapshot, StoredLearningEvent } from './learning-progress';

/**
 * This is deliberately versioned. A projection is a reproducible interpretation
 * of immutable events, not a score that a page is allowed to invent ad hoc.
 */
export const MASTERY_PROJECTOR_VERSION = 'mastery-evidence-v4' as const;
export const CLASSROOM_MASTERY_CONCEPT_ID = 'classroom';

type MasteryEvidenceFamily =
  | 'diagnosis'
  | 'recall'
  | 'explanation'
  | 'practice'
  | 'transfer'
  | 'evaluation';

type ReviewRating = 'again' | 'hard' | 'good' | 'easy';

interface ReviewSchedulingSignal {
  rating: ReviewRating;
  occurredAt: string;
}

export interface MasteryEvidenceReason {
  eventId: string;
  eventType: LearningEventType;
  occurredAt: string;
  score: number;
  weight: number;
  independence: number;
}

export interface MasteryProjection {
  conceptId: string;
  estimate: number | null;
  confidence: number;
  evidenceCount: number;
  evidenceTypes: LearningEventType[];
  evidence: MasteryEvidenceReason[];
  lastPracticedAt?: string;
  nextReviewAt?: string;
  projectorVersion: typeof MASTERY_PROJECTOR_VERSION;
}

interface CandidateEvidence {
  event: StoredLearningEvent;
  conceptId?: string;
  evidenceKey: string;
  family: MasteryEvidenceFamily;
  score: number;
  weight: number;
  independence: number;
}

function payload(event: StoredLearningEvent): Record<string, unknown> {
  return event.payload as unknown as Record<string, unknown>;
}

function stringPayload(event: StoredLearningEvent, key: string): string | undefined {
  const value = payload(event)[key];
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function numberPayload(event: StoredLearningEvent, key: string): number | undefined {
  const value = payload(event)[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function sceneConceptId(sceneId: string): string {
  return `scene:${sceneId}`;
}

function scoreFromPractice(event: StoredLearningEvent): number {
  const explicit = numberPayload(event, 'score');
  if (explicit !== undefined) return clamp(explicit);
  const response = stringPayload(event, 'response');
  if (!response) return 0.5;
  try {
    const parsed: unknown = JSON.parse(response);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return 0.5;
    const record = parsed as Record<string, unknown>;
    const earned = Number(record.earned);
    const possible = Number(record.possible);
    if (!Number.isFinite(earned) || !Number.isFinite(possible) || possible <= 0) return 0.5;
    return clamp(earned / possible);
  } catch {
    return 0.5;
  }
}

function parseSceneId(
  event: StoredLearningEvent,
  sceneIds: ReadonlySet<string>,
  fallbackKey?: string,
): string | undefined {
  const direct = stringPayload(event, 'sceneId');
  if (direct && sceneIds.has(direct)) return direct;
  if (fallbackKey && sceneIds.has(fallbackKey)) return fallbackKey;
  const conceptId = stringPayload(event, 'conceptId');
  if (conceptId?.startsWith('scene:')) {
    const sceneId = conceptId.slice('scene:'.length);
    if (sceneIds.has(sceneId)) return sceneId;
  }
  return undefined;
}

function activeCandidate(
  event: StoredLearningEvent,
  sceneIds: ReadonlySet<string>,
  independenceByKey: ReadonlyMap<string, number>,
): CandidateEvidence | undefined {
  const promptId = stringPayload(event, 'promptId');
  const taskId = stringPayload(event, 'taskId');
  const promptKey = promptId ? `prompt:${promptId}` : undefined;
  const taskKey = taskId ? `task:${taskId}` : undefined;
  const independence = promptKey ? (independenceByKey.get(promptKey) ?? 1) : 1;
  const sceneId = parseSceneId(event, sceneIds, taskId);
  const base = {
    event,
    ...(sceneId ? { conceptId: sceneConceptId(sceneId) } : {}),
  };

  switch (event.eventType) {
    case 'diagnosisAnswered':
      return {
        ...base,
        evidenceKey: promptKey ?? `diagnosis:${event.id}`,
        family: 'diagnosis',
        score: payload(event).correct === true ? 1 : payload(event).correct === false ? 0 : 0.5,
        weight: 0.45,
        independence,
      };
    case 'retrievalAttempted': {
      const explicitScore = numberPayload(event, 'score');
      return {
        ...base,
        evidenceKey: promptKey ?? `retrieval:${event.id}`,
        family: 'recall',
        score: clamp(explicitScore ?? 0.5),
        weight: explicitScore === undefined ? 0.4 : 0.85,
        independence,
      };
    }
    case 'explanationSubmitted': {
      const explicitScore = numberPayload(event, 'score');
      return {
        ...base,
        evidenceKey: promptKey ?? `explanation:${event.id}`,
        family: 'explanation',
        score: clamp(explicitScore ?? 0.5),
        weight: explicitScore === undefined ? 0.35 : 0.75,
        independence,
      };
    }
    case 'practiceSubmitted':
      return {
        ...base,
        evidenceKey: taskKey ?? `practice:${event.id}`,
        family: 'practice',
        score: scoreFromPractice(event),
        weight: 1,
        independence,
      };
    case 'transferTaskCompleted':
      return {
        ...base,
        evidenceKey: taskKey ?? `transfer:${event.id}`,
        family: 'transfer',
        score: clamp(numberPayload(event, 'score') ?? 0.7),
        weight: 1.35,
        independence,
      };
    case 'evidenceEvaluated':
      return {
        ...base,
        evidenceKey: `evidence:${stringPayload(event, 'evidenceId') ?? event.id}`,
        family: 'evaluation',
        score:
          payload(event).verdict === 'passed' ? 1 : payload(event).verdict === 'revise' ? 0.4 : 0,
        weight: 1.1,
        independence,
      };
    default:
      return undefined;
  }
}

function nextReviewAt(
  estimate: number,
  confidence: number,
  lastPracticedAt: string,
  evidence: readonly MasteryEvidenceReason[],
  reviewSignal?: ReviewSchedulingSignal,
): string {
  const baseDays =
    estimate < 0.45 ? 1 : estimate < 0.65 ? 2 : estimate < 0.8 ? 5 : estimate < 0.9 ? 10 : 18;
  const hasStrongTransfer = evidence.some(
    (item) => item.eventType === 'transferTaskCompleted' && item.score >= 0.8,
  );
  const ratingFactor =
    reviewSignal?.rating === 'again'
      ? 0.45
      : reviewSignal?.rating === 'hard'
        ? 0.72
        : reviewSignal?.rating === 'easy'
          ? 1.35
          : 1;
  const demonstratedBonus = hasStrongTransfer ? 1.25 : 1;
  const confidenceFactor = 0.65 + confidence * 0.7;
  const days = Math.max(
    1,
    Math.round(baseDays * confidenceFactor * demonstratedBonus * ratingFactor),
  );
  const anchor =
    reviewSignal && reviewSignal.occurredAt > lastPracticedAt
      ? reviewSignal.occurredAt
      : lastPracticedAt;
  const due = new Date(anchor);
  due.setUTCDate(due.getUTCDate() + days);
  return due.toISOString();
}

function buildProjection(
  conceptId: string,
  candidates: readonly CandidateEvidence[],
  reviewSignal?: ReviewSchedulingSignal,
): MasteryProjection {
  if (candidates.length === 0) {
    return {
      conceptId,
      estimate: null,
      confidence: 0,
      evidenceCount: 0,
      evidenceTypes: [],
      evidence: [],
      projectorVersion: MASTERY_PROJECTOR_VERSION,
    };
  }

  const seenAttempts = new Map<string, number>();
  const evidence: MasteryEvidenceReason[] = [];
  let alpha = 1;
  let beta = 1;
  let totalWeight = 0;
  let lastPracticedAt = candidates[0].event.occurredAt;
  const evidenceFamilies = new Set<MasteryEvidenceFamily>();
  const latestEventAt = Math.max(
    ...candidates.map((candidate) => Date.parse(candidate.event.occurredAt)),
  );

  for (const candidate of candidates) {
    const attempts = seenAttempts.get(candidate.evidenceKey) ?? 0;
    seenAttempts.set(candidate.evidenceKey, attempts + 1);
    // A fourth re-answer of the same prompt must not manufacture mastery.
    if (attempts >= 3) continue;
    const repeatFactor = attempts === 0 ? 1 : attempts === 1 ? 0.5 : 0.25;
    const eventAt = Date.parse(candidate.event.occurredAt);
    const ageDays =
      Number.isFinite(eventAt) && Number.isFinite(latestEventAt)
        ? Math.max(0, (latestEventAt - eventAt) / (24 * 60 * 60 * 1000))
        : 0;
    const recencyFactor = Math.max(0.4, Math.pow(0.5, ageDays / 180));
    const weight = candidate.weight * candidate.independence * repeatFactor * recencyFactor;
    if (weight <= 0) continue;
    const score = clamp(candidate.score);
    alpha += score * weight;
    beta += (1 - score) * weight;
    totalWeight += weight;
    evidenceFamilies.add(candidate.family);
    if (candidate.event.occurredAt > lastPracticedAt) lastPracticedAt = candidate.event.occurredAt;
    evidence.push({
      eventId: candidate.event.id,
      eventType: candidate.event.eventType,
      occurredAt: candidate.event.occurredAt,
      score,
      weight: Number(weight.toFixed(4)),
      independence: candidate.independence,
    });
  }

  if (evidence.length === 0) {
    return {
      conceptId,
      estimate: null,
      confidence: 0,
      evidenceCount: 0,
      evidenceTypes: [],
      evidence: [],
      projectorVersion: MASTERY_PROJECTOR_VERSION,
    };
  }

  const estimate = clamp(alpha / (alpha + beta));
  const diversityFactor = 0.55 + Math.min(1, evidenceFamilies.size / 3) * 0.45;
  const confidence = clamp((1 - Math.exp(-totalWeight / 3)) * diversityFactor);
  return {
    conceptId,
    estimate: Number(estimate.toFixed(4)),
    confidence: Number(confidence.toFixed(4)),
    evidenceCount: evidence.length,
    evidenceTypes: [...new Set(evidence.map((item) => item.eventType))],
    evidence: evidence.slice(-24),
    lastPracticedAt,
    nextReviewAt: nextReviewAt(estimate, confidence, lastPracticedAt, evidence, reviewSignal),
    projectorVersion: MASTERY_PROJECTOR_VERSION,
  };
}

function reviewSchedulingSignal(event: StoredLearningEvent): {
  conceptId: string;
  signal: ReviewSchedulingSignal;
} | undefined {
  if (event.eventType !== 'reviewCompleted') return undefined;
  const conceptId = stringPayload(event, 'conceptId');
  const rating = payload(event).rating;
  if (
    !conceptId ||
    (rating !== 'again' && rating !== 'hard' && rating !== 'good' && rating !== 'easy')
  ) {
    return undefined;
  }
  return {
    conceptId,
    signal: { rating, occurredAt: event.occurredAt },
  };
}

/**
 * Project immutable classroom events into explainable mastery. Scene views and
 * completion markers are intentionally excluded from the score: they describe
 * progress, not demonstrated understanding.
 */
export function buildMasteryProjections(
  classroom: ClassroomLearningSnapshot,
  events: readonly StoredLearningEvent[],
): MasteryProjection[] {
  const sceneIds = new Set(classroom.scenes.map((scene) => scene.id));
  const ordered = [...events].sort((left, right) => {
    const sequence = (left.serverSeq ?? 0) - (right.serverSeq ?? 0);
    return sequence || left.occurredAt.localeCompare(right.occurredAt);
  });
  const independenceByKey = new Map<string, number>();
  const byConcept = new Map<string, CandidateEvidence[]>();
  const reviewSignals = new Map<string, ReviewSchedulingSignal>();
  byConcept.set(CLASSROOM_MASTERY_CONCEPT_ID, []);
  for (const scene of classroom.scenes) byConcept.set(sceneConceptId(scene.id), []);

  for (const event of ordered) {
    const scheduling = reviewSchedulingSignal(event);
    if (scheduling && byConcept.has(scheduling.conceptId)) {
      reviewSignals.set(scheduling.conceptId, scheduling.signal);
    }
    if (event.eventType === 'hintRequested') {
      const promptId = stringPayload(event, 'promptId');
      const level = numberPayload(event, 'level') ?? 1;
      if (promptId) {
        independenceByKey.set(`prompt:${promptId}`, level >= 3 ? 0.4 : level >= 2 ? 0.6 : 0.8);
      }
      continue;
    }
    if (event.eventType === 'answerRevealed') {
      const promptId = stringPayload(event, 'promptId');
      if (promptId) independenceByKey.set(`prompt:${promptId}`, 0.2);
      continue;
    }
    const candidate = activeCandidate(event, sceneIds, independenceByKey);
    if (!candidate) continue;
    byConcept.get(CLASSROOM_MASTERY_CONCEPT_ID)?.push(candidate);
    if (candidate.conceptId) byConcept.get(candidate.conceptId)?.push(candidate);
  }

  return [...byConcept.entries()]
    .map(([conceptId, candidates]) =>
      buildProjection(conceptId, candidates, reviewSignals.get(conceptId)),
    )
    .sort((left, right) => left.conceptId.localeCompare(right.conceptId));
}

export function classroomCompletionSummary(
  classroom: ClassroomLearningSnapshot,
  events: readonly StoredLearningEvent[],
): { completedSceneIds: string[]; totalSceneCount: number; completed: boolean } {
  const validSceneIds = new Set(classroom.scenes.map((scene) => scene.id));
  const completed = new Set<string>();
  for (const event of events) {
    if (event.eventType !== 'sceneCompleted') continue;
    const sceneId = stringPayload(event, 'sceneId');
    if (sceneId && validSceneIds.has(sceneId)) completed.add(sceneId);
  }
  const completedSceneIds = [...classroom.scenes]
    .sort((left, right) => left.order - right.order)
    .map((scene) => scene.id)
    .filter((sceneId) => completed.has(sceneId));
  return {
    completedSceneIds,
    totalSceneCount: classroom.scenes.length,
    completed: classroom.scenes.length > 0 && completedSceneIds.length === classroom.scenes.length,
  };
}
