import { describe, expect, it } from 'vitest';

import { assessOutlineEvidenceIntegrity } from '@/lib/generation/evidence-quality';
import { convergeOutlineEvidence } from '@/lib/generation/outline-evidence-convergence';
import { makeHighQualityOutlines } from './course-quality-fixtures';

const sourceContext = [
  '- [S1] [Architecture specification](https://example.test/spec): request boundaries, module ownership, and state-transition rules.',
  '- [S2] [Evaluation paper](https://example.test/paper): measured results, limitations, and competing implementation evidence.',
  '- [S3] [Operations guide](https://example.test/ops): failure signals, recovery procedure, and acceptance checks.',
  '- [S4] [Reference implementation](https://example.test/code): data flow, implementation choices, and inspectable verification artifacts.',
].join('\n');

describe('outline evidence convergence', () => {
  it('makes every claim traceable, uses the complete frozen set, and cites the final transfer', () => {
    const outlines = makeHighQualityOutlines();
    const before = assessOutlineEvidenceIntegrity(sourceContext, outlines);
    const convergence = convergeOutlineEvidence(sourceContext, outlines);
    const after = assessOutlineEvidenceIntegrity(sourceContext, convergence.outlines);

    expect(before.passed).toBe(false);
    expect(convergence.changed).toBe(true);
    expect(convergence.availableLabels).toEqual(['S1', 'S2', 'S3', 'S4']);
    expect(convergence.usedLabels).toEqual(['S1', 'S2', 'S3', 'S4']);
    expect(after.passed, JSON.stringify(after, null, 2)).toBe(true);
    expect(after.metrics.citationCoverage).toBe(1);
    expect(after.metrics.claimTraceability).toBe(1);
    expect(after.metrics.sourceUtilization).toBe(1);
    expect(after.metrics.finalTraceable).toBe(true);
  });

  it('removes invented labels while preserving and balancing valid evidence', () => {
    const outlines = makeHighQualityOutlines();
    outlines[0] = {
      ...outlines[0],
      description: `${outlines[0].description} [S99]`,
      keyPoints: outlines[0].keyPoints.map((point) => `${point} [S99]`),
    };

    const convergence = convergeOutlineEvidence(sourceContext, outlines);
    const serialized = JSON.stringify(convergence.outlines);
    const assessment = assessOutlineEvidenceIntegrity(sourceContext, convergence.outlines);

    expect(serialized).not.toContain('[S99]');
    expect(assessment.passed, JSON.stringify(assessment, null, 2)).toBe(true);
  });

  it('prefers the semantically closest frozen finding for each unlabeled claim', () => {
    const outlines = makeHighQualityOutlines();
    const stateScene = outlines[2];
    const convergence = convergeOutlineEvidence(sourceContext, [stateScene]);
    const serialized = JSON.stringify(convergence.outlines[0]);

    expect(serialized).toContain('[S1]');
  });

  it('does nothing when the source set has no frozen labels', () => {
    const outlines = makeHighQualityOutlines();
    const convergence = convergeOutlineEvidence('plain source text without labels', outlines);

    expect(convergence.changed).toBe(false);
    expect(convergence.outlines).toEqual(outlines);
  });
});
