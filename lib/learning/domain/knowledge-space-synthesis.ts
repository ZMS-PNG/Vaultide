import { createHash } from 'node:crypto';
import type {
  KnowledgeSnapshotEvidenceSummary,
  KnowledgeSourceReference,
  MisconceptionCorrection,
  KnowledgeOpenQuestion,
  VerifiedKnowledgeEntry,
} from './knowledge-snapshot';
import {
  KNOWLEDGE_SNAPSHOT_PROJECTOR_VERSION,
  MINIMUM_KNOWLEDGE_VERIFICATION_SCORE,
} from './knowledge-snapshot';
import { isManagedVaultidePath } from './vaultide-paths';
import type {
  KnowledgeGraph,
  SynthesisEvidenceFingerprint,
  SynthesisFilterOptions,
  SynthesisRequest,
  SynthesisSourceType,
  SynthesisTaskCandidate,
} from './synthesis';

export const TRUSTED_KNOWLEDGE_SPACE_VERSION = 'trusted-knowledge-space/1' as const;
export const TRUSTED_SYNTHESIS_VERSION = 'trusted-synthesis/1' as const;
export const SEMANTIC_COORDINATE_MODEL_VERSION = 'tfidf-pca-semantic-v1' as const;

const MAX_SYNTHESIS_SNAPSHOTS = 50;
const MAX_CONCEPTS_PER_NODE = 4;
const MAX_SEMANTIC_FEATURES = 64;
const MAX_REPORT_ITEMS = 24;

export type KnowledgeSnapshotScopeKind = 'session' | 'project' | 'source' | 'topic';

export interface TrustedKnowledgeSnapshotInput {
  snapshotId: string;
  sessionId: string;
  scopeKind: KnowledgeSnapshotScopeKind;
  scopeId: string;
  revision: number;
  parentSnapshotId?: string;
  sourceManifestSha256: string;
  projectId?: string;
  projectName?: string;
  classroomId?: string;
  sourceMode: 'external' | 'obsidian' | 'hybrid';
  topicTags: string[];
  createdAt: Date;
  verifiedKnowledge: VerifiedKnowledgeEntry[];
  misconceptions: MisconceptionCorrection[];
  unresolvedItems: KnowledgeOpenQuestion[];
  evidenceSummary: KnowledgeSnapshotEvidenceSummary;
  eligibleForPersistence: boolean;
}

export type TrustedKnowledgeNodeType = 'concept' | 'claim' | 'skill' | 'artifact';
export type TrustedKnowledgeEdgeType =
  | 'supports'
  | 'derived-from'
  | 'related'
  | 'applies-to'
  | 'contradicts'
  | 'precedes';

export interface SemanticCoordinates {
  x: number;
  y: number;
  z: number;
}

export interface TrustedKnowledgeEvidence {
  id: string;
  snapshotId: string;
  sourceManifestSha256: string;
  learningEventId: string;
  evaluationEventId: string;
  sourceReference: KnowledgeSourceReference;
  confidence: number;
  verifiedAt: string;
}

export interface TrustedKnowledgeNode {
  id: string;
  label: string;
  type: TrustedKnowledgeNodeType;
  semanticKind:
    | 'concept'
    | 'verified-claim'
    | 'verified-explanation'
    | 'verified-skill'
    | 'verified-transfer'
    | 'correction'
    | 'refuted-misconception'
    | 'open-question'
    | 'source-artifact';
  epistemicStatus: 'verified' | 'refuted' | 'unknown' | 'source';
  domain: string;
  domainIds: string[];
  projectId?: string;
  projectIds: string[];
  projectNames: string[];
  classroomId?: string;
  classroomIds: string[];
  snapshotIds: string[];
  evidenceRefs: string[];
  sourceReferenceId?: string;
  timestamp: string;
  firstSeenAt: string;
  lastSeenAt: string;
  confidence: number;
  /** Kept null: a verified statement is not itself a mastery estimate. */
  mastery: null;
  coordinates: SemanticCoordinates;
  x: number;
  y: number;
  z: number;
  url?: string;
  citationId?: string;
}

export interface TrustedKnowledgeEdge {
  id: string;
  source: string;
  target: string;
  type: TrustedKnowledgeEdgeType;
  directed: boolean;
  weight: number;
  confidence: number;
  evidenceRefs: string[];
  firstSeenAt: string;
  lastSeenAt: string;
  label?: string;
}

export interface TrustedSynthesisStatement {
  id: string;
  text: string;
  nodeIds: string[];
  evidenceRefs: string[];
  confidence: number;
  projectIds: string[];
  domainIds: string[];
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface TrustedSynthesisEvolution extends TrustedSynthesisStatement {
  kind: 'introduced' | 'reinforced' | 'retired-from-current-scope' | 'corrected';
}

export interface TrustedSynthesisComparison extends TrustedSynthesisStatement {
  dimension: 'timeline' | 'domain' | 'project';
  left: string;
  right: string;
}

export interface TrustedSynthesisSupport {
  id: string;
  claimNodeId: string;
  artifactNodeId: string;
  evidenceRefs: string[];
  confidence: number;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface TrustedSynthesisConflict {
  id: string;
  misconceptionNodeId: string;
  correctionNodeId: string;
  text: string;
  evidenceRefs: string[];
  confidence: number;
  verifiedAt: string;
}

export interface TrustedSynthesisUnknown extends TrustedSynthesisStatement {
  reason: 'open-question' | 'insufficient-independent-support';
}

export interface TrustedSynthesisNextValidation extends TrustedSynthesisStatement {
  priority: 'high' | 'normal';
  validationKind: 'resolve-unknown' | 'recheck-conflict' | 'seek-independent-source';
}

export interface TrustedSynthesisReport {
  schemaVersion: typeof TRUSTED_SYNTHESIS_VERSION;
  conclusions: TrustedSynthesisStatement[];
  evolution: TrustedSynthesisEvolution[];
  comparisons: TrustedSynthesisComparison[];
  supports: TrustedSynthesisSupport[];
  conflicts: TrustedSynthesisConflict[];
  unknowns: TrustedSynthesisUnknown[];
  nextValidations: TrustedSynthesisNextValidation[];
}

export interface TrustedKnowledgeSpaceGraph {
  schemaVersion: typeof TRUSTED_KNOWLEDGE_SPACE_VERSION;
  generatedAt: string;
  coordinateModel: {
    version: typeof SEMANTIC_COORDINATE_MODEL_VERSION;
    algorithm: 'centered-tfidf-pca-with-interpretable-fallback';
    vocabulary: string[];
    components: Array<{
      axis: 'x' | 'y' | 'z';
      eigenvalue: number;
      positiveTerms: string[];
      negativeTerms: string[];
      fallback?: 'time' | 'domain' | 'epistemic-confidence';
    }>;
    usesIdentifiersAsCoordinates: false;
  };
  dimensions: {
    x: 'semantic-component-1';
    y: 'semantic-component-2';
    z: 'semantic-component-3';
  };
  projections: {
    twoDimensional: {
      nodeModel: 'shared';
      coordinateField: 'coordinates';
      axes: ['x', 'y'];
    };
    threeDimensional: {
      nodeModel: 'shared';
      coordinateField: 'coordinates';
      axes: ['x', 'y', 'z'];
    };
  };
  facets: {
    timeline: Array<{ key: string; nodeIds: string[] }>;
    domains: Array<{ key: string; label: string; nodeIds: string[] }>;
    projects: Array<{ key: string; label: string; nodeIds: string[] }>;
  };
  domains: string[];
  nodes: TrustedKnowledgeNode[];
  edges: TrustedKnowledgeEdge[];
  evidence: TrustedKnowledgeEvidence[];
  synthesis: TrustedSynthesisReport;
  inputAudit: {
    acceptedSnapshotIds: string[];
    rejectedSnapshots: Array<{ snapshotId: string; reason: string }>;
    rejectedEntryCount: number;
  };
  statistics: {
    snapshotCount: number;
    nodeCount: number;
    edgeCount: number;
    evidenceCount: number;
    nodeCountsByType: Record<TrustedKnowledgeNodeType, number>;
  };
}

export interface TrustedSynthesisBuildResult {
  graph: TrustedKnowledgeSpaceGraph;
  markdown: string;
  evidenceManifest: SynthesisEvidenceFingerprint[];
  taskCandidates: SynthesisTaskCandidate[];
  selectedSnapshots: TrustedKnowledgeSnapshotInput[];
}

interface DomainDefinition {
  id: string;
  label: string;
  pattern: RegExp;
}

const DOMAIN_DEFINITIONS: DomainDefinition[] = [
  {
    id: 'software-ai',
    label: '软件与人工智能',
    pattern:
      /\b(ai|agent|algorithm|api|code|database|github|llm|model|programming|react|software|typescript|vercel)\b|人工智能|大模型|算法|编程|代码|软件|数据库|架构|接口|部署|智能体/iu,
  },
  {
    id: 'research-methods',
    label: '研究与方法',
    pattern:
      /\b(arxiv|experiment|methodology|paper|research|study|survey)\b|论文|研究|实验|方法论|综述|证据|科研/iu,
  },
  {
    id: 'learning-cognition',
    label: '学习与认知',
    pattern:
      /\b(active recall|cognition|learning|memory|retrieval|review)\b|学习|记忆|认知|反刍|复习|检索练习|遗忘/iu,
  },
  {
    id: 'product-business',
    label: '产品与商业',
    pattern:
      /\b(business|market|product|strategy|user experience)\b|产品|商业|市场|战略|用户体验|运营/iu,
  },
  {
    id: 'natural-sciences',
    label: '自然科学',
    pattern:
      /\b(biology|chemistry|climate|medicine|physics|quantum|science)\b|物理|化学|生物|医学|气候|量子|自然科学/iu,
  },
  {
    id: 'humanities-social',
    label: '人文与社会',
    pattern:
      /\b(culture|education|history|law|philosophy|politics|society)\b|历史|哲学|社会|政治|法律|文化|教育/iu,
  },
];

const STOPWORDS = new Set([
  'about',
  'after',
  'also',
  'and',
  'are',
  'can',
  'for',
  'from',
  'how',
  'into',
  'that',
  'the',
  'this',
  'with',
  '一个',
  '以及',
  '什么',
  '可以',
  '如何',
  '学习',
  '已经',
  '我们',
  '这个',
  '这些',
  '进行',
  '通过',
]);

function cleanText(value: string, maximum = 2_000): string {
  return value
    .replace(/<!--\s*\/?vaultide:managed\b[^>]*-->/giu, 'Vaultide managed')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, '')
    .replace(/\r\n?/gu, '\n')
    .replace(/[ \t]+/gu, ' ')
    .trim()
    .slice(0, maximum);
}

function normalizedIdentityText(value: string): string {
  return cleanText(value).normalize('NFKC').toLocaleLowerCase().replace(/\s+/gu, ' ');
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonical(item)]),
    );
  }
  return value;
}

