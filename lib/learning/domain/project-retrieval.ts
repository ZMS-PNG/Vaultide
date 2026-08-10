import { createHash, randomUUID } from 'node:crypto';
import type { JsonObject } from '@openmaic/learning-protocol';

export const PROJECT_RETRIEVAL_STRATEGY = 'lexical-diverse-v1' as const;
export const PROJECT_SOURCE_INDEX_VERSION = 'markdown-lexical-v1' as const;
export const DEFAULT_PROJECT_CONTEXT_CHARS = 44_000;
export const MIN_PROJECT_CONTEXT_CHARS = 20_000;
export const MAX_PROJECT_CONTEXT_CHARS = 48_000;
export const MAX_PROJECT_RETRIEVAL_CHUNKS = 16;

const TARGET_CHUNK_CHARS = 4_500;
const MIN_CHUNK_CHARS = 2_200;
const MAX_CHUNK_CHARS = 6_000;
const MAX_BODY_TERMS = 520;
const MAX_ANCHOR_TERMS = 320;
const MAX_QUERY_TERMS = 48;

const ENGLISH_STOP_WORDS = new Set([
  'about',
  'after',
  'also',
  'and',
  'are',
  'can',
  'could',
  'for',
  'from',
  'have',
  'how',
  'into',
  'learn',
  'learning',
  'need',
  'project',
  'should',
  'that',
  'the',
  'this',
  'through',
  'use',
  'what',
  'when',
  'where',
  'which',
  'with',
  'would',
]);

const HAN_STOP_TERMS = new Set([
  '一个',
  '什么',
  '可以',
  '如何',
  '学习',
  '应该',
  '怎么',
  '怎样',
  '我们',
  '我的',
  '这个',
  '这些',
  '项目',
  '需要',
]);

export interface SourceChunkDraft {
  ordinal: number;
  startChar: number;
  endChar: number;
  charCount: number;
  contentHash: string;
  headingPath: string[];
  anchorTokens: string;
  bodyTokens: string;
  tokenCount: number;
}

export interface IndexedProjectSourceChunk extends SourceChunkDraft {
  chunkId: string;
  sourceId: string;
  snapshotId: string;
}

export interface ProjectBundleContext {
  projectId: string;
  displayName: string;
  projectRevision: number;
  uploadedProjectRevision: number;
  coverage: 'partial' | 'complete';
  activeSourceCount: number;
  searchableSourceCount: number;
  pendingSourceCount: number;
  failedSourceCount: number;
  indexedChunkCount: number;
  lastIndexedAt?: Date;
}

export interface ProjectRetrievalProject {
  projectId: string;
  displayName: string;
  projectRevision: number;
  activeSourceCount: number;
  searchableSourceCount: number;
  pendingSourceCount: number;
  failedSourceCount: number;
  indexedChunkCount: number;
  lastIndexedAt?: Date;
}

export interface ProjectChunkCandidate {
  chunkId: string;
  sourceId: string;
  sourceVersionId: string;
  sourceBundleId: string;
  snapshotId: string;
  title: string;
  relativePath: string;
  chunkOrdinal: number;
  startChar: number;
  endChar: number;
  contentHash: string;
  headingPath: string[];
  score: number;
  fallback: boolean;
}

export interface ProjectRetrievalCitation {
  citationId: string;
  sourceId: string;
  sourceVersionId: string;
  sourceBundleId: string;
  snapshotId: string;
  chunkId: string;
  title: string;
  relativePath: string;
  headingPath: string[];
  chunkOrdinal: number;
  score: number;
  excerptChars: number;
  excerptPreview: string;
  matchedTerms: string[];
  selectionReason: 'goal-match' | 'required-source' | 'project-overview';
  contentHash: string;
}

export interface ProjectRetrievalAlternative {
  chunkId: string;
  sourceId: string;
  title: string;
  relativePath: string;
  headingPath: string[];
  score: number;
  excerptPreview: string;
  matchedTerms: string[];
  reason: string;
}

export interface ProjectRetrievalMetrics {
  activeSourceCount: number;
  searchableSourceCount: number;
  unavailableSourceCount: number;
  matchedSourceCount: number;
  selectedSourceCount: number;
  candidateChunkCount: number;
  selectedChunkCount: number;
  contextCharCount: number;
  contextTruncated: boolean;
  omittedCandidateCount: number;
  unavailableCandidateCount: number;
  fallbackSelectedCount: number;
}

export interface ProjectRetrievalResult {
  retrievalId: string;
  strategy: typeof PROJECT_RETRIEVAL_STRATEGY;
  matchQuality: 'strong' | 'weak';
  project: {
    projectId: string;
    displayName: string;
    projectRevision: number;
  };
  goal: string;
  context: string;
  citations: ProjectRetrievalCitation[];
  alternatives: ProjectRetrievalAlternative[];
  metrics: ProjectRetrievalMetrics;
  createdAt: string;
}

export interface SaveProjectRetrievalRun {
  id: string;
  ownerId: string;
  projectId: string;
  projectRevision: number;
  anchorBundleId?: string;
  goal: string;
  goalHash: string;
  strategy: typeof PROJECT_RETRIEVAL_STRATEGY;
  maxContextChars: number;
  contextCharCount: number;
  candidateChunkCount: number;
  selectedChunkCount: number;
  selectedSourceCount: number;
  metrics: JsonObject;
  citations: ProjectRetrievalCitation[];
  requiredSourceIds: string[];
  excludedSourceIds: string[];
  createdAt: Date;
}

