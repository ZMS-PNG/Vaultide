import type { LearningEvent, LearningEventType } from './events.js';
import { isJsonObject } from './json.js';
import type { ProjectBindingRequest, ProjectBindingResponse } from './project.js';
import { PROJECT_KINDS } from './project.js';
import type { SourceBundle, SourceSnapshot } from './source.js';
import { SOURCE_ORIGINS } from './source.js';
import type { SourceUploadIntent } from './source-upload-intent.js';
import {
  API_ERROR_CODES,
  LEARNING_EVENT_SCHEMA_VERSION,
  LEARNING_PROTOCOL_VERSION,
  PROJECT_BINDING_SCHEMA_VERSION,
  SOURCE_BUNDLE_SCHEMA_VERSION,
  SOURCE_UPLOAD_INTENT_SCHEMA_VERSION,
  WRITEBACK_COMMAND_SCHEMA_VERSION,
} from './version.js';
import type { WritebackCommand } from './writeback.js';
import { WRITEBACK_FRONTMATTER_KEYS, WRITEBACK_OPERATIONS } from './writeback.js';

export interface ValidationIssue {
  path: string;
  code: string;
  message: string;
}

export type ValidationResult = { valid: true } | { valid: false; errors: ValidationIssue[] };

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function issue(errors: ValidationIssue[], path: string, code: string, message: string): void {
  errors.push({ path, code, message });
}

function done(errors: ValidationIssue[]): ValidationResult {
  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}

function stringValue(
  value: unknown,
  path: string,
  errors: ValidationIssue[],
  opts: { nonEmpty?: boolean } = { nonEmpty: true },
): value is string {
  if (typeof value !== 'string') {
    issue(errors, path, 'type', 'expected string');
    return false;
  }
  if (opts.nonEmpty !== false && value.trim().length === 0) {
    issue(errors, path, 'empty', 'expected non-empty string');
    return false;
  }
  return true;
}

function nonNegativeInteger(
  value: unknown,
  path: string,
  errors: ValidationIssue[],
): value is number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    issue(errors, path, 'range', 'expected non-negative integer');
    return false;
  }
  return true;
}

function positiveInteger(value: unknown, path: string, errors: ValidationIssue[]): value is number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    issue(errors, path, 'range', 'expected positive integer');
    return false;
  }
  return true;
}

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export function isIsoTimestamp(value: unknown): value is string {
  return typeof value === 'string' && ISO_TIMESTAMP.test(value) && !Number.isNaN(Date.parse(value));
}

function timestamp(value: unknown, path: string, errors: ValidationIssue[]): value is string {
  if (!isIsoTimestamp(value)) {
    issue(errors, path, 'timestamp', 'expected an RFC 3339 timestamp');
    return false;
  }
  return true;
}

export function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function sha256(value: unknown, path: string, errors: ValidationIssue[]): value is string {
  if (!isSha256(value)) {
    issue(errors, path, 'sha256', 'expected lowercase SHA-256 hex');
    return false;
  }
  return true;
}

function entityId(
  value: unknown,
  prefix: 'prj' | 'sou' | 'snp' | 'src' | 'cmp' | 'pdx' | 'sch' | 'sdx' | 'vdx',
  path: string,
  errors: ValidationIssue[],
): value is string {
  if (typeof value !== 'string' || !new RegExp(`^${prefix}_[a-f0-9]{32}$`).test(value)) {
    issue(errors, path, 'entity_id', `expected a ${prefix}_ entity id`);
    return false;
  }
  return true;
}

function boundedString(
  value: unknown,
  path: string,
  maximumLength: number,
  errors: ValidationIssue[],
): value is string {
  if (!stringValue(value, path, errors)) return false;
  if (value.length > maximumLength) {
    issue(errors, path, 'length', `expected at most ${maximumLength} characters`);
    return false;
  }
  return true;
}

function httpsUrl(value: unknown, path: string, errors: ValidationIssue[], host?: string): boolean {
  if (!stringValue(value, path, errors)) return false;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:') {
      issue(errors, path, 'url_protocol', 'only https URLs are allowed');
      return false;
    }
    if (host && parsed.hostname.toLowerCase() !== host) {
      issue(errors, path, 'url_host', `expected host ${host}`);
      return false;
    }
    return true;
  } catch {
    issue(errors, path, 'url', 'expected a valid URL');
    return false;
  }
}

export function isSafeVaultRelativePath(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 1024) return false;
  if (/^[a-zA-Z]:[\\/]/.test(value) || value.startsWith('/') || value.startsWith('\\'))
    return false;
  if (/[:\u0000-\u001f]/.test(value)) return false;
  const normalized = value.replaceAll('\\', '/');
  const segments = normalized.split('/');
  return segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
}

function safeMarkdownPath(value: unknown, path: string, errors: ValidationIssue[]): boolean {
  if (!isSafeVaultRelativePath(value)) {
    issue(errors, path, 'unsafe_path', 'expected a safe Vault-relative path');
    return false;
  }
  if (!value.toLowerCase().endsWith('.md')) {
    issue(errors, path, 'file_type', 'writeback target must be a Markdown file');
    return false;
  }
  return true;
}

