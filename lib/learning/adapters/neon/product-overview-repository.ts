import type { ManagedBlockState } from '../../domain/learning-progress';
import { healthMetric, type ProductHealthSnapshot } from '../../domain/product-health';
import type {
  VaultOverviewDocumentRecord,
  VaultOverviewLearningItem,
  VaultOverviewProject,
  VaultOverviewReviewItem,
  VaultOverviewSnapshot,
  VaultOverviewSynthesisItem,
} from '../../domain/vault-overview';
import type {
  FindOrCreateVaultOverviewInput,
  ProductOverviewRepository,
} from '../../ports/product-overview-repository';
import { getLearningSql } from './client';

function managedBlocks(value: unknown): ManagedBlockState[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    if (!candidate || typeof candidate !== 'object') return [];
    const record = candidate as Record<string, unknown>;
    return typeof record.id === 'string' &&
      typeof record.content === 'string' &&
      typeof record.contentHash === 'string'
      ? [
          {
            id: record.id,
            content: record.content,
            contentHash: record.contentHash,
          },
        ]
      : [];
  });
}

function date(value: unknown): string | undefined {
  if (!value) return undefined;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function number(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export class NeonProductOverviewRepository implements ProductOverviewRepository {
  async findOrCreateOverview(
    input: FindOrCreateVaultOverviewInput,
  ): Promise<VaultOverviewDocumentRecord> {
    const sql = getLearningSql();
    const rows = (await sql.query(
      `
        INSERT INTO vault_overviews
          (id, owner_id, vault_binding_id, relative_path, status, managed_blocks,
           last_content_hash, created_at, updated_at)
        SELECT $1, $2, $3, $4, 'active', $5::jsonb, NULL, $6, $6
        FROM vault_bindings vault
        WHERE vault.owner_id = $2 AND vault.vault_binding_id = $3 AND vault.revoked_at IS NULL
        ON CONFLICT (owner_id, vault_binding_id) DO UPDATE
        SET updated_at = EXCLUDED.updated_at
        RETURNING id, owner_id, vault_binding_id, relative_path, status, managed_blocks,
                  last_content_hash, created_at, updated_at
      `,
      [
        input.id,
        input.ownerId,
        input.vaultBindingId,
        input.relativePath,
        JSON.stringify(input.initialManagedBlocks),
        input.now,
      ],
    )) as Array<Record<string, unknown>>;
    let row = rows[0];
    if (!row) throw new Error('vault_overview_not_created');
    if (!row.last_content_hash) {
      const recovered = (await sql.query(
        `
          WITH latest_applied AS (
            SELECT draft.managed_blocks,
                   receipt.resulting_content_hash
            FROM writeback_drafts draft
            JOIN writeback_commands command ON command.draft_id = draft.id
            JOIN writeback_receipts receipt ON receipt.command_id = command.id
            WHERE draft.owner_id = $1
              AND draft.vault_overview_id = $2
              AND receipt.outcome = 'applied'
              AND receipt.resulting_content_hash IS NOT NULL
            ORDER BY COALESCE(receipt.applied_at, receipt.reported_at, receipt.created_at) DESC
            LIMIT 1
          )
          UPDATE vault_overviews overview
          SET managed_blocks = latest_applied.managed_blocks,
              last_content_hash = latest_applied.resulting_content_hash,
              updated_at = GREATEST(overview.updated_at, $3)
          FROM latest_applied
          WHERE overview.owner_id = $1
            AND overview.id = $2
            AND overview.status = 'active'
            AND overview.last_content_hash IS NULL
          RETURNING overview.id, overview.owner_id, overview.vault_binding_id,
                    overview.relative_path, overview.status, overview.managed_blocks,
                    overview.last_content_hash, overview.created_at, overview.updated_at
        `,
        [input.ownerId, row.id, input.now],
      )) as Array<Record<string, unknown>>;
      row = recovered[0] ?? row;
    }
    return {
      id: String(row.id),
      ownerId: String(row.owner_id),
      vaultBindingId: String(row.vault_binding_id),
      relativePath: String(row.relative_path),
      status: row.status === 'archived' ? 'archived' : 'active',
      managedBlocks: managedBlocks(row.managed_blocks),
      ...(row.last_content_hash ? { lastContentHash: String(row.last_content_hash) } : {}),
      createdAt: new Date(String(row.created_at)),
      updatedAt: new Date(String(row.updated_at)),
    };
  }

  async snapshot(ownerId: string, now: Date): Promise<VaultOverviewSnapshot> {
    const sql = getLearningSql();
    const [projectsRows, learningRows, reviewRows, synthesisRows, health] = await Promise.all([
      sql.query(
        `
          SELECT project.id, project.display_name, project.root_path, project.project_revision,
                 project.updated_at,
                 COUNT(DISTINCT source.source_id) FILTER (WHERE source.removed_at IS NULL) AS source_count,
                 COUNT(DISTINCT sprint.classroom_id) AS classroom_count,
                 COUNT(DISTINCT sprint.id) FILTER (WHERE sprint.status = 'active') AS active_sprint_count
          FROM learning_projects project
          LEFT JOIN learning_project_sources source
            ON source.owner_id = project.owner_id AND source.project_id = project.id
          LEFT JOIN learning_sprints sprint
            ON sprint.owner_id = project.owner_id AND sprint.project_id = project.id
          WHERE project.owner_id = $1 AND project.status = 'active'
          GROUP BY project.id
          ORDER BY project.updated_at DESC
          LIMIT 12
        `,
        [ownerId],
      ),
      sql.query(
        `
          SELECT sprint.id, sprint.classroom_id, sprint.goal, sprint.status, sprint.updated_at,
                 project.display_name AS project_name,
                 mastery.estimate, mastery.confidence, mastery.evidence_count,
                 mastery.next_review_at
          FROM learning_sprints sprint
          LEFT JOIN learning_projects project
            ON project.owner_id = sprint.owner_id AND project.id = sprint.project_id
          LEFT JOIN LATERAL (
            SELECT estimate, confidence, evidence_count, next_review_at
            FROM mastery_projections projection
            WHERE projection.owner_id = sprint.owner_id
              AND projection.sprint_id = sprint.id
              AND projection.concept_id = 'classroom'
            ORDER BY projection.computed_at DESC
            LIMIT 1
          ) mastery ON true
          WHERE sprint.owner_id = $1
          ORDER BY sprint.updated_at DESC
          LIMIT 12
        `,
        [ownerId],
      ),
      sql.query(
        `
          SELECT MIN(review.id) AS id, sprint.classroom_id, sprint.goal,
                 project.display_name AS project_name, MIN(review.due_at) AS due_at,
                 COUNT(*) AS due_count, mastery.estimate,
                 BOOL_OR(review.due_at <= $2 OR review.state = 'due') AS is_due
          FROM review_items review
          JOIN learning_sprints sprint
            ON sprint.owner_id = review.owner_id AND sprint.id = review.sprint_id
          LEFT JOIN learning_projects project
            ON project.owner_id = sprint.owner_id AND project.id = sprint.project_id
          LEFT JOIN LATERAL (
            SELECT estimate
            FROM mastery_projections projection
            WHERE projection.owner_id = sprint.owner_id
              AND projection.sprint_id = sprint.id
              AND projection.concept_id = 'classroom'
            ORDER BY projection.computed_at DESC
            LIMIT 1
          ) mastery ON true
          WHERE review.owner_id = $1
            AND review.state IN ('scheduled', 'due')
            AND review.due_at <= $2 + INTERVAL '14 days'
          GROUP BY sprint.id, sprint.classroom_id, sprint.goal, project.display_name,
                   mastery.estimate
          ORDER BY is_due DESC, due_at ASC
          LIMIT 20
        `,
        [ownerId, now],
      ),
      sql.query(
        `
          SELECT id, title, mode, classroom_count, node_count, created_at
          FROM synthesis_runs
          WHERE owner_id = $1
          ORDER BY created_at DESC
          LIMIT 10
        `,
        [ownerId],
      ),
      this.health(ownerId, now),
    ]);

    const projects = (projectsRows as Array<Record<string, unknown>>).map(
      (row): VaultOverviewProject => ({
        id: String(row.id),
        name: String(row.display_name),
        rootPath: String(row.root_path),
        revision: number(row.project_revision),
        sourceCount: number(row.source_count),
        classroomCount: number(row.classroom_count),
        activeSprintCount: number(row.active_sprint_count),
        updatedAt: date(row.updated_at) ?? now.toISOString(),
      }),
    );
    const recentLearning = (learningRows as Array<Record<string, unknown>>).map(
      (row): VaultOverviewLearningItem => ({
        sprintId: String(row.id),
        classroomId: String(row.classroom_id),
        goal: String(row.goal || '未命名学习目标'),
        ...(row.project_name ? { projectName: String(row.project_name) } : {}),
        status: row.status === 'completed' || row.status === 'archived' ? row.status : 'active',
        masteryEstimate:
          row.estimate === null || row.estimate === undefined ? null : number(row.estimate),
        masteryConfidence: number(row.confidence),
        evidenceCount: number(row.evidence_count),
        ...(date(row.next_review_at) ? { nextReviewAt: date(row.next_review_at) } : {}),
        updatedAt: date(row.updated_at) ?? now.toISOString(),
      }),
    );
    const reviews = (reviewRows as Array<Record<string, unknown>>).map(
      (row): VaultOverviewReviewItem => ({
        id: String(row.id),
        classroomId: String(row.classroom_id),
        goal: String(row.goal || '未命名学习目标'),
        ...(row.project_name ? { projectName: String(row.project_name) } : {}),
        dueAt: date(row.due_at) ?? now.toISOString(),
        dueCount: number(row.due_count),
        masteryEstimate:
          row.estimate === null || row.estimate === undefined ? null : number(row.estimate),
        isDue: row.is_due === true,
      }),
    );
    const syntheses = (synthesisRows as Array<Record<string, unknown>>).map(
      (row): VaultOverviewSynthesisItem => ({
        id: String(row.id),
        title: String(row.title),
        mode: row.mode === 'timeline' || row.mode === 'domain' ? row.mode : 'combined',
        classroomCount: number(row.classroom_count),
        nodeCount: number(row.node_count),
        createdAt: date(row.created_at) ?? now.toISOString(),
      }),
    );
    return {
      generatedAt: now.toISOString(),
      projects,
      recentLearning,
      reviews,
      syntheses,
      health,
    };
  }

  async health(ownerId: string, now: Date): Promise<ProductHealthSnapshot> {
    const rows = (await getLearningSql().query(
      `
        WITH cutoff AS (
          SELECT $2::timestamptz - INTERVAL '7 days' AS value
        ),
        latest_generation_ops AS (
          SELECT DISTINCT ON (operation_id) operation_id, state, error_code, detail, occurred_at
          FROM learning_operation_events, cutoff
          WHERE owner_id = $1
            AND operation_kind = 'classroom-generation'
            AND occurred_at >= cutoff.value
          ORDER BY operation_id, occurred_at DESC
        ),
        latest_synthesis_ops AS (
          SELECT DISTINCT ON (operation_id) operation_id, state, error_code, detail, occurred_at
          FROM learning_operation_events, cutoff
          WHERE owner_id = $1
            AND operation_kind = 'synthesis-generation'
            AND occurred_at >= cutoff.value
          ORDER BY operation_id, occurred_at DESC
        )
        SELECT
          (SELECT COUNT(*) FROM learning_classrooms, cutoff
            WHERE owner_id = $1 AND created_at >= cutoff.value) AS generation_success,
          (SELECT COUNT(*) FROM latest_generation_ops WHERE state = 'failed') AS generation_failed,
          (SELECT COUNT(*) FROM latest_generation_ops WHERE state = 'started') AS generation_pending,
          (SELECT MAX(created_at) FROM learning_classrooms WHERE owner_id = $1) AS generation_last_success,
          (SELECT MAX(occurred_at) FROM latest_generation_ops WHERE state = 'failed') AS generation_last_failure,
          (SELECT COALESCE(detail->>'message', error_code) FROM latest_generation_ops
            WHERE state = 'failed' ORDER BY occurred_at DESC LIMIT 1) AS generation_failure_detail,

          (SELECT COUNT(*) FROM synthesis_runs, cutoff
            WHERE owner_id = $1 AND created_at >= cutoff.value) AS synthesis_success,
          (SELECT COUNT(*) FROM synthesis_schedule_runs, cutoff
            WHERE owner_id = $1 AND state = 'failed' AND created_at >= cutoff.value)
            + (SELECT COUNT(*) FROM latest_synthesis_ops WHERE state = 'failed') AS synthesis_failed,
          (SELECT COUNT(*) FROM synthesis_schedule_runs
            WHERE owner_id = $1 AND state = 'running')
            + (SELECT COUNT(*) FROM latest_synthesis_ops WHERE state = 'started') AS synthesis_pending,
          (SELECT MAX(created_at) FROM synthesis_runs WHERE owner_id = $1) AS synthesis_last_success,
          (SELECT MAX(completed_at) FROM synthesis_schedule_runs
            WHERE owner_id = $1 AND state = 'failed')
            AS synthesis_schedule_last_failure,
          (SELECT MAX(occurred_at) FROM latest_synthesis_ops
            WHERE state = 'failed') AS synthesis_operation_last_failure,
          COALESCE(
            (SELECT COALESCE(detail->>'message', error_code) FROM latest_synthesis_ops
              WHERE state = 'failed' ORDER BY occurred_at DESC LIMIT 1),
            (SELECT error_detail FROM synthesis_schedule_runs
              WHERE owner_id = $1 AND state = 'failed'
              ORDER BY completed_at DESC NULLS LAST LIMIT 1)
          ) AS synthesis_failure_detail,

          (SELECT COUNT(*) FROM writeback_receipts, cutoff
            WHERE owner_id = $1 AND outcome = 'applied' AND created_at >= cutoff.value) AS writeback_success,
          (SELECT COUNT(*) FROM writeback_receipts, cutoff
            WHERE owner_id = $1
              AND outcome IN ('conflicted', 'failed', 'expired')
              AND created_at >= cutoff.value) AS writeback_failed,
          (SELECT COUNT(*) FROM writeback_commands
            WHERE owner_id = $1 AND status IN ('pending', 'leased')) AS writeback_pending,
          (SELECT MAX(applied_at) FROM writeback_receipts
            WHERE owner_id = $1 AND outcome = 'applied') AS writeback_last_success,
          (SELECT MAX(reported_at) FROM writeback_receipts
            WHERE owner_id = $1
              AND outcome IN ('conflicted', 'failed', 'expired')) AS writeback_last_failure,
          (SELECT conflict_detail FROM writeback_receipts
            WHERE owner_id = $1
              AND outcome IN ('conflicted', 'failed', 'expired')
            ORDER BY reported_at DESC LIMIT 1) AS writeback_failure_detail,

          (SELECT COUNT(*) FROM research_sources WHERE owner_id = $1) AS source_total,
          (SELECT COUNT(*) FROM research_sources
            WHERE owner_id = $1 AND availability IN ('available', 'redirected')) AS source_success,
          (SELECT COUNT(*) FROM research_sources
            WHERE owner_id = $1 AND availability IN ('unreachable', 'unsafe')) AS source_failed,
          (SELECT COUNT(*) FROM research_sources
            WHERE owner_id = $1 AND availability = 'unverified') AS source_pending,
          (SELECT MAX(checked_at) FROM research_sources
            WHERE owner_id = $1 AND availability IN ('available', 'redirected')) AS source_last_success,
          (SELECT MAX(checked_at) FROM research_sources
            WHERE owner_id = $1 AND availability IN ('unreachable', 'unsafe')) AS source_last_failure,
          (SELECT health_error FROM research_sources
            WHERE owner_id = $1 AND availability IN ('unreachable', 'unsafe')
            ORDER BY checked_at DESC NULLS LAST LIMIT 1) AS source_failure_detail
      `,
      [ownerId, now],
    )) as Array<Record<string, unknown>>;
    const row = rows[0] ?? {};
    const generationSucceeded = number(row.generation_success);
    const generationFailed = number(row.generation_failed);
    const generationPending = number(row.generation_pending);
    const synthesisSucceeded = number(row.synthesis_success);
    const synthesisFailed = number(row.synthesis_failed);
    const synthesisPending = number(row.synthesis_pending);
    const writebackSucceeded = number(row.writeback_success);
    const writebackFailed = number(row.writeback_failed);
    const writebackPending = number(row.writeback_pending);
    const sourceTotal = number(row.source_total);
    const sourceSucceeded = number(row.source_success);
    const sourceFailed = number(row.source_failed);
    const sourcePending = number(row.source_pending);
    return {
      generatedAt: now.toISOString(),
      windowDays: 7,
      generation: healthMetric({
        total: generationSucceeded + generationFailed + generationPending,
        succeeded: generationSucceeded,
        failed: generationFailed,
        pending: generationPending,
        ...(date(row.generation_last_success)
          ? { lastSuccessAt: date(row.generation_last_success) }
          : {}),
        ...(date(row.generation_last_failure)
          ? { lastFailureAt: date(row.generation_last_failure) }
          : {}),
        ...(row.generation_failure_detail
          ? { lastFailureDetail: String(row.generation_failure_detail) }
          : {}),
      }),
      synthesis: healthMetric({
        total: synthesisSucceeded + synthesisFailed + synthesisPending,
        succeeded: synthesisSucceeded,
        failed: synthesisFailed,
        pending: synthesisPending,
        ...(date(row.synthesis_last_success)
          ? { lastSuccessAt: date(row.synthesis_last_success) }
          : {}),
        ...(date(row.synthesis_operation_last_failure ?? row.synthesis_schedule_last_failure)
          ? {
              lastFailureAt: date(
                row.synthesis_operation_last_failure ?? row.synthesis_schedule_last_failure,
              ),
            }
          : {}),
        ...(row.synthesis_failure_detail
          ? { lastFailureDetail: String(row.synthesis_failure_detail) }
          : {}),
      }),
      writeback: healthMetric({
        total: writebackSucceeded + writebackFailed + writebackPending,
        succeeded: writebackSucceeded,
        failed: writebackFailed,
        pending: writebackPending,
        ...(date(row.writeback_last_success)
          ? { lastSuccessAt: date(row.writeback_last_success) }
          : {}),
        ...(date(row.writeback_last_failure)
          ? { lastFailureAt: date(row.writeback_last_failure) }
          : {}),
        ...(row.writeback_failure_detail
          ? { lastFailureDetail: String(row.writeback_failure_detail) }
          : {}),
      }),
      sources: healthMetric({
        total: sourceTotal,
        succeeded: sourceSucceeded,
        failed: sourceFailed,
        pending: sourcePending,
        ...(date(row.source_last_success) ? { lastSuccessAt: date(row.source_last_success) } : {}),
        ...(date(row.source_last_failure) ? { lastFailureAt: date(row.source_last_failure) } : {}),
        ...(row.source_failure_detail
          ? { lastFailureDetail: String(row.source_failure_detail) }
          : {}),
      }),
    };
  }
}
