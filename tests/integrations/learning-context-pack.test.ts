import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  compileLearningContextPack,
  isManagedVaultideLearningPath,
} from '@/lib/learning/domain/learning-context-pack';

describe('Vaultide canonical context firewall', () => {
  it('allows only an explicitly pending external research run to start without evidence', () => {
    const pack = compileLearningContextPack({
      sourceMode: 'external',
      goal: 'Research a current public project from authoritative sources.',
      allowPendingExternalResearch: true,
    });

    expect(pack.sourceText).toBe('');
    expect(pack.sourceSha256).toBe(createHash('sha256').update('').digest('hex'));
    expect(pack.sourceManifest.pendingExternalResearch).toBe(true);
    expect(pack.sourceManifest.contributingReferenceCount).toBe(0);
  });

  it('does not weaken the empty-source firewall for normal, internal, or hybrid runs', () => {
    expect(() =>
      compileLearningContextPack({
        sourceMode: 'external',
        goal: 'A normal external run still needs evidence.',
      }),
    ).toThrow('learning_context_source_required');

    for (const sourceMode of ['obsidian', 'hybrid'] as const) {
      expect(() =>
        compileLearningContextPack({
          sourceMode,
          goal: 'Internal source material must never be silently omitted.',
          allowPendingExternalResearch: true,
        }),
      ).toThrow('learning_context_source_required');
    }
  });

  it('recognizes current, encoded, absolute, traversal-shaped, and legacy managed paths', () => {
    expect(isManagedVaultideLearningPath('Vaultide/学习记录/course.md')).toBe(true);
    expect(isManagedVaultideLearningPath('D:\\J-obsidian\\Vaultide\\伴随笔记\\note.md')).toBe(true);
    expect(isManagedVaultideLearningPath('Vaultide%2F%E5%BD%92%E7%BA%B3%2Fweekly.md')).toBe(true);
    expect(isManagedVaultideLearningPath('Vaultide/../Projects/original.md')).toBe(true);
    expect(isManagedVaultideLearningPath('OpenMAIC/Learning/legacy.md')).toBe(true);
    expect(isManagedVaultideLearningPath('知洄/知识归纳/legacy.md')).toBe(true);
    expect(isManagedVaultideLearningPath('Projects/OpenMAIC/README.md')).toBe(false);
    expect(isManagedVaultideLearningPath('Projects/Original/README.md')).toBe(false);
    expect(isManagedVaultideLearningPath('https://example.com/Vaultide/article')).toBe(false);
  });

  it('includes only explicit segments whose declared references remain included', () => {
    const includedText = 'The canonical implementation uses an immutable source version.';
    const pack = compileLearningContextPack({
      sourceMode: 'obsidian',
      goal: 'Understand the source-version contract.',
      documentText: 'AGGREGATE TEXT MUST NOT BE USED WHEN SEGMENTS EXIST.',
      references: [
        {
          kind: 'obsidian-source',
          id: 'V1',
          locator: 'Projects/Architecture/source.md',
          included: true,
        },
        {
          kind: 'obsidian-source',
          id: 'V2',
          locator: 'Vaultide/伴随笔记/generated.md',
          included: true,
        },
      ],
      referenceSegments: [
        {
          id: 'seg-safe',
          referenceId: 'V1',
          locator: 'Projects/Architecture/source.md',
          text: includedText,
          contentHash: createHash('sha256').update(includedText).digest('hex'),
        },
        {
          id: 'seg-managed',
          referenceId: 'V2',
          locator: 'Vaultide/伴随笔记/generated.md',
          text: 'MODEL-GENERATED CONTENT MUST NEVER ENTER THE CANONICAL LANE.',
        },
        {
          id: 'seg-orphan',
          referenceId: 'V404',
          text: 'ORPHAN CONTENT MUST NEVER ENTER THE CANONICAL LANE.',
        },
      ],
      generatedAt: '2026-07-28T12:00:00.000Z',
    });

    expect(pack.sourceText).toContain(includedText);
    expect(pack.sourceText).not.toContain('AGGREGATE TEXT');
    expect(pack.sourceText).not.toContain('MODEL-GENERATED CONTENT');
    expect(pack.sourceText).not.toContain('ORPHAN CONTENT');
    expect(pack.sourceManifest).toMatchObject({
      compilerVersion: 'vaultide-context-v2',
      contributingReferenceCount: 1,
      includedSegmentCount: 1,
      excludedSegmentCount: 2,
      aggregateFallbacks: { documentText: 'blocked' },
    });
    expect(pack.sourceManifest.references.find((reference) => reference.id === 'V2')).toMatchObject(
      {
        included: false,
      },
    );
  });

  it('blocks an aggregate document whenever one of its document references is excluded', () => {
    expect(() =>
      compileLearningContextPack({
        sourceMode: 'obsidian',
        goal: 'Study a mixed project.',
        documentText: 'This aggregate may contain both the source and a generated companion.',
        references: [
          {
            kind: 'obsidian-source',
            id: 'V1',
            locator: 'Projects/source.md',
            included: true,
          },
          {
            kind: 'obsidian-source',
            id: 'V2',
            locator: 'Vaultide/学习记录/generated.md',
            included: true,
          },
        ],
      }),
    ).toThrow('learning_context_source_required');
  });

  it('keeps verified learner state outside canonical source text', () => {
    const pack = compileLearningContextPack({
      sourceMode: 'obsidian',
      goal: 'Build on verified understanding without changing the source baseline.',
      documentText: 'Canonical source material.',
      references: [{ kind: 'uploaded-document', id: 'V1', included: true }],
      priorKnowledge: {
        id: `ksn_${'1'.repeat(32)}`,
        verifiedKnowledge: ['A verified prior claim.'],
        misconceptions: ['Old belief → corrected belief.'],
        unresolvedItems: ['Which boundary still needs testing?'],
      },
    });

    expect(pack.sourceText).toContain('Canonical source material.');
    expect(pack.sourceText).not.toContain('A verified prior claim.');
    expect(pack.learnerKnowledgeText).toContain('A verified prior claim.');
    expect(pack.sourceManifest.inheritedKnowledgeSnapshotId).toBe(`ksn_${'1'.repeat(32)}`);
  });

  it('accepts a typed snapshot whose only retained state is a correction and open question', () => {
    const trace = {
      learningEventId: `lev_${'2'.repeat(32)}`,
      evaluationEventId: `lev_${'3'.repeat(32)}`,
      verifiedAt: '2026-07-28T12:00:00.000Z',
      confidence: 0.95,
      sourceReferences: [{ referenceId: 'V1', locator: 'Projects/source.md' }],
    };
    const pack = compileLearningContextPack({
      sourceMode: 'obsidian',
      goal: 'Continue from the last verified state.',
      documentText: 'Canonical source material.',
      references: [{ kind: 'uploaded-document', id: 'V1', included: true }],
      priorKnowledge: {
        id: `ksn_${'4'.repeat(32)}`,
        ownerId: `own_${'5'.repeat(32)}`,
        sessionId: `lsn_${'6'.repeat(32)}`,
        scopeKind: 'session',
        scopeId: `lsn_${'6'.repeat(32)}`,
        revision: 2,
        sourceManifestSha256: '9'.repeat(64),
        createdAt: new Date('2026-07-28T12:00:00.000Z'),
        verifiedKnowledge: [],
        misconceptions: [
          {
            id: `ken_${'7'.repeat(32)}`,
            misconception: 'Latest means reproducible.',
            correction: 'Reproducibility requires an immutable manifest.',
            trace,
          },
        ],
        unresolvedItems: [
          {
            id: `ken_${'8'.repeat(32)}`,
            question: 'How are deleted sources retained in old revisions?',
            trace,
          },
        ],
        evidenceSummary: {
          projectorVersion: 'knowledge-snapshot-v1',
          acceptedEvaluationEventIds: [trace.evaluationEventId],
          evaluatedLearningEventIds: [trace.learningEventId],
          sourceReferenceIds: ['V1'],
          rejected: {
            unverifiedLearningEvents: 0,
            invalidEvaluations: 0,
            malformedEntries: 0,
            missingSourceReferences: 0,
          },
        },
        eligibleForPersistence: true,
      },
    });

    expect(pack.learnerKnowledge.misconceptions).toEqual([
      'Latest means reproducible. → Reproducibility requires an immutable manifest.',
    ]);
    expect(pack.learnerKnowledge.unresolvedItems).toEqual([
      'How are deleted sources retained in old revisions?',
    ]);
    expect(pack.sourceText).not.toContain('Latest means reproducible.');
  });

  it('rejects aggregate text carrying managed-note markers even without a locator', () => {
    expect(() =>
      compileLearningContextPack({
        sourceMode: 'obsidian',
        goal: 'Reject generated output.',
        documentText: '---\nmaic_managed: true\n---\nGenerated summary',
      }),
    ).toThrow('learning_context_source_required');
  });
});