function stamp(doc: UnknownRecord, schemaVersion: string, errors: ValidationIssue[]): void {
  if (doc.protocolVersion !== LEARNING_PROTOCOL_VERSION) {
    issue(errors, '/protocolVersion', 'protocol_version', 'unsupported protocol version');
  }
  if (doc.schemaVersion !== schemaVersion) {
    issue(errors, '/schemaVersion', 'schema_version', `expected ${schemaVersion}`);
  }
}

function rejectUnknownKeys(
  doc: UnknownRecord,
  allowed: readonly string[],
  path: string,
  errors: ValidationIssue[],
): void {
  const set = new Set(allowed);
  for (const key of Object.keys(doc)) {
    if (!set.has(key)) issue(errors, `${path}/${key}`, 'unknown_field', 'field is not allowed');
  }
}

function validateCitationAnchors(
  value: unknown,
  snapshotId: string,
  path: string,
  errors: ValidationIssue[],
): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    issue(errors, path, 'type', 'expected citation anchor array');
    return;
  }
  for (let i = 0; i < value.length; i++) {
    const anchor = value[i];
    const itemPath = `${path}/${i}`;
    if (!isRecord(anchor)) {
      issue(errors, itemPath, 'type', 'expected citation anchor object');
      continue;
    }
    stringValue(anchor.id, `${itemPath}/id`, errors);
    if (anchor.snapshotId !== snapshotId) {
      issue(errors, `${itemPath}/snapshotId`, 'reference', 'anchor must reference its snapshot');
    }
    if (
      !['heading', 'block', 'line-range', 'page', 'timestamp'].includes(String(anchor.anchorType))
    ) {
      issue(errors, `${itemPath}/anchorType`, 'enum', 'unknown citation anchor type');
    }
    sha256(anchor.quotedHash, `${itemPath}/quotedHash`, errors);
    sha256(anchor.contextHash, `${itemPath}/contextHash`, errors);
    if (anchor.startLine !== undefined)
      nonNegativeInteger(anchor.startLine, `${itemPath}/startLine`, errors);
    if (anchor.endLine !== undefined)
      nonNegativeInteger(anchor.endLine, `${itemPath}/endLine`, errors);
    if (anchor.page !== undefined) positiveInteger(anchor.page, `${itemPath}/page`, errors);
    if (
      anchor.timestampSeconds !== undefined &&
      (typeof anchor.timestampSeconds !== 'number' ||
        !Number.isFinite(anchor.timestampSeconds) ||
        anchor.timestampSeconds < 0)
    ) {
      issue(errors, `${itemPath}/timestampSeconds`, 'range', 'expected non-negative seconds');
    }
  }
}

function validateSourceSnapshot(value: unknown, path: string, errors: ValidationIssue[]): number {
  if (!isRecord(value)) {
    issue(errors, path, 'type', 'expected source snapshot object');
    return 0;
  }
  stringValue(value.id, `${path}/id`, errors);
  stringValue(value.title, `${path}/title`, errors);
  sha256(value.contentHash, `${path}/contentHash`, errors);
  stringValue(value.mimeType, `${path}/mimeType`, errors);
  const sizeValid = nonNegativeInteger(value.byteSize, `${path}/byteSize`, errors);
  if (!SOURCE_ORIGINS.includes(value.origin as (typeof SOURCE_ORIGINS)[number])) {
    issue(errors, `${path}/origin`, 'enum', 'unknown source origin');
  }
  if (!isRecord(value.locator)) {
    issue(errors, `${path}/locator`, 'type', 'expected source locator object');
  } else if (value.locator.kind !== value.origin) {
    issue(errors, `${path}/locator/kind`, 'discriminant', 'locator kind must match source origin');
  } else {
    const locator = value.locator;
    switch (value.origin) {
      case 'obsidian':
        stringValue(locator.vaultBindingId, `${path}/locator/vaultBindingId`, errors);
        if (!isSafeVaultRelativePath(locator.relativePath)) {
          issue(
            errors,
            `${path}/locator/relativePath`,
            'unsafe_path',
            'expected a safe Vault-relative path',
          );
        }
        if (locator.sourceId !== undefined)
          entityId(locator.sourceId, 'sou', `${path}/locator/sourceId`, errors);
        if (locator.sourceMtime !== undefined)
          timestamp(locator.sourceMtime, `${path}/locator/sourceMtime`, errors);
        break;
      case 'web':
        httpsUrl(locator.canonicalUrl, `${path}/locator/canonicalUrl`, errors);
        timestamp(locator.retrievedAt, `${path}/locator/retrievedAt`, errors);
        if (locator.publishedAt !== undefined)
          timestamp(locator.publishedAt, `${path}/locator/publishedAt`, errors);
        break;
      case 'pdf':
        stringValue(locator.fileName, `${path}/locator/fileName`, errors);
        sha256(locator.documentHash, `${path}/locator/documentHash`, errors);
        if (locator.pageCount !== undefined)
          positiveInteger(locator.pageCount, `${path}/locator/pageCount`, errors);
        if (locator.canonicalUrl !== undefined)
          httpsUrl(locator.canonicalUrl, `${path}/locator/canonicalUrl`, errors);
        break;
      case 'github':
        httpsUrl(locator.repositoryUrl, `${path}/locator/repositoryUrl`, errors, 'github.com');
        if (typeof locator.commit !== 'string' || !/^[a-f0-9]{7,64}$/i.test(locator.commit)) {
          issue(errors, `${path}/locator/commit`, 'git_commit', 'expected a Git commit hash');
        }
        if (!isSafeVaultRelativePath(locator.path)) {
          issue(
            errors,
            `${path}/locator/path`,
            'unsafe_path',
            'expected a safe repository-relative path',
          );
        }
        break;
      case 'arxiv':
        if (typeof locator.arxivId !== 'string' || !/^\d{4}\.\d{4,5}$/.test(locator.arxivId)) {
          issue(
            errors,
            `${path}/locator/arxivId`,
            'arxiv_id',
            'expected a modern arXiv identifier',
          );
        }
        if (locator.version !== undefined)
          positiveInteger(locator.version, `${path}/locator/version`, errors);
        httpsUrl(locator.canonicalUrl, `${path}/locator/canonicalUrl`, errors, 'arxiv.org');
        break;
      case 'manual':
        stringValue(locator.label, `${path}/locator/label`, errors);
        break;
    }
  }
  const snapshotId = typeof value.id === 'string' ? value.id : '';
  validateCitationAnchors(value.citationAnchors, snapshotId, `${path}/citationAnchors`, errors);
  return sizeValid && typeof value.byteSize === 'number' ? value.byteSize : 0;
}

