import {
  LEARNING_EVENT_SCHEMA_VERSION,
  LEARNING_PROTOCOL_VERSION,
  type JsonObject,
  type LearningEvent,
  type WritebackCommand,
  type WritebackReceipt,
} from '@openmaic/learning-protocol';
import { createHash } from 'node:crypto';
import type {
  AppendLearningEventsResult,
  CreateSynthesisWritebackDraftRecord,
  CreateWritebackDraftRecord,
  DepositionItemRecord,
  DepositionPolicyRecord,
  DepositionRunRecord,
  LearningCompanionRecord,
  LearningSprintRecord,
  MasteryProjectionRecord,
  ManagedBlockDraft,
  ManagedBlockState,
  ReceiptRecordResult,
  ReviewQueueItemRecord,
  StoredLearningEvent,
  WritebackDraftRecord,
  WritebackTarget,
} from '../../domain/learning-progress';
import type { MasteryProjection } from '../../domain/mastery-evidence';
import type { ProjectLearningIndexDocumentRecord } from '../../domain/project-learning';
import type { SynthesisIndexDocumentRecord } from '../../domain/synthesis-index';
import type {
  ApproveWritebackDraftInput,
  CreateDepositionItemInput,
  CreateDepositionRunInput,
  EnsureLearningSprintInput,
  FindOrCreateLearningCompanionInput,
  FindOrCreateProjectLearningIndexInput,
  FindOrCreateSynthesisIndexInput,
  LearningProgressRepository,
  UpdateDepositionPolicyInput,
  UpdateDepositionRunInput,
} from '../../ports/learning-progress-repository';
import { preferredWritebackVaultBindingId } from '../../config';
import { getLearningSql } from './client';

interface SprintRow {
  id: string;
  owner_id: string;
  classroom_id: string;
  source_bundle_id: string | null;
  project_id: string | null;
  project_name: string | null;
  project_revision: string | number | null;
  retrieval_run_id: string | null;
  research_run_id: string | null;
  goal: string;
  status: LearningSprintRecord['status'];
  created_at: string;
  updated_at: string;
}

interface DraftRow {
  id: string;
  owner_id: string;
  draft_kind: WritebackDraftRecord['draftKind'];
  sprint_id: string | null;
  synthesis_run_id: string | null;
  knowledge_asset_id: string | null;
  knowledge_asset_version_id: string | null;
  project_index_id: string | null;
  synthesis_index_id: string | null;
  vault_overview_id: string | null;
  target_device_id: string;
  target_vault_binding_id: string;
  revision: number;
  status: WritebackDraftRecord['status'];
  operation: WritebackDraftRecord['operation'];
  companion_id: string | null;
  managed_blocks: unknown;
  relative_path: string;
  content: string;
  frontmatter: JsonObject;
  created_at: string;
  updated_at: string;
}

interface CompanionRow {
  id: string;
  owner_id: string;
  vault_binding_id: string;
  source_id: string;
  source_bundle_id: string | null;
  source_snapshot_id: string | null;
  project_id: string | null;
  original_relative_path: string;
  relative_path: string;
  status: LearningCompanionRecord['status'];
  managed_blocks: unknown;
  last_content_hash: string | null;
  created_at: string;
  updated_at: string;
}

interface ProjectIndexRow {
  id: string;
  owner_id: string;
  project_id: string;
  vault_binding_id: string;
  relative_path: string;
  status: ProjectLearningIndexDocumentRecord['status'];
  managed_blocks: unknown;
  last_content_hash: string | null;
  created_at: string;
  updated_at: string;
}

interface SynthesisIndexRow {
  id: string;
  owner_id: string;
  schedule_id: string;
  vault_binding_id: string;
  relative_path: string;
  status: SynthesisIndexDocumentRecord['status'];
  managed_blocks: unknown;
  last_content_hash: string | null;
  created_at: string;
  updated_at: string;
}

interface MasteryRow {
  id: string;
  owner_id: string;
  sprint_id: string;
  concept_id: string;
  estimate: string | number | null;
  confidence: string | number;
  evidence_count: number;
  evidence_types: unknown;
  evidence_summary: unknown;
  last_practiced_at: string | null;
  next_review_at: string | null;
  projector_version: string;
  computed_at: string;
  classroom_id: string;
  goal: string;
  project_id: string | null;
  project_name: string | null;
}

interface ReviewQueueRow {
  id: string;
  owner_id: string;
  sprint_id: string;
  concept_id: string;
  projector_version: string;
  state: ReviewQueueItemRecord['state'];
  due_at: string;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  classroom_id: string;
  goal: string;
  project_id: string | null;
  project_name: string | null;
  mastery_estimate: string | number | null;
  mastery_confidence: string | number;
  mastery_evidence_count: string | number;
  is_due: boolean;
}

interface DepositionPolicyRow {
  owner_id: string;
  mode: DepositionPolicyRecord['mode'];
  managed_auto_enabled: boolean;
  allow_companion_updates: boolean;
  allow_synthesis_index_updates: boolean;
  allow_external_cards: boolean;
  updated_at: string;
}

interface DepositionRunRow {
  id: string;
  owner_id: string;
  sprint_id: string | null;
  asset_type: DepositionRunRecord['assetType'];
  idempotency_key: string;
  projector_version: string;
  state: DepositionRunRecord['state'];
  risk_level: DepositionRunRecord['riskLevel'];
  error_code: string | null;
  error_detail: string | null;
  created_at: string;
  updated_at: string;
}

interface DepositionItemRow {
  id: string;
  owner_id: string;
  run_id: string;
  source_version_id: string | null;
  target_kind: DepositionItemRecord['targetKind'];
  target_id: string | null;
  writeback_draft_id: string | null;
  writeback_command_id: string | null;
  receipt_id: string | null;
  state: DepositionItemRecord['state'];
  command_risk_level: DepositionItemRecord['commandRiskLevel'];
  created_at: string;
  updated_at: string;
}

