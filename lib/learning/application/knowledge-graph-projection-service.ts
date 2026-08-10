import { randomUUID } from 'node:crypto';
import type { SynthesisRepository } from '../ports/synthesis-repository';
import type { KnowledgeGraphV2Repository } from '../ports/knowledge-graph-v2-repository';
import {
  KNOWLEDGE_GRAPH_LAYOUT_VERSION,
  KNOWLEDGE_GRAPH_PROJECTOR_VERSION,
  type KnowledgeGraphNeighborhood,
  type KnowledgeGraphPath,
  type KnowledgeGraphProjectionQuery,
  type KnowledgeGraphProjectionRecord,
  type KnowledgeNodeV2,
  type KnowledgeRelationFeedbackRecord,
} from '../domain/knowledge-graph-v2/contracts';
import {
  buildKnowledgeGraphV2,
  knowledgeGraphContentHash,
} from '../domain/knowledge-graph-v2/projection-builder';
import {
  filterKnowledgeGraph,
  graphNeighborhood,
  shortestKnowledgePath,
} from '../domain/knowledge-graph-v2/graph-query';
import { stableHash } from '../domain/knowledge-graph-v2/stable-identity';
import type { KnowledgeGraphV2Flags } from '../knowledge-graph-v2-flags';

export class KnowledgeGraphServiceError extends Error {
  constructor(
    readonly code: 'invalid_request' | 'conflict' | 'dependency_unavailable',
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'KnowledgeGraphServiceError';
  }
}

export interface KnowledgeGraphProjectionServiceOptions {
  ownerId: string;
  synthesisRepository: SynthesisRepository;
  repository: KnowledgeGraphV2Repository;
  flags: KnowledgeGraphV2Flags;
  now?: () => Date;
  identifier?: (prefix: 'kgp' | 'kgf') => string;
}

function defaultIdentifier(prefix: 'kgp' | 'kgf'): string {
  return `${prefix}_${randomUUID().replaceAll('-', '')}`;
}

