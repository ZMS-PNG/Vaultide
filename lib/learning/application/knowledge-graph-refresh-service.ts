import { randomUUID } from 'node:crypto';
import type {
  KnowledgeGraphRefreshChange,
  KnowledgeGraphRefreshProcessResult,
  KnowledgeGraphRefreshQueueStatus,
} from '../domain/knowledge-graph-refresh';
import { stableHash } from '../domain/knowledge-graph-v2/stable-identity';
import type { KnowledgeGraphRefreshRepository } from '../ports/knowledge-graph-refresh-repository';

export interface KnowledgeGraphProjectionWriter {
  createProjection(
    synthesisId: string,
    options?: { force?: boolean },
  ): Promise<{ id: string }>;
}

export interface KnowledgeGraphRefreshServiceOptions {
  ownerId: string;
  repository: KnowledgeGraphRefreshRepository;
  projections: KnowledgeGraphProjectionWriter;
  now?: () => Date;
  identifier?: () => string;
}

const LEASE_MILLISECONDS = 5 * 60 * 1000;
const MAX_AFFECTED_SYNTHESES = 20;

export class KnowledgeGraphRefreshService {
  constructor(private readonly options: KnowledgeGraphRefreshServiceOptions) {}

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }

  async enqueue(change: KnowledgeGraphRefreshChange): Promise<{ id: string; enqueued: boolean }> {
    const now = this.now();
    const dedupeKey = stableHash({
      ownerId: this.options.ownerId,
      ...change,
    });
    const result = await this.options.repository.enqueue({
      id:
        this.options.identifier?.() ??
        `kgq_${randomUUID().replaceAll('-', '')}`,
      ownerId: this.options.ownerId,
      dedupeKey,
      ...change,
      now,
    });
    return { id: result.record.id, enqueued: result.enqueued };
  }

  async enqueueAndProcess(
    change: KnowledgeGraphRefreshChange,
    limit = 3,
  ): Promise<KnowledgeGraphRefreshProcessResult> {
    await this.enqueue(change);
    return this.processPending(limit);
  }

  async queueStatus(): Promise<KnowledgeGraphRefreshQueueStatus> {
    return this.options.repository.queueStatus(this.options.ownerId);
  }

  async processPending(limit = 10): Promise<KnowledgeGraphRefreshProcessResult> {
    const bounded = Math.max(1, Math.min(50, Math.trunc(limit)));
    const claimedAt = this.now();
    const requests = await this.options.repository.claimPending(
      this.options.ownerId,
      claimedAt,
      new Date(claimedAt.getTime() + LEASE_MILLISECONDS),
      bounded,
    );
    const result: KnowledgeGraphRefreshProcessResult = {
      attempted: requests.length,
      succeeded: 0,
      skipped: 0,
      failed: 0,
      projectionIds: [],
    };

    for (const request of requests) {
      let synthesisIds: string[] = [];
      const projectionIds: string[] = [];
      try {
        synthesisIds = await this.options.repository.findAffectedSynthesisIds(
          this.options.ownerId,
          request,
          MAX_AFFECTED_SYNTHESES,
        );
        if (synthesisIds.length === 0) {
          await this.options.repository.complete({
            ownerId: this.options.ownerId,
            requestId: request.id,
            state: 'skipped',
            synthesisIds,
            projectionIds,
            now: this.now(),
          });
          result.skipped += 1;
          continue;
        }
        for (const synthesisId of synthesisIds) {
          const projection = await this.options.projections.createProjection(synthesisId, {
            force: true,
          });
          projectionIds.push(projection.id);
          result.projectionIds.push(projection.id);
        }
        await this.options.repository.complete({
          ownerId: this.options.ownerId,
          requestId: request.id,
          state: 'succeeded',
          synthesisIds,
          projectionIds,
          now: this.now(),
        });
        result.succeeded += 1;
      } catch (error) {
        const now = this.now();
        const retryMinutes = Math.min(60, 2 ** Math.max(0, request.attemptCount - 1));
        await this.options.repository.complete({
          ownerId: this.options.ownerId,
          requestId: request.id,
          state: 'failed',
          synthesisIds,
          projectionIds,
          errorDetail:
            error instanceof Error ? error.message.slice(0, 2000) : 'knowledge_graph_refresh_failed',
          retryAt: new Date(now.getTime() + retryMinutes * 60 * 1000),
          now,
        });
        result.failed += 1;
      }
    }
    return result;
  }
}
