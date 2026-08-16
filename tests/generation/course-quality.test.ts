import { describe, expect, it } from 'vitest';
import {
  assessCompleteScene,
  assessCourseQuality,
  assessCourseSceneScoreContract,
  assessFinalSceneArtifactContract,
  assessGeneratedSceneContent,
  assessOutlineQuality,
  assessSourceReadiness,
  shouldEnforceCourseQuality,
} from '@/lib/generation/course-quality';
import { makeHighQualityOutlines, makeHighQualityScenes } from './course-quality-fixtures';

describe('course quality contract', () => {
  it('accepts a complete high-quality learning arc without granting quality by default', () => {
    const outlines = makeHighQualityOutlines();
    const scenes = makeHighQualityScenes(outlines);
    const outlineResult = assessOutlineQuality(outlines);
    const courseResult = assessCourseQuality(outlines, scenes);

    expect(outlineResult.passed, JSON.stringify(outlineResult, null, 2)).toBe(true);
    expect(courseResult.passed, JSON.stringify(courseResult, null, 2)).toBe(true);
    expect(courseResult.metrics.averageSceneScore).toBeGreaterThanOrEqual(93);
    expect(courseResult.metrics.minimumSceneScore).toBeGreaterThanOrEqual(90);
  });

  it('rejects short, generic, assessment-free outlines', () => {
    const result = assessOutlineQuality([
      {
        id: 'one',
        order: 1,
        type: 'slide',
        title: 'Scene 1',
        description: 'Short description.',
        keyPoints: ['Concept'],
      },
      {
        id: 'two',
        order: 2,
        type: 'slide',
        title: 'Scene 2',
        description: 'Another short description.',
        keyPoints: ['Content'],
      },
    ]);
    expect(result.passed).toBe(false);
    expect(result.issues.map((entry) => entry.code)).toEqual(
      expect.arrayContaining([
        'outline_count',
        'outline_no_retrieval',
        'outline_filler_scene',
        'outline_final_transfer_missing',
      ]),
    );
  });

  it('rejects a complete-length outline when the final synthesis does not transfer', () => {
    const outlines = makeHighQualityOutlines();
    outlines[outlines.length - 1] = {
      ...outlines[outlines.length - 1],
      title: 'Course recap',
      description:
        'Summarize the terms already shown in the course and repeat the preceding points without asking the learner to apply or verify them.',
      keyPoints: [
        'Recap of the architecture vocabulary',
        'Review of the mechanism vocabulary',
        'Summary of previously listed limitations',
      ],
    };
    const result = assessOutlineQuality(outlines);

    expect(result.passed).toBe(false);
    expect(result.issues.map((entry) => entry.code)).toContain('outline_final_transfer_missing');
  });

  it('rejects visibly shallow slide content', () => {
    const current = makeHighQualityOutlines()[1];
    const result = assessGeneratedSceneContent(current, {
      elements: [{ id: 'only', type: 'text', content: '<p>Architecture</p>' }],
    });
    expect(result.passed).toBe(false);
    expect(result.issues.map((entry) => entry.code)).toContain('scene_slide_depth');
  });

  it('counts visible table rows when evaluating slide teaching depth', () => {
    const current = makeHighQualityOutlines()[1];
    const [first, second, third] = current.keyPoints;
    const result = assessGeneratedSceneContent(current, {
      elements: [
        { id: 'title', type: 'text', content: `<p>${current.title}</p>` },
        {
          id: 'evidence-table',
          type: 'table',
          data: [
            [
              {
                text: `机制与因果：${first}，因为依赖方向决定信息如何流动，因此会改变最终可观察结果。`,
              },
            ],
            [
              {
                text: `来源案例与证据：${second}，案例显示明确边界后可以验证输入、输出与责任是否一致。`,
              },
            ],
            [
              {
                text: `学习者判断：请比较两种实现，选择能满足${third}的方案，并解释选择依据与潜在风险。`,
              },
            ],
            [
              {
                text: `结论与边界：应记录决策、证据和验证结果；当信任边界变化时，必须重新检查机制而不是照搬旧方案。`,
              },
            ],
          ],
        },
        { id: 'shape-a', type: 'shape' },
        { id: 'shape-b', type: 'shape' },
        { id: 'shape-c', type: 'shape' },
        { id: 'shape-d', type: 'shape' },
        { id: 'line-a', type: 'line' },
        { id: 'line-b', type: 'line' },
      ] as never,
    });

    expect(result.metrics.textChars).toBeGreaterThanOrEqual(220);
    expect(result.metrics.substantiveTextElements).toBeGreaterThanOrEqual(3);
    expect(result.issues.map((entry) => entry.code)).not.toContain('scene_slide_depth');
  });

  it('scores threshold-level content below 100 even when no blocking issue remains', () => {
    const current = makeHighQualityOutlines()[1];
    const [first, second] = current.keyPoints;
    const result = assessGeneratedSceneContent(current, {
      elements: [
        { id: 'title', type: 'text', content: `<p>${current.title}</p>` },
        {
          id: 'body-a',
          type: 'text',
          content: `<p>${first}. This mechanism matters because it controls the dependency direction and therefore changes the observable result in the worked architecture.</p>`,
        },
        {
          id: 'body-b',
          type: 'text',
          content: `<p>${second}. For example, compare two module boundaries, decide which contract applies, and verify the evidence before implementation.</p>`,
        },
        {
          id: 'body-c',
          type: 'text',
          content:
            '<p>A practical limitation appears when the trust boundary moves; the learner should inspect the input, choose a safeguard, and record the resulting decision.</p>',
        },
        { id: 'shape', type: 'shape' },
        { id: 'line', type: 'line' },
      ] as never,
    });

    expect(result.passed, JSON.stringify(result, null, 2)).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(90);
    expect(result.score).toBeLessThan(100);
  });

  it('accepts a complete scene only when content and guided narration both pass', () => {
    const outlines = makeHighQualityOutlines();
    const scenes = makeHighQualityScenes(outlines);
    const result = assessCompleteScene(outlines[1], scenes[1]);
    expect(result.passed, JSON.stringify(result, null, 2)).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(90);
  });

  it('rejects a generic study note when the final V3 contract requires an implementation plan', () => {
    const current = {
      ...makeHighQualityOutlines().at(-1)!,
      order: 12,
      activity: {
        schemaVersion: 3 as const,
        slotId: 'slot_12_synthesis-transfer',
        kind: 'synthesis-transfer' as const,
        conceptIds: ['concept:one'],
        evidenceLabels: ['S1'],
        learnerAction: 'Create a transfer plan.',
        observableOutcome: 'A verified implementation plan is ready.',
        artifactRequired: true,
        artifact: {
          artifactType: 'implementation-plan',
          requiredSections: ['Problem framing', 'Architecture or workflow', 'First executable step'],
          verificationMethod: 'Review the plan against the evidence map.',
          destination: 'both',
        },
      },
    };
    const generic = {
      elements: [
        {
          id: 'final',
          type: 'text',
          content:
            '<p>Submit a study-note with a summary, source evidence, acceptance criteria, and a learner reflection.</p>',
        },
      ],
    };
    const exact = {
      elements: [
        {
          id: 'final',
          type: 'text',
          content:
            '<p>Submit an implementation-plan. Required sections: Problem framing; Architecture or workflow; First executable step. Verification: Review the plan against the evidence map. Destination: both.</p>',
        },
      ],
    };

    expect(assessFinalSceneArtifactContract(current, generic).passed).toBe(false);
    expect(assessFinalSceneArtifactContract(current, exact).passed).toBe(true);
  });

  it('rejects a course containing duplicate generated scenes', () => {
    const outlines = makeHighQualityOutlines();
    const scenes = makeHighQualityScenes(outlines);
    scenes[1] = {
      ...scenes[1],
      content: scenes[0].content,
      actions: scenes[0].actions,
    } as never;
    const result = assessCourseQuality(outlines, scenes);

    expect(result.passed).toBe(false);
    expect(result.issues.map((entry) => entry.code)).toContain('course_near_duplicate');
  });

  it('rejects a blank or title-only generated scene', () => {
    const outlines = makeHighQualityOutlines();
    const scenes = makeHighQualityScenes(outlines);
    scenes[2] = {
      ...scenes[2],
      content: {
        type: 'slide',
        canvas: {
          elements: [{ id: 'title', type: 'text', content: '<p>Scene 3</p>' }],
        } as never,
      },
    } as never;
    const result = assessCourseQuality(outlines, scenes);

    expect(result.passed).toBe(false);
    expect(result.issues.map((entry) => entry.code)).toEqual(
      expect.arrayContaining(['scene_slide_depth', 'course_blank_or_filler_scene']),
    );
  });

  it('enforces the exact 93 average boundary and the 90 per-scene floor', () => {
    const atBoundary = assessCourseSceneScoreContract(Array.from({ length: 9 }, () => 93));
    const belowAverage = assessCourseSceneScoreContract([
      92.99, 92.99, 92.99, 92.99, 92.99, 92.99, 92.99, 92.99, 92.99,
    ]);
    const lowSceneDespiteHighAverage = assessCourseSceneScoreContract([
      89, 94, 94, 94, 94, 94, 94, 94, 94,
    ]);

    expect(atBoundary.passed).toBe(true);
    expect(atBoundary.score).toBe(93);
    expect(belowAverage.passed).toBe(false);
    expect(belowAverage.issues.map((entry) => entry.code)).toContain('course_average_quality');
    expect(lowSceneDespiteHighAverage.passed).toBe(false);
    expect(lowSceneDespiteHighAverage.issues.map((entry) => entry.code)).toContain(
      'course_scene_quality_floor',
    );
  });

  it('fails closed when external evidence is only a thin snippet', () => {
    const result = assessSourceReadiness({
      webSearchEnabled: true,
      researchContext: '- [S1] short snippet',
    });
    expect(result.passed).toBe(false);
    expect(result.issues.map((entry) => entry.code)).toEqual(
      expect.arrayContaining(['source_external_too_shallow', 'source_citation_set_too_small']),
    );
  });

  it('accepts one complete official source body but not repository metadata as a substitute', () => {
    const completeOfficialDocument = `[S1] ${'The official repository README explains workflow triggers, permissions, verification, failure recovery, and observable acceptance evidence. '.repeat(24)}`;
    const complete = assessSourceReadiness({
      webSearchEnabled: true,
      researchContext: completeOfficialDocument,
    });
    const metadataOnly = assessSourceReadiness({
      webSearchEnabled: true,
      researchContext:
        '[S1] Repository metadata: Stars: 4855; Forks: 476; Language: Go; Updated: 2026-08-03; Default branch: main.',
    });

    expect(complete.passed).toBe(true);
    expect(complete.metrics.substantiveCitedSourceCount).toBe(1);
    expect(metadataOnly.passed).toBe(false);
    expect(metadataOnly.issues.map((entry) => entry.code)).toContain('source_external_too_shallow');
  });

  it('keeps a deep reviewed Obsidian project authoritative when web search is supplemental', () => {
    const result = assessSourceReadiness({
      webSearchEnabled: true,
      pdfText: `--- [V1] README.md ---\n${'项目架构、数据流与验收证据。'.repeat(3_000)}`,
      researchContext: '- [S1] optional short supplement',
    });

    expect(result.passed).toBe(true);
    expect(result.metrics.pdfChars).toBeGreaterThan(39_000);
    expect(result.metrics.sourceBasis).toBe('supplied-canonical-source');
    expect(result.issues.map((entry) => entry.code)).not.toContain('source_citation_set_too_small');
  });

  it('keeps the blocking course quality gate disabled during generation for OpenMAIC parity', () => {
    // Vaultide parity decision: blocking quality gates are disabled so a
    // course generates like official OpenMAIC. Assessment is still computed
    // and persisted as evidence, but it no longer rejects the result.
    expect(shouldEnforceCourseQuality(undefined, 'test')).toBe(false);
    expect(shouldEnforceCourseQuality(true, 'test')).toBe(false);
    expect(shouldEnforceCourseQuality(false, 'production')).toBe(false);
  });
});
