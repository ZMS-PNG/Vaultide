import { describe, expect, it } from 'vitest';

import { stabilizeGeneratedSceneActions } from '@/lib/generation/action-quality-convergence';
import {
  buildDeterministicQuizContent,
  buildDeterministicSlideContent,
} from '@/lib/generation/content-quality-convergence';
import { buildDeterministicDiagram } from '@/lib/generation/deterministic-diagram';
import { convergeOutlineEvidence } from '@/lib/generation/outline-evidence-convergence';
import { stabilizeGeneratedQuizAssessment } from '@/lib/generation/quiz-assessment-repair';
import type { SceneOutline } from '@/lib/types/generation';

function legacyOutline(type: SceneOutline['type']): SceneOutline {
  return {
    id: `legacy-${type}`,
    order: 1,
    type,
    title: 'Legacy recovered outline',
    description: 'Explain the mechanism, verify the result, and identify a failure boundary.',
    // Older persisted/model responses can omit this field at runtime even
    // though the current TypeScript contract requires it.
  } as SceneOutline;
}

describe('missing outline field resilience', () => {
  it('renders deterministic slide, quiz, and diagram fallbacks without keyPoints', () => {
    const slide = legacyOutline('slide');
    const quiz = legacyOutline('quiz');
    const diagram = legacyOutline('interactive');

    expect(buildDeterministicSlideContent(slide).elements.length).toBeGreaterThan(4);
    expect(buildDeterministicQuizContent(quiz).questions.length).toBeGreaterThan(2);
    expect(buildDeterministicDiagram(diagram).widgetConfig.nodes.length).toBeGreaterThan(1);
  });

  it('repairs actions, quiz assessment, and evidence without keyPoints', () => {
    const slide = legacyOutline('slide');
    const slideContent = buildDeterministicSlideContent(slide);
    const actions = stabilizeGeneratedSceneActions(slide, slideContent, []);
    expect(actions.length).toBeGreaterThanOrEqual(5);

    const quiz = legacyOutline('quiz');
    const questions = stabilizeGeneratedQuizAssessment(quiz, [
      {
        id: 'q1',
        type: 'single',
        question: 'Which result is verifiable?',
        options: [
          { value: 'A', label: 'An observable result' },
          { value: 'B', label: 'An unsupported guess' },
        ],
        answer: ['A'],
        hasAnswer: true,
        analysis: 'The observable result can be checked against the stated mechanism and evidence.',
        points: 10,
      },
      {
        id: 'q2',
        type: 'single',
        question: 'Which boundary should be tested?',
        options: [
          { value: 'A', label: 'A concrete failure condition' },
          { value: 'B', label: 'No boundary' },
        ],
        answer: ['A'],
        hasAnswer: true,
        analysis: 'A concrete failure condition tests whether the conclusion remains valid.',
        points: 10,
      },
    ]);
    expect(questions.some((question) => question.type === 'short_answer')).toBe(true);

    const evidence = convergeOutlineEvidence(
      '[S1] Primary evidence describing the mechanism and observable result.',
      [legacyOutline('slide')],
    );
    expect(evidence.outlines[0].description).toContain('[S1]');
  });
});
