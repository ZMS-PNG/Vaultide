import { createHash } from 'node:crypto';
import type { StoredLearningEvent } from './learning-progress';
import { isManagedVaultidePath, normalizeVaultideLocator } from './vaultide-paths';

export const KNOWLEDGE_SNAPSHOT_PROJECTOR_VERSION = 'knowledge-snapshot-v1' as const;
export const KNOWLEDGE_EVALUATION_SCHEMA = 'vaultide-knowledge-evaluation/v1' as const;
export const MINIMUM_KNOWLEDGE_VERIFICATION_SCORE = 0.85;

export type VerifiedKnowledgeKind = 'claim' | 'explanation' | 'skill' | 'transfer-outcome';

export interface KnowledgeSourceReference {
  referenceId: string;
  kind?: 'canonical-source' | 'artifact';
  citationId?: string;
  sourceId?: string;
  sourceVersionId?: string;
  locator?: string;
  contentHash?: string;
}

export interface KnowledgeEvidenceTrace {
  learningEventId: string;
  evaluationEventId: string;
  verifiedAt: string;
  confidence: number;
  rubricVersion?: string;
  sourceReferences: KnowledgeSourceReference[];
}

export interface VerifiedKnowledgeEntry {
  id: string;
  kind: VerifiedKnowledgeKind;
  text: string;
  trace: KnowledgeEvidenceTrace;
}

export interface MisconceptionCorrection {
  id: string;
  misconception: string;
  correction: string;
  trace: KnowledgeEvidenceTrace;
}

export interface KnowledgeOpenQuestion {
  id: string;
  question: string;
  trace: KnowledgeEvidenceTrace;
}

export interface KnowledgeSnapshotEvidenceSummary {
  projectorVersion: typeof KNOWLEDGE_SNAPSHOT_PROJECTOR_VERSION;
  parentSnapshotId?: string;
  acceptedEvaluationEventIds: string[];
  evaluatedLearningEventIds: string[];
  sourceReferenceIds: string[];
  rejected: {
    unverifiedLearningEvents: number;
    invalidEvaluations: number;
    malformedEntries: number;
    missingSourceReferences: number;
  };
}

export interface KnowledgeSnapshotProjection {
  verifiedKnowledge: VerifiedKnowledgeEntry[];
  misconceptions: MisconceptionCorrection[];
  unresolvedItems: KnowledgeOpenQuestion[];
  evidenceSummary: KnowledgeSnapshotEvidenceSummary;
  eligibleForPersistence: boolean;
}

export type KnowledgeSnapshotScopeKind = 'session' | 'project' | 'source' | 'topic';

export interface KnowledgeSnapshotRecord extends KnowledgeSnapshotProjection {
  id: string;
  ownerId: string;
  sessionId: string;
  scopeKind: KnowledgeSnapshotScopeKind;
  scopeId: string;
  revision: number;
  parentSnapshotId?: string;
  sourceManifestSha256: string;
  createdAt: Date;
}

export function isKnowledgeSnapshotRecord(snapshot: unknown): snapshot is KnowledgeSnapshotRecord {
  if (typeof snapshot !== 'object' || snapshot === null || Array.isArray(snapshot)) return false;
  const candidate = snapshot as Record<string, unknown>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.ownerId === 'string' &&
    typeof candidate.sessionId === 'string' &&
    (candidate.scopeKind === 'session' ||
      candidate.scopeKind === 'project' ||
      candidate.scopeKind === 'source' ||
      candidate.scopeKind === 'topic') &&
    typeof candidate.scopeId === 'string' &&
    typeof candidate.revision === 'number' &&
    typeof candidate.sourceManifestSha256 === 'string' &&
    Array.isArray(candidate.verifiedKnowledge) &&
    Array.isArray(candidate.misconceptions) &&
    Array.isArray(candidate.unresolvedItems)
  );
}

export interface EvaluationKnowledgeItem {
  text: string;
  sourceReferences?: KnowledgeSourceReference[];
  supersedesEntryIds?: string[];
}

export interface EvaluationCorrectionItem {
  misconception: string;
  correction: string;
  sourceReferences?: KnowledgeSourceReference[];
  supersedesEntryIds?: string[];
}

