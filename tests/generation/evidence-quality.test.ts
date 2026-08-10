import { describe, expect, it } from 'vitest';
import {
  assessOutlineEvidenceIntegrity,
  assessSceneEvidenceIntegrity,
  combineQualityAssessments,
} from '@/lib/generation/evidence-quality';
import type { SceneOutline } from '@/lib/types/generation';

function outline(
  order: number,
  options: { citation?: string; citeEveryClaim?: boolean } = {},
): SceneOutline {
  const citation = options.citation ?? '';
  const claimCitation = options.citeEveryClaim ? citation : '';
  return {
    id: `outline-${order}`,
    type: 'slide',
    title: `Distinct mechanism ${order}`,
    description: `Explain mechanism ${order}, its observed result, limitation, and learner decision. ${citation}`,
    keyPoints: [
      `Input contract and evidence boundary ${order} ${claimCitation}`,
      `State transition and measured result ${order} ${claimCitation}`,
      `Failure condition and transfer decision ${order} ${claimCitation}`,
    ],
    order,
  };
}

const sourceContext = [
  '- [S1] [Primary documentation](https://example.test/docs): authoritative mechanism details.',
  '- [S2] [Research paper](https://example.test/paper): evaluated results and limitations.',
  '- [S3] [Specification](https://example.test/spec): normative boundary conditions.',
  '- [S4] [Reference implementation](https://example.test/code): inspectable implementation evidence.',
].join('\n');

function externallyGroundedOutlines(citedCount: number): SceneOutline[] {
  const citedIndexes = new Set([
    ...Array.from({ length: Math.max(0, citedCount - 1) }, (_, index) => index),
    ...(citedCount > 0 ? [9] : []),
  ]);
  return Array.from({ length: 10 }, (_, index) => {
    const citation = citedIndexes.has(index) ? `[S${(index % 4) + 1}]` : '';
    return outline(index + 1, { citation, citeEveryClaim: Boolean(citation) });
  });
}

describe('evidence quality contract', () => {
  it('accepts only high citation coverage, claim traceability, source use, and a cited final synthesis', () => {
    const result = assessOutlineEvidenceIntegrity(sourceContext, externallyGroundedOutlines(8));

    expect(result.passed, JSON.stringify(result, null, 2)).toBe(true);
    expect(result.metrics.citationCoverage).toBe(0.8);
    expect(result.metrics.claimTraceability).toBe(0.8);
    expect(result.dimensions?.grounding).toBeGreaterThanOrEqual(95);
    expect(result.dimensions?.accuracy).toBeGreaterThanOrEqual(95);
  });

  it('rejects the old low-coverage standard even when every used label is valid', () => {
    const result = assessOutlineEvidenceIntegrity(sourceContext, externallyGroundedOutlines(7));

    expect(result.passed).toBe(false);
    expect(result.issues.map((entry) => entry.code)).toContain('evidence_outline_coverage');
  });

  it('rejects scene-level citations that do not trace critical claims', () => {
    const outlines = Array.from({ length: 10 }, (_, index) => {
      const citation = index < 7 || index === 9 ? `[S${(index % 4) + 1}]` : '';
      return outline(index + 1, {
        citation,
        citeEveryClaim: false,
      });
    });
    const result = assessOutlineEvidenceIntegrity(sourceContext, outlines);

    expect(result.passed).toBe(false);
    expect(result.metrics.citationCoverage).toBe(0.8);
    expect(result.issues.map((entry) => entry.code)).toContain('evidence_claim_traceability');
  });

  it('rejects invented labels in the outline', () => {
    const outlines = externallyGroundedOutlines(8);
    outlines[0] = outline(1, { citation: '[S99]', citeEveryClaim: true });
    const result = assessOutlineEvidenceIntegrity(sourceContext, outlines);

    expect(result.passed).toBe(false);
    expect(result.issues.map((entry) => entry.code)).toContain('evidence_unknown_citation');
  });

  it('requires every approved label to survive next to learner-visible claim text', () => {
    const citedOutline = outline(1, {
      citation: '[S1] [S2]',
      citeEveryClaim: true,
    });
    const dropped = assessSceneEvidenceIntegrity(sourceContext, citedOutline, {
      elements: [
        {
          id: 'body',
          type: 'text',
          content:
            'The mechanism changes the state transition and produces observable evidence [S1].',
        },
      ],
    });
    const naked = assessSceneEvidenceIntegrity(sourceContext, citedOutline, {
      elements: [{ id: 'body', type: 'text', content: '[S1] [S2]' }],
    });
    const preserved = assessSceneEvidenceIntegrity(sourceContext, citedOutline, {
      elements: [
        {
          id: 'body-a',
          type: 'text',
          content:
            'The normative input contract and state transition are defined by the primary specification [S1].',
        },
        {
          id: 'body-b',
          type: 'text',
          content:
            'The evaluated result and limitation are supported by the controlled research evidence [S2].',
        },
      ],
    });

    expect(dropped.passed).toBe(false);
    expect(dropped.issues.map((entry) => entry.code)).toContain('evidence_scene_citation_dropped');
    expect(naked.passed).toBe(false);
    expect(naked.issues.map((entry) => entry.code)).toContain(
      'evidence_scene_citation_uncontextualized',
    );
    expect(preserved.passed, JSON.stringify(preserved, null, 2)).toBe(true);
    expect(preserved.score).toBe(100);
  });

  it('rejects a cited product, regulation, or API that is absent from frozen evidence', () => {
    const citedOutline = outline(1, { citation: '[S1]', citeEveryClaim: true });
    const result = assessSceneEvidenceIntegrity(sourceContext, citedOutline, {
      elements: [
        {
          id: 'body',
          type: 'text',
          content:
            'GPT-4o guarantees GDPR-compliant processing through convert_stream() [S1]. The primary specification defines the input contract and observed boundary [S1].',
        },
      ],
    });

    expect(result.passed).toBe(false);
    expect(result.issues.map((entry) => entry.code)).toContain(
      'evidence_scene_unsupported_named_claim',
    );
    expect(result.metrics.unsupportedNamedClaimCount).toBeGreaterThan(0);
  });

  it('combines structural and evidence gates fail-closed', () => {
    const notApplicable = assessSceneEvidenceIntegrity(undefined, outline(1), {});
    const failed = assessSceneEvidenceIntegrity(
      sourceContext,
      outline(1, { citation: '[S1]', citeEveryClaim: true }),
      {},
    );
    const combined = combineQualityAssessments(notApplicable, failed);

    expect(combined.passed).toBe(false);
    expect(combined.score).toBeCloseTo(failed.score, 1);
  });
});
