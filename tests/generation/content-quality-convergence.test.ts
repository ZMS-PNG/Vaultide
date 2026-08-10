import { describe, expect, it } from 'vitest';

import {
  buildDeterministicQuizContent,
  buildDeterministicSlideContent,
  convergeFinalSceneTransferDelivery,
  convergeGeneratedSceneContent,
  convergeGeneratedSceneEvidence,
  convergeUnsupportedNamedEvidenceClaims,
} from '@/lib/generation/content-quality-convergence';
import { assessGeneratedSceneContent } from '@/lib/generation/course-quality';
import { assessSceneEvidenceIntegrity } from '@/lib/generation/evidence-quality';
import type { GeneratedPBLContent, SceneOutline } from '@/lib/types/generation';

function outline(type: SceneOutline['type']): SceneOutline {
  return {
    id: `first-pass-${type}`,
    type,
    title: '库存并发控制 [S1]',
    description: '理解条件更新如何防止并发超卖，并用状态与测试证据验证事务边界。[S1]',
    keyPoints: [
      '条件更新必须同时检查剩余容量 [S1]',
      '事务状态决定提交或整体回滚 [S2]',
      '失败边界要用并发测试和日志验证 [S2]',
    ],
    order: 4,
    ...(type === 'interactive'
      ? {
          widgetType: 'simulation' as const,
          widgetOutline: { concept: '并发库存状态' },
        }
      : {}),
  };
}

