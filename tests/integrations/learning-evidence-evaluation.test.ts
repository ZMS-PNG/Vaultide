import { describe, expect, it } from 'vitest';
import {
  LEARNING_EVIDENCE_RUBRIC_VERSION,
  satisfiesDeterministicFinalTransferContract,
  stabilizeBorderlineFinalTransfer,
  type LearningEvidenceEvaluation,
  type LearningEvidenceEvaluationInput,
} from '@/lib/learning/application/learning-evidence-evaluation';
import { KNOWLEDGE_EVALUATION_SCHEMA } from '@/lib/learning/domain/knowledge-snapshot';

const source = {
  excerpt:
    'A controlled deployment must preserve source integrity, use server-verified evidence, and bind writeback to a paired device. The verification checklist records both the evidence result and remaining corrective work.',
  score: 12,
};

function input(): LearningEvidenceEvaluationInput {
  return {
    classroom: {
      id: 'cls_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      stage: {
        id: 'cls_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        name: 'Deployment integrity',
      },
      scenes: [{ id: 'scene-final', title: 'Final transfer', order: 1 }],
    },
    sprint: {
      id: 'spr_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      classroomId: 'cls_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      goal: 'Apply the integrity and paired-device writeback mechanism to a new deployment.',
    },
    event: {
      id: 'lev_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      ownerId: 'own_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      sprintId: 'spr_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      deviceId: 'web_openmaic_admin',
      source: 'web',
      schemaVersion: 1,
      protocolVersion: '1.0',
      eventType: 'transferTaskCompleted',
      clientEventId: 'transfer-final',
      occurredAt: '2026-08-03T00:00:00.000Z',
      payload: {
        taskId: 'scene-final',
        sceneId: 'scene-final',
        outcome:
          'New situation: validate a second deployment region. I apply the integrity-round-trip and paired-device writeback mechanism by producing a JSON release checklist as the learner artifact. The checklist records source hashes, server-verified evidence, and the device identifier. I verify the result by comparing source hashes before and after upload and checking the evidence record. A remaining limitation is that the checklist does not prove the external search provider is reliable, so I record that correction before release.',
      },
    },
    canonicalSources: [
      {
        reference: { referenceId: 'S1', kind: 'canonical-source' },
        text: source.excerpt,
      },
    ],
  } as unknown as LearningEvidenceEvaluationInput;
}

function borderlineRevise(): LearningEvidenceEvaluation {
  return {
    verdict: 'revise',
    score: 0.7,
    confidence: 0.72,
    rubricVersion: LEARNING_EVIDENCE_RUBRIC_VERSION,
    knowledgeEvaluation: {
      schema: KNOWLEDGE_EVALUATION_SCHEMA,
      verdict: 'revise',
      confidence: 0.72,
      sourceReferences: [{ referenceId: 'S1', kind: 'canonical-source' }],
    },
  };
}

describe('final-transfer stability contract', () => {
  it('promotes only a complete, source-grounded borderline final transfer', () => {
    const fixture = input();
    const response = String((fixture.event.payload as { outcome: string }).outcome);
    expect(satisfiesDeterministicFinalTransferContract(fixture, response, [source])).toBe(true);

    const result = stabilizeBorderlineFinalTransfer(fixture, response, [source], borderlineRevise());
    expect(result).toMatchObject({
      verdict: 'passed',
      deterministicContractSatisfied: true,
    });
    expect(result.score).toBeGreaterThanOrEqual(0.85);
    expect(result.knowledgeEvaluation.transferOutcomes).toHaveLength(1);
  });

  it('does not promote a response that omits a required observable boundary', () => {
    const fixture = input();
    const response = String((fixture.event.payload as { outcome: string }).outcome).replace(
      ' A remaining limitation is that the checklist does not prove the external search provider is reliable, so I record that correction before release.',
      '',
    );
    expect(satisfiesDeterministicFinalTransferContract(fixture, response, [source])).toBe(false);
    expect(stabilizeBorderlineFinalTransfer(fixture, response, [source], borderlineRevise()).verdict).toBe(
      'revise',
    );
  });
});