export interface EvaluationQuestionItem {
  question: string;
  sourceReferences?: KnowledgeSourceReference[];
}

export interface KnowledgeEvaluationEnvelope {
  schema: typeof KNOWLEDGE_EVALUATION_SCHEMA;
  verdict: 'passed' | 'revise' | 'failed';
  confidence: number;
  sourceReferences?: KnowledgeSourceReference[];
  verifiedClaims?: EvaluationKnowledgeItem[];
  verifiedExplanations?: EvaluationKnowledgeItem[];
  misconceptionCorrections?: EvaluationCorrectionItem[];
  openQuestions?: EvaluationQuestionItem[];
  skills?: EvaluationKnowledgeItem[];
  transferOutcomes?: EvaluationKnowledgeItem[];
  resolvedQuestionIds?: string[];
}

interface AcceptedEvaluation {
  learningEvent: StoredLearningEvent;
  evaluationEvent: StoredLearningEvent;
  envelope: KnowledgeEvaluationEnvelope;
  confidence: number;
  rubricVersion?: string;
}

const EVALUATABLE_EVENT_TYPES = new Set<StoredLearningEvent['eventType']>([
  'retrievalAttempted',
  'explanationSubmitted',
  'practiceSubmitted',
  'transferTaskCompleted',
]);

function payload(event: StoredLearningEvent): Record<string, unknown> {
  return event.payload as unknown as Record<string, unknown>;
}

function normalizedText(value: unknown, maximum = 1_000): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value
    .replace(/<!--\s*\/?vaultide:managed\b/giu, 'Vaultide managed')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, '')
    .replace(/\r\n?/gu, '\n')
    .trim()
    .slice(0, maximum);
  if (text.length < 6) return undefined;
  if (/^(?:todo|tbd|n\/a|none|unknown|不知道|不清楚|暂无|无)$/iu.test(text)) return undefined;
  return text;
}

function normalizedIdentifier(value: unknown, maximum = 200): string | undefined {
  if (typeof value !== 'string') return undefined;
  const result = value
    .replace(/[\u0000-\u001f\u007f]/gu, '')
    .trim()
    .slice(0, maximum);
  return result || undefined;
}

function finiteScore(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : undefined;
}

function parseObject(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== 'string') return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function sourceReference(value: unknown): KnowledgeSourceReference | undefined {
  const record = parseObject(value);
  if (!record) return undefined;
  const referenceId = normalizedIdentifier(record.referenceId ?? record.citationId, 160);
  if (!referenceId) return undefined;
  const locator = normalizedIdentifier(record.locator, 2_000);
  if (locator && isManagedVaultidePath(locator)) return undefined;
  const contentHash = normalizedIdentifier(record.contentHash, 64);
  if (contentHash && !/^[a-f0-9]{64}$/iu.test(contentHash)) return undefined;
  return {
    referenceId,
    ...(record.kind === 'artifact' ? { kind: 'artifact' as const } : {}),
    ...(normalizedIdentifier(record.citationId, 160)
      ? { citationId: normalizedIdentifier(record.citationId, 160) }
      : {}),
    ...(normalizedIdentifier(record.sourceId, 160)
      ? { sourceId: normalizedIdentifier(record.sourceId, 160) }
      : {}),
    ...(normalizedIdentifier(record.sourceVersionId, 160)
      ? { sourceVersionId: normalizedIdentifier(record.sourceVersionId, 160) }
      : {}),
    ...(locator ? { locator: normalizeVaultideLocator(locator) } : {}),
    ...(contentHash ? { contentHash: contentHash.toLocaleLowerCase() } : {}),
  };
}

function sourceReferences(value: unknown): KnowledgeSourceReference[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: KnowledgeSourceReference[] = [];
  for (const item of value) {
    const reference = sourceReference(item);
    if (!reference) continue;
    const key = [
      reference.referenceId,
      reference.sourceVersionId ?? '',
      reference.locator ?? '',
      reference.contentHash ?? '',
    ].join('\u0000');
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(reference);
    if (result.length >= 50) break;
  }
  return result;
}