function sha256(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonical(value)), 'utf8')
    .digest('hex');
}

function stableId(prefix: string, value: unknown): string {
  return `${prefix}_${sha256(value).slice(0, 32)}`;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function validDate(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}

function sourceReferenceKey(reference: KnowledgeSourceReference): string {
  return (
    reference.sourceVersionId ??
    reference.sourceId ??
    reference.locator ??
    reference.citationId ??
    reference.contentHash ??
    reference.referenceId
  );
}

function isTraceableSourceReference(reference: KnowledgeSourceReference): boolean {
  if (!reference || typeof reference.referenceId !== 'string' || !reference.referenceId.trim()) {
    return false;
  }
  if (reference.locator && isManagedVaultidePath(reference.locator)) return false;
  if (reference.contentHash && !/^[a-f0-9]{64}$/iu.test(reference.contentHash)) return false;
  return Boolean(
    reference.citationId ||
    reference.sourceId ||
    reference.sourceVersionId ||
    reference.locator ||
    reference.contentHash ||
    reference.referenceId,
  );
}

function isTrustedTrace(
  trace: VerifiedKnowledgeEntry['trace'],
  requireCanonicalSource: boolean,
): boolean {
  if (
    !trace ||
    !trace.learningEventId ||
    !trace.evaluationEventId ||
    !validDate(trace.verifiedAt) ||
    !Number.isFinite(trace.confidence) ||
    trace.confidence < MINIMUM_KNOWLEDGE_VERIFICATION_SCORE
  ) {
    return false;
  }
  const references = trace.sourceReferences.filter(isTraceableSourceReference);
  return requireCanonicalSource
    ? references.some((reference) => reference.kind !== 'artifact')
    : references.length > 0;
}

function trustedSnapshot(input: TrustedKnowledgeSnapshotInput): {
  snapshot?: TrustedKnowledgeSnapshotInput;
  rejectedEntries: number;
  reason?: string;
} {
  if (!input.eligibleForPersistence) {
    return { rejectedEntries: 0, reason: 'snapshot_not_eligible_for_persistence' };
  }
  if (!/^[a-f0-9]{64}$/iu.test(input.sourceManifestSha256)) {
    return { rejectedEntries: 0, reason: 'source_manifest_hash_invalid' };
  }
  if (
    input.evidenceSummary.projectorVersion !== KNOWLEDGE_SNAPSHOT_PROJECTOR_VERSION ||
    input.evidenceSummary.acceptedEvaluationEventIds.length === 0
  ) {
    return { rejectedEntries: 0, reason: 'system_evaluation_evidence_missing' };
  }
  if (
    !Number.isInteger(input.revision) ||
    input.revision < 1 ||
    !Number.isFinite(input.createdAt.getTime())
  ) {
    return { rejectedEntries: 0, reason: 'snapshot_revision_or_time_invalid' };
  }

  const verifiedKnowledge = input.verifiedKnowledge.filter((entry) => {
    const text = cleanText(entry.text);
    if (text.length < 6) return false;
    const canonicalRequired = entry.kind === 'claim' || entry.kind === 'explanation';
    return isTrustedTrace(entry.trace, canonicalRequired);
  });
  const misconceptions = input.misconceptions.filter(
    (entry) =>
      cleanText(entry.misconception).length >= 6 &&
      cleanText(entry.correction).length >= 6 &&
      normalizedIdentityText(entry.misconception) !== normalizedIdentityText(entry.correction) &&
      isTrustedTrace(entry.trace, true),
  );
  const unresolvedItems = input.unresolvedItems.filter(
    (entry) => cleanText(entry.question).length >= 6 && isTrustedTrace(entry.trace, false),
  );
  const totalInput =
    input.verifiedKnowledge.length + input.misconceptions.length + input.unresolvedItems.length;
  const totalAccepted = verifiedKnowledge.length + misconceptions.length + unresolvedItems.length;
  if (totalAccepted === 0) {
    return {
      rejectedEntries: totalInput,
      reason: 'snapshot_contains_no_traceable_verified_knowledge',
    };
  }
  return {
    snapshot: {
      ...input,
      topicTags: unique(input.topicTags.map((tag) => cleanText(tag, 80)).filter(Boolean)),
      verifiedKnowledge,
      misconceptions,
      unresolvedItems,
    },
    rejectedEntries: totalInput - totalAccepted,
  };
}

export function inferKnowledgeDomains(value: string): Array<{ id: string; label: string }> {
  const matched = DOMAIN_DEFINITIONS.filter((definition) => definition.pattern.test(value)).map(
    ({ id, label }) => ({ id, label }),
  );
  return matched.length > 0 ? matched : [{ id: 'general', label: '通用知识' }];
}

function sourceTypeFor(input: TrustedKnowledgeSnapshotInput): SynthesisSourceType {
  return input.sourceMode;
}

function snapshotSearchText(input: TrustedKnowledgeSnapshotInput): string {
  return [
    input.projectName,
    ...input.topicTags,
    ...input.verifiedKnowledge.map((entry) => entry.text),
    ...input.misconceptions.flatMap((entry) => [entry.misconception, entry.correction]),
    ...input.unresolvedItems.map((entry) => entry.question),
  ]
    .filter(Boolean)
    .join('\n');
}

function withinRequestScope(
  input: TrustedKnowledgeSnapshotInput,
  request: SynthesisRequest,
): boolean {
  const timestamp = input.createdAt.getTime();
  const timeFrom = request.timeFrom ? Date.parse(request.timeFrom) : Number.NEGATIVE_INFINITY;
  const timeTo = request.timeTo
    ? Date.parse(request.timeTo) + 86_399_999
    : Number.POSITIVE_INFINITY;
  if (!Number.isFinite(timestamp) || timestamp < timeFrom || timestamp > timeTo) return false;
  if (
    request.projectIds?.length &&
    (!input.projectId || !request.projectIds.includes(input.projectId))
  ) {
    return false;
  }
  if (
    request.classroomIds?.length &&
    (!input.classroomId || !request.classroomIds.includes(input.classroomId))
  ) {
    return false;
  }
  if (request.sourceType && sourceTypeFor(input) !== request.sourceType) return false;
  const searchText = snapshotSearchText(input);
  if (
    request.domainQuery &&
    !searchText.toLocaleLowerCase().includes(request.domainQuery.trim().toLocaleLowerCase())
  ) {
    return false;
  }
  if (request.domain) {
    const requested = request.domain.trim().toLocaleLowerCase();
    const domains = inferKnowledgeDomains(searchText);
    if (
      !domains.some(
        (domain) => domain.id === requested || domain.label.toLocaleLowerCase() === requested,
      )
    ) {
      return false;
    }
  }
  if (request.topicTags?.length) {
    const available = new Set(input.topicTags.map((tag) => tag.toLocaleLowerCase()));
    if (!request.topicTags.every((tag) => available.has(tag.trim().toLocaleLowerCase())))
      return false;
  }
  return true;
}

export function selectTrustedKnowledgeSnapshots(
  inputs: readonly TrustedKnowledgeSnapshotInput[],
  request: SynthesisRequest,
): {
  selected: TrustedKnowledgeSnapshotInput[];
  audit: TrustedKnowledgeSpaceGraph['inputAudit'];
} {
  const accepted: TrustedKnowledgeSnapshotInput[] = [];
  const rejectedSnapshots: Array<{ snapshotId: string; reason: string }> = [];
  let rejectedEntryCount = 0;
  for (const input of inputs) {
    const checked = trustedSnapshot(input);
    rejectedEntryCount += checked.rejectedEntries;
    if (!checked.snapshot) {
      rejectedSnapshots.push({
        snapshotId: input.snapshotId,
        reason: checked.reason ?? 'snapshot_rejected',
      });
      continue;
    }
    if (withinRequestScope(checked.snapshot, request)) accepted.push(checked.snapshot);
  }
  accepted.sort(
    (left, right) =>
      left.createdAt.getTime() - right.createdAt.getTime() ||
      left.scopeId.localeCompare(right.scopeId) ||
      left.revision - right.revision ||
      left.snapshotId.localeCompare(right.snapshotId),
  );
  if (accepted.length > MAX_SYNTHESIS_SNAPSHOTS) {
    throw new Error(
      `trusted_synthesis_scope_too_broad:${accepted.length}:maximum_${MAX_SYNTHESIS_SNAPSHOTS}`,
    );
  }
  return {
    selected: accepted,
    audit: {
      acceptedSnapshotIds: accepted.map((snapshot) => snapshot.snapshotId),
      rejectedSnapshots,
      rejectedEntryCount,
    },
  };
}

function semanticTokens(value: string): string[] {
  const normalized = cleanText(value)
    .normalize('NFKC')
    .replace(/([a-z])([A-Z])/gu, '$1 $2')
    .toLocaleLowerCase();
  const output: string[] = [];
  const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'word' });
  for (const segment of segmenter.segment(normalized)) {
    const token = segment.segment.replace(/^[^\p{L}\p{N}+#.-]+|[^\p{L}\p{N}+#.-]+$/gu, '').trim();
    if (!token || STOPWORDS.has(token) || /^\d+(?:\.\d+)?$/u.test(token)) continue;
    if (/^\p{Script=Han}+$/u.test(token) ? token.length >= 2 : token.length >= 3) {
      output.push(token.slice(0, 48));
    }
  }
  return output;
}

function artifactLabel(reference: KnowledgeSourceReference): string {
  const value =
    reference.locator ??
    reference.citationId ??
    reference.sourceVersionId ??
    reference.sourceId ??
    reference.referenceId;
  return cleanText(value, 180);
}

function evidenceId(
  snapshot: TrustedKnowledgeSnapshotInput,
  trace: VerifiedKnowledgeEntry['trace'],
  reference: KnowledgeSourceReference,
): string {
  return stableId('kse', {
    snapshotId: snapshot.snapshotId,
    learningEventId: trace.learningEventId,
    evaluationEventId: trace.evaluationEventId,
    source: sourceReferenceKey(reference),
  });
}

interface MutableNode extends Omit<TrustedKnowledgeNode, 'coordinates' | 'x' | 'y' | 'z'> {
  evidenceRefs: string[];
  projectIds: string[];
  projectNames: string[];
  classroomIds: string[];
  snapshotIds: string[];
  domainIds: string[];
  coordinates?: SemanticCoordinates;
  x?: number;
  y?: number;
  z?: number;
}

interface MutableEdge extends TrustedKnowledgeEdge {
  evidenceRefs: string[];
}

function mergeNode(target: MutableNode, incoming: MutableNode): MutableNode {
  const firstSeenAt =
    Date.parse(target.firstSeenAt) <= Date.parse(incoming.firstSeenAt)
      ? target.firstSeenAt
      : incoming.firstSeenAt;
  const lastSeenAt =
    Date.parse(target.lastSeenAt) >= Date.parse(incoming.lastSeenAt)
      ? target.lastSeenAt
      : incoming.lastSeenAt;
  return {
    ...target,
    projectId: target.projectId ?? incoming.projectId,
    classroomId: target.classroomId ?? incoming.classroomId,
    projectIds: unique([...target.projectIds, ...incoming.projectIds]),
    projectNames: unique([...target.projectNames, ...incoming.projectNames]),
    classroomIds: unique([...target.classroomIds, ...incoming.classroomIds]),
    snapshotIds: unique([...target.snapshotIds, ...incoming.snapshotIds]),
    evidenceRefs: unique([...target.evidenceRefs, ...incoming.evidenceRefs]),
    domainIds: unique([...target.domainIds, ...incoming.domainIds]),
    firstSeenAt,
    lastSeenAt,
    timestamp: lastSeenAt,
    confidence: Math.max(target.confidence, incoming.confidence),
    url: target.url ?? incoming.url,
    citationId: target.citationId ?? incoming.citationId,
  };
}

function clamp(value: number, minimum = -1, maximum = 1): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function rounded(value: number): number {
  return Number(clamp(value).toFixed(6));
}

interface CoordinateProjection {
  coordinates: Map<string, SemanticCoordinates>;
  model: TrustedKnowledgeSpaceGraph['coordinateModel'];
}

function covarianceMatrix(vectors: readonly number[][]): number[][] {
  if (vectors.length === 0 || vectors[0]!.length === 0) return [];
  const dimensions = vectors[0]!.length;
  const result = Array.from({ length: dimensions }, () => Array(dimensions).fill(0) as number[]);
  const divisor = Math.max(1, vectors.length - 1);
  for (const vector of vectors) {
    for (let row = 0; row < dimensions; row += 1) {
      for (let column = row; column < dimensions; column += 1) {
        result[row]![column] += (vector[row] ?? 0) * (vector[column] ?? 0);
      }
    }
  }
  for (let row = 0; row < dimensions; row += 1) {
    for (let column = row; column < dimensions; column += 1) {
      const value = result[row]![column]! / divisor;
      result[row]![column] = value;
      result[column]![row] = value;
    }
  }
  return result;
}

function jacobiEigen(matrix: readonly number[][]): {
  values: number[];
  vectors: number[][];
} {
  const size = matrix.length;
  const values = matrix.map((row) => [...row]);
  const vectors: number[][] = Array.from({ length: size }, (_, row) =>
    Array.from({ length: size }, (_, column) => (row === column ? 1 : 0)),
  );
  const maximumIterations = Math.max(24, size * size * 6);
  for (let iteration = 0; iteration < maximumIterations; iteration += 1) {
    let pivotRow = 0;
    let pivotColumn = 0;
    let largest = 0;
    for (let row = 0; row < size; row += 1) {
      for (let column = row + 1; column < size; column += 1) {
        const magnitude = Math.abs(values[row]![column]!);
        if (magnitude > largest) {
          largest = magnitude;
          pivotRow = row;
          pivotColumn = column;
        }
      }
    }
    if (largest < 1e-10) break;
    const diagonalDifference = values[pivotColumn]![pivotColumn]! - values[pivotRow]![pivotRow]!;
    const angle = 0.5 * Math.atan2(2 * values[pivotRow]![pivotColumn]!, diagonalDifference);
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    for (let index = 0; index < size; index += 1) {
      if (index === pivotRow || index === pivotColumn) continue;
      const rowValue = values[index]![pivotRow]!;
      const columnValue = values[index]![pivotColumn]!;
      values[index]![pivotRow] = cosine * rowValue - sine * columnValue;
      values[pivotRow]![index] = values[index]![pivotRow]!;
      values[index]![pivotColumn] = sine * rowValue + cosine * columnValue;
      values[pivotColumn]![index] = values[index]![pivotColumn]!;
    }
    const rowDiagonal = values[pivotRow]![pivotRow]!;
    const columnDiagonal = values[pivotColumn]![pivotColumn]!;
    const offDiagonal = values[pivotRow]![pivotColumn]!;
    values[pivotRow]![pivotRow] =
      cosine * cosine * rowDiagonal -
      2 * sine * cosine * offDiagonal +
      sine * sine * columnDiagonal;
    values[pivotColumn]![pivotColumn] =
      sine * sine * rowDiagonal +
      2 * sine * cosine * offDiagonal +
      cosine * cosine * columnDiagonal;
    values[pivotRow]![pivotColumn] = 0;
    values[pivotColumn]![pivotRow] = 0;
    for (let row = 0; row < size; row += 1) {
      const rowVector = vectors[row]![pivotRow]!;
      const columnVector = vectors[row]![pivotColumn]!;
      vectors[row]![pivotRow] = cosine * rowVector - sine * columnVector;
      vectors[row]![pivotColumn] = sine * rowVector + cosine * columnVector;
    }
  }
  return {
    values: values.map((row, index) => row[index] ?? 0),
    vectors,
  };
}

function semanticCoordinates(nodes: readonly MutableNode[]): CoordinateProjection {
  const documents = nodes.map((node) => [
    ...semanticTokens(node.label),
    `type:${node.type}`,
    `status:${node.epistemicStatus}`,
    ...node.domainIds.map((domain) => `domain:${domain}`),
    ...node.projectNames.flatMap(semanticTokens),
  ]);
  const documentFrequency = new Map<string, number>();
  for (const document of documents) {
    for (const token of new Set(document)) {
      documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
    }
  }
  const vocabulary = [...documentFrequency.entries()]
    .sort(
      ([leftToken, leftFrequency], [rightToken, rightFrequency]) =>
        rightFrequency - leftFrequency || leftToken.localeCompare(rightToken),
    )
    .slice(0, MAX_SEMANTIC_FEATURES)
    .map(([token]) => token);
  const vocabularyIndex = new Map(vocabulary.map((token, index) => [token, index]));
  const vectors = documents.map((document) => {
    const frequency = new Map<string, number>();
    for (const token of document) {
      if (vocabularyIndex.has(token)) frequency.set(token, (frequency.get(token) ?? 0) + 1);
    }
    const vector = Array(vocabulary.length).fill(0) as number[];
    for (const [token, count] of frequency) {
      const index = vocabularyIndex.get(token)!;
      const idf = Math.log((documents.length + 1) / ((documentFrequency.get(token) ?? 0) + 1)) + 1;
      vector[index] = (1 + Math.log(count)) * idf;
    }
    const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
    return vector.map((value) => value / norm);
  });
  const means = vocabulary.map(
    (_, index) =>
      vectors.reduce((sum, vector) => sum + (vector[index] ?? 0), 0) / Math.max(1, vectors.length),
  );
  const centered = vectors.map((vector) =>
    vector.map((value, index) => value - (means[index] ?? 0)),
  );
  const eigen = jacobiEigen(covarianceMatrix(centered));
  const ranked = eigen.values
    .map((value, index) => ({ value, index }))
    .sort((left, right) => right.value - left.value || left.index - right.index)
    .slice(0, 3);
  const componentVectors = ranked.map(({ index }) => {
    const vector = eigen.vectors.map((row) => row[index] ?? 0);
    const anchor = vector.reduce(
      (best, value, position) => (Math.abs(value) > Math.abs(vector[best] ?? 0) ? position : best),
      0,
    );
    return (vector[anchor] ?? 0) < 0 ? vector.map((value) => -value) : vector;
  });
  const projected = centered.map((vector) =>
    componentVectors.map((component) =>
      vector.reduce((sum, value, index) => sum + value * (component[index] ?? 0), 0),
    ),
  );
  const maximums = [0, 1, 2].map((axis) =>
    Math.max(0, ...projected.map((coordinates) => Math.abs(coordinates[axis] ?? 0))),
  );
  const timestamps = nodes.map((node) => Date.parse(node.timestamp)).filter(Number.isFinite);
  const earliest = timestamps.length ? Math.min(...timestamps) : 0;
  const latest = timestamps.length ? Math.max(...timestamps) : earliest;
  const domainKeys = unique(nodes.flatMap((node) => node.domainIds));
  const fallbackValues = nodes.map((node) => {
    const time =
      latest === earliest
        ? 0
        : ((Date.parse(node.timestamp) - earliest) / (latest - earliest)) * 2 - 1;
    const domainIndex = Math.max(0, domainKeys.indexOf(node.domainIds[0] ?? 'general'));
    const domain =
      domainKeys.length <= 1 ? 0 : (domainIndex / Math.max(1, domainKeys.length - 1)) * 2 - 1;
    const statusOffset =
      node.epistemicStatus === 'verified'
        ? 0.25
        : node.epistemicStatus === 'source'
          ? 0
          : node.epistemicStatus === 'unknown'
            ? -0.35
            : -0.7;
    return [time, domain, clamp(node.confidence * 1.4 - 0.7 + statusOffset)];
  });
  const fallbackNames = ['time', 'domain', 'epistemic-confidence'] as const;
  const coordinates = new Map<string, SemanticCoordinates>();
  nodes.forEach((node, nodeIndex) => {
    const values = [0, 1, 2].map((axis) =>
      (ranked[axis]?.value ?? 0) > 1e-8 && (maximums[axis] ?? 0) > 1e-8
        ? (projected[nodeIndex]?.[axis] ?? 0) / (maximums[axis] ?? 1)
        : (fallbackValues[nodeIndex]?.[axis] ?? 0),
    );
    coordinates.set(node.id, {
      x: rounded(values[0] ?? 0),
      y: rounded(values[1] ?? 0),
      z: rounded(values[2] ?? 0),
    });
  });
  const components: TrustedKnowledgeSpaceGraph['coordinateModel']['components'] = (
    ['x', 'y', 'z'] as const
  ).map((axis, axisIndex) => {
    const component = componentVectors[axisIndex] ?? [];
    const terms = vocabulary
      .map((term, index) => ({ term, weight: component[index] ?? 0 }))
      .sort(
        (left, right) =>
          Math.abs(right.weight) - Math.abs(left.weight) || left.term.localeCompare(right.term),
      )
      .slice(0, 12);
    const eigenvalue = Math.max(0, ranked[axisIndex]?.value ?? 0);
    return {
      axis,
      eigenvalue: Number(eigenvalue.toFixed(8)),
      positiveTerms: terms
        .filter((term) => term.weight > 0)
        .slice(0, 5)
        .map((term) => term.term),
      negativeTerms: terms
        .filter((term) => term.weight < 0)
        .slice(0, 5)
        .map((term) => term.term),
      ...(eigenvalue <= 1e-8 ? { fallback: fallbackNames[axisIndex] } : {}),
    };
  });
  return {
    coordinates,
    model: {
      version: SEMANTIC_COORDINATE_MODEL_VERSION,
      algorithm: 'centered-tfidf-pca-with-interpretable-fallback',
      vocabulary,
      components,
      usesIdentifiersAsCoordinates: false,
    },
  };
}

function timeBucket(value: string): string {
  return validDate(value) ? new Date(value).toISOString().slice(0, 7) : 'unknown-time';
}

function groupedFacet(
  nodes: readonly TrustedKnowledgeNode[],
  values: (node: TrustedKnowledgeNode) => Array<{ key: string; label: string }>,
): Array<{ key: string; label: string; nodeIds: string[] }> {
  const groups = new Map<string, { label: string; nodeIds: string[] }>();
  for (const node of nodes) {
    for (const item of values(node)) {
      const group = groups.get(item.key) ?? { label: item.label, nodeIds: [] };
      group.nodeIds.push(node.id);
      groups.set(item.key, group);
    }
  }
  return [...groups.entries()]
    .map(([key, value]) => ({ key, label: value.label, nodeIds: unique(value.nodeIds) }))
    .sort((left, right) => left.key.localeCompare(right.key));
}

function reportStatement(node: TrustedKnowledgeNode, text = node.label): TrustedSynthesisStatement {
  return {
    id: stableId('sts', { nodeId: node.id, text }),
    text,
    nodeIds: [node.id],
    evidenceRefs: node.evidenceRefs,
    confidence: node.confidence,
    projectIds: node.projectIds,
    domainIds: node.domainIds,
    firstSeenAt: node.firstSeenAt,
    lastSeenAt: node.lastSeenAt,
  };
}

function buildComparisons(
  nodes: readonly TrustedKnowledgeNode[],
  dimension: TrustedSynthesisComparison['dimension'],
): TrustedSynthesisComparison[] {
  const eligible = nodes.filter(
    (node) =>
      (node.type === 'claim' || node.type === 'skill') && node.epistemicStatus === 'verified',
  );
  const memberships = new Map<string, { label: string; nodes: TrustedKnowledgeNode[] }>();
  for (const node of eligible) {
    const entries =
      dimension === 'project'
        ? node.projectIds.map((key, index) => ({
            key,
            label: node.projectNames[index] ?? key,
          }))
        : dimension === 'domain'
          ? node.domainIds.map((key) => ({
              key,
              label: DOMAIN_DEFINITIONS.find((definition) => definition.id === key)?.label ?? key,
            }))
          : [{ key: timeBucket(node.timestamp), label: timeBucket(node.timestamp) }];
    for (const entry of entries) {
      const group = memberships.get(entry.key) ?? { label: entry.label, nodes: [] };
      group.nodes.push(node);
      memberships.set(entry.key, group);
    }
  }
  const groups = [...memberships.entries()]
    .map(([key, value]) => ({ key, ...value }))
    .sort(
      (left, right) => right.nodes.length - left.nodes.length || left.key.localeCompare(right.key),
    )
    .slice(0, 6);
  const comparisons: TrustedSynthesisComparison[] = [];
  for (let index = 0; index < groups.length - 1; index += 1) {
    const left = groups[index]!;
    const right = groups[index + 1]!;
    const leftConcepts = new Set(
      left.nodes.flatMap((node) => semanticTokens(node.label)).filter((token) => token.length >= 2),
    );
    const shared = unique(
      right.nodes
        .flatMap((node) => semanticTokens(node.label))
        .filter((token) => leftConcepts.has(token)),
    ).slice(0, 6);
    const evidenceRefs = unique([
      ...left.nodes.flatMap((node) => node.evidenceRefs),
      ...right.nodes.flatMap((node) => node.evidenceRefs),
    ]);
    const text = `${left.label} 含 ${left.nodes.length} 个已验证知识条目，${right.label} 含 ${right.nodes.length} 个；${
      shared.length > 0 ? `共同概念：${shared.join('、')}` : '当前证据未显示稳定的共同概念'
    }。`;
    comparisons.push({
      id: stableId('cmp', { dimension, left: left.key, right: right.key, text }),
      dimension,
      left: left.label,
      right: right.label,
      text,
      nodeIds: unique([
        ...left.nodes.map((node) => node.id),
        ...right.nodes.map((node) => node.id),
      ]),
      evidenceRefs,
      confidence: Math.min(...[...left.nodes, ...right.nodes].map((node) => node.confidence)),
      projectIds: unique([...left.nodes, ...right.nodes].flatMap((node) => node.projectIds)),
      domainIds: unique([...left.nodes, ...right.nodes].flatMap((node) => node.domainIds)),
      firstSeenAt: [...left.nodes, ...right.nodes].map((node) => node.firstSeenAt).sort()[0]!,
      lastSeenAt: [...left.nodes, ...right.nodes]
        .map((node) => node.lastSeenAt)
        .sort()
        .at(-1)!,
    });
  }
  return comparisons;
}

function markdownEvidenceRefs(evidenceRefs: readonly string[]): string {
  return evidenceRefs.length > 0 ? `〔${evidenceRefs.slice(0, 8).join('，')}〕` : '〔无可用证据〕';
}

function renderTrustedSynthesisMarkdown(input: {
  title: string;
  request: SynthesisRequest;
  graph: TrustedKnowledgeSpaceGraph;
  now: Date;
  incremental: boolean;
}): string {
  const { graph } = input;
  const section = <T>(
    title: string,
    items: readonly T[],
    render: (item: T) => string,
    empty: string,
  ): string[] => [
    `## ${title}`,
    '',
    ...(items.length > 0 ? items.map(render) : [`- ${empty}`]),
    '',
  ];
  return [
    '---',
    `maic_synthesis_schema: ${TRUSTED_SYNTHESIS_VERSION}`,
    `maic_knowledge_space_schema: ${TRUSTED_KNOWLEDGE_SPACE_VERSION}`,
    `maic_generated_at: ${input.now.toISOString()}`,
    `maic_verified_snapshot_count: ${graph.statistics.snapshotCount}`,
    `maic_incremental: ${input.incremental ? 'true' : 'false'}`,
    '---',
    '',
    `# ${input.title}`,
    '',
    '> 本归纳只使用通过系统评估、已持久化且带可追溯来源的知识快照。课堂标题、浏览次数、自评与未验证自由回答不构成结论证据。',
    '',
    '## 归纳范围',
    '',
    `- 维度：${input.request.mode === 'timeline' ? '时间线' : input.request.mode === 'domain' ? '知识板块' : '时间线 × 知识板块 × 项目'}`,
    `- 已验证快照：${graph.statistics.snapshotCount} 份`,
    `- 证据：${graph.statistics.evidenceCount} 条；语义节点：${graph.statistics.nodeCount} 个；关系：${graph.statistics.edgeCount} 条`,
    `- 语义坐标：${graph.coordinateModel.algorithm}；2D 与 3D 读取同一组节点坐标`,
    '',
    ...section(
      '核心结论',
      graph.synthesis.conclusions,
      (item) =>
        `- ${item.text} ${markdownEvidenceRefs(item.evidenceRefs)}（置信度 ${Math.round(item.confidence * 100)}%）`,
      '当前范围没有满足可信门槛的结论。',
    ),
    ...section(
      '知识演化',
      graph.synthesis.evolution,
      (item) =>
        `- **${item.kind}**：${item.text} ${markdownEvidenceRefs(item.evidenceRefs)}（${item.firstSeenAt.slice(0, 10)} → ${item.lastSeenAt.slice(0, 10)}）`,
      '当前快照不足以判断演化，系统不会凭空补写趋势。',
    ),
    ...section(
      '维度比较',
      graph.synthesis.comparisons,
      (item) =>
        `- **${item.dimension}｜${item.left} ↔ ${item.right}**：${item.text} ${markdownEvidenceRefs(item.evidenceRefs)}`,
      '当前范围不足以形成有证据的跨时间、跨板块或跨项目比较。',
    ),
    ...section(
      '支持关系',
      graph.synthesis.supports,
      (item) => {
        const claim = graph.nodes.find((node) => node.id === item.claimNodeId);
        const artifact = graph.nodes.find((node) => node.id === item.artifactNodeId);
        return `- ${artifact?.label ?? item.artifactNodeId} → ${claim?.label ?? item.claimNodeId} ${markdownEvidenceRefs(item.evidenceRefs)}（置信度 ${Math.round(item.confidence * 100)}%）`;
      },
      '没有可展示的支持关系。',
    ),
    ...section(
      '冲突与修正',
      graph.synthesis.conflicts,
      (item) => `- ${item.text} ${markdownEvidenceRefs(item.evidenceRefs)}`,
      '没有经过验证的冲突或误区修正记录。',
    ),
    ...section(
      '未知与边界',
      graph.synthesis.unknowns,
      (item) => `- ${item.text} ${markdownEvidenceRefs(item.evidenceRefs)}`,
      '当前没有带来源的开放问题；这不代表知识范围不存在其他未知。',
    ),
    ...section(
      '下一轮主动学习',
      graph.synthesis.nextValidations,
      (item) =>
        `- **${item.priority === 'high' ? '高优先级' : '常规'}**：${item.text} ${markdownEvidenceRefs(item.evidenceRefs)}`,
      '当前证据未产生新的验证任务。',
    ),
    '## 多维知识空间',
    '',
    `- 时间切片：${graph.facets.timeline.map((item) => item.key).join('、') || '无'}`,
    `- 知识板块：${graph.facets.domains.map((item) => item.label).join('、') || '无'}`,
    `- 项目：${graph.facets.projects.map((item) => item.label).join('、') || '无'}`,
    '- 2D 使用 `coordinates.x/y`；3D 使用 `coordinates.x/y/z`。两者引用同一节点、关系与证据集合。',
    '',
    '## 证据索引',
    '',
    ...graph.evidence.map((evidence) => {
      const reference = evidence.sourceReference;
      const locator =
        reference.locator ??
        reference.sourceVersionId ??
        reference.sourceId ??
        reference.citationId ??
        reference.referenceId;
      return `- **${evidence.id}**：${cleanText(locator, 300)}；快照 ${evidence.snapshotId}；评估 ${evidence.evaluationEventId}；置信度 ${Math.round(evidence.confidence * 100)}%`;
    }),
    '',
    '## 输入审计',
    '',
    `- 接受快照：${graph.inputAudit.acceptedSnapshotIds.length}`,
    `- 拒绝快照：${graph.inputAudit.rejectedSnapshots.length}`,
    `- 拒绝条目：${graph.inputAudit.rejectedEntryCount}`,
    ...(graph.inputAudit.rejectedSnapshots.length > 0
      ? graph.inputAudit.rejectedSnapshots.map((item) => `- ${item.snapshotId}：${item.reason}`)
      : []),
    '',
  ].join('\n');
}

export function trustedSynthesisEvidenceManifest(
  snapshots: readonly TrustedKnowledgeSnapshotInput[],
): SynthesisEvidenceFingerprint[] {
  return snapshots
    .map((snapshot) => ({
      // Keep the actual classroom for coverage/freshness and the immutable
      // snapshot identity for revision-level change detection.
      classroomId: snapshot.classroomId ?? snapshot.snapshotId,
      snapshotId: snapshot.snapshotId,
      activityAt: snapshot.createdAt.toISOString(),
      fingerprint: sha256({
        snapshotId: snapshot.snapshotId,
        revision: snapshot.revision,
        parentSnapshotId: snapshot.parentSnapshotId,
        sourceManifestSha256: snapshot.sourceManifestSha256,
        acceptedEvaluationEventIds: snapshot.evidenceSummary.acceptedEvaluationEventIds,
        sourceReferenceIds: snapshot.evidenceSummary.sourceReferenceIds,
      }),
    }))
    .sort(
      (left, right) =>
        left.classroomId.localeCompare(right.classroomId) ||
        (left.snapshotId ?? '').localeCompare(right.snapshotId ?? ''),
    );
}

export function buildTrustedSynthesisFilterOptions(
  inputs: readonly TrustedKnowledgeSnapshotInput[],
): SynthesisFilterOptions {
  const trusted = inputs.flatMap((input) => trustedSnapshot(input).snapshot ?? []);
  const classrooms = [
    ...new Map(
      trusted
        .filter((snapshot): snapshot is TrustedKnowledgeSnapshotInput & { classroomId: string } =>
          Boolean(snapshot.classroomId),
        )
        .map((snapshot) => {
          const domains = inferKnowledgeDomains(snapshotSearchText(snapshot));
          return [
            snapshot.classroomId,
            {
              classroomId: snapshot.classroomId,
              ...(snapshot.projectId ? { projectId: snapshot.projectId } : {}),
              ...(snapshot.projectName ? { projectName: snapshot.projectName } : {}),
              title: snapshot.projectName ?? `已验证知识快照 r${snapshot.revision}`,
              createdAt: snapshot.createdAt.toISOString(),
              domain: domains[0]?.label ?? '通用知识',
              sourceType: sourceTypeFor(snapshot),
              topicTags: snapshot.topicTags,
            },
          ] as const;
        }),
    ).values(),
  ].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  const projects = [
    ...new Map(
      trusted
        .filter((snapshot): snapshot is TrustedKnowledgeSnapshotInput & { projectId: string } =>
          Boolean(snapshot.projectId),
        )
        .map((snapshot) => [
          snapshot.projectId,
          {
            projectId: snapshot.projectId,
            projectName: snapshot.projectName ?? snapshot.projectId,
            classroomCount: new Set(
              trusted
                .filter((candidate) => candidate.projectId === snapshot.projectId)
                .map((candidate) => candidate.classroomId ?? candidate.snapshotId),
            ).size,
            latestActivityAt: trusted
              .filter((candidate) => candidate.projectId === snapshot.projectId)
              .map((candidate) => candidate.createdAt.toISOString())
              .sort()
              .at(-1)!,
          },
        ]),
    ).values(),
  ].sort((left, right) => right.latestActivityAt.localeCompare(left.latestActivityAt));
  return {
    projects,
    classrooms,
    domains: unique(
      trusted.flatMap((snapshot) =>
        inferKnowledgeDomains(snapshotSearchText(snapshot)).map((domain) => domain.label),
      ),
    ),
    topicTags: unique(trusted.flatMap((snapshot) => snapshot.topicTags)),
    sourceTypes: unique(trusted.map(sourceTypeFor)) as SynthesisSourceType[],
  };
}

export function buildTrustedKnowledgeSpace(input: {
  snapshots: readonly TrustedKnowledgeSnapshotInput[];
  request: SynthesisRequest;
  title: string;
  now: Date;
  incremental?: boolean;
}): TrustedSynthesisBuildResult {
  const selection = selectTrustedKnowledgeSnapshots(input.snapshots, input.request);
  if (selection.selected.length === 0) {
    throw new Error('trusted_synthesis_requires_verified_snapshots');
  }

  const nodes = new Map<string, MutableNode>();
  const edges = new Map<string, MutableEdge>();
  const evidence = new Map<string, TrustedKnowledgeEvidence>();
  const scopePresence = new Map<string, Map<string, Set<string>>>();
  const conflictPairs: Array<{
    misconceptionNodeId: string;
    correctionNodeId: string;
    text: string;
    evidenceRefs: string[];
    confidence: number;
    verifiedAt: string;
  }> = [];

  const addNode = (node: MutableNode, snapshot: TrustedKnowledgeSnapshotInput): MutableNode => {
    const existing = nodes.get(node.id);
    const merged = existing ? mergeNode(existing, node) : node;
    nodes.set(node.id, merged);
    const byScope = scopePresence.get(node.id) ?? new Map<string, Set<string>>();
    const scopeKey = `${snapshot.scopeKind}:${snapshot.scopeId}`;
    const snapshotIds = byScope.get(scopeKey) ?? new Set<string>();
    snapshotIds.add(snapshot.snapshotId);
    byScope.set(scopeKey, snapshotIds);
    scopePresence.set(node.id, byScope);
    return merged;
  };
  const addEdge = (edge: Omit<MutableEdge, 'id'>): MutableEdge => {
    const id = stableId('kre', {
      source: edge.source,
      target: edge.target,
      type: edge.type,
    });
    const existing = edges.get(id);
    const merged: MutableEdge = existing
      ? {
          ...existing,
          evidenceRefs: unique([...existing.evidenceRefs, ...edge.evidenceRefs]),
          confidence: Math.max(existing.confidence, edge.confidence),
          weight: Math.max(existing.weight, edge.weight),
          firstSeenAt:
            existing.firstSeenAt <= edge.firstSeenAt ? existing.firstSeenAt : edge.firstSeenAt,
          lastSeenAt:
            existing.lastSeenAt >= edge.lastSeenAt ? existing.lastSeenAt : edge.lastSeenAt,
        }
      : { id, ...edge };
    edges.set(id, merged);
    return merged;
  };

  const traceEvidence = (
    snapshot: TrustedKnowledgeSnapshotInput,
    trace: VerifiedKnowledgeEntry['trace'],
  ): {
    evidenceRefs: string[];
    artifactNodeIds: string[];
  } => {
    const evidenceRefs: string[] = [];
    const artifactNodeIds: string[] = [];
    for (const reference of trace.sourceReferences.filter(isTraceableSourceReference)) {
      const id = evidenceId(snapshot, trace, reference);
      evidence.set(id, {
        id,
        snapshotId: snapshot.snapshotId,
        sourceManifestSha256: snapshot.sourceManifestSha256,
        learningEventId: trace.learningEventId,
        evaluationEventId: trace.evaluationEventId,
        sourceReference: reference,
        confidence: trace.confidence,
        verifiedAt: trace.verifiedAt,
      });
      evidenceRefs.push(id);
      const artifactId = stableId('art', sourceReferenceKey(reference));
      const domains = inferKnowledgeDomains(
        `${artifactLabel(reference)} ${snapshotSearchText(snapshot)}`,
      );
      addNode(
        {
          id: artifactId,
          label: artifactLabel(reference),
          type: 'artifact',
          semanticKind: 'source-artifact',
          epistemicStatus: 'source',
          domain: domains[0]?.label ?? '通用知识',
          domainIds: domains.map((domain) => domain.id),
          ...(snapshot.projectId ? { projectId: snapshot.projectId } : {}),
          projectIds: snapshot.projectId ? [snapshot.projectId] : [],
          projectNames: snapshot.projectName ? [snapshot.projectName] : [],
          ...(snapshot.classroomId ? { classroomId: snapshot.classroomId } : {}),
          classroomIds: snapshot.classroomId ? [snapshot.classroomId] : [],
          snapshotIds: [snapshot.snapshotId],
          evidenceRefs: [id],
          sourceReferenceId: reference.referenceId,
          timestamp: trace.verifiedAt,
          firstSeenAt: trace.verifiedAt,
          lastSeenAt: trace.verifiedAt,
          confidence: trace.confidence,
          mastery: null,
          ...(reference.locator && /^https?:\/\//iu.test(reference.locator)
            ? { url: reference.locator }
            : {}),
          ...(reference.citationId ? { citationId: reference.citationId } : {}),
        },
        snapshot,
      );
      artifactNodeIds.push(artifactId);
    }
    return { evidenceRefs: unique(evidenceRefs), artifactNodeIds: unique(artifactNodeIds) };
  };

  const addSemanticEntry = (
    snapshot: TrustedKnowledgeSnapshotInput,
    value: {
      text: string;
      trace: VerifiedKnowledgeEntry['trace'];
      type: 'claim' | 'skill';
      semanticKind: TrustedKnowledgeNode['semanticKind'];
      epistemicStatus: TrustedKnowledgeNode['epistemicStatus'];
    },
  ): string => {
    const text = cleanText(value.text);
    const nodeId = stableId(value.type === 'claim' ? 'clm' : 'skl', {
      type: value.type,
      semanticKind: value.semanticKind,
      epistemicStatus: value.epistemicStatus,
      text: normalizedIdentityText(text),
    });
    const traced = traceEvidence(snapshot, value.trace);
    const domains = inferKnowledgeDomains(`${text} ${snapshot.topicTags.join(' ')}`);
    addNode(
      {
        id: nodeId,
        label: text,
        type: value.type,
        semanticKind: value.semanticKind,
        epistemicStatus: value.epistemicStatus,
        domain: domains[0]?.label ?? '通用知识',
        domainIds: domains.map((domain) => domain.id),
        ...(snapshot.projectId ? { projectId: snapshot.projectId } : {}),
        projectIds: snapshot.projectId ? [snapshot.projectId] : [],
        projectNames: snapshot.projectName ? [snapshot.projectName] : [],
        ...(snapshot.classroomId ? { classroomId: snapshot.classroomId } : {}),
        classroomIds: snapshot.classroomId ? [snapshot.classroomId] : [],
        snapshotIds: [snapshot.snapshotId],
        evidenceRefs: traced.evidenceRefs,
        timestamp: value.trace.verifiedAt,
        firstSeenAt: value.trace.verifiedAt,
        lastSeenAt: value.trace.verifiedAt,
        confidence: value.trace.confidence,
        mastery: null,
      },
      snapshot,
    );
    for (const artifactNodeId of traced.artifactNodeIds) {
      addEdge({
        source: artifactNodeId,
        target: nodeId,
        type: value.type === 'skill' ? 'derived-from' : 'supports',
        directed: true,
        weight: value.trace.confidence,
        confidence: value.trace.confidence,
        evidenceRefs: traced.evidenceRefs,
        firstSeenAt: value.trace.verifiedAt,
        lastSeenAt: value.trace.verifiedAt,
        label: value.type === 'skill' ? '技能来源' : '来源支持',
      });
    }
    return nodeId;
  };

  for (const snapshot of selection.selected) {
    for (const entry of snapshot.verifiedKnowledge) {
      addSemanticEntry(snapshot, {
        text: entry.text,
        trace: entry.trace,
        type: entry.kind === 'skill' || entry.kind === 'transfer-outcome' ? 'skill' : 'claim',
        semanticKind:
          entry.kind === 'claim'
            ? 'verified-claim'
            : entry.kind === 'explanation'
              ? 'verified-explanation'
              : entry.kind === 'skill'
                ? 'verified-skill'
                : 'verified-transfer',
        epistemicStatus: 'verified',
      });
    }
    for (const entry of snapshot.misconceptions) {
      const correctionNodeId = addSemanticEntry(snapshot, {
        text: entry.correction,
        trace: entry.trace,
        type: 'claim',
        semanticKind: 'correction',
        epistemicStatus: 'verified',
      });
      const misconceptionNodeId = addSemanticEntry(snapshot, {
        text: entry.misconception,
        trace: entry.trace,
        type: 'claim',
        semanticKind: 'refuted-misconception',
        epistemicStatus: 'refuted',
      });
      const traced = traceEvidence(snapshot, entry.trace);
      addEdge({
        source: correctionNodeId,
        target: misconceptionNodeId,
        type: 'contradicts',
        directed: true,
        weight: entry.trace.confidence,
        confidence: entry.trace.confidence,
        evidenceRefs: traced.evidenceRefs,
        firstSeenAt: entry.trace.verifiedAt,
        lastSeenAt: entry.trace.verifiedAt,
        label: '经验证的误区修正',
      });
      conflictPairs.push({
        misconceptionNodeId,
        correctionNodeId,
        text: `“${cleanText(entry.misconception)}”已被修正为“${cleanText(entry.correction)}”。`,
        evidenceRefs: traced.evidenceRefs,
        confidence: entry.trace.confidence,
        verifiedAt: entry.trace.verifiedAt,
      });
    }
    for (const entry of snapshot.unresolvedItems) {
      addSemanticEntry(snapshot, {
        text: entry.question,
        trace: entry.trace,
        type: 'claim',
        semanticKind: 'open-question',
        epistemicStatus: 'unknown',
      });
    }
  }

  const semanticNodes = [...nodes.values()].filter(
    (node) => node.type === 'claim' || node.type === 'skill',
  );
  const documentFrequency = new Map<string, number>();
  const tokenByNode = new Map<string, string[]>();
  for (const node of semanticNodes) {
    const tokens = semanticTokens(node.label);
    tokenByNode.set(node.id, tokens);
    for (const token of new Set(tokens)) {
      documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
    }
  }
  for (const node of semanticNodes) {
    const frequency = new Map<string, number>();
    for (const token of tokenByNode.get(node.id) ?? []) {
      frequency.set(token, (frequency.get(token) ?? 0) + 1);
    }
    const concepts = [...frequency.entries()]
      .map(([token, count]) => ({
        token,
        score:
          (1 + Math.log(count)) *
          (Math.log((semanticNodes.length + 1) / ((documentFrequency.get(token) ?? 0) + 1)) + 1) *
          (1 + Math.min(24, token.length) / 48),
      }))
      .sort(
        (left, right) =>
          right.score - left.score ||
          right.token.length - left.token.length ||
          left.token.localeCompare(right.token),
      )
      .slice(0, MAX_CONCEPTS_PER_NODE)
      .map((item) => item.token);
    const selectedConcepts =
      concepts.length > 0
        ? concepts
        : [
            DOMAIN_DEFINITIONS.find((definition) => definition.id === node.domainIds[0])?.label ??
              '通用知识',
          ];
    for (const concept of selectedConcepts) {
      const conceptId = stableId('cpt', normalizedIdentityText(concept));
      const snapshot = selection.selected.find((item) =>
        node.snapshotIds.includes(item.snapshotId),
      )!;
      addNode(
        {
          id: conceptId,
          label: concept,
          type: 'concept',
          semanticKind: 'concept',
          epistemicStatus: 'verified',
          domain: node.domain,
          domainIds: node.domainIds,
          projectId: node.projectId,
          projectIds: node.projectIds,
          projectNames: node.projectNames,
          classroomId: node.classroomId,
          classroomIds: node.classroomIds,
          snapshotIds: node.snapshotIds,
          evidenceRefs: node.evidenceRefs,
          timestamp: node.timestamp,
          firstSeenAt: node.firstSeenAt,
          lastSeenAt: node.lastSeenAt,
          confidence: node.confidence,
          mastery: null,
        },
        snapshot,
      );
      addEdge({
        source: node.id,
        target: conceptId,
        type: node.type === 'skill' ? 'applies-to' : 'related',
        directed: node.type === 'skill',
        weight: node.confidence,
        confidence: node.confidence,
        evidenceRefs: node.evidenceRefs,
        firstSeenAt: node.firstSeenAt,
        lastSeenAt: node.lastSeenAt,
        label: node.type === 'skill' ? '技能应用概念' : '陈述涉及概念',
      });
    }
  }

  const latestSnapshotByScope = new Map<string, TrustedKnowledgeSnapshotInput>();
  for (const snapshot of selection.selected) {
    const key = `${snapshot.scopeKind}:${snapshot.scopeId}`;
    const existing = latestSnapshotByScope.get(key);
    if (!existing || existing.revision < snapshot.revision)
      latestSnapshotByScope.set(key, snapshot);
  }

  const nodeListWithoutCoordinates = [...nodes.values()].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
  const coordinateProjection = semanticCoordinates(nodeListWithoutCoordinates);
  const nodeList: TrustedKnowledgeNode[] = nodeListWithoutCoordinates.map((node) => {
    const coordinates = coordinateProjection.coordinates.get(node.id) ?? { x: 0, y: 0, z: 0 };
    return {
      ...node,
      coordinates,
      x: coordinates.x,
      y: coordinates.y,
      z: coordinates.z,
    };
  });
  const nodeById = new Map(nodeList.map((node) => [node.id, node]));
  const edgeList = [...edges.values()].sort((left, right) => left.id.localeCompare(right.id));
  const evidenceList = [...evidence.values()].sort((left, right) =>
    left.id.localeCompare(right.id),
  );

  const conclusions = nodeList
    .filter(
      (node) =>
        node.type === 'claim' &&
        node.epistemicStatus === 'verified' &&
        node.semanticKind !== 'verified-explanation',
    )
    .sort(
      (left, right) =>
        right.evidenceRefs.length - left.evidenceRefs.length ||
        right.confidence - left.confidence ||
        right.lastSeenAt.localeCompare(left.lastSeenAt) ||
        left.id.localeCompare(right.id),
    )
    .slice(0, MAX_REPORT_ITEMS)
    .map((node) => reportStatement(node));
  const evolution: TrustedSynthesisEvolution[] = [];
  for (const node of nodeList.filter(
    (item) =>
      (item.type === 'claim' || item.type === 'skill') && item.epistemicStatus === 'verified',
  )) {
    evolution.push({
      ...reportStatement(node, `首次形成：${node.label}`),
      kind: 'introduced',
    });
    if (node.snapshotIds.length > 1 || node.evidenceRefs.length > 1) {
      evolution.push({
        ...reportStatement(node, `获得后续证据强化：${node.label}`),
        kind: 'reinforced',
      });
    }
    const retiredScopes = [...(scopePresence.get(node.id)?.entries() ?? [])].filter(
      ([scopeKey, presentSnapshotIds]) => {
        const latest = latestSnapshotByScope.get(scopeKey);
        return Boolean(latest && !presentSnapshotIds.has(latest.snapshotId));
      },
    );
    if (retiredScopes.length > 0) {
      evolution.push({
        ...reportStatement(node, `已不在最新范围快照中：${node.label}`),
        kind: 'retired-from-current-scope',
      });
    }
  }
  for (const conflict of conflictPairs) {
    const correction = nodeById.get(conflict.correctionNodeId);
    if (!correction) continue;
    evolution.push({
      ...reportStatement(correction, conflict.text),
      kind: 'corrected',
      nodeIds: [conflict.correctionNodeId, conflict.misconceptionNodeId],
      evidenceRefs: conflict.evidenceRefs,
      confidence: conflict.confidence,
      firstSeenAt: conflict.verifiedAt,
      lastSeenAt: conflict.verifiedAt,
    });
  }

  const comparisons = [
    ...(input.request.mode === 'timeline' || input.request.mode === 'combined'
      ? buildComparisons(nodeList, 'timeline')
      : []),
    ...(input.request.mode === 'domain' || input.request.mode === 'combined'
      ? buildComparisons(nodeList, 'domain')
      : []),
    ...buildComparisons(nodeList, 'project'),
  ].slice(0, MAX_REPORT_ITEMS);
  const supports: TrustedSynthesisSupport[] = edgeList
    .filter((edge) => edge.type === 'supports')
    .map((edge) => ({
      id: stableId('sup', edge.id),
      claimNodeId: edge.target,
      artifactNodeId: edge.source,
      evidenceRefs: edge.evidenceRefs,
      confidence: edge.confidence,
      firstSeenAt: edge.firstSeenAt,
      lastSeenAt: edge.lastSeenAt,
    }))
    .slice(0, MAX_REPORT_ITEMS);
  const conflicts: TrustedSynthesisConflict[] = conflictPairs
    .map((conflict) => ({
      id: stableId('cnf', {
        misconceptionNodeId: conflict.misconceptionNodeId,
        correctionNodeId: conflict.correctionNodeId,
      }),
      ...conflict,
    }))
    .slice(0, MAX_REPORT_ITEMS);
  const unknowns: TrustedSynthesisUnknown[] = nodeList
    .filter((node) => node.semanticKind === 'open-question')
    .map((node) => ({
      ...reportStatement(node),
      reason: 'open-question' as const,
    }));
  const lowSupportClaims = nodeList.filter((node) => {
    if (node.type !== 'claim' || node.epistemicStatus !== 'verified') return false;
    const sourceKeys = new Set(
      node.evidenceRefs
        .map((id) => evidence.get(id)?.sourceReference)
        .filter((reference): reference is KnowledgeSourceReference => Boolean(reference))
        .map(sourceReferenceKey),
    );
    return sourceKeys.size < 2;
  });
  for (const node of lowSupportClaims) {
    unknowns.push({
      ...reportStatement(node, `“${node.label}”目前只有单一独立来源支持。`),
      reason: 'insufficient-independent-support',
    });
  }
  const nextValidations: TrustedSynthesisNextValidation[] = [
    ...unknowns.map((unknown) => ({
      ...unknown,
      id: stableId('nxt', { kind: 'unknown', id: unknown.id }),
      text:
        unknown.reason === 'open-question'
          ? `检索并验证开放问题：${unknown.text}`
          : `为该结论寻找第二个独立权威来源：${unknown.text}`,
      priority: unknown.reason === 'open-question' ? ('high' as const) : ('normal' as const),
      validationKind:
        unknown.reason === 'open-question'
          ? ('resolve-unknown' as const)
          : ('seek-independent-source' as const),
    })),
    ...conflicts.map((conflict) => {
      const correction = nodeById.get(conflict.correctionNodeId);
      return {
        id: stableId('nxt', { kind: 'conflict', id: conflict.id }),
        text: `使用独立来源复核误区修正：${conflict.text}`,
        nodeIds: [conflict.correctionNodeId, conflict.misconceptionNodeId],
        evidenceRefs: conflict.evidenceRefs,
        confidence: conflict.confidence,
        projectIds: correction?.projectIds ?? [],
        domainIds: correction?.domainIds ?? [],
        firstSeenAt: conflict.verifiedAt,
        lastSeenAt: conflict.verifiedAt,
        priority: 'high' as const,
        validationKind: 'recheck-conflict' as const,
      };
    }),
  ].slice(0, MAX_REPORT_ITEMS);

  const domainFacets = groupedFacet(nodeList, (node) =>
    node.domainIds.map((key) => ({
      key,
      label: DOMAIN_DEFINITIONS.find((definition) => definition.id === key)?.label ?? node.domain,
    })),
  );
  const projectFacets = groupedFacet(nodeList, (node) =>
    node.projectIds.map((key, index) => ({
      key,
      label: node.projectNames[index] ?? key,
    })),
  );
  const timelineFacets = [
    ...new Map(
      nodeList.map((node) => {
        const key = timeBucket(node.timestamp);
        return [key, key] as const;
      }),
    ).keys(),
  ]
    .sort()
    .map((key) => ({
      key,
      nodeIds: nodeList.filter((node) => timeBucket(node.timestamp) === key).map((node) => node.id),
    }));
  const report: TrustedSynthesisReport = {
    schemaVersion: TRUSTED_SYNTHESIS_VERSION,
    conclusions,
    evolution: evolution.slice(0, MAX_REPORT_ITEMS),
    comparisons,
    supports,
    conflicts,
    unknowns: unknowns.slice(0, MAX_REPORT_ITEMS),
    nextValidations,
  };
  const graph: TrustedKnowledgeSpaceGraph = {
    schemaVersion: TRUSTED_KNOWLEDGE_SPACE_VERSION,
    generatedAt: input.now.toISOString(),
    coordinateModel: coordinateProjection.model,
    dimensions: {
      x: 'semantic-component-1',
      y: 'semantic-component-2',
      z: 'semantic-component-3',
    },
    projections: {
      twoDimensional: {
        nodeModel: 'shared',
        coordinateField: 'coordinates',
        axes: ['x', 'y'],
      },
      threeDimensional: {
        nodeModel: 'shared',
        coordinateField: 'coordinates',
        axes: ['x', 'y', 'z'],
      },
    },
    facets: {
      timeline: timelineFacets,
      domains: domainFacets,
      projects: projectFacets,
    },
    domains: unique(nodeList.map((node) => node.domain)),
    nodes: nodeList,
    edges: edgeList,
    evidence: evidenceList,
    synthesis: report,
    inputAudit: selection.audit,
    statistics: {
      snapshotCount: selection.selected.length,
      nodeCount: nodeList.length,
      edgeCount: edgeList.length,
      evidenceCount: evidenceList.length,
      nodeCountsByType: {
        concept: nodeList.filter((node) => node.type === 'concept').length,
        claim: nodeList.filter((node) => node.type === 'claim').length,
        skill: nodeList.filter((node) => node.type === 'skill').length,
        artifact: nodeList.filter((node) => node.type === 'artifact').length,
      },
    },
  };
  const taskCandidates: SynthesisTaskCandidate[] = nextValidations.map((item) => ({
    id: item.id,
    kind: item.validationKind === 'seek-independent-source' ? 'transfer' : 'review',
    title: item.text.slice(0, 180),
    priority: item.priority,
    relatedNodeIds: item.nodeIds,
    rationale: `来自可信归纳的下一验证项；证据 ${item.evidenceRefs.join('、')}`,
  }));
  return {
    graph,
    markdown: renderTrustedSynthesisMarkdown({
      title: input.title,
      request: input.request,
      graph,
      now: input.now,
      incremental: input.incremental ?? false,
    }),
    evidenceManifest: trustedSynthesisEvidenceManifest(selection.selected),
    taskCandidates,
    selectedSnapshots: selection.selected,
  };
}

/**
 * Synthesis storage still names its JSON column `graph` and exposes a legacy
 * TypeScript contract. The persisted JSON is versioned and self-describing;
 * this adapter keeps the database/API boundary backward compatible while the
 * trusted knowledge-space schema is rolled out.
 */
export function asPersistedKnowledgeGraph(graph: TrustedKnowledgeSpaceGraph): KnowledgeGraph {
  return graph as unknown as KnowledgeGraph;
}

export function asTrustedKnowledgeSpaceGraph(
  graph: KnowledgeGraph,
): TrustedKnowledgeSpaceGraph | undefined {
  const candidate = graph as unknown as Partial<TrustedKnowledgeSpaceGraph>;
  return candidate.schemaVersion === TRUSTED_KNOWLEDGE_SPACE_VERSION &&
    Array.isArray(candidate.nodes) &&
    Array.isArray(candidate.edges) &&
    Array.isArray(candidate.evidence)
    ? (candidate as TrustedKnowledgeSpaceGraph)
    : undefined;
}