export class KnowledgeGraphProjectionService {
  constructor(private readonly options: KnowledgeGraphProjectionServiceOptions) {}

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }

  private assertEnabled(): void {
    if (!this.options.flags.enabled) {
      throw new KnowledgeGraphServiceError(
        'dependency_unavailable',
        503,
        'Knowledge graph v2 is currently disabled.',
      );
    }
  }

  private async overlayRelationStatuses(
    record: KnowledgeGraphProjectionRecord,
  ): Promise<KnowledgeGraphProjectionRecord> {
    const statuses = await this.options.repository.relationStatuses(
      this.options.ownerId,
      record.graph.edges.map((edge) => edge.id),
    );
    const edges = record.graph.edges.map((edge) => ({
      ...edge,
      status: statuses[edge.id] ?? edge.status,
    }));
    return {
      ...record,
      graph: {
        ...record.graph,
        edges,
        statistics: {
          ...record.graph.statistics,
          candidateEdgeCount: edges.filter((edge) => edge.status === 'candidate').length,
        },
      },
    };
  }

  async createProjection(
    synthesisId: string,
    options: { force?: boolean } = {},
  ): Promise<KnowledgeGraphProjectionRecord> {
    this.assertEnabled();
    if (!/^syn_[a-f0-9]{32}$/.test(synthesisId)) {
      throw new KnowledgeGraphServiceError('invalid_request', 400, 'Invalid synthesis id.');
    }
    const synthesis = await this.options.synthesisRepository.find(
      this.options.ownerId,
      synthesisId,
    );
    if (!synthesis) {
      throw new KnowledgeGraphServiceError('invalid_request', 404, 'Synthesis was not found.');
    }
    const classroomIds = [
      ...new Set(
        synthesis.graph.nodes
          .map((node) => node.classroomId)
          .filter((value): value is string => Boolean(value)),
      ),
    ].sort();
    const projectIds = [
      ...new Set(
        synthesis.graph.nodes
          .map((node) => node.projectId)
          .filter((value): value is string => Boolean(value)),
      ),
    ].sort();
    const context = await this.options.repository.loadProjectionContext({
      ownerId: this.options.ownerId,
      classroomIds,
      projectIds,
    });
    const inputHash = stableHash({
      synthesisId: synthesis.id,
      synthesisGraphHash: synthesis.graphHash,
      synthesisUpdatedAt: synthesis.updatedAt.toISOString(),
      context,
      projectorVersion: KNOWLEDGE_GRAPH_PROJECTOR_VERSION,
      layoutVersion: KNOWLEDGE_GRAPH_LAYOUT_VERSION,
    });
    if (!options.force) {
      const existing = await this.options.repository.findReadyByInput(
        this.options.ownerId,
        synthesis.id,
        inputHash,
        KNOWLEDGE_GRAPH_PROJECTOR_VERSION,
        KNOWLEDGE_GRAPH_LAYOUT_VERSION,
      );
      if (existing) return this.overlayRelationStatuses(existing);
    }
    const id = (this.options.identifier ?? defaultIdentifier)('kgp');
    const generatedAt = this.now();
    const graph = buildKnowledgeGraphV2({
      projectionId: id,
      synthesis,
      context,
      generatedAt,
    });
    const saved = await this.options.repository.saveProjection({
      id,
      ownerId: this.options.ownerId,
      synthesisId: synthesis.id,
      scopeHash: graph.scopeHash,
      inputHash,
      graphHash: knowledgeGraphContentHash(graph),
      graph,
      generatedAt,
    });
    return this.overlayRelationStatuses(saved);
  }

  async getProjection(
    projectionId: string,
    query: KnowledgeGraphProjectionQuery = {},
  ): Promise<KnowledgeGraphProjectionRecord> {
    this.assertEnabled();
    if (!/^kgp_[a-f0-9]{32}$/.test(projectionId)) {
      throw new KnowledgeGraphServiceError('invalid_request', 400, 'Invalid projection id.');
    }
    const record = await this.options.repository.findProjection(this.options.ownerId, projectionId);
    if (!record) {
      throw new KnowledgeGraphServiceError('invalid_request', 404, 'Projection was not found.');
    }
    const overlaid = await this.overlayRelationStatuses(record);
    return {
      ...overlaid,
      graph: filterKnowledgeGraph(overlaid.graph, {
        ...query,
        includeCandidates:
          this.options.flags.semanticEdgesEnabled && query.includeCandidates === true,
      }),
    };
  }

  async latestForSynthesis(
    synthesisId: string,
    query: KnowledgeGraphProjectionQuery = {},
  ): Promise<KnowledgeGraphProjectionRecord | null> {
    this.assertEnabled();
    if (!/^syn_[a-f0-9]{32}$/.test(synthesisId)) {
      throw new KnowledgeGraphServiceError('invalid_request', 400, 'Invalid synthesis id.');
    }
    const record = await this.options.repository.findLatestReady(this.options.ownerId, synthesisId);
    if (!record) return null;
    const overlaid = await this.overlayRelationStatuses(record);
    return { ...overlaid, graph: filterKnowledgeGraph(overlaid.graph, query) };
  }

  async getNode(projectionId: string, nodeId: string): Promise<KnowledgeNodeV2> {
    const record = await this.getProjection(projectionId, { includeCandidates: true });
    const node = record.graph.nodes.find((item) => item.id === nodeId);
    if (!node) throw new KnowledgeGraphServiceError('invalid_request', 404, 'Node was not found.');
    return node;
  }

  async neighborhood(
    projectionId: string,
    nodeId: string,
    depth: 1 | 2,
  ): Promise<KnowledgeGraphNeighborhood> {
    const record = await this.getProjection(projectionId, { includeCandidates: true });
    const result = graphNeighborhood(record.graph, nodeId, depth);
    if (result.nodes.length === 0) {
      throw new KnowledgeGraphServiceError('invalid_request', 404, 'Node was not found.');
    }
    return result;
  }

  async path(projectionId: string, from: string, to: string): Promise<KnowledgeGraphPath> {
    const record = await this.getProjection(projectionId, { includeCandidates: true });
    return shortestKnowledgePath(record.graph, from, to);
  }

  async feedback(input: {
    relationId: string;
    action: 'confirm' | 'reject';
    reason?: string;
  }): Promise<KnowledgeRelationFeedbackRecord> {
    this.assertEnabled();
    if (!/^kgr_[a-f0-9]{32}$/.test(input.relationId)) {
      throw new KnowledgeGraphServiceError('invalid_request', 400, 'Invalid relation id.');
    }
    const reason = input.reason?.trim();
    if (reason && reason.length > 2000) {
      throw new KnowledgeGraphServiceError('invalid_request', 400, 'Feedback reason is too long.');
    }
    const result = await this.options.repository.saveFeedback({
      id: (this.options.identifier ?? defaultIdentifier)('kgf'),
      ownerId: this.options.ownerId,
      relationId: input.relationId,
      action: input.action,
      ...(reason ? { reason } : {}),
      now: this.now(),
    });
    if (!result) {
      throw new KnowledgeGraphServiceError('invalid_request', 404, 'Relation was not found.');
    }
    return result;
  }
}
