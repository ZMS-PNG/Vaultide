import type { JsonObject } from '@openmaic/learning-protocol';
import type { LearningProjectRecord } from '../../domain/project';
import {
  sourceLearningState,
  type ProjectLearningIndexRecord,
  type ProjectSourceLearningRecord,
} from '../../domain/project-learning';
import type {
  ProjectCompanionSourceRecord,
  ProjectLearningIndexRepository,
} from '../../ports/project-learning-index-repository';
import { getLearningSql } from './client';

interface ProjectRow {
  id: string;
  owner_id: string;
  vault_binding_id: string;
  kind: string;
  display_name: string;
  root_path: string;
  status: LearningProjectRecord['status'];
  binding_revision: string | number;
  project_revision: string | number;
  latest_manifest_hash: string | null;
  metadata: JsonObject;
  last_indexed_at: string | null;
  created_at: string;
  updated_at: string;
}

interface SourceRow {
  source_id: string;
  title: string;
  relative_path: string | null;
  latest_version_id: string;
  latest_content_hash: string;
  index_status: string | null;
  indexed_chunk_count: string | number | null;
  last_seen_at: string;
  companion_id: string | null;
  companion_relative_path: string | null;
  sprint_id: string | null;
  classroom_id: string | null;
  sprint_status: 'active' | 'completed' | 'archived' | null;
  sprint_source_version_id: string | null;
  sprint_updated_at: string | null;
  completed_source_version_id: string | null;
  mastery_estimate: string | number | null;
  mastery_confidence: string | number | null;
  mastery_evidence_count: string | number | null;
  mastery_next_review_at: string | null;
  review_id: string | null;
  review_state: 'scheduled' | 'due' | 'completed' | 'cancelled' | null;
  review_due_at: string | null;
}