export function validateSourceBundle(doc: unknown): ValidationResult {
  const errors: ValidationIssue[] = [];
  if (!isRecord(doc)) {
    return {
      valid: false,
      errors: [{ path: '/', code: 'type', message: 'expected SourceBundle object' }],
    };
  }
  stamp(doc, SOURCE_BUNDLE_SCHEMA_VERSION, errors);
  stringValue(doc.id, '/id', errors);
  stringValue(doc.ownerId, '/ownerId', errors);
  positiveInteger(doc.revision, '/revision', errors);
  sha256(doc.manifestHash, '/manifestHash', errors);
  const byteSizeValid = nonNegativeInteger(doc.byteSize, '/byteSize', errors);
  const itemCountValid = positiveInteger(doc.itemCount, '/itemCount', errors);
  stringValue(doc.selectionReason, '/selectionReason', errors);
  const createdValid = timestamp(doc.createdAt, '/createdAt', errors);
  const retentionValid = timestamp(doc.retentionUntil, '/retentionUntil', errors);
  if (
    createdValid &&
    retentionValid &&
    Date.parse(doc.retentionUntil as string) < Date.parse(doc.createdAt as string)
  ) {
    issue(errors, '/retentionUntil', 'range', 'retention must not end before creation');
  }

  if (!isRecord(doc.sourcePolicy)) {
    issue(errors, '/sourcePolicy', 'type', 'expected source policy object');
  } else {
    if (
      !['disabled', 'official-only', 'allow-general'].includes(
        String(doc.sourcePolicy.externalSearch),
      )
    ) {
      issue(errors, '/sourcePolicy/externalSearch', 'enum', 'unknown external search policy');
    }
    if (doc.sourcePolicy.allowedDomains !== undefined) {
      if (
        !Array.isArray(doc.sourcePolicy.allowedDomains) ||
        !doc.sourcePolicy.allowedDomains.every(
          (domain) => typeof domain === 'string' && /^[a-z0-9.-]+$/i.test(domain),
        )
      ) {
        issue(errors, '/sourcePolicy/allowedDomains', 'domain', 'expected hostname array');
      }
    }
    if (doc.sourcePolicy.recencyAfter !== undefined) {
      timestamp(doc.sourcePolicy.recencyAfter, '/sourcePolicy/recencyAfter', errors);
    }
  }

  if (!Array.isArray(doc.snapshots) || doc.snapshots.length === 0) {
    issue(errors, '/snapshots', 'empty', 'SourceBundle requires at least one snapshot');
  } else {
    let totalBytes = 0;
    const ids = new Set<string>();
    for (let i = 0; i < doc.snapshots.length; i++) {
      const snapshot = doc.snapshots[i] as SourceSnapshot;
      totalBytes += validateSourceSnapshot(snapshot, `/snapshots/${i}`, errors);
      if (isRecord(snapshot) && typeof snapshot.id === 'string') {
        if (ids.has(snapshot.id))
          issue(errors, `/snapshots/${i}/id`, 'duplicate', 'duplicate snapshot id');
        ids.add(snapshot.id);
      }
    }
    if (itemCountValid && doc.itemCount !== doc.snapshots.length) {
      issue(errors, '/itemCount', 'invariant', 'itemCount must equal snapshots length');
    }
    if (byteSizeValid && doc.byteSize !== totalBytes) {
      issue(errors, '/byteSize', 'invariant', 'byteSize must equal snapshot byte total');
    }
  }
  return done(errors);
}

