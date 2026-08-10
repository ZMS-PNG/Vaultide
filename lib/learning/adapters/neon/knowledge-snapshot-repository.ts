import { randomUUID } from 'node:crypto';
import type {
  KnowledgeEvidenceTrace,
  KnowledgeOpenQuestion,
  KnowledgeSnapshotEvidenceSummary,
  KnowledgeSnapshotRecord,
  KnowledgeSnapshotScopeKind,
  MisconceptionCorrection,
  VerifiedKnowledgeEntry,
} from '../../domain/knowledge-snapshot';
import { KNOWLEDGE_SNAPSHOT_PROJECTOR_VERSION } from '../../domain/knowledge-snapshot';
import { isManagedVaultidePath } from '../../domain/vaultide-paths';
import type {
  AppendKnowledgeSnapshotInput,
  KnowledgeSnapshotRepository,
} from '../../ports/knowledge-snapshot-repository';
import { getLearningSql } from './client';

interface KnowledgeSnapshotRow {
  id: string;
  owner_id: string;
  session_id: string;
  scope_kind: KnowledgeSnapshotScopeKind;
  scope_id: string;
  revision: number;
  parent_snapshot_id: string | null;
  source_manifest_sha256: string;
  verified_knowledge: unknown;
  misconceptions: unknown;
  unresolved_items: unknown;
  evidence_summary: unknown;
  created_at: string;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function trace(value: unknown): KnowledgeEvidenceTrace | undefined {
  const source = record(value);
  if (!source) return undefined;
  const learningEventId = stringValue(source.learningEventId);
  const evaluationEventId = stringValue(source.evaluationEventId);
  const verifiedAt = stringValue(source.verifiedAt);
  const confidence =
    typeof source.confidence === 'number' && Number.isFinite(source.confidence)
      ? source.confidence
      : undefined;
  if (!learningEventId || !evaluationEventId || !verifiedAt || confidence === undefined) {
    return undefined;
  }
  const sourceReferences = Array.isArray(source.sourceReferences)
    ? source.sourceReferences.flatMap((item) => {
        const reference = record(item);
        const referenceId = stringValue(reference?.referenceId);
        const locator = stringValue(reference?.locator);
        if (!reference || !referenceId || (locator && isManagedVaultidePath(locator))) return [];
        return [
          {
            referenceId,
            ...(reference.kind === 'artifact' ? { kind: 'artifact' as const } : {}),
            ...(stringValue(reference.citationId)
              ? { citationId: stringValue(reference.citationId) }
              : {}),
            ...(stringValue(reference.sourceId)
              ? { sourceId: stringValue(reference.sourceId) }
              : {}),
            ...(stringValue(reference.sourceVersionId)
              ? { sourceVersionId: stringValue(reference.sourceVersionId) }
              : {}),
            ...(locator ? { locator } : {}),
            ...(stringValue(reference.contentHash)
              ? { contentHash: stringValue(reference.contentHash) }
              : {}),
          },
        ];
      })
    : [];
  return {
    learningEventId,
    evaluationEventId,
    verifiedAt,
    confidence,
    ...(stringValue(source.rubricVersion)
      ? { rubricVersion: stringValue(source.rubricVersion) }
      : {}),
    sourceReferences,
  };
}

function verifiedKnowledge(value: unknown): VerifiedKnowledgeEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const source = record(item);
    const evidence = trace(source?.trace);
    const id = stringValue(source?.id);
    const text = stringValue(source?.text);
    const kind = source?.kind;
    if (
      !source ||
      !evidence ||
      !id ||
      !text ||
      (kind !== 'claim' &&
        kind !== 'explanation' &&
        kind !== 'skill' &&
        kind !== 'transfer-outcome')
    ) {
      return [];
    }
    return [{ id, kind, text, trace: evidence }];
  });
}

function misconceptions(value: unknown): MisconceptionCorrection[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const source = record(item);
    const evidence = trace(source?.trace);
    const id = stringValue(source?.id);
    const misconception = stringValue(source?.misconception);
    const correction = stringValue(source?.correction);
    return source && evidence && id && misconception && correction
      ? [{ id, misconception, correction, trace: evidence }]
      : [];
  });
}

function unresolvedItems(value: unknown): KnowledgeOpenQuestion[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const source = record(item);
    const evidence = trace(source?.trace);
    const id = stringValue(source?.id);
    const question = stringValue(source?.question);
    return source && evidence && id && question ? [{ id, question, trace: evidence }] : [];
  });
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.flatMap((item) => stringValue(item) ?? []) : [];
}

