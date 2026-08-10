import { describe, expect, it } from 'vitest';
import { LEARNING_PROTOCOL_VERSION } from '@openmaic/learning-protocol';
import {
  KNOWLEDGE_EVALUATION_SCHEMA,
  projectKnowledgeSnapshot,
  type KnowledgeSnapshotRecord,
} from '@/lib/learning/domain/knowledge-snapshot';
import type { StoredLearningEvent } from '@/lib/learning/domain/learning-progress';

const OWNER_ID = `own_${'1'.repeat(32)}`;
const SPRINT_ID = `spr_${'2'.repeat(32)}`;
const NOW = Date.parse('2026-07-28T12:00:00.000Z');

function event(
  eventType: StoredLearningEvent['eventType'],
  payload: Record<string, unknown>,
  sequence: number,
  source: StoredLearningEvent['source'] = 'web',
): StoredLearningEvent {
  return {
    protocolVersion: LEARNING_PROTOCOL_VERSION,
    schemaVersion: 'learning-event/1',
    id: `lev_${String(sequence).padStart(32, '0')}`,
    ownerId: OWNER_ID,
    sprintId: SPRINT_ID,
    eventType,
    clientEventId: `knowledge-event-${sequence}`,
    deviceId: source === 'system' ? 'system_evaluator' : 'web_openmaic_admin',
    occurredAt: new Date(NOW + sequence * 1_000).toISOString(),
    receivedAt: new Date(NOW + sequence * 1_000).toISOString(),
    serverSeq: sequence,
    source,
    payload,
  } as unknown as StoredLearningEvent;
}

function evaluation(overrides: Record<string, unknown> = {}) {
  return {
    schema: KNOWLEDGE_EVALUATION_SCHEMA,
    verdict: 'passed',
    confidence: 0.96,
    sourceReferences: [
      {
        referenceId: 'V1',
        citationId: 'V1',
        sourceId: `sou_${'3'.repeat(32)}`,
        sourceVersionId: `svr_${'4'.repeat(32)}`,
        locator: 'Projects/Architecture/source.md',
        contentHash: 'a'.repeat(64),
      },
    ],
    ...overrides,
  };
}