const EVENT_TYPES: LearningEventType[] = [
  'diagnosisAnswered',
  'retrievalAttempted',
  'hintRequested',
  'answerRevealed',
  'explanationSubmitted',
  'practiceSubmitted',
  'sceneViewed',
  'sceneCompleted',
  'sprintCompleted',
  'whiteboardNoteAdded',
  'discussionParticipated',
  'feedbackReceived',
  'evidenceSubmitted',
  'evidenceEvaluated',
  'transferTaskCompleted',
  'writebackApproved',
  'writebackApplied',
  'reviewCompleted',
];

function payloadString(payload: UnknownRecord, key: string, errors: ValidationIssue[]): void {
  stringValue(payload[key], `/payload/${key}`, errors);
}

function optionalScore(value: unknown, path: string, errors: ValidationIssue[]): void {
  if (value === undefined) return;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    issue(errors, path, 'range', 'expected score between 0 and 1');
  }
}

export function validateLearningEvent(doc: unknown): ValidationResult {
  const errors: ValidationIssue[] = [];
  if (!isRecord(doc)) {
    return {
      valid: false,
      errors: [{ path: '/', code: 'type', message: 'expected LearningEvent object' }],
    };
  }
  stamp(doc, LEARNING_EVENT_SCHEMA_VERSION, errors);
  for (const key of ['id', 'ownerId', 'sprintId', 'clientEventId', 'deviceId'] as const) {
    stringValue(doc[key], `/${key}`, errors);
  }
  timestamp(doc.occurredAt, '/occurredAt', errors);
  if (doc.receivedAt !== undefined) timestamp(doc.receivedAt, '/receivedAt', errors);
  if (doc.serverSeq !== undefined) nonNegativeInteger(doc.serverSeq, '/serverSeq', errors);
  if (!['web', 'obsidian-plugin', 'system', 'import'].includes(String(doc.source))) {
    issue(errors, '/source', 'enum', 'unknown event source');
  }
  if (!EVENT_TYPES.includes(doc.eventType as LearningEventType)) {
    issue(errors, '/eventType', 'enum', 'unknown learning event type');
    return done(errors);
  }
  if (!isRecord(doc.payload)) {
    issue(errors, '/payload', 'type', 'expected event payload object');
    return done(errors);
  }
  const payload = doc.payload;
  switch (doc.eventType) {
    case 'diagnosisAnswered':
      payloadString(payload, 'questionId', errors);
      payloadString(payload, 'response', errors);
      if (payload.correct !== undefined && typeof payload.correct !== 'boolean')
        issue(errors, '/payload/correct', 'type', 'expected boolean');
      break;
    case 'retrievalAttempted':
      payloadString(payload, 'promptId', errors);
      if (payload.promptText !== undefined)
        boundedString(payload.promptText, '/payload/promptText', 2_000, errors);
      payloadString(payload, 'response', errors);
      if (payload.sceneId !== undefined) payloadString(payload, 'sceneId', errors);
      optionalScore(payload.score, '/payload/score', errors);
      if (payload.durationMs !== undefined)
        nonNegativeInteger(payload.durationMs, '/payload/durationMs', errors);
      break;
    case 'hintRequested':
      payloadString(payload, 'promptId', errors);
      if (![1, 2, 3].includes(payload.level as number))
        issue(errors, '/payload/level', 'enum', 'expected hint level 1, 2, or 3');
      break;
    case 'answerRevealed':
      payloadString(payload, 'promptId', errors);
      if (
        payload.reason !== undefined &&
        !['user-requested', 'attempt-exhausted', 'instructor-decision'].includes(
          String(payload.reason),
        )
      )
        issue(errors, '/payload/reason', 'enum', 'unknown reveal reason');
      break;
    case 'explanationSubmitted':
      payloadString(payload, 'promptId', errors);
      if (payload.promptText !== undefined)
        boundedString(payload.promptText, '/payload/promptText', 2_000, errors);
      payloadString(payload, 'response', errors);
      if (payload.sceneId !== undefined) payloadString(payload, 'sceneId', errors);
      optionalScore(payload.score, '/payload/score', errors);
      break;
    case 'practiceSubmitted':
      payloadString(payload, 'taskId', errors);
      if (payload.promptText !== undefined)
        boundedString(payload.promptText, '/payload/promptText', 2_000, errors);
      payloadString(payload, 'response', errors);
      if (payload.sceneId !== undefined) payloadString(payload, 'sceneId', errors);
      optionalScore(payload.score, '/payload/score', errors);
      break;
    case 'sceneViewed':
      payloadString(payload, 'sceneId', errors);
      if (payload.title !== undefined) stringValue(payload.title, '/payload/title', errors);
      if (payload.sceneOrder !== undefined)
        nonNegativeInteger(payload.sceneOrder, '/payload/sceneOrder', errors);
      break;
    case 'sceneCompleted':
      payloadString(payload, 'sceneId', errors);
      if (payload.sceneOrder !== undefined)
        nonNegativeInteger(payload.sceneOrder, '/payload/sceneOrder', errors);
      if (
        ![
          'manual',
          'quiz-submitted',
          'explanation-submitted',
          'practice-submitted',
          'transfer-completed',
        ].includes(String(payload.completionKind))
      ) {
        issue(errors, '/payload/completionKind', 'enum', 'unknown scene completion kind');
      }
      break;
    case 'sprintCompleted': {
      if (payload.completionVersion !== 1) {
        issue(errors, '/payload/completionVersion', 'enum', 'expected completion version 1');
      }
      const countValid = positiveInteger(
        payload.totalSceneCount,
        '/payload/totalSceneCount',
        errors,
      );
      if (!Array.isArray(payload.completedSceneIds) || payload.completedSceneIds.length === 0) {
        issue(errors, '/payload/completedSceneIds', 'empty', 'expected completed scene ids');
        break;
      }
      if (payload.completedSceneIds.length > 1000) {
        issue(errors, '/payload/completedSceneIds', 'length', 'too many completed scene ids');
      }
      const seen = new Set<string>();
      for (let index = 0; index < payload.completedSceneIds.length; index += 1) {
        const sceneId = payload.completedSceneIds[index];
        const itemPath = `/payload/completedSceneIds/${index}`;
        if (!stringValue(sceneId, itemPath, errors)) continue;
        if (sceneId.length > 128) issue(errors, itemPath, 'length', 'scene id is too long');
        if (seen.has(sceneId)) issue(errors, itemPath, 'duplicate', 'duplicate completed scene id');
        seen.add(sceneId);
      }
      if (countValid && payload.completedSceneIds.length !== payload.totalSceneCount) {
        issue(
          errors,
          '/payload/completedSceneIds',
          'invariant',
          'completed scenes must match total',
        );
      }
      break;
    }
    case 'whiteboardNoteAdded':
      payloadString(payload, 'sceneId', errors);
      if (!['understanding', 'question', 'connection'].includes(String(payload.noteKind)))
        issue(errors, '/payload/noteKind', 'enum', 'unknown study note kind');
      positiveInteger(payload.characterCount, '/payload/characterCount', errors);
      break;
    case 'discussionParticipated':
      if (payload.sceneId !== undefined) stringValue(payload.sceneId, '/payload/sceneId', errors);
      payloadString(payload, 'sessionId', errors);
      if (!['qa', 'discussion'].includes(String(payload.sessionType)))
        issue(errors, '/payload/sessionType', 'enum', 'unknown discussion session type');
      positiveInteger(payload.messageLength, '/payload/messageLength', errors);
      break;
    case 'feedbackReceived':
      payloadString(payload, 'targetEventId', errors);
      payloadString(payload, 'summary', errors);
      optionalScore(payload.score, '/payload/score', errors);
      break;
    case 'evidenceSubmitted':
      payloadString(payload, 'evidenceId', errors);
      if (
        !['code', 'test', 'document', 'design', 'decision', 'other'].includes(
          String(payload.evidenceType),
        )
      )
        issue(errors, '/payload/evidenceType', 'enum', 'unknown evidence type');
      break;
    case 'evidenceEvaluated':
      payloadString(payload, 'evidenceId', errors);
      payloadString(payload, 'rubricVersion', errors);
      if (!['passed', 'revise', 'failed'].includes(String(payload.verdict)))
        issue(errors, '/payload/verdict', 'enum', 'unknown evidence verdict');
      break;
    case 'transferTaskCompleted':
      payloadString(payload, 'taskId', errors);
      if (payload.promptText !== undefined)
        boundedString(payload.promptText, '/payload/promptText', 2_000, errors);
      if (payload.sceneId !== undefined) payloadString(payload, 'sceneId', errors);
      payloadString(payload, 'outcome', errors);
      optionalScore(payload.score, '/payload/score', errors);
      break;
    case 'writebackApproved':
      payloadString(payload, 'draftId', errors);
      positiveInteger(payload.draftRevision, '/payload/draftRevision', errors);
      break;
    case 'writebackApplied':
      payloadString(payload, 'commandId', errors);
      payloadString(payload, 'receiptId', errors);
      if (payload.outcome !== 'applied')
        issue(errors, '/payload/outcome', 'enum', 'expected applied outcome');
      break;
    case 'reviewCompleted':
      payloadString(payload, 'reviewItemId', errors);
      if (!['again', 'hard', 'good', 'easy'].includes(String(payload.rating)))
        issue(errors, '/payload/rating', 'enum', 'unknown review rating');
      if (payload.durationMs !== undefined)
        nonNegativeInteger(payload.durationMs, '/payload/durationMs', errors);
      break;
  }
  return done(errors);
}