function evidenceSummary(value: unknown): KnowledgeSnapshotEvidenceSummary {
  const source = record(value);
  if (source?.projectorVersion !== KNOWLEDGE_SNAPSHOT_PROJECTOR_VERSION) {
    throw new Error('knowledge_snapshot_projector_version_unsupported');
  }
  const rejected = record(source?.rejected);
  const count = (key: string) =>
    typeof rejected?.[key] === 'number' && Number.isInteger(rejected[key]) && rejected[key] >= 0
      ? (rejected[key] as number)
      : 0;
  return {
    projectorVersion: KNOWLEDGE_SNAPSHOT_PROJECTOR_VERSION,
    ...(stringValue(source?.parentSnapshotId)
      ? { parentSnapshotId: stringValue(source?.parentSnapshotId) }
      : {}),
    acceptedEvaluationEventIds: stringArray(source?.acceptedEvaluationEventIds),
    evaluatedLearningEventIds: stringArray(source?.evaluatedLearningEventIds),
    sourceReferenceIds: stringArray(source?.sourceReferenceIds),
    rejected: {
      unverifiedLearningEvents: count('unverifiedLearningEvents'),
      invalidEvaluations: count('invalidEvaluations'),
      malformedEntries: count('malformedEntries'),
      missingSourceReferences: count('missingSourceReferences'),
    },
  };
}

function snapshot(row: KnowledgeSnapshotRow): KnowledgeSnapshotRecord {
  const knowledge = verifiedKnowledge(row.verified_knowledge);
  const corrections = misconceptions(row.misconceptions);
  const questions = unresolvedItems(row.unresolved_items);
  return {
    id: row.id,
    ownerId: row.owner_id,
    sessionId: row.session_id,
    scopeKind: row.scope_kind,
    scopeId: row.scope_id,
    revision: Number(row.revision),
    ...(row.parent_snapshot_id ? { parentSnapshotId: row.parent_snapshot_id } : {}),
    sourceManifestSha256: row.source_manifest_sha256,
    verifiedKnowledge: knowledge,
    misconceptions: corrections,
    unresolvedItems: questions,
    evidenceSummary: evidenceSummary(row.evidence_summary),
    eligibleForPersistence: knowledge.length > 0 || corrections.length > 0 || questions.length > 0,
    createdAt: new Date(row.created_at),
  };
}

const SELECT_COLUMNS = `
  id, owner_id, session_id, scope_kind, scope_id, revision, parent_snapshot_id,
  source_manifest_sha256, verified_knowledge, misconceptions, unresolved_items,
  evidence_summary, created_at
`;

