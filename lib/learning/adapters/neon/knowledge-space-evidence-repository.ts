import type {
  KnowledgeSnapshotEvidenceSummary,
  KnowledgeOpenQuestion,
  MisconceptionCorrection,
  VerifiedKnowledgeEntry,
} from '../../domain/knowledge-snapshot';
import type { TrustedKnowledgeSnapshotInput } from '../../domain/knowledge-space-synthesis';
import type { KnowledgeSpaceEvidenceRepository } from '../../ports/knowledge-space-evidence-repository';
import { getLearningSql } from './client';

interface KnowledgeSnapshotRow {
  snapshot_id: string;
  session_id: string;
  scope_kind: TrustedKnowledgeSnapshotInput['scopeKind'];
  scope_id: string;
  revision: number;
  parent_snapshot_id: string | null;
  source_manifest_sha256: string;
  project_id: string | null;
  project_name: string | null;
  classroom_id: string | null;
  source_mode: TrustedKnowledgeSnapshotInput['sourceMode'];
  session_metadata: unknown;
  verified_knowledge: unknown;
  misconceptions: unknown;
  unresolved_items: unknown;
  evidence_summary: unknown;
  created_at: string;
}

function arrayOrEmpty<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function objectOrEmpty<T extends object>(value: unknown): T {
  return (
    value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  ) as T;
}

function topicTags(value: unknown): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const metadata = value as Record<string, unknown>;
  const candidates = metadata.topicTags ?? metadata.tags;
  return Array.isArray(candidates)
    ? candidates
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 100)
    : [];
}

/**
 * This query reads durable projected snapshots, not raw learning events. The
 * domain projector performs a second trust check before any row can influence
 * synthesis output.
 */
export class NeonKnowledgeSpaceEvidenceRepository
  implements KnowledgeSpaceEvidenceRepository
{
  async listKnowledgeSnapshots(ownerId: string): Promise<TrustedKnowledgeSnapshotInput[]> {
    const rows = (await getLearningSql().query(
      `
        SELECT
          ks.id AS snapshot_id,
          ks.session_id,
          ks.scope_kind,
          ks.scope_id,
          ks.revision,
          ks.parent_snapshot_id,
          ks.source_manifest_sha256,
          COALESCE(ls.project_id, sprint.project_id) AS project_id,
          project.display_name AS project_name,
          COALESCE(generation.classroom_id, ls.metadata ->> 'classroomId') AS classroom_id,
          ls.source_mode,
          ls.metadata AS session_metadata,
          ks.verified_knowledge,
          ks.misconceptions,
          ks.unresolved_items,
          ks.evidence_summary,
          ks.created_at
        FROM learning_knowledge_snapshots ks
        INNER JOIN learning_sessions ls
          ON ls.owner_id = ks.owner_id AND ls.id = ks.session_id
        LEFT JOIN LATERAL (
          SELECT job.classroom_id
          FROM course_generation_jobs job
          WHERE job.owner_id = ks.owner_id
            AND job.session_id = ks.session_id
            AND job.status = 'ready'
          ORDER BY job.completed_at DESC NULLS LAST, job.created_at DESC
          LIMIT 1
        ) generation ON TRUE
        LEFT JOIN learning_sprints sprint
          ON sprint.owner_id = ks.owner_id
         AND sprint.classroom_id = COALESCE(generation.classroom_id, ls.metadata ->> 'classroomId')
        LEFT JOIN learning_projects project
          ON project.owner_id = ks.owner_id
         AND project.id = COALESCE(ls.project_id, sprint.project_id)
        WHERE ks.owner_id = $1
          AND CASE
                WHEN jsonb_typeof(ks.evidence_summary -> 'acceptedEvaluationEventIds') = 'array'
                  THEN jsonb_array_length(ks.evidence_summary -> 'acceptedEvaluationEventIds')
                ELSE 0
              END > 0
        ORDER BY ks.created_at ASC, ks.scope_kind ASC, ks.scope_id ASC, ks.revision ASC
      `,
      [ownerId],
    )) as KnowledgeSnapshotRow[];

    return rows.map((row) => {
      const evidenceSummary = objectOrEmpty<KnowledgeSnapshotEvidenceSummary>(
        row.evidence_summary,
      );
      return {
        snapshotId: row.snapshot_id,
        sessionId: row.session_id,
        scopeKind: row.scope_kind,
        scopeId: row.scope_id,
        revision: Number(row.revision),
        ...(row.parent_snapshot_id ? { parentSnapshotId: row.parent_snapshot_id } : {}),
        sourceManifestSha256: row.source_manifest_sha256,
        ...(row.project_id ? { projectId: row.project_id } : {}),
        ...(row.project_name ? { projectName: row.project_name } : {}),
        ...(row.classroom_id ? { classroomId: row.classroom_id } : {}),
        sourceMode: row.source_mode,
        topicTags: topicTags(row.session_metadata),
        createdAt: new Date(row.created_at),
        verifiedKnowledge: arrayOrEmpty<VerifiedKnowledgeEntry>(row.verified_knowledge),
        misconceptions: arrayOrEmpty<MisconceptionCorrection>(row.misconceptions),
        unresolvedItems: arrayOrEmpty<KnowledgeOpenQuestion>(row.unresolved_items),
        evidenceSummary,
        eligibleForPersistence:
          Array.isArray(evidenceSummary.acceptedEvaluationEventIds) &&
          evidenceSummary.acceptedEvaluationEventIds.length > 0,
      };
    });
  }
}