const COMMAND_BASE_KEYS = [
  'protocolVersion',
  'schemaVersion',
  'id',
  'draftId',
  'draftRevision',
  'ownerId',
  'deviceId',
  'vaultBindingId',
  'issuedAt',
  'expiresAt',
  'operation',
  'arguments',
] as const;

function validateFrontmatter(value: unknown, path: string, errors: ValidationIssue[]): void {
  if (!isJsonObject(value)) {
    issue(errors, path, 'json', 'expected a JSON object');
    return;
  }
  const allowed = new Set<string>(WRITEBACK_FRONTMATTER_KEYS);
  for (const [key, item] of Object.entries(value)) {
    if (!allowed.has(key))
      issue(errors, `${path}/${key}`, 'frontmatter_key', 'frontmatter key is not allowed');
    if (Array.isArray(item) && !item.every((entry) => typeof entry === 'string')) {
      issue(
        errors,
        `${path}/${key}`,
        'frontmatter_value',
        'frontmatter arrays must contain strings',
      );
    }
    if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
      issue(
        errors,
        `${path}/${key}`,
        'frontmatter_value',
        'nested frontmatter objects are not allowed',
      );
    }
  }
}

function validateManagedBlockReplacements(
  value: unknown,
  path: string,
  errors: ValidationIssue[],
  operation: string,
): void {
  if (!Array.isArray(value) || value.length < 1 || value.length > 16) {
    issue(errors, path, 'range', `${operation} requires between 1 and 16 managed blocks`);
    return;
  }
  const blockIds = new Set<string>();
  value.forEach((block, index) => {
    const blockPath = `${path}/${index}`;
    if (!isRecord(block)) {
      issue(errors, blockPath, 'type', 'expected managed block object');
      return;
    }
    rejectUnknownKeys(block, ['id', 'expectedHash', 'content'], blockPath, errors);
    if (typeof block.id !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(block.id)) {
      issue(errors, `${blockPath}/id`, 'format', 'expected a safe managed block id');
    } else if (blockIds.has(block.id)) {
      issue(errors, `${blockPath}/id`, 'duplicate', 'managed block ids must be unique');
    } else {
      blockIds.add(block.id);
    }
    sha256(block.expectedHash, `${blockPath}/expectedHash`, errors);
    boundedString(block.content, `${blockPath}/content`, 500000, errors);
    if (typeof block.content === 'string' && /<!--\s*\/?vaultide:managed\b/i.test(block.content)) {
      issue(
        errors,
        `${blockPath}/content`,
        'safety',
        'managed block content may not contain Vaultide marker syntax',
      );
    }
  });
}

