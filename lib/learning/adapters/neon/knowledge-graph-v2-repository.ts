import type {
  KnowledgeCompanionContext,
  KnowledgeGraphProjectionContext,
  KnowledgeGraphProjectionRecord,
  KnowledgeGraphV2,
  KnowledgeMasteryContext,
  KnowledgeRelationFeedbackRecord,
  KnowledgeRelationStatus,
  KnowledgeReviewContext,
  KnowledgeSourceContext,
} from '../../domain/knowledge-graph-v2/contracts';
import { canonicalConceptIdentity } from '../../domain/knowledge-graph-v2/stable-identity';
import type {
  KnowledgeGraphV2Repository,
  LoadKnowledgeGraphContextInput,
  SaveKnowledgeGraphProjectionInput,
  SaveKnowledgeRelationFeedbackInput,
} from '../../ports/knowledge-graph-v2-repository';
import { getLearningSql } from './client';

interface ProjectionRow {
  id: string;
  owner_id: string;
  synthesis_id: string;
  scope_hash: string;
  input_hash: string;
  graph_hash: string | null;
  projector_version: string;
  layout_version: string;
  status: 'building' | 'ready' | 'failed';
  graph_snapshot: unknown;
  generated_at: string;
  created_at: string;
  updated_at: string;
}

interface FeedbackRow {
  id: string;
  owner_id: string;
  relation_id: string;
  action: 'confirm' | 'reject';
  reason: string | null;
  created_at: string;
  updated_at: string;
}

