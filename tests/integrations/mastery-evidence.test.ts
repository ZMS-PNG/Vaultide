import { describe, expect, it } from 'vitest';
import { LEARNING_PROTOCOL_VERSION } from '@openmaic/learning-protocol';
import type { StoredLearningEvent } from '@/lib/learning/domain/learning-progress';
import {
  buildMasteryProjections,
  CLASSROOM_MASTERY_CONCEPT_ID,
} from '@/lib/learning/domain/mastery-evidence';

const now = '2026-07-23T12:00:00.000Z';

const classroom = {
  id: 'course_mastery',
  stage: { id: 'course_mastery', name: 'Mastery evidence classroom' },
  scenes: [
    { id: 'scene_intro', title: 'Introduction', order: 0, type: 'slide' },
    { id: 'scene_quiz', title: 'Quiz', order: 1, type: 'quiz' },
  ],
  createdAt: now,
};

function event(
  eventType: StoredLearningEvent['eventType'],
  payload: Record<string, unknown>,
  sequence: number,
): StoredLearningEvent {
  return {
    protocolVersion: LEARNING_PROTOCOL_VERSION,
    schemaVersion: 'learning-event/1',
    id: `lev_${String(sequence).padStart(32, '0')}`,
    ownerId: `own_${'1'.repeat(32)}`,
    sprintId: `spr_${'2'.repeat(32)}`,
    eventType,
    clientEventId: `event-${sequence}`,
    deviceId: 'web_openmaic_admin',
    occurredAt: new Date(Date.parse(now) + sequence * 1_000).toISOString(),
    receivedAt: new Date(Date.parse(now) + sequence * 1_000).toISOString(),
    serverSeq: sequence,
    source: 'web',
    payload,
  } as unknown as StoredLearningEvent;
}