export function validateWritebackCommand(doc: unknown): ValidationResult {
  const errors: ValidationIssue[] = [];
  if (!isRecord(doc)) {
    return {
      valid: false,
      errors: [{ path: '/', code: 'type', message: 'expected WritebackCommand object' }],
    };
  }
  stamp(doc, WRITEBACK_COMMAND_SCHEMA_VERSION, errors);
  for (const key of ['id', 'draftId', 'ownerId', 'deviceId', 'vaultBindingId'] as const) {
    stringValue(doc[key], `/${key}`, errors);
  }
  positiveInteger(doc.draftRevision, '/draftRevision', errors);
  const issuedValid = timestamp(doc.issuedAt, '/issuedAt', errors);
  const expiresValid = timestamp(doc.expiresAt, '/expiresAt', errors);
  if (
    issuedValid &&
    expiresValid &&
    Date.parse(doc.expiresAt as string) <= Date.parse(doc.issuedAt as string)
  ) {
    issue(errors, '/expiresAt', 'range', 'command must expire after it is issued');
  }
  if (!WRITEBACK_OPERATIONS.includes(doc.operation as (typeof WRITEBACK_OPERATIONS)[number])) {
    issue(errors, '/operation', 'operation', 'writeback operation is not allowed');
    return done(errors);
  }
  if (!isRecord(doc.arguments)) {
    issue(errors, '/arguments', 'type', 'expected command arguments object');
    return done(errors);
  }
  const args = doc.arguments;
  switch (doc.operation) {
    case 'createManagedNote':
      rejectUnknownKeys(doc, COMMAND_BASE_KEYS, '', errors);
      rejectUnknownKeys(
        args,
        ['relativePath', 'content', 'frontmatter', 'expectedAbsent'],
        '/arguments',
        errors,
      );
      safeMarkdownPath(args.relativePath, '/arguments/relativePath', errors);
      stringValue(args.content, '/arguments/content', errors);
      if (args.expectedAbsent !== true)
        issue(errors, '/arguments/expectedAbsent', 'safety', 'create requires expectedAbsent=true');
      if (args.frontmatter !== undefined)
        validateFrontmatter(args.frontmatter, '/arguments/frontmatter', errors);
      break;
    case 'appendManagedSection':
      rejectUnknownKeys(doc, [...COMMAND_BASE_KEYS, 'baseContentHash'], '', errors);
      rejectUnknownKeys(args, ['relativePath', 'sectionHeading', 'content'], '/arguments', errors);
      sha256(doc.baseContentHash, '/baseContentHash', errors);
      safeMarkdownPath(args.relativePath, '/arguments/relativePath', errors);
      stringValue(args.sectionHeading, '/arguments/sectionHeading', errors);
      stringValue(args.content, '/arguments/content', errors);
      break;
    case 'updateManagedFrontmatterKeys':
      rejectUnknownKeys(doc, [...COMMAND_BASE_KEYS, 'baseContentHash'], '', errors);
      rejectUnknownKeys(args, ['relativePath', 'values'], '/arguments', errors);
      sha256(doc.baseContentHash, '/baseContentHash', errors);
      safeMarkdownPath(args.relativePath, '/arguments/relativePath', errors);
      validateFrontmatter(args.values, '/arguments/values', errors);
      if (isRecord(args.values) && Object.keys(args.values).length === 0)
        issue(errors, '/arguments/values', 'empty', 'at least one frontmatter key is required');
      break;
    case 'replaceManagedBlocks':
      rejectUnknownKeys(doc, COMMAND_BASE_KEYS, '', errors);
      rejectUnknownKeys(args, ['relativePath', 'companionId', 'blocks'], '/arguments', errors);
      safeMarkdownPath(args.relativePath, '/arguments/relativePath', errors);
      entityId(args.companionId, 'cmp', '/arguments/companionId', errors);
      validateManagedBlockReplacements(
        args.blocks,
        '/arguments/blocks',
        errors,
        'replaceManagedBlocks',
      );
      break;
    case 'replaceProjectIndexBlocks':
      rejectUnknownKeys(doc, COMMAND_BASE_KEYS, '', errors);
      rejectUnknownKeys(
        args,
        ['relativePath', 'projectId', 'projectIndexId', 'blocks'],
        '/arguments',
        errors,
      );
      safeMarkdownPath(args.relativePath, '/arguments/relativePath', errors);
      entityId(args.projectId, 'prj', '/arguments/projectId', errors);
      entityId(args.projectIndexId, 'pdx', '/arguments/projectIndexId', errors);
      validateManagedBlockReplacements(
        args.blocks,
        '/arguments/blocks',
        errors,
        'replaceProjectIndexBlocks',
      );
      break;
    case 'replaceSynthesisIndexBlocks':
      rejectUnknownKeys(doc, COMMAND_BASE_KEYS, '', errors);
      rejectUnknownKeys(
        args,
        ['relativePath', 'scheduleId', 'synthesisIndexId', 'blocks'],
        '/arguments',
        errors,
      );
      safeMarkdownPath(args.relativePath, '/arguments/relativePath', errors);
      entityId(args.scheduleId, 'sch', '/arguments/scheduleId', errors);
      entityId(args.synthesisIndexId, 'sdx', '/arguments/synthesisIndexId', errors);
      validateManagedBlockReplacements(
        args.blocks,
        '/arguments/blocks',
        errors,
        'replaceSynthesisIndexBlocks',
      );
      break;
    case 'replaceVaultOverviewBlocks':
      rejectUnknownKeys(doc, COMMAND_BASE_KEYS, '', errors);
      rejectUnknownKeys(args, ['relativePath', 'vaultOverviewId', 'blocks'], '/arguments', errors);
      safeMarkdownPath(args.relativePath, '/arguments/relativePath', errors);
      entityId(args.vaultOverviewId, 'vdx', '/arguments/vaultOverviewId', errors);
      validateManagedBlockReplacements(
        args.blocks,
        '/arguments/blocks',
        errors,
        'replaceVaultOverviewBlocks',
      );
      break;
  }
  return done(errors);
}