function projection(row: ProjectionRow): KnowledgeGraphProjectionRecord {
  if (row.status !== 'ready' || !row.graph_hash || !row.graph_snapshot) {
    throw new Error('knowledge_graph_projection_not_ready');
  }
  return {
    id: row.id,
    ownerId: row.owner_id,
    synthesisId: row.synthesis_id,
    scopeHash: row.scope_hash,
    inputHash: row.input_hash,
    graphHash: row.graph_hash,
    projectorVersion: row.projector_version,
    layoutVersion: row.layout_version,
    status: row.status,
    graph: row.graph_snapshot as KnowledgeGraphV2,
    generatedAt: new Date(row.generated_at),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

function feedback(row: FeedbackRow): KnowledgeRelationFeedbackRecord {
  return {
    id: row.id,
    ownerId: row.owner_id,
    relationId: row.relation_id,
    action: row.action,
    ...(row.reason ? { reason: row.reason } : {}),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

export class NeonKnowledgeGraphV2Repository implements KnowledgeGraphV2Repository {
  async loadProjectionContext(
    input: LoadKnowledgeGraphContextInput,
  ): Promise<KnowledgeGraphProjectionContext> {
    const [sourceRows, companionRows, masteryRows, reviewRows] = await Promise.all([
      getLearningSql().query(
        `
          WITH scoped_sources AS (
            SELECT item.source_id, sprint.project_id, sprint.classroom_id
            FROM learning_sprints sprint
            JOIN source_bundle_items item
              ON item.owner_id = sprint.owner_id
             AND item.source_bundle_id = sprint.source_bundle_id
            WHERE sprint.owner_id = $1
              AND (
                (cardinality($2::text[]) = 0 AND cardinality($3::text[]) = 0)
                OR sprint.classroom_id = ANY($2::text[])
                OR sprint.project_id = ANY($3::text[])
              )
            UNION ALL
            SELECT link.source_id, link.project_id, NULL::text AS classroom_id
            FROM learning_project_sources link
            WHERE link.owner_id = $1 AND link.removed_at IS NULL
              AND (
                (cardinality($2::text[]) = 0 AND cardinality($3::text[]) = 0)
                OR link.project_id = ANY($3::text[])
              )
          ), grouped_sources AS (
            SELECT source_id, project_id,
                   array_remove(array_agg(DISTINCT classroom_id), NULL) AS classroom_ids
            FROM scoped_sources
            GROUP BY source_id, project_id
          )
          SELECT source.id AS source_id, source.title AS source_title,
                 source.origin AS source_origin, grouped.project_id,
                 grouped.classroom_ids, latest_version.id AS source_version_id,
                 latest_version.locator ->> 'relativePath' AS original_relative_path,
                 COALESCE(latest_version.last_seen_at, source.updated_at) AS updated_at
          FROM grouped_sources grouped
          JOIN learning_sources source
            ON source.owner_id = $1 AND source.id = grouped.source_id
          LEFT JOIN LATERAL (
            SELECT version.id, version.locator, version.last_seen_at
            FROM learning_source_versions version
            WHERE version.owner_id = $1 AND version.source_id = grouped.source_id
            ORDER BY version.revision DESC
            LIMIT 1
          ) latest_version ON TRUE
          WHERE source.status = 'active'
          ORDER BY source.title ASC, grouped.project_id ASC NULLS LAST, source.id ASC
        `,
        [input.ownerId, input.classroomIds, input.projectIds],
      ),
      getLearningSql().query(
        `
          SELECT companion.id AS companion_id, companion.source_id,
                 COALESCE(source.title, companion.original_relative_path) AS source_title,
                 COALESCE(source.origin, 'obsidian') AS source_origin,
                 latest_version.id AS source_version_id, companion.project_id,
                 companion.source_bundle_id, companion.source_snapshot_id,
                 companion.original_relative_path, companion.relative_path,
                 (latest_version.last_seen_at > companion.updated_at) AS source_updated,
                 companion.updated_at
          FROM learning_companions companion
          LEFT JOIN learning_sources source
            ON source.owner_id = companion.owner_id AND source.id = companion.source_id
          LEFT JOIN LATERAL (
            SELECT version.id, version.last_seen_at
            FROM learning_source_versions version
            WHERE version.owner_id = companion.owner_id
              AND version.source_id = companion.source_id
            ORDER BY version.revision DESC
            LIMIT 1
          ) latest_version ON TRUE
          WHERE companion.owner_id = $1 AND companion.status = 'active'
            AND (
              (cardinality($2::text[]) = 0 AND cardinality($3::text[]) = 0)
              OR companion.project_id = ANY($3::text[])
              OR EXISTS (
                SELECT 1
                FROM learning_sprints sprint
                WHERE sprint.owner_id = companion.owner_id
                  AND sprint.source_bundle_id = companion.source_bundle_id
                  AND sprint.classroom_id = ANY($2::text[])
              )
            )
          ORDER BY companion.updated_at DESC, companion.id ASC
        `,
        [input.ownerId, input.classroomIds, input.projectIds],
      ),
      getLearningSql().query(
        `
          SELECT mastery.id AS projection_id, mastery.sprint_id, sprint.classroom_id,
                 mastery.concept_id, mastery.estimate, mastery.confidence,
                 mastery.evidence_count, mastery.evidence_summary,
                 mastery.last_practiced_at, mastery.next_review_at,
                 mastery.projector_version
          FROM mastery_projections mastery
          JOIN learning_sprints sprint
            ON sprint.owner_id = mastery.owner_id AND sprint.id = mastery.sprint_id
          WHERE mastery.owner_id = $1
            AND (
              sprint.classroom_id = ANY($2::text[])
              OR sprint.project_id = ANY($3::text[])
            )
          ORDER BY mastery.computed_at DESC, mastery.id ASC
        `,
        [input.ownerId, input.classroomIds, input.projectIds],
      ),
      getLearningSql().query(
        `
          SELECT review.id AS review_id, review.sprint_id, sprint.classroom_id,
                 sprint.project_id, review.concept_id, review.state, review.due_at
          FROM review_items review
          JOIN learning_sprints sprint
            ON sprint.owner_id = review.owner_id AND sprint.id = review.sprint_id
          WHERE review.owner_id = $1
            AND review.state IN ('scheduled', 'due')
            AND (
              sprint.classroom_id = ANY($2::text[])
              OR sprint.project_id = ANY($3::text[])
            )
          ORDER BY review.due_at ASC, review.id ASC
        `,
        [input.ownerId, input.classroomIds, input.projectIds],
      ),
    ]);

    const sources = (sourceRows as Array<Record<string, unknown>>).map(
      (row): KnowledgeSourceContext => ({
        sourceId: String(row.source_id),
        sourceTitle: String(row.source_title),
        sourceOrigin: String(row.source_origin) as KnowledgeSourceContext['sourceOrigin'],
        ...(typeof row.source_version_id === 'string'
          ? { sourceVersionId: row.source_version_id }
          : {}),
        ...(typeof row.project_id === 'string' ? { projectId: row.project_id } : {}),
        classroomIds: Array.isArray(row.classroom_ids)
          ? row.classroom_ids.filter((value): value is string => typeof value === 'string')
          : [],
        ...(typeof row.original_relative_path === 'string' && row.original_relative_path.length > 0
          ? { originalRelativePath: row.original_relative_path }
          : {}),
        updatedAt: new Date(String(row.updated_at)).toISOString(),
      }),
    );
    const companions = (companionRows as Array<Record<string, unknown>>).map(
      (row): KnowledgeCompanionContext => ({
        companionId: String(row.companion_id),
        sourceId: String(row.source_id),
        sourceTitle: String(row.source_title),
        sourceOrigin: String(row.source_origin) as KnowledgeCompanionContext['sourceOrigin'],
        ...(typeof row.source_version_id === 'string'
          ? { sourceVersionId: row.source_version_id }
          : {}),
        ...(typeof row.project_id === 'string' ? { projectId: row.project_id } : {}),
        ...(typeof row.source_bundle_id === 'string'
          ? { sourceBundleId: row.source_bundle_id }
          : {}),
        ...(typeof row.source_snapshot_id === 'string'
          ? { sourceSnapshotId: row.source_snapshot_id }
          : {}),
        originalRelativePath: String(row.original_relative_path),
        companionRelativePath: String(row.relative_path),
        sourceUpdated: row.source_updated === true,
        updatedAt: new Date(String(row.updated_at)).toISOString(),
      }),
    );
    const masteries = (masteryRows as Array<Record<string, unknown>>).map(
      (row): KnowledgeMasteryContext => ({
        projectionId: String(row.projection_id),
        sprintId: String(row.sprint_id),
        classroomId: String(row.classroom_id),
        conceptId: String(row.concept_id),
        estimate: row.estimate === null ? null : Number(row.estimate),
        confidence: Number(row.confidence),
        evidenceCount: Number(row.evidence_count),
        evidenceSummary: Array.isArray(row.evidence_summary)
          ? (row.evidence_summary as KnowledgeMasteryContext['evidenceSummary'])
          : [],
        ...(row.last_practiced_at
          ? { lastPracticedAt: new Date(String(row.last_practiced_at)).toISOString() }
          : {}),
        ...(row.next_review_at
          ? { nextReviewAt: new Date(String(row.next_review_at)).toISOString() }
          : {}),
        projectorVersion: String(row.projector_version),
      }),
    );
    const reviews = (reviewRows as Array<Record<string, unknown>>).map(
      (row): KnowledgeReviewContext => ({
        reviewId: String(row.review_id),
        sprintId: String(row.sprint_id),
        classroomId: String(row.classroom_id),
        ...(typeof row.project_id === 'string' ? { projectId: row.project_id } : {}),
        conceptId: String(row.concept_id),
        state: String(row.state) as KnowledgeReviewContext['state'],
        dueAt: new Date(String(row.due_at)).toISOString(),
      }),
    );
    return { sources, companions, masteries, reviews };
  }

  async findReadyByInput(
    ownerId: string,
    synthesisId: string,
    inputHash: string,
    projectorVersion: string,
    layoutVersion: string,
  ): Promise<KnowledgeGraphProjectionRecord | null> {
    const rows = (await getLearningSql().query(
      `
        SELECT id, owner_id, synthesis_id, scope_hash, input_hash, graph_hash,
               projector_version, layout_version, status, graph_snapshot,
               generated_at, created_at, updated_at
        FROM knowledge_graph_projections
        WHERE owner_id = $1 AND synthesis_id = $2 AND input_hash = $3
          AND projector_version = $4 AND layout_version = $5 AND status = 'ready'
        LIMIT 1
      `,
      [ownerId, synthesisId, inputHash, projectorVersion, layoutVersion],
    )) as ProjectionRow[];
    return rows[0] ? projection(rows[0]) : null;
  }

  async findProjection(
    ownerId: string,
    projectionId: string,
  ): Promise<KnowledgeGraphProjectionRecord | null> {
    const rows = (await getLearningSql().query(
      `
        SELECT id, owner_id, synthesis_id, scope_hash, input_hash, graph_hash,
               projector_version, layout_version, status, graph_snapshot,
               generated_at, created_at, updated_at
        FROM knowledge_graph_projections
        WHERE owner_id = $1 AND id = $2 AND status = 'ready'
      `,
      [ownerId, projectionId],
    )) as ProjectionRow[];
    return rows[0] ? projection(rows[0]) : null;
  }

  async findLatestReady(
    ownerId: string,
    synthesisId: string,
  ): Promise<KnowledgeGraphProjectionRecord | null> {
    const rows = (await getLearningSql().query(
      `
        SELECT id, owner_id, synthesis_id, scope_hash, input_hash, graph_hash,
               projector_version, layout_version, status, graph_snapshot,
               generated_at, created_at, updated_at
        FROM knowledge_graph_projections
        WHERE owner_id = $1 AND synthesis_id = $2 AND status = 'ready'
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [ownerId, synthesisId],
    )) as ProjectionRow[];
    return rows[0] ? projection(rows[0]) : null;
  }

  async relationStatuses(
    ownerId: string,
    relationIds: string[],
  ): Promise<Record<string, KnowledgeRelationStatus>> {
    if (relationIds.length === 0) return {};
    const rows = (await getLearningSql().query(
      `
        SELECT id, status
        FROM knowledge_relations
        WHERE owner_id = $1 AND id = ANY($2::text[])
      `,
      [ownerId, relationIds],
    )) as Array<{ id: string; status: KnowledgeRelationStatus }>;
    return Object.fromEntries(rows.map((row) => [row.id, row.status]));
  }

  async saveProjection(
    input: SaveKnowledgeGraphProjectionInput,
  ): Promise<KnowledgeGraphProjectionRecord> {
    const inserted = (await getLearningSql().query(
      `
        INSERT INTO knowledge_graph_projections
          (id, owner_id, synthesis_id, scope_hash, input_hash, graph_hash,
           projector_version, layout_version, status, graph_snapshot,
           node_count, edge_count, generated_at, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, NULL, $6, $7, 'building', NULL, 0, 0, $8, $8, $8)
        ON CONFLICT (
          owner_id, synthesis_id, input_hash, projector_version, layout_version
        ) DO NOTHING
        RETURNING id
      `,
      [
        input.id,
        input.ownerId,
        input.synthesisId,
        input.scopeHash,
        input.inputHash,
        input.graph.projectorVersion,
        input.graph.layoutVersion,
        input.generatedAt,
      ],
    )) as Array<{ id: string }>;
    if (!inserted[0]) {
      const existing = await this.findReadyByInput(
        input.ownerId,
        input.synthesisId,
        input.inputHash,
        input.graph.projectorVersion,
        input.graph.layoutVersion,
      );
      if (existing) return existing;
      throw new Error('knowledge_graph_projection_build_in_progress');
    }

    try {
      const concepts = input.graph.nodes
        .filter((node) => node.type === 'concept')
        .map((node) => {
          const identity = canonicalConceptIdentity(
            node.label,
            node.domainIds[0] ?? 'domain:general',
            input.ownerId,
          );
          return {
            id: node.canonicalId,
            canonicalKey: identity.key,
            canonicalLabel: node.label,
            normalizedLabel: identity.normalizedLabel,
            domainIds: node.domainIds,
          };
        });
      if (concepts.length > 0) {
        await getLearningSql().query(
          `
            WITH input AS (
              SELECT *
              FROM jsonb_to_recordset($3::jsonb) AS item(
                id text, "canonicalKey" text, "canonicalLabel" text,
                "normalizedLabel" text, "domainIds" jsonb
              )
            ), upserted AS (
              INSERT INTO knowledge_concepts
                (id, owner_id, canonical_key, canonical_label, normalized_label,
                 domain_ids, status, created_at, updated_at)
              SELECT id, $1, "canonicalKey", "canonicalLabel", "normalizedLabel",
                     "domainIds", 'active', $2, $2
              FROM input
              ON CONFLICT (owner_id, canonical_key) DO UPDATE
              SET canonical_label = EXCLUDED.canonical_label,
                  normalized_label = EXCLUDED.normalized_label,
                  domain_ids = EXCLUDED.domain_ids,
                  updated_at = EXCLUDED.updated_at
              RETURNING id, canonical_label, normalized_label
            )
            INSERT INTO knowledge_concept_aliases
              (owner_id, concept_id, alias, normalized_alias, origin,
               confidence, created_at, updated_at)
            SELECT $1, id, canonical_label, normalized_label, 'canonical', 1, $2, $2
            FROM upserted
            ON CONFLICT (owner_id, concept_id, normalized_alias) DO UPDATE
            SET alias = EXCLUDED.alias, confidence = 1, updated_at = EXCLUDED.updated_at
          `,
          [input.ownerId, input.generatedAt, JSON.stringify(concepts)],
        );
      }

      const relations = input.graph.edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: edge.type,
        directed: edge.directed,
        weight: edge.weight,
        confidence: edge.confidence,
        origin: edge.origin,
        generatorVersion: edge.generatorVersion,
        status: edge.status,
      }));
      if (relations.length > 0) {
        await getLearningSql().query(
          `
            INSERT INTO knowledge_relations
              (id, owner_id, source_node_id, target_node_id, relation_type,
               directed, weight, confidence, origin, generator_version,
               status, created_at, updated_at)
            SELECT item.id, $1, item.source, item.target, item.type,
                   item.directed, item.weight, item.confidence, item.origin,
                   item."generatorVersion", item.status, $2, $2
            FROM jsonb_to_recordset($3::jsonb) AS item(
              id text, source text, target text, type text, directed boolean,
              weight numeric, confidence numeric, origin text,
              "generatorVersion" text, status text
            )
            ON CONFLICT (id) DO UPDATE
            SET weight = EXCLUDED.weight,
                confidence = EXCLUDED.confidence,
                generator_version = EXCLUDED.generator_version,
                status = CASE
                  WHEN knowledge_relations.status IN ('confirmed', 'rejected')
                    THEN knowledge_relations.status
                  ELSE EXCLUDED.status
                END,
                updated_at = EXCLUDED.updated_at
            WHERE knowledge_relations.owner_id = EXCLUDED.owner_id
          `,
          [input.ownerId, input.generatedAt, JSON.stringify(relations)],
        );
      }

      if (input.graph.nodes.length > 0) {
        await getLearningSql().query(
          `
            INSERT INTO knowledge_graph_projection_nodes
              (owner_id, projection_id, node_id, canonical_id, node_type, data, created_at)
            SELECT $1, $2, item.id, item."canonicalId", item.type, item.data, $3
            FROM jsonb_to_recordset($4::jsonb) AS item(
              id text, "canonicalId" text, type text, data jsonb
            )
            ON CONFLICT (owner_id, projection_id, node_id) DO NOTHING
          `,
          [
            input.ownerId,
            input.id,
            input.generatedAt,
            JSON.stringify(
              input.graph.nodes.map((node) => ({
                id: node.id,
                canonicalId: node.canonicalId,
                type: node.type,
                data: node,
              })),
            ),
          ],
        );
      }
      if (input.graph.edges.length > 0) {
        await getLearningSql().query(
          `
            INSERT INTO knowledge_graph_projection_edges
              (owner_id, projection_id, edge_id, relation_id, source_node_id,
               target_node_id, edge_type, data, created_at)
            SELECT $1, $2, item.id, item.id, item.source, item.target,
                   item.type, item.data, $3
            FROM jsonb_to_recordset($4::jsonb) AS item(
              id text, source text, target text, type text, data jsonb
            )
            ON CONFLICT (owner_id, projection_id, edge_id) DO NOTHING
          `,
          [
            input.ownerId,
            input.id,
            input.generatedAt,
            JSON.stringify(
              input.graph.edges.map((edge) => ({
                id: edge.id,
                source: edge.source,
                target: edge.target,
                type: edge.type,
                data: edge,
              })),
            ),
          ],
        );
      }

      const relationByEvidence = new Map<string, string>();
      for (const edge of input.graph.edges) {
        for (const evidenceId of edge.evidenceRefs) {
          if (!relationByEvidence.has(evidenceId)) relationByEvidence.set(evidenceId, edge.id);
        }
      }
      if (input.graph.evidence.length > 0) {
        await getLearningSql().query(
          `
            INSERT INTO knowledge_evidence_refs
              (id, owner_id, projection_id, relation_id, evidence_kind,
               entity_id, label, locator, occurred_at, created_at)
            SELECT item.id, $1, $2, NULLIF(item."relationId", ''), item.kind,
                   item."entityId", item.label, item.locator,
                   NULLIF(item."occurredAt", '')::timestamptz, $3
            FROM jsonb_to_recordset($4::jsonb) AS item(
              id text, "relationId" text, kind text, "entityId" text,
              label text, locator jsonb, "occurredAt" text
            )
            ON CONFLICT (id) DO NOTHING
          `,
          [
            input.ownerId,
            input.id,
            input.generatedAt,
            JSON.stringify(
              input.graph.evidence.map((item) => ({
                ...item,
                relationId: relationByEvidence.get(item.id) ?? '',
                occurredAt: item.occurredAt ?? '',
              })),
            ),
          ],
        );
      }

      const rows = (await getLearningSql().query(
        `
          UPDATE knowledge_graph_projections
          SET graph_hash = $3, status = 'ready', graph_snapshot = $4::jsonb,
              node_count = $5, edge_count = $6, failure_detail = NULL, updated_at = $7
          WHERE owner_id = $1 AND id = $2 AND status = 'building'
          RETURNING id, owner_id, synthesis_id, scope_hash, input_hash, graph_hash,
                    projector_version, layout_version, status, graph_snapshot,
                    generated_at, created_at, updated_at
        `,
        [
          input.ownerId,
          input.id,
          input.graphHash,
          JSON.stringify(input.graph),
          input.graph.nodes.length,
          input.graph.edges.length,
          input.generatedAt,
        ],
      )) as ProjectionRow[];
      if (!rows[0]) throw new Error('knowledge_graph_projection_not_saved');
      // Keep only the latest projection for this synthesis; superseded
      // snapshots are pruned to prevent unbounded knowledge-graph growth.
      await this.pruneSupersededProjections(input.ownerId, input.synthesisId, input.id);
      return projection(rows[0]);
    } catch (error) {
      await getLearningSql().query(
        `
          UPDATE knowledge_graph_projections
          SET status = 'failed', failure_detail = $3, updated_at = $4
          WHERE owner_id = $1 AND id = $2 AND status = 'building'
        `,
        [
          input.ownerId,
          input.id,
          error instanceof Error ? error.message.slice(0, 2000) : 'projection_failed',
          input.generatedAt,
        ],
      );
      throw error;
    }
  }

  async pruneSupersededProjections(
    ownerId: string,
    synthesisId: string,
    currentProjectionId: string,
  ): Promise<number> {
    const rows = (await getLearningSql().query(
      `
        DELETE FROM knowledge_graph_projections
        WHERE owner_id = $1 AND synthesis_id = $2 AND id <> $3
        RETURNING id
      `,
      [ownerId, synthesisId, currentProjectionId],
    )) as Array<{ id: string }>;
    return rows.length;
  }

  async saveFeedback(
    input: SaveKnowledgeRelationFeedbackInput,
  ): Promise<KnowledgeRelationFeedbackRecord | null> {
    const rows = (await getLearningSql().query(
      `
        WITH changed AS (
          UPDATE knowledge_relations
          SET status = CASE WHEN $4 = 'confirm' THEN 'confirmed' ELSE 'rejected' END,
              updated_at = $6
          WHERE owner_id = $1 AND id = $3
          RETURNING id
        )
        INSERT INTO knowledge_relation_feedback
          (id, owner_id, relation_id, action, reason, created_at, updated_at)
        SELECT $2, $1, changed.id, $4, $5, $6, $6
        FROM changed
        ON CONFLICT (owner_id, relation_id) DO UPDATE
        SET action = EXCLUDED.action, reason = EXCLUDED.reason,
            updated_at = EXCLUDED.updated_at
        RETURNING id, owner_id, relation_id, action, reason, created_at, updated_at
      `,
      [input.ownerId, input.id, input.relationId, input.action, input.reason ?? null, input.now],
    )) as FeedbackRow[];
    return rows[0] ? feedback(rows[0]) : null;
  }
}