function project(row: ProjectRow): LearningProjectRecord {
  return {
    id: row.id,
    ownerId: row.owner_id,
    vaultBindingId: row.vault_binding_id,
    kind: row.kind,
    projectName: row.display_name,
    rootPath: row.root_path,
    status: row.status,
    bindingRevision: Number(row.binding_revision),
    projectRevision: Number(row.project_revision),
    ...(row.latest_manifest_hash ? { latestManifestHash: row.latest_manifest_hash } : {}),
    metadata: row.metadata,
    ...(row.last_indexed_at ? { lastIndexedAt: new Date(row.last_indexed_at) } : {}),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

function indexStatus(value: string | null): ProjectSourceLearningRecord['indexStatus'] {
  return value === 'pending' || value === 'ready' || value === 'failed' || value === 'purged'
    ? value
    : 'missing';
}

function source(row: SourceRow, now: Date): ProjectSourceLearningRecord {
  const latestSprint =
    row.sprint_id &&
    row.classroom_id &&
    row.sprint_status &&
    row.sprint_source_version_id &&
    row.sprint_updated_at
      ? {
          id: row.sprint_id,
          classroomId: row.classroom_id,
          status: row.sprint_status,
          sourceVersionId: row.sprint_source_version_id,
          updatedAt: new Date(row.sprint_updated_at),
        }
      : undefined;
  const mastery =
    row.mastery_confidence !== null && row.mastery_evidence_count !== null
      ? {
          estimate: row.mastery_estimate === null ? null : Number(row.mastery_estimate),
          confidence: Number(row.mastery_confidence),
          evidenceCount: Number(row.mastery_evidence_count),
          ...(row.mastery_next_review_at
            ? { nextReviewAt: new Date(row.mastery_next_review_at) }
            : {}),
        }
      : undefined;
  const review =
    row.review_id && row.review_state && row.review_due_at
      ? { id: row.review_id, state: row.review_state, dueAt: new Date(row.review_due_at) }
      : undefined;
  const sourceUpdated =
    Boolean(row.completed_source_version_id) && row.completed_source_version_id !== row.latest_version_id;
  return {
    sourceId: row.source_id,
    title: row.title,
    relativePath: row.relative_path || row.title,
    latestVersionId: row.latest_version_id,
    latestContentHash: row.latest_content_hash,
    indexStatus: indexStatus(row.index_status),
    indexedChunkCount: Math.max(0, Number(row.indexed_chunk_count ?? 0)),
    lastSeenAt: new Date(row.last_seen_at),
    ...(row.companion_id && row.companion_relative_path
      ? { companion: { id: row.companion_id, relativePath: row.companion_relative_path } }
      : {}),
    ...(latestSprint ? { latestSprint } : {}),
    ...(row.completed_source_version_id
      ? { latestCompletedSourceVersionId: row.completed_source_version_id }
      : {}),
    ...(mastery ? { mastery } : {}),
    ...(review ? { review } : {}),
    learningState: sourceLearningState({ latestSprint, mastery, review, now }),
    sourceUpdated,
  };
}

export class NeonProjectLearningIndexRepository implements ProjectLearningIndexRepository {
  async listProjectBundleCompanionSources(
    ownerId: string,
    projectId: string,
    sourceBundleId: string,
    vaultBindingId: string,
  ): Promise<ProjectCompanionSourceRecord[]> {
    const rows = (await getLearningSql().query(
      `
        SELECT item.source_id, item.snapshot_id,
               version.locator ->> 'relativePath' AS relative_path
        FROM source_bundle_items item
        JOIN learning_source_versions version
          ON version.owner_id = item.owner_id
         AND version.source_id = item.source_id
         AND version.id = item.source_version_id
        WHERE item.owner_id = $1
          AND item.project_id = $2
          AND item.source_bundle_id = $3
          AND item.vault_binding_id = $4
        ORDER BY item.ordinal ASC
      `,
      [ownerId, projectId, sourceBundleId, vaultBindingId],
    )) as Array<{
      source_id: string;
      snapshot_id: string;
      relative_path: string | null;
    }>;
    return rows.flatMap((row) =>
      row.relative_path
        ? [
            {
              sourceId: row.source_id,
              snapshotId: row.snapshot_id,
              relativePath: row.relative_path,
            },
          ]
        : [],
    );
  }

  async findProjectLearningIndex(
    ownerId: string,
    projectId: string,
    now: Date,
  ): Promise<ProjectLearningIndexRecord | null> {
    const projects = (await getLearningSql().query(
      `
        SELECT id, owner_id, vault_binding_id, kind, display_name, root_path, status,
               binding_revision, project_revision, latest_manifest_hash, metadata,
               last_indexed_at, created_at, updated_at
        FROM learning_projects
        WHERE owner_id = $1 AND id = $2 AND status = 'active'
      `,
      [ownerId, projectId],
    )) as ProjectRow[];
    const projectRow = projects[0];
    if (!projectRow) return null;

    const sources = (await getLearningSql().query(
      `
        WITH latest_sprint AS (
          SELECT DISTINCT ON (item.source_id)
                 item.source_id, sprint.id AS sprint_id, sprint.classroom_id,
                 sprint.status AS sprint_status, item.source_version_id,
                 sprint.updated_at
          FROM learning_sprints sprint
          JOIN source_bundle_items item
            ON item.owner_id = sprint.owner_id AND item.source_bundle_id = sprint.source_bundle_id
          WHERE sprint.owner_id = $1 AND sprint.project_id = $2
          ORDER BY item.source_id, sprint.updated_at DESC, sprint.id DESC
        ), latest_completed AS (
          SELECT DISTINCT ON (item.source_id)
                 item.source_id, item.source_version_id
          FROM learning_sprints sprint
          JOIN source_bundle_items item
            ON item.owner_id = sprint.owner_id AND item.source_bundle_id = sprint.source_bundle_id
          WHERE sprint.owner_id = $1 AND sprint.project_id = $2 AND sprint.status = 'completed'
          ORDER BY item.source_id, sprint.updated_at DESC, sprint.id DESC
        )
        SELECT link.source_id,
               version.title,
               version.locator ->> 'relativePath' AS relative_path,
               link.latest_version_id,
               version.content_hash AS latest_content_hash,
               source_index.status AS index_status,
               source_index.chunk_count AS indexed_chunk_count,
               link.last_seen_at,
               companion.id AS companion_id,
               companion.relative_path AS companion_relative_path,
               sprint.sprint_id,
               sprint.classroom_id,
               sprint.sprint_status,
               sprint.source_version_id AS sprint_source_version_id,
               sprint.updated_at AS sprint_updated_at,
               completed.source_version_id AS completed_source_version_id,
               mastery.estimate AS mastery_estimate,
               mastery.confidence AS mastery_confidence,
               mastery.evidence_count AS mastery_evidence_count,
               mastery.next_review_at AS mastery_next_review_at,
               review.id AS review_id,
               review.state AS review_state,
               review.due_at AS review_due_at
        FROM learning_project_sources link
        JOIN learning_source_versions version
          ON version.owner_id = link.owner_id
         AND version.source_id = link.source_id
         AND version.id = link.latest_version_id
        LEFT JOIN learning_source_indexes source_index
          ON source_index.owner_id = link.owner_id
         AND source_index.source_version_id = link.latest_version_id
         AND source_index.index_version = 'markdown-lexical-v1'
        LEFT JOIN learning_companions companion
          ON companion.owner_id = link.owner_id
         AND companion.vault_binding_id = link.vault_binding_id
         AND companion.source_id = link.source_id
         AND companion.status = 'active'
        LEFT JOIN latest_sprint sprint ON sprint.source_id = link.source_id
        LEFT JOIN latest_completed completed ON completed.source_id = link.source_id
        LEFT JOIN mastery_projections mastery
          ON mastery.owner_id = link.owner_id
         AND mastery.sprint_id = sprint.sprint_id
         AND mastery.concept_id = 'classroom'
         AND mastery.projector_version = 'mastery-evidence-v2'
        LEFT JOIN review_items review
          ON review.owner_id = link.owner_id
         AND review.sprint_id = sprint.sprint_id
         AND review.concept_id = 'classroom'
         AND review.projector_version = 'mastery-evidence-v2'
        WHERE link.owner_id = $1 AND link.project_id = $2 AND link.removed_at IS NULL
        ORDER BY version.locator ->> 'relativePath' ASC NULLS LAST, link.source_id ASC
      `,
      [ownerId, projectId],
    )) as SourceRow[];
    return {
      project: project(projectRow),
      sources: sources.map((row) => source(row, now)),
      generatedAt: now,
    };
  }
}