export function validateProjectBindingRequest(doc: unknown): ValidationResult {
  const errors: ValidationIssue[] = [];
  if (!isRecord(doc)) {
    return {
      valid: false,
      errors: [{ path: '/', code: 'type', message: 'expected ProjectBindingRequest object' }],
    };
  }
  rejectUnknownKeys(
    doc,
    [
      'protocolVersion',
      'schemaVersion',
      'projectId',
      'kind',
      'displayName',
      'folderPath',
      'expectedBindingRevision',
    ],
    '',
    errors,
  );
  stamp(doc, PROJECT_BINDING_SCHEMA_VERSION, errors);
  entityId(doc.projectId, 'prj', '/projectId', errors);
  if (!PROJECT_KINDS.includes(doc.kind as (typeof PROJECT_KINDS)[number])) {
    issue(errors, '/kind', 'enum', 'unknown project kind');
  }
  boundedString(doc.displayName, '/displayName', 120, errors);
  if (!isSafeVaultRelativePath(doc.folderPath)) {
    issue(errors, '/folderPath', 'unsafe_path', 'expected a safe Vault-relative folder path');
  }
  if (doc.expectedBindingRevision !== undefined) {
    nonNegativeInteger(doc.expectedBindingRevision, '/expectedBindingRevision', errors);
  }
  return done(errors);
}

export function validateProjectBindingResponse(doc: unknown): ValidationResult {
  const errors: ValidationIssue[] = [];
  if (!isRecord(doc)) {
    return {
      valid: false,
      errors: [{ path: '/', code: 'type', message: 'expected ProjectBindingResponse object' }],
    };
  }
  rejectUnknownKeys(
    doc,
    [
      'protocolVersion',
      'schemaVersion',
      'projectId',
      'kind',
      'displayName',
      'folderPath',
      'bindingRevision',
      'projectRevision',
      'latestManifestHash',
      'registeredAt',
    ],
    '',
    errors,
  );
  stamp(doc, PROJECT_BINDING_SCHEMA_VERSION, errors);
  entityId(doc.projectId, 'prj', '/projectId', errors);
  if (!PROJECT_KINDS.includes(doc.kind as (typeof PROJECT_KINDS)[number])) {
    issue(errors, '/kind', 'enum', 'unknown project kind');
  }
  boundedString(doc.displayName, '/displayName', 120, errors);
  if (!isSafeVaultRelativePath(doc.folderPath)) {
    issue(errors, '/folderPath', 'unsafe_path', 'expected a safe Vault-relative folder path');
  }
  positiveInteger(doc.bindingRevision, '/bindingRevision', errors);
  nonNegativeInteger(doc.projectRevision, '/projectRevision', errors);
  if (doc.latestManifestHash !== undefined) {
    sha256(doc.latestManifestHash, '/latestManifestHash', errors);
  }
  timestamp(doc.registeredAt, '/registeredAt', errors);
  return done(errors);
}