function sprint(row: SprintRow): LearningSprintRecord {
  return {
    id: row.id,
    ownerId: row.owner_id,
    classroomId: row.classroom_id,
    sourceBundleId: row.source_bundle_id ?? undefined,
    projectId: row.project_id ?? undefined,
    projectName: row.project_name ?? undefined,
    projectRevision: row.project_revision === null ? undefined : Number(row.project_revision),
    retrievalRunId: row.retrieval_run_id ?? undefined,
    researchRunId: row.research_run_id ?? undefined,
    goal: row.goal,
    status: row.status,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

function draft(row: DraftRow): WritebackDraftRecord {
  return {
    id: row.id,
    ownerId: row.owner_id,
    draftKind: row.draft_kind,
    sprintId: row.sprint_id ?? undefined,
    synthesisRunId: row.synthesis_run_id ?? undefined,
    assetId: row.knowledge_asset_id ?? undefined,
    assetVersionId: row.knowledge_asset_version_id ?? undefined,
    projectIndexId: row.project_index_id ?? undefined,
    synthesisIndexId: row.synthesis_index_id ?? undefined,
    vaultOverviewId: row.vault_overview_id ?? undefined,
    targetDeviceId: row.target_device_id,
    targetVaultBindingId: row.target_vault_binding_id,
    revision: row.revision,
    status: row.status,
    operation: row.operation,
    companionId: row.companion_id ?? undefined,
    managedBlocks: managedBlockDrafts(row.managed_blocks),
    relativePath: row.relative_path,
    content: row.content,
    frontmatter: row.frontmatter,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

function managedBlockStates(value: unknown): ManagedBlockState[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: ManagedBlockState[] = [];
  for (const candidate of value) {
    if (typeof candidate !== 'object' || candidate === null) continue;
    const block = candidate as Partial<ManagedBlockState>;
    if (
      typeof block.id !== 'string' ||
      !/^[a-z][a-z0-9-]{0,63}$/.test(block.id) ||
      seen.has(block.id) ||
      typeof block.content !== 'string' ||
      typeof block.contentHash !== 'string' ||
      !/^[a-f0-9]{64}$/.test(block.contentHash)
    ) {
      continue;
    }
    seen.add(block.id);
    result.push({ id: block.id, content: block.content, contentHash: block.contentHash });
  }
  return result;
}

function managedBlockDrafts(value: unknown): ManagedBlockDraft[] {
  return managedBlockStates(value).map((block) => {
    const candidate = Array.isArray(value)
      ? value.find(
          (item) =>
            typeof item === 'object' && item !== null && (item as { id?: unknown }).id === block.id,
        )
      : undefined;
    const expectedHash =
      candidate &&
      typeof candidate === 'object' &&
      typeof (candidate as { expectedHash?: unknown }).expectedHash === 'string' &&
      /^[a-f0-9]{64}$/.test((candidate as { expectedHash: string }).expectedHash)
        ? (candidate as { expectedHash: string }).expectedHash
        : undefined;
    return { ...block, ...(expectedHash ? { expectedHash } : {}) };
  });
}

function companion(row: CompanionRow): LearningCompanionRecord {
  return {
    id: row.id,
    ownerId: row.owner_id,
    vaultBindingId: row.vault_binding_id,
    sourceId: row.source_id,
    sourceBundleId: row.source_bundle_id ?? undefined,
    sourceSnapshotId: row.source_snapshot_id ?? undefined,
    projectId: row.project_id ?? undefined,
    originalRelativePath: row.original_relative_path,
    relativePath: row.relative_path,
    status: row.status,
    managedBlocks: managedBlockStates(row.managed_blocks),
    lastContentHash: row.last_content_hash ?? undefined,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

function projectIndex(row: ProjectIndexRow): ProjectLearningIndexDocumentRecord {
  return {
    id: row.id,
    ownerId: row.owner_id,
    projectId: row.project_id,
    vaultBindingId: row.vault_binding_id,
    relativePath: row.relative_path,
    status: row.status,
    managedBlocks: managedBlockStates(row.managed_blocks),
    lastContentHash: row.last_content_hash ?? undefined,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

function synthesisIndex(row: SynthesisIndexRow): SynthesisIndexDocumentRecord {
  return {
    id: row.id,
    ownerId: row.owner_id,
    scheduleId: row.schedule_id,
    vaultBindingId: row.vault_binding_id,
    relativePath: row.relative_path,
    status: row.status,
    managedBlocks: managedBlockStates(row.managed_blocks),
    lastContentHash: row.last_content_hash ?? undefined,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

function reviewQueueItem(row: ReviewQueueRow): ReviewQueueItemRecord {
  return {
    id: row.id,
    ownerId: row.owner_id,
    sprintId: row.sprint_id,
    conceptId: row.concept_id,
    projectorVersion: row.projector_version,
    state: row.state,
    dueAt: new Date(row.due_at),
    completedAt: row.completed_at ? new Date(row.completed_at) : undefined,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    classroomId: row.classroom_id,
    goal: row.goal,
    projectId: row.project_id ?? undefined,
    projectName: row.project_name ?? undefined,
    masteryEstimate: row.mastery_estimate === null ? null : Number(row.mastery_estimate),
    masteryConfidence: Number(row.mastery_confidence),
    masteryEvidenceCount: Number(row.mastery_evidence_count),
    isDue: row.is_due,
  };
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function evidenceSummary(value: unknown): MasteryProjectionRecord['evidenceSummary'] {
  if (!Array.isArray(value)) return [];
  const result: MasteryProjectionRecord['evidenceSummary'] = [];
  for (const item of value.slice(-24)) {
    if (typeof item !== 'object' || item === null) continue;
    const record = item as Record<string, unknown>;
    if (
      typeof record.eventId !== 'string' ||
      typeof record.eventType !== 'string' ||
      typeof record.occurredAt !== 'string' ||
      typeof record.score !== 'number' ||
      typeof record.weight !== 'number' ||
      typeof record.independence !== 'number'
    ) {
      continue;
    }
    result.push({
      eventId: record.eventId,
      eventType: record.eventType,
      occurredAt: record.occurredAt,
      score: record.score,
      weight: record.weight,
      independence: record.independence,
    });
  }
  return result;
}

function mastery(row: MasteryRow): MasteryProjectionRecord {
  return {
    id: row.id,
    ownerId: row.owner_id,
    sprintId: row.sprint_id,
    conceptId: row.concept_id,
    estimate: row.estimate === null ? null : Number(row.estimate),
    confidence: Number(row.confidence),
    evidenceCount: Number(row.evidence_count),
    evidenceTypes: stringArray(row.evidence_types),
    evidenceSummary: evidenceSummary(row.evidence_summary),
    lastPracticedAt: row.last_practiced_at
      ? new Date(row.last_practiced_at).toISOString()
      : undefined,
    nextReviewAt: row.next_review_at ? new Date(row.next_review_at).toISOString() : undefined,
    projectorVersion: row.projector_version,
    computedAt: new Date(row.computed_at),
    classroomId: row.classroom_id,
    goal: row.goal,
    projectId: row.project_id ?? undefined,
    projectName: row.project_name ?? undefined,
  };
}

function depositionPolicy(row: DepositionPolicyRow): DepositionPolicyRecord {
  return {
    ownerId: row.owner_id,
    mode: row.mode,
    managedAutoEnabled: row.managed_auto_enabled,
    allowCompanionUpdates: row.allow_companion_updates,
    allowSynthesisIndexUpdates: row.allow_synthesis_index_updates,
    allowExternalCards: row.allow_external_cards,
    updatedAt: new Date(row.updated_at),
  };
}

function depositionRun(row: DepositionRunRow): DepositionRunRecord {
  return {
    id: row.id,
    ownerId: row.owner_id,
    sprintId: row.sprint_id ?? undefined,
    assetType: row.asset_type,
    idempotencyKey: row.idempotency_key,
    projectorVersion: row.projector_version,
    state: row.state,
    riskLevel: row.risk_level,
    errorCode: row.error_code ?? undefined,
    errorDetail: row.error_detail ?? undefined,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

function depositionItem(row: DepositionItemRow): DepositionItemRecord {
  return {
    id: row.id,
    ownerId: row.owner_id,
    runId: row.run_id,
    sourceVersionId: row.source_version_id ?? undefined,
    targetKind: row.target_kind,
    targetId: row.target_id ?? undefined,
    writebackDraftId: row.writeback_draft_id ?? undefined,
    writebackCommandId: row.writeback_command_id ?? undefined,
    receiptId: row.receipt_id ?? undefined,
    state: row.state,
    commandRiskLevel: row.command_risk_level,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

function stableProjectionId(
  prefix: 'mpr' | 'rvi',
  ownerId: string,
  sprintId: string,
  conceptId: string,
  projectorVersion: string,
): string {
  const digest = createHash('sha256')
    .update([ownerId, sprintId, conceptId, projectorVersion].join('\u0000'), 'utf8')
    .digest('hex')
    .slice(0, 32);
  return `${prefix}_${digest}`;
}

function receiptMatches(row: Record<string, unknown>, receipt: WritebackReceipt): boolean {
  return (
    row.receipt_id === receipt.id &&
    row.outcome === receipt.outcome &&
    (row.resulting_content_hash ?? undefined) === receipt.resultingContentHash &&
    (row.resulting_path ?? undefined) === receipt.resultingPath &&
    (row.conflict_detail ?? undefined) === receipt.conflictDetail
  );
}

export class NeonLearningProgressRepository implements LearningProgressRepository {
  async findSprint(ownerId: string, sprintId: string): Promise<LearningSprintRecord | null> {
    const rows = (await getLearningSql().query(
      `
        SELECT s.id, s.owner_id, s.classroom_id, s.source_bundle_id,
               s.project_id, p.display_name AS project_name, s.project_revision,
               s.retrieval_run_id, s.research_run_id, s.goal, s.status,
               s.created_at, s.updated_at
        FROM learning_sprints s
        LEFT JOIN learning_projects p
          ON p.owner_id = s.owner_id AND p.id = s.project_id
        WHERE s.owner_id = $1 AND s.id = $2
      `,
      [ownerId, sprintId],
    )) as SprintRow[];
    return rows[0] ? sprint(rows[0]) : null;
  }

  async findSprintByClassroom(
    ownerId: string,
    classroomId: string,
  ): Promise<LearningSprintRecord | null> {
    const rows = (await getLearningSql().query(
      `
        SELECT s.id, s.owner_id, s.classroom_id, s.source_bundle_id,
               s.project_id, p.display_name AS project_name, s.project_revision,
               s.retrieval_run_id, s.research_run_id, s.goal, s.status,
               s.created_at, s.updated_at
        FROM learning_sprints s
        LEFT JOIN learning_projects p
          ON p.owner_id = s.owner_id AND p.id = s.project_id
        WHERE s.owner_id = $1 AND s.classroom_id = $2
      `,
      [ownerId, classroomId],
    )) as SprintRow[];
    return rows[0] ? sprint(rows[0]) : null;
  }

  async ensureSprint(input: EnsureLearningSprintInput): Promise<LearningSprintRecord> {
    const rows = (await getLearningSql().query(
      `
        WITH source_context AS (
          SELECT su.id AS source_bundle_id, su.project_id,
                 CASE
                   WHEN su.expected_project_revision IS NOT NULL
                     THEN su.expected_project_revision + 1
                   ELSE NULL
                 END AS project_revision
          FROM source_uploads su
          WHERE su.id = $4 AND su.owner_id = $2 AND su.status = 'validated'
        ), explicit_project AS (
          SELECT p.id, p.project_revision
          FROM learning_projects p
          WHERE p.id = $6 AND p.owner_id = $2 AND p.status = 'active'
        ), upserted AS (
          INSERT INTO learning_sprints
            (id, owner_id, classroom_id, source_bundle_id, project_id, project_revision,
             retrieval_run_id, research_run_id, goal, status, created_at, updated_at)
          VALUES (
            $1, $2, $3,
            (SELECT source_bundle_id FROM source_context),
            COALESCE(
              (SELECT project_id FROM source_context),
              (SELECT id FROM explicit_project)
            ),
            COALESCE(
              (SELECT project_revision FROM source_context),
              $7::bigint,
              (SELECT project_revision FROM explicit_project)
            ),
            (SELECT id FROM project_retrieval_runs WHERE id = $8 AND owner_id = $2),
            (SELECT id FROM research_runs WHERE id = $5 AND owner_id = $2),
            $9, 'active', $10, $10
          )
          ON CONFLICT (owner_id, classroom_id) DO UPDATE
          SET source_bundle_id =
                COALESCE(EXCLUDED.source_bundle_id, learning_sprints.source_bundle_id),
              project_id = COALESCE(EXCLUDED.project_id, learning_sprints.project_id),
              project_revision =
                COALESCE(EXCLUDED.project_revision, learning_sprints.project_revision),
              retrieval_run_id =
                COALESCE(EXCLUDED.retrieval_run_id, learning_sprints.retrieval_run_id),
              research_run_id =
                COALESCE(EXCLUDED.research_run_id, learning_sprints.research_run_id),
              goal =
                CASE WHEN EXCLUDED.goal <> '' THEN EXCLUDED.goal ELSE learning_sprints.goal END,
              updated_at = EXCLUDED.updated_at
          RETURNING id, owner_id, classroom_id, source_bundle_id, project_id,
                    project_revision, retrieval_run_id, research_run_id, goal, status,
                    created_at, updated_at
        )
        SELECT u.id, u.owner_id, u.classroom_id, u.source_bundle_id,
               u.project_id, p.display_name AS project_name, u.project_revision,
               u.retrieval_run_id, u.research_run_id, u.goal, u.status,
               u.created_at, u.updated_at
        FROM upserted u
        LEFT JOIN learning_projects p
          ON p.owner_id = u.owner_id AND p.id = u.project_id
      `,
      [
        input.id,
        input.ownerId,
        input.classroomId,
        input.sourceBundleId ?? null,
        input.researchRunId ?? null,
        input.projectId ?? null,
        input.projectRevision ?? null,
        input.retrievalRunId ?? null,
        input.goal,
        input.now,
      ],
    )) as SprintRow[];
    const row = rows[0];
    if (!row) throw new Error('learning_sprint_not_created');
    return sprint(row);
  }

  async findWritebackTarget(
    ownerId: string,
    sourceBundleId?: string,
  ): Promise<WritebackTarget | null> {
    if (sourceBundleId) {
      const sourceRows = (await getLearningSql().query(
        `
          SELECT su.device_id, su.vault_binding_id, vb.vault_name
          FROM source_uploads su
          JOIN integration_devices d
            ON d.owner_id = su.owner_id AND d.device_id = su.device_id
          JOIN vault_bindings vb
            ON vb.owner_id = su.owner_id AND vb.vault_binding_id = su.vault_binding_id
          JOIN integration_tokens t
            ON t.owner_id = su.owner_id AND t.device_id = su.device_id
           AND t.vault_binding_id = su.vault_binding_id
          WHERE su.owner_id = $1 AND su.id = $2 AND su.status = 'validated'
            AND d.revoked_at IS NULL AND vb.revoked_at IS NULL AND t.revoked_at IS NULL
          LIMIT 1
        `,
        [ownerId, sourceBundleId],
      )) as Array<{ device_id: string; vault_binding_id: string; vault_name: string }>;
      if (sourceRows[0]) {
        return {
          deviceId: sourceRows[0].device_id,
          vaultBindingId: sourceRows[0].vault_binding_id,
          vaultName: sourceRows[0].vault_name,
        };
      }
    }

    const preferredVaultBindingId = preferredWritebackVaultBindingId() ?? null;
    const rows = (await getLearningSql().query(
      `
        SELECT t.device_id, t.vault_binding_id, vb.vault_name
        FROM integration_tokens t
        JOIN integration_devices d
          ON d.owner_id = t.owner_id AND d.device_id = t.device_id
        JOIN vault_bindings vb
          ON vb.owner_id = t.owner_id AND vb.vault_binding_id = t.vault_binding_id
        WHERE t.owner_id = $1
          AND t.revoked_at IS NULL AND d.revoked_at IS NULL AND vb.revoked_at IS NULL
        ORDER BY
          CASE WHEN t.vault_binding_id = $2 THEN 0 ELSE 1 END,
          COALESCE(t.last_used_at, t.updated_at) DESC,
          vb.last_seen_at DESC
        LIMIT 1
      `,
      [ownerId, preferredVaultBindingId],
    )) as Array<{ device_id: string; vault_binding_id: string; vault_name: string }>;
    const row = rows[0];
    return row
      ? { deviceId: row.device_id, vaultBindingId: row.vault_binding_id, vaultName: row.vault_name }
      : null;
  }

  async findOrCreateCompanion(
    input: FindOrCreateLearningCompanionInput,
  ): Promise<LearningCompanionRecord> {
    const rows = (await getLearningSql().query(
      `
        INSERT INTO learning_companions
          (id, owner_id, vault_binding_id, source_id, source_bundle_id, source_snapshot_id,
           project_id, original_relative_path, relative_path, status, managed_blocks,
           last_content_hash, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'active', $10::jsonb, NULL, $11, $11)
        ON CONFLICT (owner_id, vault_binding_id, source_id) DO UPDATE
        SET source_bundle_id = COALESCE(EXCLUDED.source_bundle_id, learning_companions.source_bundle_id),
            source_snapshot_id = COALESCE(EXCLUDED.source_snapshot_id, learning_companions.source_snapshot_id),
            project_id = COALESCE(EXCLUDED.project_id, learning_companions.project_id),
            original_relative_path = EXCLUDED.original_relative_path,
            updated_at = EXCLUDED.updated_at
        RETURNING id, owner_id, vault_binding_id, source_id, source_bundle_id, source_snapshot_id,
                  project_id, original_relative_path, relative_path, status, managed_blocks,
                  last_content_hash, created_at, updated_at
      `,
      [
        input.id,
        input.ownerId,
        input.vaultBindingId,
        input.sourceId,
        input.sourceBundleId ?? null,
        input.sourceSnapshotId ?? null,
        input.projectId ?? null,
        input.originalRelativePath,
        input.relativePath,
        JSON.stringify(input.initialManagedBlocks),
        input.now,
      ],
    )) as CompanionRow[];
    const row = rows[0];
    if (!row) throw new Error('learning_companion_not_created');
    return companion(row);
  }

  async findOrCreateProjectLearningIndex(
    input: FindOrCreateProjectLearningIndexInput,
  ): Promise<ProjectLearningIndexDocumentRecord> {
    const rows = (await getLearningSql().query(
      `
        INSERT INTO project_learning_indexes
          (id, owner_id, project_id, vault_binding_id, relative_path, status, managed_blocks,
           last_content_hash, created_at, updated_at)
        SELECT $1, $2, $3, $4, $5, 'active', $6::jsonb, NULL, $7, $7
        FROM learning_projects project
        WHERE project.owner_id = $2 AND project.id = $3 AND project.vault_binding_id = $4
          AND project.status = 'active'
        ON CONFLICT (owner_id, project_id, vault_binding_id) DO UPDATE
        SET updated_at = EXCLUDED.updated_at
        RETURNING id, owner_id, project_id, vault_binding_id, relative_path, status,
                  managed_blocks, last_content_hash, created_at, updated_at
      `,
      [
        input.id,
        input.ownerId,
        input.projectId,
        input.vaultBindingId,
        input.relativePath,
        JSON.stringify(input.initialManagedBlocks),
        input.now,
      ],
    )) as ProjectIndexRow[];
    const row = rows[0];
    if (!row) throw new Error('project_learning_index_not_created');
    return projectIndex(row);
  }

  async findOrCreateSynthesisIndex(
    input: FindOrCreateSynthesisIndexInput,
  ): Promise<SynthesisIndexDocumentRecord> {
    const rows = (await getLearningSql().query(
      `
        INSERT INTO synthesis_indexes
          (id, owner_id, schedule_id, vault_binding_id, relative_path, status, managed_blocks,
           last_content_hash, created_at, updated_at)
        SELECT $1, $2, $3, $4, $5, 'active', $6::jsonb, NULL, $7, $7
        FROM synthesis_schedules schedule
        JOIN vault_bindings vault
          ON vault.owner_id = schedule.owner_id AND vault.vault_binding_id = $4
        WHERE schedule.owner_id = $2 AND schedule.id = $3 AND vault.revoked_at IS NULL
        ON CONFLICT (owner_id, schedule_id, vault_binding_id) DO UPDATE
        SET updated_at = EXCLUDED.updated_at
        RETURNING id, owner_id, schedule_id, vault_binding_id, relative_path, status,
                  managed_blocks, last_content_hash, created_at, updated_at
      `,
      [
        input.id,
        input.ownerId,
        input.scheduleId,
        input.vaultBindingId,
        input.relativePath,
        JSON.stringify(input.initialManagedBlocks),
        input.now,
      ],
    )) as SynthesisIndexRow[];
    const row = rows[0];
    if (!row) throw new Error('synthesis_index_not_created');
    return synthesisIndex(row);
  }

  async getDepositionPolicy(ownerId: string): Promise<DepositionPolicyRecord> {
    const rows = (await getLearningSql().query(
      `
        SELECT owner_id, mode, managed_auto_enabled, allow_companion_updates,
               allow_synthesis_index_updates, allow_external_cards, updated_at
        FROM deposition_policies
        WHERE owner_id = $1
      `,
      [ownerId],
    )) as DepositionPolicyRow[];
    return rows[0]
      ? depositionPolicy(rows[0])
      : {
          ownerId,
          mode: 'manual',
          managedAutoEnabled: false,
          allowCompanionUpdates: false,
          allowSynthesisIndexUpdates: false,
          allowExternalCards: false,
          updatedAt: new Date(0),
        };
  }

  async updateDepositionPolicy(
    input: UpdateDepositionPolicyInput,
  ): Promise<DepositionPolicyRecord> {
    const rows = (await getLearningSql().query(
      `
        INSERT INTO deposition_policies
          (owner_id, mode, managed_auto_enabled, allow_companion_updates,
           allow_synthesis_index_updates, allow_external_cards, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (owner_id) DO UPDATE
        SET mode = EXCLUDED.mode,
            managed_auto_enabled = EXCLUDED.managed_auto_enabled,
            allow_companion_updates = EXCLUDED.allow_companion_updates,
            allow_synthesis_index_updates = EXCLUDED.allow_synthesis_index_updates,
            allow_external_cards = EXCLUDED.allow_external_cards,
            updated_at = EXCLUDED.updated_at
        RETURNING owner_id, mode, managed_auto_enabled, allow_companion_updates,
                  allow_synthesis_index_updates, allow_external_cards, updated_at
      `,
      [
        input.ownerId,
        input.mode,
        input.managedAutoEnabled,
        input.allowCompanionUpdates,
        input.allowSynthesisIndexUpdates,
        input.allowExternalCards,
        input.now,
      ],
    )) as DepositionPolicyRow[];
    const row = rows[0];
    if (!row) throw new Error('deposition_policy_not_updated');
    return depositionPolicy(row);
  }

  async findOrCreateDepositionRun(input: CreateDepositionRunInput): Promise<DepositionRunRecord> {
    const rows = (await getLearningSql().query(
      `
        INSERT INTO deposition_runs
          (id, owner_id, sprint_id, asset_type, idempotency_key, projector_version,
           state, risk_level, error_code, error_detail, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, NULL, NULL, $8, $8)
        ON CONFLICT (owner_id, idempotency_key) DO UPDATE
        SET updated_at = EXCLUDED.updated_at
        RETURNING id, owner_id, sprint_id, asset_type, idempotency_key, projector_version,
                  state, risk_level, error_code, error_detail, created_at, updated_at
      `,
      [
        input.id,
        input.ownerId,
        input.sprintId ?? null,
        input.assetType,
        input.idempotencyKey,
        input.projectorVersion,
        input.riskLevel,
        input.now,
      ],
    )) as DepositionRunRow[];
    const row = rows[0];
    if (!row) throw new Error('deposition_run_not_created');
    return depositionRun(row);
  }

  async updateDepositionRun(input: UpdateDepositionRunInput): Promise<DepositionRunRecord | null> {
    const rows = (await getLearningSql().query(
      `
        UPDATE deposition_runs
        SET state = $3,
            error_code = $4,
            error_detail = $5,
            updated_at = $6
        WHERE owner_id = $1 AND id = $2
        RETURNING id, owner_id, sprint_id, asset_type, idempotency_key, projector_version,
                  state, risk_level, error_code, error_detail, created_at, updated_at
      `,
      [
        input.ownerId,
        input.runId,
        input.state,
        input.errorCode ?? null,
        input.errorDetail ?? null,
        input.now,
      ],
    )) as DepositionRunRow[];
    return rows[0] ? depositionRun(rows[0]) : null;
  }

  async createDepositionItem(input: CreateDepositionItemInput): Promise<DepositionItemRecord> {
    const rows = (await getLearningSql().query(
      `
        INSERT INTO deposition_items
          (id, owner_id, run_id, source_version_id, target_kind, target_id,
           writeback_draft_id, writeback_command_id, state, command_risk_level, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)
        ON CONFLICT (id) DO UPDATE
        SET state = EXCLUDED.state,
            writeback_draft_id = COALESCE(EXCLUDED.writeback_draft_id, deposition_items.writeback_draft_id),
            writeback_command_id = COALESCE(EXCLUDED.writeback_command_id, deposition_items.writeback_command_id),
            command_risk_level = EXCLUDED.command_risk_level,
            updated_at = EXCLUDED.updated_at
        RETURNING id, owner_id, run_id, source_version_id, target_kind, target_id,
                  writeback_draft_id, writeback_command_id, receipt_id,
                  state, command_risk_level, created_at, updated_at
      `,
      [
        input.id,
        input.ownerId,
        input.runId,
        input.sourceVersionId ?? null,
        input.targetKind,
        input.targetId ?? null,
        input.writebackDraftId ?? null,
        input.writebackCommandId ?? null,
        input.state,
        input.commandRiskLevel,
        input.now,
      ],
    )) as DepositionItemRow[];
    const row = rows[0];
    if (!row) throw new Error('deposition_item_not_created');
    return depositionItem(row);
  }

  async appendEvents(
    events: readonly LearningEvent[],
    receivedAt: Date,
  ): Promise<AppendLearningEventsResult> {
    if (events.length === 0) return { accepted: 0, deduplicated: 0 };
    const records = events.map((event) => ({
      id: event.id,
      owner_id: event.ownerId,
      sprint_id: event.sprintId,
      client_event_id: event.clientEventId,
      device_id: event.deviceId,
      event_type: event.eventType,
      source: event.source,
      occurred_at: event.occurredAt,
      causation_id: event.causationId ?? null,
      correlation_id: event.correlationId ?? null,
      payload: event.payload,
    }));
    const rows = (await getLearningSql().query(
      `
        INSERT INTO learning_events
          (id, owner_id, sprint_id, client_event_id, device_id, event_type, source,
           occurred_at, received_at, causation_id, correlation_id, payload)
        SELECT e.id, e.owner_id, e.sprint_id, e.client_event_id, e.device_id, e.event_type,
               e.source, e.occurred_at::timestamptz, $2, e.causation_id, e.correlation_id,
               e.payload
        FROM jsonb_to_recordset($1::jsonb) AS e(
          id text, owner_id text, sprint_id text, client_event_id text, device_id text,
          event_type text, source text, occurred_at text, causation_id text,
          correlation_id text, payload jsonb
        )
        ON CONFLICT (owner_id, device_id, client_event_id) DO NOTHING
        RETURNING id
      `,
      [JSON.stringify(records), receivedAt],
    )) as Array<{ id: string }>;
    return { accepted: rows.length, deduplicated: events.length - rows.length };
  }

  async markSprintCompleted(ownerId: string, sprintId: string, now: Date): Promise<void> {
    await getLearningSql().query(
      `
        UPDATE learning_sprints
        SET status = 'completed', updated_at = $3
        WHERE owner_id = $1 AND id = $2 AND status IN ('active', 'completed')
      `,
      [ownerId, sprintId, now],
    );
  }

  async replaceMasteryProjections(
    ownerId: string,
    sprintId: string,
    projections: readonly MasteryProjection[],
    now: Date,
  ): Promise<void> {
    if (projections.length === 0) return;
    const records = projections.map((projection) => ({
      id: stableProjectionId(
        'mpr',
        ownerId,
        sprintId,
        projection.conceptId,
        projection.projectorVersion,
      ),
      review_id: stableProjectionId(
        'rvi',
        ownerId,
        sprintId,
        projection.conceptId,
        projection.projectorVersion,
      ),
      concept_id: projection.conceptId,
      estimate: projection.estimate,
      confidence: projection.confidence,
      evidence_count: projection.evidenceCount,
      evidence_types: projection.evidenceTypes,
      evidence_summary: projection.evidence,
      last_practiced_at: projection.lastPracticedAt ?? null,
      next_review_at: projection.nextReviewAt ?? null,
      projector_version: projection.projectorVersion,
    }));
    await getLearningSql().query(
      `
        WITH input AS (
          SELECT *
          FROM jsonb_to_recordset($4::jsonb) AS p(
            id text,
            review_id text,
            concept_id text,
            estimate numeric,
            confidence numeric,
            evidence_count integer,
            evidence_types jsonb,
            evidence_summary jsonb,
            last_practiced_at text,
            next_review_at text,
            projector_version text
          )
        ), upserted AS (
          INSERT INTO mastery_projections
            (id, owner_id, sprint_id, concept_id, estimate, confidence, evidence_count,
             evidence_types, evidence_summary, last_practiced_at, next_review_at,
             projector_version, computed_at)
          SELECT id, $1, $2, concept_id, estimate, confidence, evidence_count,
                 evidence_types, evidence_summary,
                 NULLIF(last_practiced_at, '')::timestamptz,
                 NULLIF(next_review_at, '')::timestamptz,
                 projector_version, $3
          FROM input
          ON CONFLICT (owner_id, sprint_id, concept_id, projector_version) DO UPDATE
          SET estimate = EXCLUDED.estimate,
              confidence = EXCLUDED.confidence,
              evidence_count = EXCLUDED.evidence_count,
              evidence_types = EXCLUDED.evidence_types,
              evidence_summary = EXCLUDED.evidence_summary,
              last_practiced_at = EXCLUDED.last_practiced_at,
              next_review_at = EXCLUDED.next_review_at,
              computed_at = EXCLUDED.computed_at
          RETURNING concept_id
        )
        INSERT INTO review_items
          (id, owner_id, sprint_id, concept_id, projector_version, state, due_at,
           completed_at, created_at, updated_at)
        SELECT review_id, $1, $2, concept_id, projector_version,
               CASE
                 WHEN NULLIF(next_review_at, '')::timestamptz <= $3 THEN 'due'
                 ELSE 'scheduled'
               END,
               NULLIF(next_review_at, '')::timestamptz,
               NULL, $3, $3
        FROM input
        WHERE estimate IS NOT NULL AND NULLIF(next_review_at, '') IS NOT NULL
        ON CONFLICT (owner_id, sprint_id, concept_id, projector_version) DO UPDATE
        SET state = CASE
              WHEN EXCLUDED.due_at <= $3 THEN 'due'
              ELSE 'scheduled'
            END,
            due_at = EXCLUDED.due_at,
            completed_at = NULL,
            updated_at = EXCLUDED.updated_at
      `,
      [ownerId, sprintId, now, JSON.stringify(records)],
    );
  }

  async listMasteryProjections(
    ownerId: string,
    options: { sprintId?: string; projectId?: string; conceptId?: string },
  ): Promise<MasteryProjectionRecord[]> {
    const rows = (await getLearningSql().query(
      `
        WITH latest AS (
          SELECT DISTINCT ON (mp.sprint_id, mp.concept_id)
                 mp.id, mp.owner_id, mp.sprint_id, mp.concept_id, mp.estimate,
                 mp.confidence, mp.evidence_count, mp.evidence_types, mp.evidence_summary,
                 mp.last_practiced_at, mp.next_review_at, mp.projector_version, mp.computed_at,
                 s.classroom_id, s.goal, s.project_id,
                 project.display_name AS project_name
          FROM mastery_projections mp
          JOIN learning_sprints s
            ON s.owner_id = mp.owner_id AND s.id = mp.sprint_id
          LEFT JOIN learning_projects project
            ON project.owner_id = s.owner_id AND project.id = s.project_id
          WHERE mp.owner_id = $1
            AND ($2::text IS NULL OR mp.sprint_id = $2)
            AND ($3::text IS NULL OR s.project_id = $3)
            AND ($4::text IS NULL OR mp.concept_id = $4)
          ORDER BY mp.sprint_id, mp.concept_id, mp.computed_at DESC, mp.projector_version DESC
        )
        SELECT *
        FROM latest
        ORDER BY computed_at DESC, concept_id ASC
        LIMIT 1000
      `,
      [ownerId, options.sprintId ?? null, options.projectId ?? null, options.conceptId ?? null],
    )) as MasteryRow[];
    return rows.map(mastery);
  }

  async listReviewQueue(
    ownerId: string,
    options: { projectId?: string; dueOnly?: boolean; limit: number },
    now: Date,
  ): Promise<ReviewQueueItemRecord[]> {
    const limit = Math.max(1, Math.min(200, Math.trunc(options.limit)));
    const rows = (await getLearningSql().query(
      `
        WITH latest_mastery AS (
          SELECT DISTINCT ON (mp.sprint_id, mp.concept_id)
                 mp.*
          FROM mastery_projections mp
          WHERE mp.owner_id = $1
          ORDER BY mp.sprint_id, mp.concept_id, mp.computed_at DESC, mp.projector_version DESC
        ), promoted AS (
          UPDATE review_items
          SET state = 'due', updated_at = $4
          WHERE owner_id = $1 AND state = 'scheduled' AND due_at <= $4
          RETURNING id
        )
        SELECT review.id, review.owner_id, review.sprint_id, review.concept_id,
               review.projector_version, review.state, review.due_at, review.completed_at,
               review.created_at, review.updated_at,
               sprint.classroom_id, sprint.goal, sprint.project_id,
               project.display_name AS project_name,
               mastery.estimate AS mastery_estimate,
               mastery.confidence AS mastery_confidence,
               mastery.evidence_count AS mastery_evidence_count,
               (review.due_at <= $4) AS is_due
        FROM review_items review
        JOIN learning_sprints sprint
          ON sprint.owner_id = review.owner_id AND sprint.id = review.sprint_id
        LEFT JOIN learning_projects project
          ON project.owner_id = sprint.owner_id AND project.id = sprint.project_id
        JOIN latest_mastery mastery
          ON mastery.owner_id = review.owner_id
         AND mastery.sprint_id = review.sprint_id
         AND mastery.concept_id = review.concept_id
         AND mastery.projector_version = review.projector_version
        WHERE review.owner_id = $1
          AND review.state IN ('scheduled', 'due')
          AND ($2::text IS NULL OR sprint.project_id = $2)
          AND ($3::boolean IS NOT TRUE OR review.due_at <= $4)
        ORDER BY review.due_at ASC, review.id ASC
        LIMIT $5
      `,
      [ownerId, options.projectId ?? null, options.dueOnly ?? false, now, limit],
    )) as ReviewQueueRow[];
    return rows.map(reviewQueueItem);
  }

  async findReviewQueueItem(
    ownerId: string,
    reviewItemId: string,
    now: Date,
  ): Promise<ReviewQueueItemRecord | null> {
    const rows = (await getLearningSql().query(
      `
        WITH latest_mastery AS (
          SELECT DISTINCT ON (mp.sprint_id, mp.concept_id)
                 mp.*
          FROM mastery_projections mp
          WHERE mp.owner_id = $1
          ORDER BY mp.sprint_id, mp.concept_id, mp.computed_at DESC, mp.projector_version DESC
        ), promoted AS (
          UPDATE review_items
          SET state = 'due', updated_at = $3
          WHERE owner_id = $1 AND id = $2 AND state = 'scheduled' AND due_at <= $3
          RETURNING id
        )
        SELECT review.id, review.owner_id, review.sprint_id, review.concept_id,
               review.projector_version, review.state, review.due_at, review.completed_at,
               review.created_at, review.updated_at,
               sprint.classroom_id, sprint.goal, sprint.project_id,
               project.display_name AS project_name,
               mastery.estimate AS mastery_estimate,
               mastery.confidence AS mastery_confidence,
               mastery.evidence_count AS mastery_evidence_count,
               (review.due_at <= $3) AS is_due
        FROM review_items review
        JOIN learning_sprints sprint
          ON sprint.owner_id = review.owner_id AND sprint.id = review.sprint_id
        LEFT JOIN learning_projects project
          ON project.owner_id = sprint.owner_id AND project.id = sprint.project_id
        JOIN latest_mastery mastery
          ON mastery.owner_id = review.owner_id
         AND mastery.sprint_id = review.sprint_id
         AND mastery.concept_id = review.concept_id
         AND mastery.projector_version = review.projector_version
        WHERE review.owner_id = $1 AND review.id = $2 AND review.state IN ('scheduled', 'due')
        LIMIT 1
      `,
      [ownerId, reviewItemId, now],
    )) as ReviewQueueRow[];
    return rows[0] ? reviewQueueItem(rows[0]) : null;
  }

  async listEvents(
    ownerId: string,
    sprintId: string,
    limit: number,
  ): Promise<StoredLearningEvent[]> {
    const rows = (await getLearningSql().query(
      `
        SELECT server_seq, id, owner_id, sprint_id, event_type, client_event_id, device_id,
               occurred_at, received_at, source, causation_id, correlation_id, payload
        FROM learning_events
        WHERE owner_id = $1 AND sprint_id = $2
        ORDER BY server_seq ASC
        LIMIT $3
      `,
      [ownerId, sprintId, limit],
    )) as Array<Record<string, unknown>>;
    return rows.map(
      (row) =>
        ({
          protocolVersion: LEARNING_PROTOCOL_VERSION,
          schemaVersion: LEARNING_EVENT_SCHEMA_VERSION,
          id: String(row.id),
          ownerId: String(row.owner_id),
          sprintId: String(row.sprint_id),
          eventType: row.event_type,
          clientEventId: String(row.client_event_id),
          deviceId: String(row.device_id),
          occurredAt: new Date(String(row.occurred_at)).toISOString(),
          receivedAt: new Date(String(row.received_at)).toISOString(),
          serverSeq: Number(row.server_seq),
          source: row.source,
          ...(row.causation_id ? { causationId: String(row.causation_id) } : {}),
          ...(row.correlation_id ? { correlationId: String(row.correlation_id) } : {}),
          payload: row.payload,
        }) as StoredLearningEvent,
    );
  }

  async createDraft(input: CreateWritebackDraftRecord): Promise<WritebackDraftRecord> {
    const rows = (await getLearningSql().query(
      `
        INSERT INTO writeback_drafts
          (id, owner_id, draft_kind, sprint_id, synthesis_run_id, target_device_id,
           target_vault_binding_id, revision, status, operation, companion_id, managed_blocks,
             knowledge_asset_id, knowledge_asset_version_id, project_index_id, synthesis_index_id,
             vault_overview_id,
             relative_path, content, frontmatter,
             created_at, updated_at)
        VALUES ($1, $2, $3, $4, NULL, $5, $6, 1, 'generated', $7, $8, $9::jsonb,
                  $10, $11, $12, $13, $14, $15, $16, $17::jsonb, $18, $18)
        RETURNING id, owner_id, draft_kind, sprint_id, synthesis_run_id,
                  target_device_id, target_vault_binding_id, revision, status, operation,
                  companion_id, managed_blocks, knowledge_asset_id, knowledge_asset_version_id,
                   project_index_id, synthesis_index_id, vault_overview_id,
                  relative_path, content, frontmatter, created_at, updated_at
      `,
      [
        input.id,
        input.ownerId,
        input.draftKind ?? 'learning-summary',
        input.sprintId ?? null,
        input.targetDeviceId,
        input.targetVaultBindingId,
        input.operation ?? 'createManagedNote',
        input.companionId ?? null,
        JSON.stringify(input.managedBlocks ?? []),
        input.assetId ?? null,
        input.assetVersionId ?? null,
        input.projectIndexId ?? null,
        input.synthesisIndexId ?? null,
        input.vaultOverviewId ?? null,
        input.relativePath,
        input.content,
        JSON.stringify(input.frontmatter),
        input.now,
      ],
    )) as DraftRow[];
    const row = rows[0];
    if (!row) throw new Error('writeback_draft_not_created');
    return draft(row);
  }

  async createSynthesisDraft(
    input: CreateSynthesisWritebackDraftRecord,
  ): Promise<WritebackDraftRecord> {
    const rows = (await getLearningSql().query(
      `
        INSERT INTO writeback_drafts
          (id, owner_id, draft_kind, sprint_id, synthesis_run_id, target_device_id,
           target_vault_binding_id, revision, status, operation, companion_id, managed_blocks,
             knowledge_asset_id, knowledge_asset_version_id, project_index_id, synthesis_index_id,
             vault_overview_id,
            relative_path, content, frontmatter,
            created_at, updated_at)
        VALUES ($1, $2, 'synthesis', NULL, $3, $4, $5, 1, 'generated',
                'createManagedNote', NULL, '[]'::jsonb, NULL, NULL, NULL, NULL, NULL,
                $6, $7, $8::jsonb, $9, $9)
        RETURNING id, owner_id, draft_kind, sprint_id, synthesis_run_id,
                  target_device_id, target_vault_binding_id, revision, status, operation,
                  companion_id, managed_blocks, knowledge_asset_id, knowledge_asset_version_id,
                   project_index_id, synthesis_index_id, vault_overview_id,
                  relative_path, content, frontmatter, created_at, updated_at
      `,
      [
        input.id,
        input.ownerId,
        input.synthesisRunId,
        input.targetDeviceId,
        input.targetVaultBindingId,
        input.relativePath,
        input.content,
        JSON.stringify(input.frontmatter),
        input.now,
      ],
    )) as DraftRow[];
    const row = rows[0];
    if (!row) throw new Error('synthesis_writeback_draft_not_created');
    return draft(row);
  }

  async findOpenDraftByAssetVersion(
    ownerId: string,
    assetVersionId: string,
  ): Promise<WritebackDraftRecord | null> {
    const rows = (await getLearningSql().query(
      `
        SELECT id, owner_id, draft_kind, sprint_id, synthesis_run_id,
               target_device_id, target_vault_binding_id, revision, status, operation,
               companion_id, managed_blocks, knowledge_asset_id, knowledge_asset_version_id,
                project_index_id, synthesis_index_id, vault_overview_id,
               relative_path, content, frontmatter, created_at, updated_at
        FROM writeback_drafts
        WHERE owner_id = $1
          AND knowledge_asset_version_id = $2
          AND draft_kind = 'external-card'
          AND status IN ('generated', 'edited', 'approved')
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [ownerId, assetVersionId],
    )) as DraftRow[];
    return rows[0] ? draft(rows[0]) : null;
  }

  async findOpenDraftBySprint(
    ownerId: string,
    sprintId: string,
    draftKind: 'learning-summary',
  ): Promise<WritebackDraftRecord | null> {
    const rows = (await getLearningSql().query(
      `
        SELECT id, owner_id, draft_kind, sprint_id, synthesis_run_id,
               target_device_id, target_vault_binding_id, revision, status, operation,
               companion_id, managed_blocks, knowledge_asset_id, knowledge_asset_version_id,
               project_index_id, synthesis_index_id, vault_overview_id,
               relative_path, content, frontmatter, created_at, updated_at
        FROM writeback_drafts
        WHERE owner_id = $1
          AND sprint_id = $2
          AND draft_kind = $3
          AND status IN ('generated', 'edited', 'approved')
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [ownerId, sprintId, draftKind],
    )) as DraftRow[];
    return rows[0] ? draft(rows[0]) : null;
  }

  async findOpenDraftByProjectIndex(
    ownerId: string,
    projectIndexId: string,
  ): Promise<WritebackDraftRecord | null> {
    const rows = (await getLearningSql().query(
      `
        SELECT id, owner_id, draft_kind, sprint_id, synthesis_run_id,
               target_device_id, target_vault_binding_id, revision, status, operation,
               companion_id, managed_blocks, knowledge_asset_id, knowledge_asset_version_id,
                project_index_id, synthesis_index_id, vault_overview_id,
               relative_path, content, frontmatter, created_at, updated_at
        FROM writeback_drafts
        WHERE owner_id = $1
          AND project_index_id = $2
          AND draft_kind = 'project-index'
          AND status IN ('generated', 'edited', 'approved')
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [ownerId, projectIndexId],
    )) as DraftRow[];
    return rows[0] ? draft(rows[0]) : null;
  }

  async findOpenDraftBySynthesisIndex(
    ownerId: string,
    synthesisIndexId: string,
  ): Promise<WritebackDraftRecord | null> {
    const rows = (await getLearningSql().query(
      `
        SELECT id, owner_id, draft_kind, sprint_id, synthesis_run_id,
               target_device_id, target_vault_binding_id, revision, status, operation,
               companion_id, managed_blocks, knowledge_asset_id, knowledge_asset_version_id,
               project_index_id, synthesis_index_id, vault_overview_id,
               relative_path, content, frontmatter, created_at, updated_at
        FROM writeback_drafts
        WHERE owner_id = $1
          AND synthesis_index_id = $2
          AND draft_kind = 'synthesis-index'
          AND status IN ('generated', 'edited', 'approved')
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [ownerId, synthesisIndexId],
    )) as DraftRow[];
    return rows[0] ? draft(rows[0]) : null;
  }

  async findOpenDraftByVaultOverview(
    ownerId: string,
    vaultOverviewId: string,
  ): Promise<WritebackDraftRecord | null> {
    const rows = (await getLearningSql().query(
      `
        SELECT id, owner_id, draft_kind, sprint_id, synthesis_run_id,
               target_device_id, target_vault_binding_id, revision, status, operation,
               companion_id, managed_blocks, knowledge_asset_id, knowledge_asset_version_id,
               project_index_id, synthesis_index_id, vault_overview_id,
               relative_path, content, frontmatter, created_at, updated_at
        FROM writeback_drafts
        WHERE owner_id = $1
          AND vault_overview_id = $2
          AND draft_kind = 'vault-overview'
          AND status IN ('generated', 'edited', 'approved')
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [ownerId, vaultOverviewId],
    )) as DraftRow[];
    return rows[0] ? draft(rows[0]) : null;
  }

  async findDraft(ownerId: string, draftId: string): Promise<WritebackDraftRecord | null> {
    const rows = (await getLearningSql().query(
      `
        SELECT id, owner_id, draft_kind, sprint_id, synthesis_run_id,
               target_device_id, target_vault_binding_id, revision, status, operation,
               companion_id, managed_blocks, knowledge_asset_id, knowledge_asset_version_id,
                project_index_id, synthesis_index_id, vault_overview_id,
               relative_path, content, frontmatter, created_at, updated_at
        FROM writeback_drafts
        WHERE owner_id = $1 AND id = $2
      `,
      [ownerId, draftId],
    )) as DraftRow[];
    return rows[0] ? draft(rows[0]) : null;
  }

  async approveDraft(input: ApproveWritebackDraftInput): Promise<WritebackCommand | null> {
    const rows = (await getLearningSql().query(
      `
        WITH approved AS (
          UPDATE writeback_drafts
          SET status = 'approved', approved_at = $6, updated_at = $6
          WHERE id = $1 AND owner_id = $2 AND revision = $3
            AND status IN ('generated', 'edited', 'approved')
          RETURNING id, revision
        ), inserted AS (
          INSERT INTO writeback_commands
            (id, draft_id, draft_revision, owner_id, device_id, vault_binding_id,
             status, payload, issued_at, expires_at, created_at, updated_at)
          SELECT $4, approved.id, approved.revision, $2, $7, $8,
                 'pending', $5::jsonb, $6, $9, $6, $6
          FROM approved
          ON CONFLICT (draft_id, draft_revision) DO NOTHING
          RETURNING payload
        )
        SELECT payload FROM inserted
        UNION ALL
        SELECT c.payload
        FROM writeback_commands c
        JOIN approved a ON a.id = c.draft_id AND a.revision = c.draft_revision
        WHERE NOT EXISTS (SELECT 1 FROM inserted)
        LIMIT 1
      `,
      [
        input.draftId,
        input.ownerId,
        input.draftRevision,
        input.command.id,
        JSON.stringify(input.command),
        input.now,
        input.command.deviceId,
        input.command.vaultBindingId,
        input.command.expiresAt,
      ],
    )) as Array<{ payload: WritebackCommand }>;
    return rows[0]?.payload ?? null;
  }

  async leaseCommands(
    ownerId: string,
    deviceId: string,
    vaultBindingId: string,
    now: Date,
    leaseUntil: Date,
    limit: number,
    operations?: readonly import('@openmaic/learning-protocol').WritebackOperation[],
  ): Promise<WritebackCommand[]> {
    const operationFilter = operations && operations.length > 0;
    const rows = (await getLearningSql().query(
      `
        WITH expired AS (
          UPDATE writeback_commands
          SET status = 'expired', updated_at = $4
          WHERE owner_id = $1 AND device_id = $2 AND vault_binding_id = $3
            AND status IN ('pending', 'leased') AND expires_at <= $4
          RETURNING id
        ), candidates AS (
          SELECT id
          FROM writeback_commands
          WHERE owner_id = $1 AND device_id = $2 AND vault_binding_id = $3
            AND status IN ('pending', 'leased') AND expires_at > $4
            ${operationFilter ? "AND payload->>'operation' = ANY($7::text[])" : ''}
          ORDER BY issued_at ASC
          LIMIT $6
          FOR UPDATE SKIP LOCKED
        )
        UPDATE writeback_commands c
        SET status = 'leased', lease_until = $5, updated_at = $4
        FROM candidates
        WHERE c.id = candidates.id
        RETURNING c.payload
      `,
      operationFilter
        ? [ownerId, deviceId, vaultBindingId, now, leaseUntil, limit, operations]
        : [ownerId, deviceId, vaultBindingId, now, leaseUntil, limit],
    )) as Array<{ payload: WritebackCommand }>;
    const commands = rows.map((row) => row.payload);
    await this.markDepositionCommandsLeased(
      ownerId,
      commands.map((command) => command.id),
      now,
    );
    return commands;
  }

  async markCommandLocallyValidated(
    ownerId: string,
    deviceId: string,
    vaultBindingId: string,
    commandId: string,
    now: Date,
  ): Promise<boolean> {
    const rows = (await getLearningSql().query(
      `
        WITH affected AS (
          UPDATE deposition_items item
          SET state = 'locally_validated', updated_at = $5
          FROM writeback_commands command
          WHERE item.owner_id = $1
            AND item.writeback_command_id = command.id
            AND command.id = $4
            AND command.owner_id = $1
            AND command.device_id = $2
            AND command.vault_binding_id = $3
            AND item.state IN ('queued', 'leased', 'locally_validated')
          RETURNING item.run_id
        ), runs AS (
          UPDATE deposition_runs run
          SET state = 'locally_validated', updated_at = $5
          WHERE run.owner_id = $1
            AND run.id IN (SELECT run_id FROM affected)
            AND run.state IN ('queued', 'leased', 'locally_validated')
          RETURNING run.id
        )
        SELECT EXISTS(SELECT 1 FROM affected) AS updated
      `,
      [ownerId, deviceId, vaultBindingId, commandId, now],
    )) as Array<{ updated: boolean }>;
    return rows[0]?.updated === true;
  }

  private async markDepositionCommandsLeased(
    ownerId: string,
    commandIds: readonly string[],
    now: Date,
  ): Promise<void> {
    if (commandIds.length === 0) return;
    await getLearningSql().query(
      `
        WITH affected AS (
          UPDATE deposition_items
          SET state = 'leased', updated_at = $3
          WHERE owner_id = $1
            AND writeback_command_id = ANY($2::text[])
            AND state = 'queued'
          RETURNING run_id
        )
        UPDATE deposition_runs run
        SET state = 'leased', updated_at = $3
        WHERE run.owner_id = $1
          AND run.id IN (SELECT run_id FROM affected)
          AND run.state = 'queued'
      `,
      [ownerId, commandIds, now],
    );
  }

  async recordReceipt(
    ownerId: string,
    deviceId: string,
    receipt: WritebackReceipt,
    now: Date,
  ): Promise<ReceiptRecordResult> {
    const commandRows = (await getLearningSql().query(
      `
        SELECT c.id AS command_id, d.sprint_id, d.companion_id, d.project_index_id,
               d.synthesis_index_id, d.vault_overview_id,
               d.managed_blocks,
               r.id AS receipt_id, r.outcome,
               r.resulting_content_hash, r.resulting_path, r.conflict_detail
        FROM writeback_commands c
        JOIN writeback_drafts d ON d.id = c.draft_id
        LEFT JOIN writeback_receipts r
          ON r.command_id = c.id AND r.device_id = $2
        WHERE c.id = $3 AND c.owner_id = $1 AND c.device_id = $2
      `,
      [ownerId, deviceId, receipt.commandId],
    )) as Array<Record<string, unknown>>;
    const command = commandRows[0];
    if (!command) return { state: 'not_found' };

    if (command.receipt_id) {
      if (!receiptMatches(command, receipt)) return { state: 'mismatch' };
      await this.updateCommandFromReceipt(ownerId, deviceId, receipt, now);
      await this.updateDraftFromReceipt(ownerId, receipt.commandId, receipt.outcome, now);
      await this.updateManagedDocumentFromReceipt(ownerId, command, receipt, now);
      await this.updateDepositionFromReceipt(
        ownerId,
        receipt.commandId,
        typeof command.receipt_id === 'string' ? command.receipt_id : receipt.id,
        receipt.outcome,
        now,
      );
      return {
        state: 'duplicate',
        ...(typeof command.sprint_id === 'string' ? { sprintId: command.sprint_id } : {}),
      };
    }

    const inserted = (await getLearningSql().query(
      `
        INSERT INTO writeback_receipts
          (id, command_id, owner_id, device_id, outcome, resulting_content_hash,
           resulting_path, conflict_detail, applied_at, reported_at, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT (command_id, device_id) DO NOTHING
        RETURNING id
      `,
      [
        receipt.id,
        receipt.commandId,
        ownerId,
        deviceId,
        receipt.outcome,
        receipt.resultingContentHash ?? null,
        receipt.resultingPath ?? null,
        receipt.conflictDetail ?? null,
        receipt.appliedAt ?? null,
        receipt.reportedAt,
        now,
      ],
    )) as Array<{ id: string }>;

    if (!inserted[0]) {
      const raced = (await getLearningSql().query(
        `
          SELECT id AS receipt_id, outcome, resulting_content_hash, resulting_path, conflict_detail
          FROM writeback_receipts
          WHERE command_id = $1 AND device_id = $2
        `,
        [receipt.commandId, deviceId],
      )) as Array<Record<string, unknown>>;
      if (!raced[0] || !receiptMatches(raced[0], receipt)) return { state: 'mismatch' };
    }

    await this.updateCommandFromReceipt(ownerId, deviceId, receipt, now);
    await this.updateDraftFromReceipt(ownerId, receipt.commandId, receipt.outcome, now);
    await this.updateManagedDocumentFromReceipt(ownerId, command, receipt, now);
    await this.updateDepositionFromReceipt(
      ownerId,
      receipt.commandId,
      inserted[0]?.id ?? receipt.id,
      receipt.outcome,
      now,
    );
    return {
      state: inserted[0] ? 'stored' : 'duplicate',
      ...(typeof command.sprint_id === 'string' ? { sprintId: command.sprint_id } : {}),
    };
  }

  private async updateCommandFromReceipt(
    ownerId: string,
    deviceId: string,
    receipt: WritebackReceipt,
    now: Date,
  ): Promise<void> {
    await getLearningSql().query(
      `
        UPDATE writeback_commands
        SET status = $4, lease_until = NULL, updated_at = $5
        WHERE id = $1 AND owner_id = $2 AND device_id = $3
      `,
      [receipt.commandId, ownerId, deviceId, receipt.outcome, now],
    );
  }

  private async updateDraftFromReceipt(
    ownerId: string,
    commandId: string,
    outcome: WritebackReceipt['outcome'],
    now: Date,
  ): Promise<void> {
    await getLearningSql().query(
      `
        UPDATE writeback_drafts draft
        SET status = $3, updated_at = $4
        FROM writeback_commands command
        WHERE command.id = $2
          AND command.owner_id = $1
          AND draft.owner_id = $1
          AND draft.id = command.draft_id
          AND draft.revision = command.draft_revision
          AND draft.status IN ('generated', 'edited', 'approved')
      `,
      [ownerId, commandId, outcome, now],
    );
  }

  private async updateManagedDocumentFromReceipt(
    ownerId: string,
    command: Record<string, unknown>,
    receipt: WritebackReceipt,
    now: Date,
  ): Promise<void> {
    if (
      receipt.outcome !== 'applied' ||
      !receipt.resultingContentHash ||
      (typeof command.companion_id !== 'string' &&
        typeof command.project_index_id !== 'string' &&
        typeof command.synthesis_index_id !== 'string' &&
        typeof command.vault_overview_id !== 'string')
    ) {
      return;
    }
    const blocks = managedBlockStates(command.managed_blocks);
    if (blocks.length === 0) return;
    if (typeof command.companion_id === 'string') {
      await getLearningSql().query(
        `
          UPDATE learning_companions
          SET managed_blocks = $3::jsonb,
              last_content_hash = $4,
              updated_at = $5
          WHERE owner_id = $1 AND id = $2 AND status = 'active'
        `,
        [ownerId, command.companion_id, JSON.stringify(blocks), receipt.resultingContentHash, now],
      );
      return;
    }
    if (typeof command.project_index_id === 'string') {
      await getLearningSql().query(
        `
          UPDATE project_learning_indexes
          SET managed_blocks = $3::jsonb,
              last_content_hash = $4,
              updated_at = $5
          WHERE owner_id = $1 AND id = $2 AND status = 'active'
        `,
        [
          ownerId,
          command.project_index_id,
          JSON.stringify(blocks),
          receipt.resultingContentHash,
          now,
        ],
      );
      return;
    }
    if (typeof command.synthesis_index_id === 'string') {
      await getLearningSql().query(
        `
          UPDATE synthesis_indexes
          SET managed_blocks = $3::jsonb,
              last_content_hash = $4,
              updated_at = $5
          WHERE owner_id = $1 AND id = $2 AND status = 'active'
        `,
        [
          ownerId,
          command.synthesis_index_id,
          JSON.stringify(blocks),
          receipt.resultingContentHash,
          now,
        ],
      );
      return;
    }
    await getLearningSql().query(
      `
        UPDATE vault_overviews
        SET managed_blocks = $3::jsonb,
            last_content_hash = $4,
            updated_at = $5
        WHERE owner_id = $1 AND id = $2 AND status = 'active'
      `,
      [
        ownerId,
        command.vault_overview_id,
        JSON.stringify(blocks),
        receipt.resultingContentHash,
        now,
      ],
    );
  }

  private async updateDepositionFromReceipt(
    ownerId: string,
    commandId: string,
    receiptId: string,
    outcome: WritebackReceipt['outcome'],
    now: Date,
  ): Promise<void> {
    const transition =
      outcome === 'applied'
        ? { itemState: 'receipted', runState: 'receipted' }
        : outcome === 'conflicted'
          ? { itemState: 'conflicted', runState: 'conflicted' }
          : outcome === 'expired'
            ? { itemState: 'expired', runState: 'expired' }
            : outcome === 'rejected'
              ? { itemState: 'rejected', runState: 'blocked_policy' }
              : { itemState: 'failed', runState: 'failed_retryable' };
    await getLearningSql().query(
      `
        WITH affected AS (
          UPDATE deposition_items
          SET state = $3, receipt_id = $4, updated_at = $5
          WHERE owner_id = $1 AND writeback_command_id = $2
          RETURNING run_id
        )
        UPDATE deposition_runs run
        SET state = $6, updated_at = $5
        WHERE run.owner_id = $1 AND run.id IN (SELECT run_id FROM affected)
      `,
      [ownerId, commandId, transition.itemState, receiptId, now, transition.runState],
    );
  }
}