export class NeonKnowledgeSnapshotRepository implements KnowledgeSnapshotRepository {
  async append(input: AppendKnowledgeSnapshotInput): Promise<KnowledgeSnapshotRecord> {
    if (!input.projection.eligibleForPersistence) {
      throw new Error('knowledge_snapshot_has_no_verified_content');
    }
    const id = `ksn_${randomUUID().replaceAll('-', '')}`;
    const expectedParentSnapshotId =
      input.expectedParentSnapshotId ?? input.projection.evidenceSummary.parentSnapshotId ?? null;
    const rows = (await getLearningSql().query(
      `
        WITH session_state AS MATERIALIZED (
          SELECT session.id,
                 CASE WHEN session.project_id IS NOT NULL THEN 'project' ELSE 'session' END
                   AS scope_kind,
                 COALESCE(session.project_id, session.id) AS scope_id,
                 context.source_sha256
          FROM learning_sessions session
          JOIN learning_context_packs context
            ON context.owner_id = session.owner_id
           AND context.id = session.current_context_pack_id
           AND context.status = 'frozen'
          WHERE session.owner_id = $1
            AND (
              session.id = $2
              OR EXISTS (
                SELECT 1
                FROM learning_sprints sprint
                WHERE sprint.owner_id = session.owner_id
                  AND sprint.id = $2
                  AND session.metadata ->> 'classroomId' = sprint.classroom_id
              )
            )
          ORDER BY
            CASE WHEN session.id = $2 THEN 0 ELSE 1 END,
            session.updated_at DESC
          LIMIT 1
        ),
        lock_row AS MATERIALIZED (
          SELECT pg_advisory_xact_lock(
            hashtextextended(
              $1 || ':' || session_state.scope_kind || ':' || session_state.scope_id,
              0
            )
          )
          FROM session_state
        ),
        latest AS MATERIALIZED (
          SELECT snapshot.id, snapshot.revision
          FROM learning_knowledge_snapshots snapshot
          CROSS JOIN lock_row
          JOIN session_state
            ON snapshot.scope_kind = session_state.scope_kind
           AND snapshot.scope_id = session_state.scope_id
          WHERE snapshot.owner_id = $1
          ORDER BY snapshot.revision DESC
          LIMIT 1
        ),
        state AS (
          SELECT session_state.*, latest.id AS latest_id,
                 COALESCE(latest.revision, 0) AS latest_revision
          FROM session_state
          CROSS JOIN lock_row
          LEFT JOIN latest ON true
        ),
        inserted AS (
          INSERT INTO learning_knowledge_snapshots
            (id, owner_id, session_id, scope_kind, scope_id, revision,
             parent_snapshot_id, source_manifest_sha256, verified_knowledge,
             misconceptions, unresolved_items, evidence_summary, created_at)
          SELECT
            $3, $1, state.id, state.scope_kind, state.scope_id,
            state.latest_revision + 1, state.latest_id, state.source_sha256,
            $5::jsonb, $6::jsonb, $7::jsonb,
            CASE
              WHEN state.latest_id IS NULL THEN $8::jsonb - 'parentSnapshotId'
              ELSE $8::jsonb || jsonb_build_object('parentSnapshotId', state.latest_id)
            END,
            $9
          FROM state
          WHERE $4::text IS NULL OR state.latest_id = $4
          RETURNING ${SELECT_COLUMNS}
        ),
        session_updated AS (
          UPDATE learning_sessions session
          SET current_knowledge_snapshot_id = inserted.id, updated_at = $9
          FROM inserted
          WHERE session.owner_id = inserted.owner_id
            AND session.id = inserted.session_id
          RETURNING session.id
        )
        SELECT inserted.*
        FROM inserted
        JOIN session_updated ON session_updated.id = inserted.session_id
      `,
      [
        input.ownerId,
        input.sessionId,
        id,
        expectedParentSnapshotId,
        JSON.stringify(input.projection.verifiedKnowledge),
        JSON.stringify(input.projection.misconceptions),
        JSON.stringify(input.projection.unresolvedItems),
        JSON.stringify(input.projection.evidenceSummary),
        input.now,
      ],
    )) as KnowledgeSnapshotRow[];
    const row = rows[0];
    if (!row) throw new Error('knowledge_snapshot_parent_conflict');
    return snapshot(row);
  }

  async findLatest(ownerId: string, sessionId: string): Promise<KnowledgeSnapshotRecord | null> {
    const rows = (await getLearningSql().query(
      `
        SELECT ${SELECT_COLUMNS}
        FROM learning_knowledge_snapshots
        WHERE owner_id = $1 AND session_id = $2
        ORDER BY revision DESC
        LIMIT 1
      `,
      [ownerId, sessionId],
    )) as KnowledgeSnapshotRow[];
    return rows[0] ? snapshot(rows[0]) : null;
  }

  async findLatestForScope(
    ownerId: string,
    scopeKind: KnowledgeSnapshotScopeKind,
    scopeId: string,
  ): Promise<KnowledgeSnapshotRecord | null> {
    const rows = (await getLearningSql().query(
      `
        SELECT ${SELECT_COLUMNS}
        FROM learning_knowledge_snapshots snapshot
        WHERE snapshot.owner_id = $1
          AND snapshot.scope_kind = $2
          AND (
            snapshot.scope_id = $3
            OR (
              $2 = 'session'
              AND EXISTS (
                SELECT 1
                FROM learning_sessions session
                JOIN learning_sprints sprint
                  ON sprint.owner_id = session.owner_id
                 AND sprint.id = $3
                WHERE session.owner_id = snapshot.owner_id
                  AND session.id = snapshot.scope_id
                  AND session.metadata ->> 'classroomId' = sprint.classroom_id
              )
            )
          )
        ORDER BY snapshot.revision DESC
        LIMIT 1
      `,
      [ownerId, scopeKind, scopeId],
    )) as KnowledgeSnapshotRow[];
    return rows[0] ? snapshot(rows[0]) : null;
  }

  async findById(ownerId: string, snapshotId: string): Promise<KnowledgeSnapshotRecord | null> {
    const rows = (await getLearningSql().query(
      `
        SELECT ${SELECT_COLUMNS}
        FROM learning_knowledge_snapshots
        WHERE owner_id = $1 AND id = $2
        LIMIT 1
      `,
      [ownerId, snapshotId],
    )) as KnowledgeSnapshotRow[];
    return rows[0] ? snapshot(rows[0]) : null;
  }
}