function itemList(value: unknown): EvaluationKnowledgeItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const record = parseObject(item);
    const text = normalizedText(record?.text);
    if (!record || !text) return [];
    return [
      {
        text,
        sourceReferences: sourceReferences(record.sourceReferences),
        supersedesEntryIds: Array.isArray(record.supersedesEntryIds)
          ? record.supersedesEntryIds
              .flatMap((id) => normalizedIdentifier(id, 160) ?? [])
              .slice(0, 50)
          : [],
      },
    ];
  });
}

function correctionList(value: unknown): EvaluationCorrectionItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const record = parseObject(item);
    const misconception = normalizedText(record?.misconception);
    const correction = normalizedText(record?.correction);
    if (!record || !misconception || !correction || misconception === correction) return [];
    return [
      {
        misconception,
        correction,
        sourceReferences: sourceReferences(record.sourceReferences),
        supersedesEntryIds: Array.isArray(record.supersedesEntryIds)
          ? record.supersedesEntryIds
              .flatMap((id) => normalizedIdentifier(id, 160) ?? [])
              .slice(0, 50)
          : [],
      },
    ];
  });
}

function questionList(value: unknown): EvaluationQuestionItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const record = parseObject(item);
    const question = normalizedText(record?.question, 500);
    return record && question
      ? [{ question, sourceReferences: sourceReferences(record.sourceReferences) }]
      : [];
  });
}

function evaluationEnvelope(value: unknown): KnowledgeEvaluationEnvelope | undefined {
  const record = parseObject(value);
  if (!record || record.schema !== KNOWLEDGE_EVALUATION_SCHEMA || record.verdict !== 'passed') {
    return undefined;
  }
  const confidence = finiteScore(record.confidence);
  if (confidence === undefined || confidence < MINIMUM_KNOWLEDGE_VERIFICATION_SCORE) {
    return undefined;
  }
  return {
    schema: KNOWLEDGE_EVALUATION_SCHEMA,
    verdict: 'passed',
    confidence,
    sourceReferences: sourceReferences(record.sourceReferences),
    verifiedClaims: itemList(record.verifiedClaims),
    verifiedExplanations: itemList(record.verifiedExplanations),
    misconceptionCorrections: correctionList(record.misconceptionCorrections),
    openQuestions: questionList(record.openQuestions),
    skills: itemList(record.skills),
    transferOutcomes: itemList(record.transferOutcomes),
    resolvedQuestionIds: Array.isArray(record.resolvedQuestionIds)
      ? record.resolvedQuestionIds
          .flatMap((id) => normalizedIdentifier(id, 160) ?? [])
          .slice(0, 100)
      : [],
  };
}

function acceptedEvaluation(
  event: StoredLearningEvent,
  eventsById: ReadonlyMap<string, StoredLearningEvent>,
): AcceptedEvaluation | undefined {
  if (event.source !== 'system') return undefined;
  const eventPayload = payload(event);

  if (event.eventType === 'feedbackReceived') {
    const learningEventId = normalizedIdentifier(eventPayload.targetEventId, 160);
    const learningEvent = learningEventId ? eventsById.get(learningEventId) : undefined;
    const confidence = finiteScore(eventPayload.score);
    const envelope = evaluationEnvelope(eventPayload.summary);
    if (
      !learningEvent ||
      !EVALUATABLE_EVENT_TYPES.has(learningEvent.eventType) ||
      confidence === undefined ||
      confidence < MINIMUM_KNOWLEDGE_VERIFICATION_SCORE ||
      !envelope
    ) {
      return undefined;
    }
    return {
      learningEvent,
      evaluationEvent: event,
      envelope,
      confidence: Math.min(confidence, envelope.confidence),
    };
  }

  if (event.eventType === 'evidenceEvaluated' && eventPayload.verdict === 'passed') {
    const envelope = evaluationEnvelope(eventPayload.knowledgeEvaluation);
    const learningEventId = normalizedIdentifier(
      eventPayload.targetEventId ?? parseObject(eventPayload.knowledgeEvaluation)?.targetEventId,
      160,
    );
    const learningEvent = learningEventId ? eventsById.get(learningEventId) : undefined;
    if (!envelope || !learningEvent || !EVALUATABLE_EVENT_TYPES.has(learningEvent.eventType)) {
      return undefined;
    }
    return {
      learningEvent,
      evaluationEvent: event,
      envelope,
      confidence: envelope.confidence,
      rubricVersion: normalizedIdentifier(eventPayload.rubricVersion, 160),
    };
  }
  return undefined;
}

