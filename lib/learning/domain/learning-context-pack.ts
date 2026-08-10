import { createHash } from 'node:crypto';
import type { KnowledgeSnapshotRecord } from './knowledge-snapshot';
import { isKnowledgeSnapshotRecord, knowledgeSnapshotContext } from './knowledge-snapshot';
import {
  containsVaultideManagedMarkers,
  isManagedVaultidePath,
  normalizeVaultideLocator,
} from './vaultide-paths';
import {
  freezeCanonicalEvidence,
  type FrozenEvidenceSet,
} from './v3/frozen-evidence';

export type LearningSourceMode = 'external' | 'obsidian' | 'hybrid';

export interface LearningSourceReference {
  kind: 'obsidian-source' | 'public-source' | 'uploaded-document' | 'learner-evidence';
  id: string;
  versionId?: string;
  locator?: string;
  contentHash?: string;
  authority?: 'primary' | 'authoritative' | 'general' | 'private-original';
  included: boolean;
  reason?: string;
}

export interface LearningSourceTextSegment {
  id: string;
  referenceId: string;
  text: string;
  locator?: string;
  contentHash?: string;
  included?: boolean;
}

export interface LearnerKnowledgeSnapshot {
  id?: string;
  verifiedKnowledge: string[];
  misconceptions: string[];
  unresolvedItems: string[];
  evidenceSummary?: KnowledgeSnapshotRecord['evidenceSummary'] | Record<string, unknown>;
}

interface ManifestSegment {
  id: string;
  referenceId: string;
  locator?: string;
  contentHash?: string;
  included: boolean;
  reason?: string;
}

type AggregateFallbackState = 'included' | 'blocked' | 'unused';

export interface CompiledLearningContextPack {
  sourceMode: LearningSourceMode;
  goal: string;
  /** Canonical source lane only. Learner state never enters this string. */
  sourceText: string;
  sourceSha256: string;
  learnerKnowledgeText: string;
  learnerKnowledge: LearnerKnowledgeSnapshot;
  sourceManifest: {
    compilerVersion: 'vaultide-context-v2';
    generatedAt: string;
    references: LearningSourceReference[];
    segments: ManifestSegment[];
    canonicalReferenceCount: number;
    contributingReferenceCount: number;
    excludedReferenceCount: number;
    includedSegmentCount: number;
    excludedSegmentCount: number;
    aggregateFallbacks: {
      documentText: AggregateFallbackState;
      researchText: AggregateFallbackState;
    };
    /** True only while an external-only plan is waiting for its first research pass. */
    pendingExternalResearch?: true;
    inheritedKnowledgeSnapshotId?: string;
    frozenEvidence?: Pick<FrozenEvidenceSet, 'version' | 'sourceSetId' | 'entries'>;
  };
  selectedEpisodes: string[];
  exclusions: string[];
  unresolvedItems: string[];
}

function normalizedIdentifier(value: string | undefined, maximum = 200): string {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/gu, '')
    .trim()
    .slice(0, maximum);
}

function normalizeText(value: string | undefined, maximum: number): string {
  return String(value ?? '')
    .replace(/\u0000/gu, '')
    .replace(/\r\n?/gu, '\n')
    .trim()
    .slice(0, maximum);
}

function uniqueText(values: readonly string[] | undefined, maximum = 100): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of values ?? []) {
    const value = normalizeText(raw, 2_000);
    const key = value.toLocaleLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    result.push(value);
    if (result.length >= maximum) break;
  }
  return result;
}