describe('mastery-evidence-v4 projector', () => {
  it('keeps passive viewing and completion out of mastery estimates', () => {
    const projections = buildMasteryProjections(classroom, [
      event('sceneViewed', { sceneId: 'scene_intro' }, 1),
      event('sceneCompleted', { sceneId: 'scene_intro', completionKind: 'manual' }, 2),
      event(
        'sprintCompleted',
        {
          completionVersion: 1,
          completedSceneIds: ['scene_intro', 'scene_quiz'],
          totalSceneCount: 2,
        },
        3,
      ),
    ]);
    const overall = projections.find(
      (projection) => projection.conceptId === CLASSROOM_MASTERY_CONCEPT_ID,
    );
    expect(overall).toMatchObject({ estimate: null, confidence: 0, evidenceCount: 0 });
  });

  it('uses active evidence, keeps an explanation trail, and creates a review date', () => {
    const projections = buildMasteryProjections(classroom, [
      event(
        'practiceSubmitted',
        {
          taskId: 'scene_quiz',
          sceneId: 'scene_quiz',
          response: '{"earned":4,"possible":5}',
          score: 0.8,
        },
        1,
      ),
      event('explanationSubmitted', { promptId: 'why', response: 'I can explain the model.' }, 2),
    ]);
    const overall = projections.find(
      (projection) => projection.conceptId === CLASSROOM_MASTERY_CONCEPT_ID,
    );
    const quiz = projections.find((projection) => projection.conceptId === 'scene:scene_quiz');
    expect(overall?.estimate).not.toBeNull();
    expect(overall?.confidence).toBeGreaterThan(0);
    expect(overall?.evidence).toHaveLength(2);
    expect(overall?.nextReviewAt).toMatch(/^2026-/);
    expect(quiz).toMatchObject({ evidenceCount: 1 });
  });

  it('caps repeated answers for the same task and discounts prompted recall', () => {
    const repeated = Array.from({ length: 6 }, (_, index) =>
      event(
        'practiceSubmitted',
        { taskId: 'scene_quiz', sceneId: 'scene_quiz', response: 'answer', score: 1 },
        index + 1,
      ),
    );
    const repeatedOverall = buildMasteryProjections(classroom, repeated).find(
      (projection) => projection.conceptId === CLASSROOM_MASTERY_CONCEPT_ID,
    );
    expect(repeatedOverall?.evidenceCount).toBe(3);

    const independent = buildMasteryProjections(classroom, [
      event('retrievalAttempted', { promptId: 'p1', response: 'independent answer' }, 1),
    ]).find((projection) => projection.conceptId === CLASSROOM_MASTERY_CONCEPT_ID);
    const prompted = buildMasteryProjections(classroom, [
      event('hintRequested', { promptId: 'p1', level: 1 }, 1),
      event('retrievalAttempted', { promptId: 'p1', response: 'prompted answer' }, 2),
    ]).find((projection) => projection.conceptId === CLASSROOM_MASTERY_CONCEPT_ID);
    expect(prompted?.confidence).toBeLessThan(independent?.confidence ?? 1);
  });

  it('does not award an optimistic score to unscored legacy recall or explanations', () => {
    const legacy = buildMasteryProjections(classroom, [
      event('retrievalAttempted', { promptId: 'legacy', response: 'an answer' }, 1),
      event('explanationSubmitted', { promptId: 'legacy-explain', response: 'an explanation' }, 2),
    ]).find((projection) => projection.conceptId === CLASSROOM_MASTERY_CONCEPT_ID);
    const checked = buildMasteryProjections(classroom, [
      event(
        'retrievalAttempted',
        { promptId: 'checked', response: 'checked answer', sceneId: 'scene_intro', score: 0.9 },
        1,
      ),
      event(
        'explanationSubmitted',
        {
          promptId: 'checked-explain',
          response: 'checked explanation',
          sceneId: 'scene_intro',
          score: 0.9,
        },
        2,
      ),
    ]).find((projection) => projection.conceptId === CLASSROOM_MASTERY_CONCEPT_ID);

    expect(legacy?.estimate).toBeCloseTo(0.5);
    expect(legacy?.confidence).toBeLessThan(0.2);
    expect(checked?.estimate).toBeGreaterThan(legacy?.estimate ?? 1);
    expect(checked?.confidence).toBeGreaterThan(legacy?.confidence ?? 1);
  });

  it('raises confidence when independent evidence spans recall, practice, and transfer', () => {
    const recallOnly = buildMasteryProjections(classroom, [
      event(
        'retrievalAttempted',
        { promptId: 'recall', response: 'answer', sceneId: 'scene_quiz', score: 0.8 },
        1,
      ),
    ]).find((projection) => projection.conceptId === CLASSROOM_MASTERY_CONCEPT_ID);
    const diverse = buildMasteryProjections(classroom, [
      event(
        'retrievalAttempted',
        { promptId: 'recall', response: 'answer', sceneId: 'scene_quiz', score: 0.8 },
        1,
      ),
      event(
        'practiceSubmitted',
        { taskId: 'quiz-2', sceneId: 'scene_quiz', response: 'answer', score: 0.8 },
        2,
      ),
      event(
        'transferTaskCompleted',
        { taskId: 'scene_quiz', outcome: 'worked in a new case', score: 0.85 },
        3,
      ),
    ]).find((projection) => projection.conceptId === CLASSROOM_MASTERY_CONCEPT_ID);

    expect(diverse?.confidence).toBeGreaterThan(recallOnly?.confidence ?? 1);
    expect(diverse?.evidenceTypes).toEqual(
      expect.arrayContaining(['retrievalAttempted', 'practiceSubmitted', 'transferTaskCompleted']),
    );
  });

  it('uses review ratings only for scheduling and never as mastery evidence', () => {
    const recall = event(
      'retrievalAttempted',
      {
        promptId: 'spaced-recall',
        response: 'An independently recalled explanation.',
        sceneId: 'scene_quiz',
        score: 0.8,
      },
      1,
    );
    const againProjection = buildMasteryProjections(classroom, [
      recall,
      event(
        'reviewCompleted',
        {
          reviewItemId: `rvi_${'4'.repeat(32)}`,
          rating: 'again',
          conceptId: 'scene:scene_quiz',
        },
        2,
      ),
    ]).find((projection) => projection.conceptId === 'scene:scene_quiz');
    const easyProjection = buildMasteryProjections(classroom, [
      recall,
      event(
        'reviewCompleted',
        {
          reviewItemId: `rvi_${'4'.repeat(32)}`,
          rating: 'easy',
          conceptId: 'scene:scene_quiz',
        },
        2,
      ),
    ]).find((projection) => projection.conceptId === 'scene:scene_quiz');

    expect(againProjection).toMatchObject({
      evidenceCount: 1,
      evidenceTypes: ['retrievalAttempted'],
    });
    expect(easyProjection?.estimate).toBe(againProjection?.estimate);
    expect(easyProjection?.confidence).toBe(againProjection?.confidence);
    expect(Date.parse(easyProjection?.nextReviewAt ?? '')).toBeGreaterThan(
      Date.parse(againProjection?.nextReviewAt ?? ''),
    );
  });

  it('does not manufacture mastery from a self-rating without active evidence', () => {
    const projection = buildMasteryProjections(classroom, [
      event(
        'reviewCompleted',
        {
          reviewItemId: `rvi_${'5'.repeat(32)}`,
          rating: 'easy',
          conceptId: 'scene:scene_quiz',
        },
        1,
      ),
    ]).find((item) => item.conceptId === 'scene:scene_quiz');

    expect(projection).toMatchObject({
      estimate: null,
      confidence: 0,
      evidenceCount: 0,
      evidenceTypes: [],
    });
  });
});