describe('first-pass content quality convergence', () => {
  it('builds a complete, grounded, renderer-ready slide without another model call', () => {
    const currentOutline = outline('slide');
    const content = buildDeterministicSlideContent(currentOutline, '请使用简体中文');
    const quality = assessGeneratedSceneContent(currentOutline, content);

    expect(content.elements).toHaveLength(8);
    expect(new Set(content.elements.map((element) => element.id)).size).toBe(8);
    expect(JSON.stringify(content)).toContain('[S1]');
    expect(JSON.stringify(content)).toContain('[S2]');
    expect(quality.passed).toBe(true);
    expect(quality.score).toBeGreaterThanOrEqual(90);
  });

  it('uses a different learner task frame for procedure, recovery, and transfer slides', () => {
    const base = outline('slide');
    const activity = (kind: 'worked-example' | 'limits' | 'synthesis-transfer') => ({
      schemaVersion: 3 as const,
      kind,
      slotId: `slot_${kind}`,
      conceptIds: ['concept:s1'],
      evidenceLabels: ['S1'],
      learnerAction: 'Create a source-backed learner-visible result.',
      observableOutcome: 'A checkable learner result is recorded.',
      artifactRequired: kind === 'synthesis-transfer',
      ...(kind === 'synthesis-transfer'
        ? {
            artifact: {
              artifactType: 'implementation-plan',
              destination: 'both',
              requiredSections: ['Problem framing', 'Architecture or workflow', 'First executable step'],
              verificationMethod: 'Show a source-backed verification result and a recovery action.',
            },
          }
        : {}),
    });
    const procedure = buildDeterministicSlideContent({ ...base, activity: activity('worked-example') }, 'English');
    const recovery = buildDeterministicSlideContent({ ...base, activity: activity('limits') }, 'English');
    const transfer = buildDeterministicSlideContent({ ...base, activity: activity('synthesis-transfer') }, 'English');

    expect(JSON.stringify(procedure)).toContain('步骤走读');
    expect(JSON.stringify(recovery)).toContain('恢复演练');
    expect(JSON.stringify(transfer)).toContain('迁移简报');
    const layout = (content: ReturnType<typeof buildDeterministicSlideContent>) =>
      content.elements
        .map((element) => [element.left, element.top, element.width, element.height].join(':'))
        .join('|');
    expect(new Set([layout(procedure), layout(recovery), layout(transfer)]).size).toBe(3);
    expect(assessGeneratedSceneContent({ ...base, activity: activity('worked-example') }, procedure).passed).toBe(true);
    expect(assessGeneratedSceneContent({ ...base, activity: activity('limits') }, recovery).passed).toBe(true);
    expect(assessGeneratedSceneContent({ ...base, activity: activity('synthesis-transfer') }, transfer).passed).toBe(true);
  });

  it('builds varied recall, application, diagnosis, and transfer questions', () => {
    const currentOutline = outline('quiz');
    const content = buildDeterministicQuizContent(currentOutline, '请使用简体中文');
    const quality = assessGeneratedSceneContent(currentOutline, content);

    expect(content.questions).toHaveLength(4);
    expect(new Set(content.questions.map((question) => question.type)).size).toBeGreaterThanOrEqual(
      2,
    );
    expect(content.questions.at(-1)?.type).toBe('short_answer');
    expect(quality.passed).toBe(true);
    expect(quality.score).toBeGreaterThanOrEqual(90);
  });

  it('replaces a failed non-diagram interactive response with a working concept explorer', () => {
    const currentOutline = outline('interactive');
    const content = convergeGeneratedSceneContent(currentOutline, null, '请使用简体中文');
    const quality = assessGeneratedSceneContent(currentOutline, content);

    expect('html' in content && content.html).toContain('vaultide-learning-status');
    expect('widgetType' in content && content.widgetType).toBe('diagram');
    expect(quality.passed).toBe(true);
    expect(quality.score).toBeGreaterThanOrEqual(90);
  });

  it('restores dropped approved evidence labels without another model call', () => {
    const currentOutline = outline('slide');
    const sourceContext = [
      '[S1] Primary specification for conditional inventory updates and remaining capacity.',
      '[S2] Controlled concurrency evaluation covering rollback and failure logs.',
    ].join('\n');
    const original = buildDeterministicSlideContent(currentOutline, '请使用简体中文');
    const dropped = {
      ...original,
      elements: original.elements.map((element) =>
        element.type === 'text'
          ? {
              ...element,
              content: element.content.replace(/\s*\[S2\]/gu, ''),
            }
          : { ...element },
      ),
    };

    expect(assessSceneEvidenceIntegrity(sourceContext, currentOutline, dropped).passed).toBe(
      false,
    );

    const converged = convergeGeneratedSceneEvidence(
      currentOutline,
      dropped,
      '请使用简体中文',
    );
    const evidence = assessSceneEvidenceIntegrity(sourceContext, currentOutline, converged);
    const quality = assessGeneratedSceneContent(currentOutline, converged);

    expect(evidence.passed, JSON.stringify(evidence, null, 2)).toBe(true);
    expect(JSON.stringify(converged)).toContain('[S2]');
    expect(quality.passed, JSON.stringify(quality, null, 2)).toBe(true);
  });

  it('ignores citation labels that exist only in non-visible metadata', () => {
    const currentOutline = outline('slide');
    const sourceContext = [
      '[S1] Primary specification for conditional inventory updates and remaining capacity.',
      '[S2] Controlled concurrency evaluation covering rollback and failure logs.',
    ].join('\n');
    const original = buildDeterministicSlideContent(currentOutline, '请使用简体中文');
    const hiddenOnly = {
      ...original,
      elements: original.elements.map((element) =>
        element.type === 'text'
          ? {
              ...element,
              content: element.content.replace(/\s*\[S2\]/gu, ''),
            }
          : { ...element },
      ),
      internalMetadata:
        'This hidden diagnostic field contains enough surrounding text to look contextualized [S2] but is not learner-visible.',
    };

    expect(
      assessSceneEvidenceIntegrity(sourceContext, currentOutline, hiddenOnly).passed,
    ).toBe(false);

    const converged = convergeGeneratedSceneEvidence(
      currentOutline,
      hiddenOnly,
      '请使用简体中文',
    );
    const evidence = assessSceneEvidenceIntegrity(sourceContext, currentOutline, converged);

    expect(evidence.passed, JSON.stringify(evidence, null, 2)).toBe(true);
  });

  it('makes the final synthesis, transfer, and observable artifact visible on the first pass', () => {
    const currentOutline: SceneOutline = {
      ...outline('slide'),
      order: 11,
      title: 'Course close',
      description: 'Review the lesson.',
      keyPoints: ['Mechanism recap', 'Source evidence', 'Operating boundary'],
    };
    const original = buildDeterministicSlideContent(currentOutline, 'English');
    const stripped = {
      ...original,
      elements: original.elements.map((element) =>
        element.type === 'text'
          ? { ...element, content: element.content.replace(/transfer|new project|artifact/giu, '') }
          : { ...element },
      ),
    };

    const converged = convergeFinalSceneTransferDelivery(currentOutline, stripped, 'English');
    const serialized = JSON.stringify(converged);

    expect(serialized).toContain('Synthesis, transfer, and completion evidence');
    expect(serialized).toContain('new project');
    expect(serialized).toContain('acceptance criteria');
    expect(serialized).not.toContain('internal_quality_repair');
  });

  it('does not allow a generic study note to replace the V3 final artifact contract', () => {
    const currentOutline: SceneOutline = {
      ...outline('slide'),
      order: 12,
      title: 'Final transfer',
      description: 'Transfer the repository evidence into a delivery-ready implementation plan [S1].',
      keyPoints: ['Map the evidence [S1]', 'Choose the operating boundary [S2]', 'Publish a reviewed plan [S2]'],
      activity: {
        schemaVersion: 3,
        slotId: 'slot_12_synthesis-transfer',
        kind: 'synthesis-transfer',
        conceptIds: ['concept:source'],
        evidenceLabels: ['S1', 'S2'],
        learnerAction: 'Create an implementation plan for a new repository integration.',
        observableOutcome: 'A reviewable implementation plan is available for Obsidian writeback.',
        artifactRequired: true,
        artifact: {
          artifactType: 'implementation-plan',
          requiredSections: ['Problem framing', 'Architecture or workflow', 'First executable step'],
          verificationMethod: 'Review the plan against the evidence map.',
          destination: 'both',
        },
      },
    };
    const original = buildDeterministicSlideContent(currentOutline, 'English');
    const genericFinal = {
      ...original,
      elements: original.elements.map((element) =>
        element.type === 'text'
          ? {
              ...element,
              content: `${element.content}<p>Synthesis transfer artifact: submit a study-note with acceptance criteria.</p>`,
            }
          : { ...element },
      ),
    };

    const converged = convergeFinalSceneTransferDelivery(currentOutline, genericFinal, 'English');
    const serialized = JSON.stringify(converged);

    expect(serialized).toContain('implementation-plan');
    expect(serialized).toContain('Problem framing');
    expect(serialized).toContain('Architecture or workflow');
    expect(serialized).toContain('First executable step');
    expect(serialized).toContain('Review the plan against the evidence map.');
    expect(serialized).toContain('Destination: both.');
    expect(serialized).not.toContain('study-note');
  });

  it('converges unsupported cited named claims without a second provider pass', () => {
    const currentOutline = outline('slide');
    const modelContent = buildDeterministicSlideContent(currentOutline, 'English');
    const unsafe = {
      ...modelContent,
      elements: modelContent.elements.map((element) =>
        element.type === 'text'
          ? {
              ...element,
              content: `${element.content}<p>GPT-4o guarantees GDPR compliance through convert_stream() [S1].</p>`,
            }
          : { ...element },
      ),
    };
    const converged = convergeUnsupportedNamedEvidenceClaims(
      currentOutline,
      unsafe,
      '- [S1] Primary documentation: the input contract and observed result.\n- [S2] Research: the limitation and verification boundary.',
      'English',
    );
    const serialized = JSON.stringify(converged);

    expect(serialized).not.toContain('GPT-4o');
    expect(serialized).not.toContain('GDPR');
    expect(serialized).toContain(currentOutline.keyPoints[0]);
  });

  it('accepts explicitly marked learner design proposals without treating them as source facts', () => {
    const currentOutline: SceneOutline = {
      ...outline('slide'),
      title: 'Appointment workflow design',
      description:
        'The source describes a framework for multi-agent applications [S1].\n\nDesign proposal (verify independently; not a source fact): assign a Coordinator and CalendarAPI to a hypothetical appointment workflow.',
      keyPoints: [
        'Design proposal (verify independently; not a source fact): Coordinator routes a booking intent.',
        'Design proposal (verify independently; not a source fact): CalendarAPI exposes only minimum permissions.',
        'Design proposal (verify independently; not a source fact): AuditLogger records the decision trail.',
      ],
    };
    const content = buildDeterministicSlideContent(currentOutline, 'English');
    const evidence = assessSceneEvidenceIntegrity(
      '[S1] Primary documentation: a framework for multi-agent applications.',
      currentOutline,
      content,
    );

    expect(evidence.passed, JSON.stringify(evidence, null, 2)).toBe(true);
  });

  it('preserves a typed PBL payload instead of replacing it with an incompatible widget', () => {
    const currentOutline = outline('pbl');
    const project = {
      projectConfig: {
        brief: 'Validate a GPT-4o integration decision [S1].',
      },
    } as unknown as GeneratedPBLContent;

    const converged = convergeUnsupportedNamedEvidenceClaims(
      currentOutline,
      project,
      '[S1] Primary inventory specification only.',
      'English',
    );

    expect(converged).toBe(project);
    expect('projectConfig' in converged).toBe(true);
  });
});