export function validateSourceUploadIntent(doc: unknown): ValidationResult {
  const errors: ValidationIssue[] = [];
  if (!isRecord(doc)) {
    return {
      valid: false,
      errors: [{ path: '/', code: 'type', message: 'expected SourceUploadIntent object' }],
    };
  }
  const legacy =
    doc.protocolVersion === undefined &&
    doc.schemaVersion === undefined &&
    doc.project === undefined;
  if (legacy) {
    rejectUnknownKeys(
      doc,
      ['bundleId', 'manifestHash', 'sourceByteSize', 'itemCount', 'retentionUntil'],
      '',
      errors,
    );
    entityId(doc.bundleId, 'src', '/bundleId', errors);
    sha256(doc.manifestHash, '/manifestHash', errors);
    nonNegativeInteger(doc.sourceByteSize, '/sourceByteSize', errors);
    positiveInteger(doc.itemCount, '/itemCount', errors);
    timestamp(doc.retentionUntil, '/retentionUntil', errors);
    return done(errors);
  }
  rejectUnknownKeys(
    doc,
    [
      'protocolVersion',
      'schemaVersion',
      'bundleId',
      'manifestHash',
      'sourceByteSize',
      'itemCount',
      'retentionUntil',
      'project',
    ],
    '',
    errors,
  );
  stamp(doc, SOURCE_UPLOAD_INTENT_SCHEMA_VERSION, errors);
  entityId(doc.bundleId, 'src', '/bundleId', errors);
  sha256(doc.manifestHash, '/manifestHash', errors);
  nonNegativeInteger(doc.sourceByteSize, '/sourceByteSize', errors);
  const itemCountValid = positiveInteger(doc.itemCount, '/itemCount', errors);
  timestamp(doc.retentionUntil, '/retentionUntil', errors);

  if (!isRecord(doc.project)) {
    issue(errors, '/project', 'type', 'expected project upload context');
    return done(errors);
  }
  const project = doc.project;
  rejectUnknownKeys(
    project,
    ['projectId', 'expectedProjectRevision', 'baseManifestHash', 'coverage', 'sources'],
    '/project',
    errors,
  );
  entityId(project.projectId, 'prj', '/project/projectId', errors);
  nonNegativeInteger(project.expectedProjectRevision, '/project/expectedProjectRevision', errors);
  if (project.baseManifestHash !== undefined) {
    sha256(project.baseManifestHash, '/project/baseManifestHash', errors);
  }
  if (!['complete', 'partial'].includes(String(project.coverage))) {
    issue(errors, '/project/coverage', 'enum', 'expected complete or partial coverage');
  }
  if (!Array.isArray(project.sources) || project.sources.length === 0) {
    issue(errors, '/project/sources', 'empty', 'project upload requires source references');
    return done(errors);
  }
  if (itemCountValid && project.sources.length !== doc.itemCount) {
    issue(errors, '/project/sources', 'invariant', 'source reference count must equal itemCount');
  }
  const snapshotIds = new Set<string>();
  const sourceIds = new Set<string>();
  for (let index = 0; index < project.sources.length; index += 1) {
    const source = project.sources[index];
    const path = `/project/sources/${index}`;
    if (!isRecord(source)) {
      issue(errors, path, 'type', 'expected project source reference');
      continue;
    }
    rejectUnknownKeys(source, ['snapshotId', 'sourceId'], path, errors);
    const snapshotId = source.snapshotId;
    const sourceId = source.sourceId;
    const snapshotValid = entityId(snapshotId, 'snp', `${path}/snapshotId`, errors);
    const sourceValid = entityId(sourceId, 'sou', `${path}/sourceId`, errors);
    if (snapshotValid) {
      if (snapshotIds.has(snapshotId)) {
        issue(errors, `${path}/snapshotId`, 'duplicate', 'duplicate snapshot reference');
      }
      snapshotIds.add(snapshotId);
    }
    if (sourceValid) {
      if (sourceIds.has(sourceId)) {
        issue(errors, `${path}/sourceId`, 'duplicate', 'duplicate stable source id');
      }
      sourceIds.add(sourceId);
    }
  }
  return done(errors);
}

/** Compile-time assertions that imported contract types remain used by validators. */
export type ValidatedContracts =
  | SourceBundle
  | LearningEvent
  | WritebackCommand
  | ProjectBindingRequest
  | ProjectBindingResponse
  | SourceUploadIntent;
export type KnownApiErrorCode = (typeof API_ERROR_CODES)[number];