describe('verified knowledge snapshot projector', () => {
  it('never treats a learner answer or self-score as verified knowledge', () => {
    const rawSecret = 'UNVERIFIED PRIVATE FREE ANSWER';
    const projection = projectKnowledgeSnapshot({
      events: [
        event('retrievalAttempted', { promptId: 'recall-1', response: rawSecret, score: 1 }, 1),
        event(
          'explanationSubmitted',
          { promptId: 'explain-1', response: `${rawSecret} explanation`, score: 1 },
          2,
        ),
        event(
          'transferTaskCompleted',
          { taskId: 'transfer-1', outcome: `${rawSecret} outcome`, score: 1 },
          3,
        ),
      ],
    });

    expect(projection.eligibleForPersistence).toBe(false);
    expect(projection.verifiedKnowledge).toEqual([]);
    expect(projection.evidenceSummary.rejected.unverifiedLearningEvents).toBe(3);
    expect(JSON.stringify(projection)).not.toContain(rawSecret);
  });

  it('extracts only evaluator-authored, source-traced knowledge after a system pass', () => {
    const rawSecret = 'PRIVATE RAW ANSWER THAT MUST NOT BE WRITTEN BACK';
    const learningEvent = event(
      'retrievalAttempted',
      { promptId: 'recall-2', response: rawSecret, score: 1 },
      1,
    );
    const evaluationEvent = event(
      'feedbackReceived',
      {
        targetEventId: learningEvent.id,
        score: 0.95,
        summary: JSON.stringify(
          evaluation({
            verifiedClaims: [
              {
                text: 'A project revision must freeze the exact source versions used for learning.',
              },
            ],
            verifiedExplanations: [
              {
                text: 'The learner correctly explained that a mutable latest pointer cannot reproduce an older course.',
              },
            ],
            misconceptionCorrections: [
              {
                misconception: 'A latest-version pointer is a complete historical manifest.',
                correction: 'A replayable revision needs an immutable source-version manifest.',
              },
            ],
            openQuestions: [
              {
                question: 'How should deleted files remain traceable in an older project revision?',
              },
            ],
            skills: [
              {
                text: 'Can distinguish a mutable index from an immutable revision manifest.',
                sourceReferences: [
                  {
                    referenceId: 'artifact-1',
                    kind: 'artifact',
                    locator: 'artifacts/revision-check.txt',
                  },
                ],
              },
            ],
            transferOutcomes: [
              {
                text: 'Applied the revision-manifest rule to a second repository and identified a deletion gap.',
                sourceReferences: [
                  {
                    referenceId: 'artifact-2',
                    kind: 'artifact',
                    locator: 'artifacts/transfer-result.md',
                  },
                ],
              },
            ],
          }),
        ),
      },
      2,
      'system',
    );

    const projection = projectKnowledgeSnapshot({ events: [learningEvent, evaluationEvent] });

    expect(projection.eligibleForPersistence).toBe(true);
    expect(projection.verifiedKnowledge.map((entry) => entry.kind)).toEqual([
      'claim',
      'explanation',
      'skill',
      'transfer-outcome',
    ]);
    expect(projection.misconceptions).toHaveLength(1);
    expect(projection.unresolvedItems).toHaveLength(1);
    expect(projection.evidenceSummary.acceptedEvaluationEventIds).toEqual([evaluationEvent.id]);
    expect(projection.verifiedKnowledge[0]?.trace).toMatchObject({
      learningEventId: learningEvent.id,
      evaluationEventId: evaluationEvent.id,
      confidence: 0.95,
    });
    expect(JSON.stringify(projection)).not.toContain(rawSecret);
  });

  it('fails closed for learner-authored, low-confidence, malformed, and managed-source evaluations', () => {
    const learningEvent = event(
      'practiceSubmitted',
      { taskId: 'practice-1', response: 'unverified response', score: 1 },
      1,
    );
    const learnerEvaluation = event(
      'feedbackReceived',
      {
        targetEventId: learningEvent.id,
        score: 1,
        summary: JSON.stringify(
          evaluation({
            verifiedClaims: [{ text: 'A learner cannot certify their own answer.' }],
          }),
        ),
      },
      2,
      'web',
    );
    const lowConfidence = event(
      'feedbackReceived',
      {
        targetEventId: learningEvent.id,
        score: 0.7,
        summary: JSON.stringify(
          evaluation({
            verifiedClaims: [{ text: 'This evaluation is below the verification floor.' }],
          }),
        ),
      },
      3,
      'system',
    );
    const managedSource = event(
      'feedbackReceived',
      {
        targetEventId: learningEvent.id,
        score: 0.98,
        summary: JSON.stringify(
          evaluation({
            sourceReferences: [
              {
                referenceId: 'generated',
                locator: 'Vaultide/伴随笔记/generated.md',
              },
            ],
            verifiedClaims: [{ text: 'Generated output must not become its own source.' }],
          }),
        ),
      },
      4,
      'system',
    );

    const projection = projectKnowledgeSnapshot({
      events: [learningEvent, learnerEvaluation, lowConfidence, managedSource],
    });
    expect(projection.eligibleForPersistence).toBe(false);
    expect(projection.verifiedKnowledge).toEqual([]);
    expect(projection.evidenceSummary.rejected).toMatchObject({
      invalidEvaluations: 2,
      missingSourceReferences: 1,
      malformedEntries: 1,
    });
  });

  it('supports rubric evaluation events and immutable parent carry-forward', () => {
    const learningEvent = event(
      'explanationSubmitted',
      { promptId: 'explain-3', response: 'raw response' },
      1,
    );
    const evaluationEvent = event(
      'evidenceEvaluated',
      {
        evidenceId: 'evidence-3',
        rubricVersion: 'knowledge-rubric-v2',
        verdict: 'passed',
        targetEventId: learningEvent.id,
        knowledgeEvaluation: evaluation({
          verifiedClaims: [
            {
              text: 'A verified snapshot is immutable and can be inherited by the next learning cycle.',
            },
          ],
          openQuestions: [{ question: 'How should the next context record its parent snapshot?' }],
        }),
      },
      2,
      'system',
    );
    const first = projectKnowledgeSnapshot({ events: [learningEvent, evaluationEvent] });
    const parent: KnowledgeSnapshotRecord = {
      id: `ksn_${'5'.repeat(32)}`,
      ownerId: OWNER_ID,
      sessionId: `lsn_${'6'.repeat(32)}`,
      scopeKind: 'session',
      scopeId: `lsn_${'6'.repeat(32)}`,
      revision: 1,
      sourceManifestSha256: '7'.repeat(64),
      createdAt: new Date(NOW),
      ...first,
    };
    expect(
      projectKnowledgeSnapshot({ events: [], parentSnapshot: parent }).eligibleForPersistence,
    ).toBe(false);
    const questionId = first.unresolvedItems[0]?.id;
    expect(questionId).toBeTruthy();

    const secondLearningEvent = event(
      'transferTaskCompleted',
      { taskId: 'transfer-4', outcome: 'raw transfer outcome' },
      3,
    );
    const secondEvaluationEvent = event(
      'feedbackReceived',
      {
        targetEventId: secondLearningEvent.id,
        score: 0.97,
        summary: JSON.stringify(
          evaluation({
            resolvedQuestionIds: [questionId],
            transferOutcomes: [
              {
                text: 'Recorded the parent snapshot identity in the next context manifest.',
                sourceReferences: [
                  {
                    referenceId: 'artifact-4',
                    kind: 'artifact',
                    locator: 'artifacts/context-manifest.json',
                  },
                ],
              },
            ],
          }),
        ),
      },
      4,
      'system',
    );
    const second = projectKnowledgeSnapshot({
      events: [secondLearningEvent, secondEvaluationEvent],
      parentSnapshot: parent,
    });

    expect(second.verifiedKnowledge).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          text: 'A verified snapshot is immutable and can be inherited by the next learning cycle.',
        }),
        expect.objectContaining({
          text: 'Recorded the parent snapshot identity in the next context manifest.',
        }),
      ]),
    );
    expect(second.unresolvedItems).toEqual([]);
    expect(second.evidenceSummary.parentSnapshotId).toBe(parent.id);
  });
});