function hashText(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function referenceLane(reference: LearningSourceReference): 'document' | 'research' | 'learner' {
  if (reference.kind === 'public-source') return 'research';
  if (reference.kind === 'learner-evidence') return 'learner';
  return 'document';
}

function normalizePriorKnowledge(
  value: LearnerKnowledgeSnapshot | KnowledgeSnapshotRecord | undefined,
): LearnerKnowledgeSnapshot {
  if (!value) {
    return {
      verifiedKnowledge: [],
      misconceptions: [],
      unresolvedItems: [],
    };
  }
  if (isKnowledgeSnapshotRecord(value)) return knowledgeSnapshotContext(value);
  return {
    ...(value.id ? { id: value.id } : {}),
    verifiedKnowledge: uniqueText(value.verifiedKnowledge, 200),
    misconceptions: uniqueText(value.misconceptions, 100),
    unresolvedItems: uniqueText(value.unresolvedItems, 200),
    ...(value.evidenceSummary ? { evidenceSummary: value.evidenceSummary } : {}),
  };
}

function learnerKnowledgeMarkdown(snapshot: LearnerKnowledgeSnapshot): string {
  const sections: string[] = [];
  if (snapshot.verifiedKnowledge.length > 0) {
    sections.push(
      [
        '## Learner-verified prior knowledge (non-canonical state)',
        ...snapshot.verifiedKnowledge.map((item) => `- ${item}`),
      ].join('\n'),
    );
  }
  if (snapshot.misconceptions.length > 0) {
    sections.push(
      [
        '## Verified misconception corrections (non-canonical state)',
        ...snapshot.misconceptions.map((item) => `- ${item}`),
      ].join('\n'),
    );
  }
  if (snapshot.unresolvedItems.length > 0) {
    sections.push(
      [
        '## Open learner questions (non-canonical state)',
        ...snapshot.unresolvedItems.map((item) => `- ${item}`),
      ].join('\n'),
    );
  }
  return sections.join('\n\n');
}

function canonicalSegmentSection(input: {
  reference: LearningSourceReference;
  segment: ManifestSegment;
  text: string;
}): string {
  const locator = input.segment.locator ?? input.reference.locator;
  return [
    `## Canonical reference [${input.reference.id}]`,
    `Segment: ${input.segment.id}`,
    ...(locator ? [`Locator: ${locator}`] : []),
    '',
    input.text,
  ].join('\n');
}

function aggregateSection(label: string, text: string): string {
  return [`## ${label}`, '', text].join('\n');
}

/**
 * Compatibility alias retained for callers and tests created before the path
 * registry was introduced.
 */
export function isManagedVaultideLearningPath(path: string | undefined): boolean {
  return isManagedVaultidePath(path);
}

export function compileLearningContextPack(input: {
  sourceMode: LearningSourceMode;
  goal: string;
  documentText?: string;
  researchText?: string;
  references?: readonly LearningSourceReference[];
  referenceSegments?: readonly LearningSourceTextSegment[];
  priorKnowledge?: LearnerKnowledgeSnapshot | KnowledgeSnapshotRecord;
  selectedEpisodes?: readonly string[];
  exclusions?: readonly string[];
  generatedAt?: string;
  /**
   * Narrow orchestration escape hatch for a brand-new external learning run.
   * The pack remains empty only until the durable research step replaces it
   * with retrieved, reviewed evidence. Internal and hybrid runs never use it.
   */
  allowPendingExternalResearch?: boolean;
}): CompiledLearningContextPack {
  const goal = normalizeText(input.goal, 8_000);
  if (!goal) throw new Error('learning_goal_required');

  const referenceIds = new Set<string>();
  const references = (input.references ?? []).map((source) => {
    const id = normalizedIdentifier(source.id, 200);
    if (!id) throw new Error('learning_context_reference_id_required');
    if (referenceIds.has(id)) throw new Error('learning_context_duplicate_reference_id');
    referenceIds.add(id);

    const locator = normalizeVaultideLocator(source.locator);
    const managedOutput = locator.length > 0 && isManagedVaultidePath(locator);
    const learnerEvidence = source.kind === 'learner-evidence';
    const included = source.included && !managedOutput && !learnerEvidence;
    return {
      ...source,
      id,
      ...(locator ? { locator } : {}),
      included,
      ...(!included
        ? {
            reason: managedOutput
              ? 'Vaultide-managed output is quarantined from canonical evidence.'
              : learnerEvidence
                ? 'Learner evidence belongs to the non-canonical knowledge-state lane.'
                : (source.reason ?? 'Reference was excluded by source selection.'),
          }
        : {}),
    };
  });
  const referencesById = new Map(references.map((reference) => [reference.id, reference]));

  const segmentIds = new Set<string>();
  const manifestSegments: ManifestSegment[] = [];
  const canonicalSections: string[] = [];
  const explicitLanePresence = { document: false, research: false };
  const contributingReferences = new Set<string>();

  for (const sourceSegment of input.referenceSegments ?? []) {
    const id = normalizedIdentifier(sourceSegment.id, 200);
    const referenceId = normalizedIdentifier(sourceSegment.referenceId, 200);
    if (!id || !referenceId) throw new Error('learning_context_segment_identity_required');
    if (segmentIds.has(id)) throw new Error('learning_context_duplicate_segment_id');
    segmentIds.add(id);

    const reference = referencesById.get(referenceId);
    const locator = normalizeVaultideLocator(sourceSegment.locator);
    const text = normalizeText(sourceSegment.text, 400_000);
    const lane = reference ? referenceLane(reference) : undefined;
    if (lane === 'document' || lane === 'research') explicitLanePresence[lane] = true;

    let included = sourceSegment.included !== false;
    let reason: string | undefined;
    if (!reference) {
      included = false;
      reason = 'Segment does not correspond to a declared reference.';
    } else if (!reference.included) {
      included = false;
      reason = 'The corresponding reference is excluded.';
    } else if (lane === 'learner') {
      included = false;
      reason = 'Learner evidence cannot enter the canonical source lane.';
    } else if (locator && isManagedVaultidePath(locator)) {
      included = false;
      reason = 'Segment locator points to a Vaultide-managed output.';
    } else if (!text) {
      included = false;
      reason = 'Segment text is empty.';
    } else if (containsVaultideManagedMarkers(text)) {
      included = false;
      reason = 'Segment contains Vaultide-managed document markers.';
    } else if (sourceSegment.contentHash) {
      if (!/^[a-f0-9]{64}$/iu.test(sourceSegment.contentHash)) {
        included = false;
        reason = 'Segment content hash is invalid.';
      } else if (hashText(text) !== sourceSegment.contentHash.toLocaleLowerCase()) {
        included = false;
        reason = 'Segment content hash does not match its declared hash.';
      }
    }

    const segment: ManifestSegment = {
      id,
      referenceId,
      ...(locator ? { locator } : {}),
      ...(sourceSegment.contentHash
        ? { contentHash: sourceSegment.contentHash.toLocaleLowerCase() }
        : {}),
      included,
      ...(reason ? { reason } : {}),
    };
    manifestSegments.push(segment);
    if (included && reference) {
      canonicalSections.push(canonicalSegmentSection({ reference, segment, text }));
      contributingReferences.add(reference.id);
    }
  }

  const aggregateFallbacks: CompiledLearningContextPack['sourceManifest']['aggregateFallbacks'] = {
    documentText: 'unused',
    researchText: 'unused',
  };
  const appendAggregate = (inputAggregate: {
    lane: 'document' | 'research';
    value: string | undefined;
    label: string;
    key: keyof typeof aggregateFallbacks;
  }) => {
    const text = normalizeText(
      inputAggregate.value,
      inputAggregate.lane === 'document' ? 1_200_000 : 800_000,
    );
    if (!text) return;
    if (explicitLanePresence[inputAggregate.lane]) {
      aggregateFallbacks[inputAggregate.key] = 'blocked';
      return;
    }
    const laneReferences = references.filter(
      (reference) => referenceLane(reference) === inputAggregate.lane,
    );
    const referencesPermitFallback =
      (references.length === 0 || laneReferences.length > 0) &&
      laneReferences.every((reference) => reference.included);
    if (!referencesPermitFallback || containsVaultideManagedMarkers(text)) {
      aggregateFallbacks[inputAggregate.key] = 'blocked';
      return;
    }
    canonicalSections.push(aggregateSection(inputAggregate.label, text));
    for (const reference of laneReferences) contributingReferences.add(reference.id);
    aggregateFallbacks[inputAggregate.key] = 'included';
  };

  appendAggregate({
    lane: 'document',
    value: input.documentText,
    label: 'Canonical supplied material',
    key: 'documentText',
  });
  appendAggregate({
    lane: 'research',
    value: input.researchText,
    label: 'Canonical external evidence',
    key: 'researchText',
  });

  const sourceText = canonicalSections.join('\n\n').trim();
  const pendingExternalResearch =
    sourceText.length < 1 &&
    input.sourceMode === 'external' &&
    input.allowPendingExternalResearch === true;
  if (sourceText.length < 1 && !pendingExternalResearch) {
    throw new Error('learning_context_source_required');
  }

  const learnerKnowledge = normalizePriorKnowledge(input.priorKnowledge);
  const learnerKnowledgeText = learnerKnowledgeMarkdown(learnerKnowledge);
  const exclusions = uniqueText(
    [
      ...(input.exclusions ?? []),
      'Do not treat Vaultide-generated summaries, companions, indexes, source cards, synthesis notes, or previous course narration as canonical factual evidence.',
      'Do not move learner answers into verified knowledge without an accepted system evaluation.',
      'Do not silently broaden beyond the frozen source manifest.',
      ...learnerKnowledge.misconceptions.map(
        (item) => `Known misconception requiring explicit correction: ${item}`,
      ),
    ],
    250,
  );

  return {
    sourceMode: input.sourceMode,
    goal,
    sourceText,
    sourceSha256: hashText(sourceText),
    learnerKnowledgeText,
    learnerKnowledge,
    sourceManifest: {
      compilerVersion: 'vaultide-context-v2',
      generatedAt: input.generatedAt ?? new Date().toISOString(),
      references,
      segments: manifestSegments,
      canonicalReferenceCount: references.filter((reference) => reference.included).length,
      contributingReferenceCount: contributingReferences.size,
      excludedReferenceCount: references.filter((reference) => !reference.included).length,
      includedSegmentCount: manifestSegments.filter((segment) => segment.included).length,
      excludedSegmentCount: manifestSegments.filter((segment) => !segment.included).length,
      aggregateFallbacks,
      ...(pendingExternalResearch ? { pendingExternalResearch: true as const } : {}),
      ...(learnerKnowledge.id ? { inheritedKnowledgeSnapshotId: learnerKnowledge.id } : {}),
    },
    selectedEpisodes: uniqueText(input.selectedEpisodes, 100),
    exclusions,
    unresolvedItems: learnerKnowledge.unresolvedItems,
  };
}

/**
 * Adds evidence labels after canonical-source selection. This is intentionally
 * a separate, pure step so legacy V2 planning remains byte-compatible until
 * the V3 feature flag is enabled.
 */
export function attachFrozenEvidenceToContextPack(
  context: CompiledLearningContextPack,
): CompiledLearningContextPack {
  const frozenEvidence = freezeCanonicalEvidence(context.sourceText);
  if (frozenEvidence.entries.length === 0) return context;
  return {
    ...context,
    sourceText: frozenEvidence.sourceText,
    sourceSha256: hashText(frozenEvidence.sourceText),
    sourceManifest: {
      ...context.sourceManifest,
      frozenEvidence: {
        version: frozenEvidence.version,
        sourceSetId: frozenEvidence.sourceSetId,
        entries: frozenEvidence.entries,
      },
    },
  };
}