function combinedSources(
  item: { sourceReferences?: KnowledgeSourceReference[] },
  envelope: KnowledgeEvaluationEnvelope,
  defaults: readonly KnowledgeSourceReference[],
): KnowledgeSourceReference[] {
  const candidates = [
    ...(item.sourceReferences ?? []),
    ...(envelope.sourceReferences ?? []),
    ...defaults,
  ];
  return sourceReferences(candidates);
}

function trace(
  evaluation: AcceptedEvaluation,
  references: KnowledgeSourceReference[],
): KnowledgeEvidenceTrace {
  return {
    learningEventId: evaluation.learningEvent.id,
    evaluationEventId: evaluation.evaluationEvent.id,
    verifiedAt: evaluation.evaluationEvent.occurredAt,
    confidence: evaluation.confidence,
    ...(evaluation.rubricVersion ? { rubricVersion: evaluation.rubricVersion } : {}),
    sourceReferences: references,
  };
}

function stableEntryId(kind: string, text: string): string {
  return `ken_${createHash('sha256')
    .update(`${kind}\u0000${text.toLocaleLowerCase()}`, 'utf8')
    .digest('hex')
    .slice(0, 32)}`;
}

function uniqueById<T extends { id: string }>(items: readonly T[]): T[] {
  const byId = new Map<string, T>();
  for (const item of items) byId.set(item.id, item);
  return [...byId.values()];
}

function safeDefaultSources(
  values: readonly KnowledgeSourceReference[] | undefined,
): KnowledgeSourceReference[] {
  return sourceReferences(values ?? []);
}

