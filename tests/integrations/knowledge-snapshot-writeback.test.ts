import { describe, expect, it } from 'vitest';
import { LEARNING_PROTOCOL_VERSION } from '@openmaic/learning-protocol';
import { renderLearningCompanion } from '@/lib/learning/domain/learning-companion';
import { KNOWLEDGE_EVALUATION_SCHEMA } from '@/lib/learning/domain/knowledge-snapshot';
import type { StoredLearningEvent } from '@/lib/learning/domain/learning-progress';
import { renderLearningSummary } from '@/lib/learning/domain/learning-summary';

const RAW_ANSWER = 'RAW LEARNER ANSWER MUST REMAIN PRIVATE AND UNVERIFIED';
const VERIFIED_CLAIM =
  'A companion note may project verified knowledge but must never become canonical source material.';

function events(): StoredLearningEvent[] {
  const learningEvent = {
    protocolVersion: LEARNING_PROTOCOL_VERSION,
    schemaVersion: 'learning-event/1',
    id: `lev_${'1'.repeat(32)}`,
    ownerId: `own_${'2'.repeat(32)}`,
    sprintId: `spr_${'3'.repeat(32)}`,
    eventType: 'retrievalAttempted',
    clientEventId: 'writeback-recall',
    deviceId: 'web_openmaic_admin',
    occurredAt: '2026-07-28T12:00:00.000Z',
    receivedAt: '2026-07-28T12:00:00.000Z',
    serverSeq: 1,
    source: 'web',
    payload: { promptId: 'recall', response: RAW_ANSWER, score: 1 },
  } as unknown as StoredLearningEvent;
  const evaluationEvent = {
    protocolVersion: LEARNING_PROTOCOL_VERSION,
    schemaVersion: 'learning-event/1',
    id: `lev_${'4'.repeat(32)}`,
    ownerId: `own_${'2'.repeat(32)}`,
    sprintId: `spr_${'3'.repeat(32)}`,
    eventType: 'feedbackReceived',
    clientEventId: 'writeback-evaluation',
    deviceId: 'system_evaluator',
    occurredAt: '2026-07-28T12:01:00.000Z',
    receivedAt: '2026-07-28T12:01:00.000Z',
    serverSeq: 2,
    source: 'system',
    payload: {
      targetEventId: learningEvent.id,
      score: 0.96,
      summary: JSON.stringify({
        schema: KNOWLEDGE_EVALUATION_SCHEMA,
        verdict: 'passed',
        confidence: 0.97,
        sourceReferences: [
          {
            referenceId: 'V1',
            citationId: 'V1',
            sourceVersionId: `svr_${'5'.repeat(32)}`,
            locator: 'Projects/source.md',
          },
        ],
        verifiedClaims: [{ text: VERIFIED_CLAIM }],
        misconceptionCorrections: [
          {
            misconception: 'A generated companion is an original source.',
            correction: 'A generated companion is a non-canonical projection.',
          },
        ],
        openQuestions: [
          { question: 'Which system evaluator should adjudicate conflicting claims?' },
        ],
      }),
    },
  } as unknown as StoredLearningEvent;
  return [learningEvent, evaluationEvent];
}

const classroom = {
  id: 'course_knowledge',
  stage: { id: 'course_knowledge', name: 'Knowledge firewall' },
  scenes: [{ id: 'scene_1', title: 'Context boundary', order: 1, type: 'slide' }],
  createdAt: '2026-07-28T11:00:00.000Z',
};

const sprint = {
  id: `spr_${'3'.repeat(32)}`,
  ownerId: `own_${'2'.repeat(32)}`,
  classroomId: 'course_knowledge',
  goal: 'Keep verified knowledge separate from canonical sources.',
  status: 'active' as const,
  createdAt: new Date('2026-07-28T11:00:00.000Z'),
  updatedAt: new Date('2026-07-28T12:01:00.000Z'),
};

describe('knowledge snapshot writeback projections', () => {
  it('renders verified content in the companion without leaking the learner answer', () => {
    const result = renderLearningCompanion({
      companionId: `cmp_${'6'.repeat(32)}`,
      sourceId: `sou_${'7'.repeat(32)}`,
      originalRelativePath: 'Projects/source.md',
      classroom,
      sprint,
      progress: { quizSummaries: [] },
      events: events(),
      now: new Date('2026-07-28T12:02:00.000Z'),
    });

    expect(result.content).toContain('## 已验证主张');
    expect(result.content).toContain(VERIFIED_CLAIM);
    expect(result.content).toContain('## 误区与修正');
    expect(result.content).toContain('## 开放问题');
    expect(result.content).not.toContain(RAW_ANSWER);
  });

  it('renders the same verified content in the learning record without free-answer leakage', () => {
    const result = renderLearningSummary({
      classroom,
      sprint,
      progress: { quizSummaries: [] },
      events: events(),
      now: new Date('2026-07-28T12:02:00.000Z'),
    });

    expect(result.content).toContain('## 已验证知识快照');
    expect(result.content).toContain(VERIFIED_CLAIM);
    expect(result.content).toContain('这里只呈现通过系统评估且具有追溯信息的知识');
    expect(result.content).not.toContain(RAW_ANSWER);
  });
});