interface HeadingMarker {
  index: number;
  level: number;
  title: string;
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function headingMarkers(text: string): HeadingMarker[] {
  const markers: HeadingMarker[] = [];
  let offset = 0;
  let fence: { character: '`' | '~'; length: number } | undefined;
  for (const lineWithBreak of text.match(/[^\n]*(?:\n|$)/g) ?? []) {
    if (lineWithBreak.length === 0) break;
    const line = lineWithBreak.endsWith('\n')
      ? lineWithBreak.slice(0, -1).replace(/\r$/, '')
      : lineWithBreak.replace(/\r$/, '');
    const fenceMatch = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (fenceMatch) {
      const marker = fenceMatch[1] ?? '';
      const character = marker[0] as '`' | '~';
      if (!fence) fence = { character, length: marker.length };
      else if (fence.character === character && marker.length >= fence.length) fence = undefined;
      offset += lineWithBreak.length;
      continue;
    }
    if (!fence) {
      const heading = line.match(/^ {0,3}(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/);
      const title = (heading?.[2] ?? '').trim().slice(0, 240);
      if (heading && title) {
        markers.push({ index: offset, level: heading[1]?.length ?? 1, title });
      }
    }
    offset += lineWithBreak.length;
  }
  return markers;
}

function headingPathAt(markers: readonly HeadingMarker[], index: number): string[] {
  const stack: string[] = [];
  for (const marker of markers) {
    if (marker.index > index) break;
    stack.length = Math.max(0, marker.level - 1);
    stack[marker.level - 1] = marker.title;
  }
  return stack.filter(Boolean).slice(0, 6);
}

function separatorEnd(text: string, start: number): number {
  const remaining = text.length - start;
  if (remaining <= MAX_CHUNK_CHARS) return text.length;

  const minimum = Math.min(text.length, start + MIN_CHUNK_CHARS);
  const target = Math.min(text.length, start + TARGET_CHUNK_CHARS);
  const maximum = Math.min(text.length, start + MAX_CHUNK_CHARS);

  const forwardParagraph = text.indexOf('\n\n', target);
  if (forwardParagraph >= minimum && forwardParagraph < maximum) return forwardParagraph + 2;

  const backwardParagraph = text.lastIndexOf('\n\n', target);
  if (backwardParagraph >= minimum) return backwardParagraph + 2;

  const forwardLine = text.indexOf('\n', target);
  if (forwardLine >= minimum && forwardLine < maximum) return forwardLine + 1;

  const backwardLine = text.lastIndexOf('\n', target);
  if (backwardLine >= minimum) return backwardLine + 1;

  return maximum;
}

function normalizedTerms(value: string, limit: number): string[] {
  const normalized = value.normalize('NFKC').toLocaleLowerCase('en-US');
  const terms: string[] = [];
  const seen = new Set<string>();
  const add = (term: string) => {
    if (
      term.length === 0 ||
      term.length > 64 ||
      ENGLISH_STOP_WORDS.has(term) ||
      HAN_STOP_TERMS.has(term) ||
      seen.has(term) ||
      terms.length >= limit
    ) {
      return;
    }
    seen.add(term);
    terms.push(term);
  };

  for (const match of normalized.matchAll(/[a-z0-9][a-z0-9_]{1,63}/g)) {
    const token = match[0].replaceAll('_', '');
    if (token.length >= 2) add(token);
  }

  for (const match of normalized.matchAll(/[\p{Script=Han}]+/gu)) {
    const sequence = match[0];
    if (sequence.length === 1) {
      add(sequence);
      continue;
    }
    if (sequence.length <= 12) add(sequence);
    for (let index = 0; index < sequence.length - 1 && terms.length < limit; index += 1) {
      add(sequence.slice(index, index + 2));
    }
    for (let index = 0; index < sequence.length - 2 && terms.length < limit; index += 1) {
      add(sequence.slice(index, index + 3));
    }
  }

  return terms;
}

export function projectSearchTerms(goal: string): string[] {
  return normalizedTerms(goal, MAX_QUERY_TERMS);
}

export function projectTsQuery(goal: string): string | undefined {
  const terms = projectSearchTerms(goal);
  if (terms.length === 0) return undefined;
  return terms.map((term) => `'${term}'`).join(' | ');
}

export function chunkMarkdownSource(options: {
  content: string;
  title: string;
  relativePath: string;
}): SourceChunkDraft[] {
  const markers = headingMarkers(options.content);
  const chunks: SourceChunkDraft[] = [];
  let start = 0;

  do {
    const end = start >= options.content.length ? start : separatorEnd(options.content, start);
    const headingPath = headingPathAt(markers, start);
    const exactContent = options.content.slice(start, end);
    const anchorTerms = normalizedTerms(
      [options.title, options.relativePath, ...headingPath].join('\n'),
      MAX_ANCHOR_TERMS,
    );
    const bodyTerms = normalizedTerms(exactContent, MAX_BODY_TERMS);
    chunks.push({
      ordinal: chunks.length + 1,
      startChar: start,
      endChar: end,
      charCount: end - start,
      contentHash: sha256(exactContent),
      headingPath,
      anchorTokens: anchorTerms.join(' '),
      bodyTokens: bodyTerms.join(' '),
      tokenCount: bodyTerms.length,
    });
    start = end;
  } while (start < options.content.length);

  return chunks;
}

export function projectRetrievalId(): string {
  return `prr_${randomUUID().replaceAll('-', '')}`;
}

export function projectGoalHash(goal: string): string {
  return sha256(goal);
}

export function deterministicProjectChunkId(options: {
  sourceId: string;
  sourceContentHash: string;
  ordinal: number;
  chunkContentHash: string;
}): string {
  const digest = sha256(
    [
      PROJECT_SOURCE_INDEX_VERSION,
      options.sourceId,
      options.sourceContentHash,
      String(options.ordinal),
      options.chunkContentHash,
    ].join('\0'),
  );
  return `chk_${digest.slice(0, 32)}`;
}