export function projectKnowledgeSnapshot(input: {
  events: readonly StoredLearningEvent[];
  parentSnapshot?: KnowledgeSnapshotRecord;
  sourceReferences?: readonly KnowledgeSourceReference[];
}): KnowledgeSnapshotProjection {
  const orderedEvents = [...input.events].sort(
    (left, right) =>
      left.serverSeq - right.serverSeq ||
      Date.parse(left.occurredAt) - Date.parse(right.occurredAt) ||
      left.id.localeCompare(right.id),
  );
  const eventsById = new Map(orderedEvents.map((event) => [event.id, event]));
  const defaults = safeDefaultSources(input.sourceReferences);
  const verifiedKnowledge = [...(input.parentSnapshot?.verifiedKnowledge ?? [])];
  const misconceptions = [...(input.parentSnapshot?.misconceptions ?? [])];
  const unresolvedItems = [...(input.parentSnapshot?.unresolvedItems ?? [])];
  const acceptedEvaluationEventIds = new Set<string>();
  const evaluatedLearningEventIds = new Set<string>();
  const sourceReferenceIds = new Set<string>();
  const rejected = {
    unverifiedLearningEvents: orderedEvents.filter((event) =>
      EVALUATABLE_EVENT_TYPES.has(event.eventType),
    ).length,
    invalidEvaluations: 0,
    malformedEntries: 0,
    missingSourceReferences: 0,
  };

  const removeSuperseded = (ids: readonly string[]) => {
    if (ids.length === 0) return;
    const removed = new Set(ids);
    for (let index = verifiedKnowledge.length - 1; index >= 0; index -= 1) {
      if (removed.has(verifiedKnowledge[index]!.id)) verifiedKnowledge.splice(index, 1);
    }
    for (let index = misconceptions.length - 1; index >= 0; index -= 1) {
      if (removed.has(misconceptions[index]!.id)) misconceptions.splice(index, 1);
    }
  };

  for (const event of orderedEvents) {
    if (event.eventType !== 'feedbackReceived' && event.eventType !== 'evidenceEvaluated') continue;
    const evaluation = acceptedEvaluation(event, eventsById);
    if (!evaluation) {
      rejected.invalidEvaluations += 1;
      continue;
    }

    let acceptedContent = 0;
    const addKnowledge = (
      kind: VerifiedKnowledgeKind,
      items: readonly EvaluationKnowledgeItem[] | undefined,
      requireCanonicalSource: boolean,
    ) => {
      for (const item of items ?? []) {
        const references = combinedSources(item, evaluation.envelope, defaults);
        const usableReferences = requireCanonicalSource
          ? references.filter((reference) => reference.kind !== 'artifact')
          : references;
        if (usableReferences.length === 0) {
          rejected.missingSourceReferences += 1;
          continue;
        }
        removeSuperseded(item.supersedesEntryIds ?? []);
        const evidence = trace(evaluation, references);
        verifiedKnowledge.push({
          id: stableEntryId(kind, item.text),
          kind,
          text: item.text,
          trace: evidence,
        });
        for (const reference of references) sourceReferenceIds.add(reference.referenceId);
        acceptedContent += 1;
      }
    };

    addKnowledge('claim', evaluation.envelope.verifiedClaims, true);
    addKnowledge('explanation', evaluation.envelope.verifiedExplanations, true);
    addKnowledge('skill', evaluation.envelope.skills, false);
    addKnowledge('transfer-outcome', evaluation.envelope.transferOutcomes, false);

    for (const item of evaluation.envelope.misconceptionCorrections ?? []) {
      const references = combinedSources(item, evaluation.envelope, defaults).filter(
        (reference) => reference.kind !== 'artifact',
      );
      if (references.length === 0) {
        rejected.missingSourceReferences += 1;
        continue;
      }
      removeSuperseded(item.supersedesEntryIds ?? []);
      const evidence = trace(evaluation, references);
      misconceptions.push({
        id: stableEntryId('misconception', `${item.misconception}\u0000${item.correction}`),
        misconception: item.misconception,
        correction: item.correction,
        trace: evidence,
      });
      for (const reference of references) sourceReferenceIds.add(reference.referenceId);
      acceptedContent += 1;
    }

    const resolved = new Set(evaluation.envelope.resolvedQuestionIds ?? []);
    if (resolved.size > 0) {
      let resolvedCount = 0;
      for (let index = unresolvedItems.length - 1; index >= 0; index -= 1) {
        if (resolved.has(unresolvedItems[index]!.id)) {
          unresolvedItems.splice(index, 1);
          resolvedCount += 1;
        }
      }
      acceptedContent += resolvedCount;
    }
    for (const item of evaluation.envelope.openQuestions ?? []) {
      const references = combinedSources(item, evaluation.envelope, defaults);
      const evidence = trace(evaluation, references);
      unresolvedItems.push({
        id: stableEntryId('open-question', item.question),
        question: item.question,
        trace: evidence,
      });
      for (const reference of references) sourceReferenceIds.add(reference.referenceId);
      acceptedContent += 1;
    }

    if (acceptedContent === 0) {
      rejected.malformedEntries += 1;
      continue;
    }
    acceptedEvaluationEventIds.add(evaluation.evaluationEvent.id);
    evaluatedLearningEventIds.add(evaluation.learningEvent.id);
    rejected.unverifiedLearningEvents = Math.max(0, rejected.unverifiedLearningEvents - 1);
  }

  const result = {
    verifiedKnowledge: uniqueById(verifiedKnowledge),
    misconceptions: uniqueById(misconceptions),
    unresolvedItems: uniqueById(unresolvedItems),
    evidenceSummary: {
      projectorVersion: KNOWLEDGE_SNAPSHOT_PROJECTOR_VERSION,
      ...(input.parentSnapshot ? { parentSnapshotId: input.parentSnapshot.id } : {}),
      acceptedEvaluationEventIds: [...acceptedEvaluationEventIds],
      evaluatedLearningEventIds: [...evaluatedLearningEventIds],
      sourceReferenceIds: [...sourceReferenceIds].sort(),
      rejected,
    },
  };
  return {
    ...result,
    eligibleForPersistence: acceptedEvaluationEventIds.size > 0,
  };
}

export function knowledgeSnapshotContext(snapshot: KnowledgeSnapshotRecord): {
  id: string;
  verifiedKnowledge: string[];
  misconceptions: string[];
  unresolvedItems: string[];
  evidenceSummary: KnowledgeSnapshotEvidenceSummary;
} {
  return {
    id: snapshot.id,
    verifiedKnowledge: snapshot.verifiedKnowledge.map((entry) => entry.text),
    misconceptions: snapshot.misconceptions.map(
      (entry) => `${entry.misconception} → ${entry.correction}`,
    ),
    unresolvedItems: snapshot.unresolvedItems.map((entry) => entry.question),
    evidenceSummary: snapshot.evidenceSummary,
  };
}

function markdownSafe(value: string): string {
  return value
    .replace(/<!--\s*\/?vaultide:managed\b/giu, 'Vaultide managed')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, '')
    .trim();
}

function traceLabel(evidence: KnowledgeEvidenceTrace): string {
  const sources = evidence.sourceReferences
    .map((reference) => reference.citationId ?? reference.referenceId)
    .filter(Boolean)
    .slice(0, 8);
  const sourceLabel = sources.length > 0 ? `来源：${sources.join('、')}` : '来源：学习产物';
  return `${sourceLabel}；证据：${evidence.learningEventId.slice(-8)}→${evidence.evaluationEventId.slice(-8)}`;
}

export interface KnowledgeSnapshotMarkdownSection {
  title: string;
  lines: string[];
}

/**
 * The renderer consumes only projected entries. It never reads the response or
 * outcome fields from learner-authored events, which prevents an unverified
 * free answer from leaking into an Obsidian writeback.
 */
export function knowledgeSnapshotMarkdownSections(
  snapshot: KnowledgeSnapshotProjection,
): KnowledgeSnapshotMarkdownSection[] {
  const claims = snapshot.verifiedKnowledge.filter((entry) => entry.kind === 'claim');
  const explanations = snapshot.verifiedKnowledge.filter((entry) => entry.kind === 'explanation');
  const skills = snapshot.verifiedKnowledge.filter(
    (entry) => entry.kind === 'skill' || entry.kind === 'transfer-outcome',
  );
  if (
    claims.length === 0 &&
    explanations.length === 0 &&
    skills.length === 0 &&
    snapshot.misconceptions.length === 0 &&
    snapshot.unresolvedItems.length === 0
  ) {
    return [
      {
        title: '已验证知识',
        lines: ['- 暂无通过质量门槛的知识；自由回答、自评分和未通过评估的内容不会自动沉淀。'],
      },
    ];
  }

  const sections: KnowledgeSnapshotMarkdownSection[] = [];
  if (claims.length > 0) {
    sections.push({
      title: '已验证主张',
      lines: claims.map((entry) => `- ${markdownSafe(entry.text)}（${traceLabel(entry.trace)}）`),
    });
  }
  if (explanations.length > 0) {
    sections.push({
      title: '已验证的学习者解释',
      lines: explanations.map(
        (entry) => `- ${markdownSafe(entry.text)}（${traceLabel(entry.trace)}）`,
      ),
    });
  }
  if (snapshot.misconceptions.length > 0) {
    sections.push({
      title: '误区与修正',
      lines: snapshot.misconceptions.map(
        (entry) =>
          `- 误区：${markdownSafe(entry.misconception)}\n  - 修正：${markdownSafe(entry.correction)}（${traceLabel(entry.trace)}）`,
      ),
    });
  }
  if (skills.length > 0) {
    sections.push({
      title: '技能与迁移成果',
      lines: skills.map((entry) => `- ${markdownSafe(entry.text)}（${traceLabel(entry.trace)}）`),
    });
  }
  if (snapshot.unresolvedItems.length > 0) {
    sections.push({
      title: '开放问题',
      lines: snapshot.unresolvedItems.map(
        (entry) => `- ${markdownSafe(entry.question)}（${traceLabel(entry.trace)}）`,
      ),
    });
  }
  return sections;
}
