import { describe, expect, it, vi } from 'vitest';
import { KnowledgeGraphProjectionService } from '@/lib/learning/application/knowledge-graph-projection-service';
import type {
  KnowledgeGraphProjectionContext,
  KnowledgeGraphProjectionRecord,
} from '@/lib/learning/domain/knowledge-graph-v2/contracts';
import {
  buildKnowledgeGraphV2,
  knowledgeGraphContentHash,
} from '@/lib/learning/domain/knowledge-graph-v2/projection-builder';
import {
  graphNeighborhood,
  shortestKnowledgePath,
} from '@/lib/learning/domain/knowledge-graph-v2/graph-query';
import type { SynthesisRunRecord } from '@/lib/learning/domain/synthesis';
import type { KnowledgeGraphV2Repository } from '@/lib/learning/ports/knowledge-graph-v2-repository';
import type { SynthesisRepository } from '@/lib/learning/ports/synthesis-repository';

const OWNER_ID = `own_${'1'.repeat(32)}`;
const SYNTHESIS_ID = `syn_${'2'.repeat(32)}`;
const PROJECT_ID = `prj_${'3'.repeat(32)}`;
const COMPANION_ID = `cmp_${'4'.repeat(32)}`;
const SOURCE_ID = `sou_${'5'.repeat(32)}`;
const SOURCE_VERSION_ID = `svr_${'6'.repeat(32)}`;
const PROJECTION_ID = `kgp_${'7'.repeat(32)}`;

function synthesis(): SynthesisRunRecord {
  const createdAt = new Date('2026-07-23T08:00:00.000Z');
  return {
    id: SYNTHESIS_ID,
    ownerId: OWNER_ID,
    projectId: PROJECT_ID,
    projectName: 'Project',
    mode: 'combined',
    title: 'Graph test',
    scope: { projectIds: [PROJECT_ID] },
    summaryMarkdown: '# Graph test',
    graph: {
      schemaVersion: 'knowledge-graph/1',
      dimensions: { x: 'time', y: 'domain', z: 'mastery' },
      domains: ['软件与人工智能'],
      nodes: [
        {
          id: `project:${PROJECT_ID}`,
          label: 'Project',
          type: 'project',
          projectId: PROJECT_ID,
          domain: '软件与人工智能',
          timestamp: createdAt.toISOString(),
          mastery: null,
          x: 0,
          y: 0,
          z: -1.15,
        },
        {
          id: 'classroom:course_a',
          label: 'TypeScript classroom',
          type: 'classroom',
          classroomId: 'course_a',
          projectId: PROJECT_ID,
          domain: '软件与人工智能',
          timestamp: createdAt.toISOString(),
          mastery: null,
          x: 0,
          y: 0,
          z: -1.15,
        },
        {
          id: 'concept:course_a:scene_a',
          label: 'TypeScript Narrowing',
          type: 'concept',
          classroomId: 'course_a',
          projectId: PROJECT_ID,
          domain: '软件与人工智能',
          timestamp: createdAt.toISOString(),
          mastery: null,
          x: 0,
          y: 0,
          z: -1.15,
        },
        {
          id: 'obsidian:course_a:note',
          label: 'Original note',
          type: 'obsidian',
          classroomId: 'course_a',
          projectId: PROJECT_ID,
          domain: '软件与人工智能',
          timestamp: createdAt.toISOString(),
          mastery: null,
          x: 0,
          y: 0,
          z: -1.15,
        },
      ],
      edges: [
        {
          id: 'contains:classroom:concept',
          source: 'classroom:course_a',
          target: 'concept:course_a:scene_a',
          type: 'contains',
          weight: 1,
        },
        {
          id: 'related:concept:note',
          source: 'concept:course_a:scene_a',
          target: 'obsidian:course_a:note',
          type: 'related',
          weight: 0.8,
        },
      ],
    },
    graphHash: 'a'.repeat(64),
    classroomCount: 1,
    incremental: false,
    evidenceManifest: [],
    taskCandidates: [],
    createdAt,
    updatedAt: createdAt,
  };
}

function context(): KnowledgeGraphProjectionContext {
  return {
    sources: [
      {
        sourceId: SOURCE_ID,
        sourceTitle: 'Original note',
        sourceOrigin: 'obsidian',
        sourceVersionId: SOURCE_VERSION_ID,
        projectId: PROJECT_ID,
        classroomIds: ['course_a'],
        originalRelativePath: 'Project/Original note.md',
        updatedAt: '2026-07-23T09:00:00.000Z',
      },
    ],
    companions: [
      {
        companionId: COMPANION_ID,
        sourceId: SOURCE_ID,
        sourceTitle: 'Original note',
        sourceOrigin: 'obsidian',
        sourceVersionId: SOURCE_VERSION_ID,
        projectId: PROJECT_ID,
        originalRelativePath: 'Project/Original note.md',
        companionRelativePath: 'Vaultide/伴随笔记/Project/Original note.md',
        sourceUpdated: true,
        updatedAt: '2026-07-23T09:00:00.000Z',
      },
    ],
    masteries: [
      {
        projectionId: `mpr_${'8'.repeat(32)}`,
        sprintId: `spr_${'9'.repeat(32)}`,
        classroomId: 'course_a',
        conceptId: 'scene:scene_a',
        estimate: 0.72,
        confidence: 0.64,
        evidenceCount: 3,
        evidenceSummary: [],
        projectorVersion: 'mastery-evidence-v2',
      },
    ],
    reviews: [
      {
        reviewId: `rvi_${'a'.repeat(32)}`,
        sprintId: `spr_${'9'.repeat(32)}`,
        classroomId: 'course_a',
        projectId: PROJECT_ID,
        conceptId: 'scene:scene_a',
        state: 'due',
        dueAt: '2026-07-24T08:00:00.000Z',
      },
    ],
  };
}

describe('knowledge graph v2 projection', () => {
  it('keeps original notes read-only and binds exactly one writable companion', () => {
    const graph = buildKnowledgeGraphV2({
      projectionId: PROJECTION_ID,
      synthesis: synthesis(),
      context: context(),
      generatedAt: new Date('2026-07-24T08:00:00.000Z'),
    });
    const original = graph.nodes.find((node) => node.id === `source:${SOURCE_ID}`);
    const companion = graph.nodes.find((node) => node.id === `companion:${COMPANION_ID}`);
    expect(original).toMatchObject({
      type: 'original-note',
      writable: false,
      originalPath: 'Project/Original note.md',
      companionId: COMPANION_ID,
    });
    expect(original?.statusFlags).toEqual(expect.arrayContaining(['read-only', 'source-updated']));
    expect(companion).toMatchObject({
      type: 'companion-note',
      writable: true,
      companionId: COMPANION_ID,
    });
    expect(
      graph.edges.filter(
        (edge) =>
          edge.type === 'companion-of' &&
          edge.source === original?.id &&
          edge.target === companion?.id,
      ),
    ).toHaveLength(1);
  });

  it('keeps an Obsidian source path without inventing a companion note', () => {
    const sourceOnlyContext: KnowledgeGraphProjectionContext = {
      ...context(),
      companions: [],
    };
    const graph = buildKnowledgeGraphV2({
      projectionId: PROJECTION_ID,
      synthesis: synthesis(),
      context: sourceOnlyContext,
      generatedAt: new Date('2026-07-24T08:00:00.000Z'),
    });
    const original = graph.nodes.find((node) => node.id === `source:${SOURCE_ID}`);
    expect(original).toMatchObject({
      type: 'original-note',
      writable: false,
      originalPath: 'Project/Original note.md',
    });
    expect(original?.sourceVersionIds).toEqual([SOURCE_VERSION_ID]);
    expect(original?.companionId).toBeUndefined();
    expect(graph.nodes.some((node) => node.type === 'companion-note')).toBe(false);
    expect(graph.edges.some((edge) => edge.type === 'companion-of')).toBe(false);
  });

  it('separates unknown mastery from low mastery and explains inferred relations', () => {
    const graph = buildKnowledgeGraphV2({
      projectionId: PROJECTION_ID,
      synthesis: synthesis(),
      context: context(),
      generatedAt: new Date('2026-07-24T08:00:00.000Z'),
    });
    const classroom = graph.nodes.find((node) => node.id === 'classroom:course_a');
    const concept = graph.nodes.find((node) => node.type === 'concept');
    expect(classroom?.mastery).toBeNull();
    expect(classroom?.coordinates.z).toBe(-1.2);
    expect(concept?.mastery).toBe(0.72);
    expect(concept?.masteryConfidence).toBe(0.64);
    expect(concept?.coordinates.z).toBeGreaterThan(0);
    const inferred = graph.edges.find((edge) => edge.origin === 'lexical');
    expect(inferred).toMatchObject({ type: 'related-to', confidence: 0.8, status: 'active' });
    expect(inferred?.evidenceRefs).toHaveLength(1);
    expect(graph.evidence.find((item) => item.id === inferred?.evidenceRefs[0])).toMatchObject({
      kind: 'lexical-comparison',
    });
  });

  it('is deterministic, supports neighborhoods and returns an explanation path', () => {
    const left = buildKnowledgeGraphV2({
      projectionId: `kgp_${'b'.repeat(32)}`,
      synthesis: synthesis(),
      context: context(),
      generatedAt: new Date('2026-07-24T08:00:00.000Z'),
    });
    const right = buildKnowledgeGraphV2({
      projectionId: `kgp_${'c'.repeat(32)}`,
      synthesis: synthesis(),
      context: context(),
      generatedAt: new Date('2026-07-25T08:00:00.000Z'),
    });
    expect(knowledgeGraphContentHash(left)).toBe(knowledgeGraphContentHash(right));
    const companionId = `companion:${COMPANION_ID}`;
    const neighborhood = graphNeighborhood(left, companionId, 1);
    expect(neighborhood.nodes.map((node) => node.id)).toContain(`source:${SOURCE_ID}`);
    const path = shortestKnowledgePath(left, `project:${PROJECT_ID}`, companionId);
    expect(path.found).toBe(true);
    expect(path.nodes.at(0)?.id).toBe(`project:${PROJECT_ID}`);
    expect(path.nodes.at(-1)?.id).toBe(companionId);
  });

  it('reuses an identical stored projection instead of rebuilding it', async () => {
    const run = synthesis();
    let stored: KnowledgeGraphProjectionRecord | null = null;
    const graphRepository = {
      loadProjectionContext: vi.fn(async () => context()),
      findReadyByInput: vi.fn(async () => stored),
      saveProjection: vi.fn(async (input) => {
        stored = {
          id: input.id,
          ownerId: input.ownerId,
          synthesisId: input.synthesisId,
          scopeHash: input.scopeHash,
          inputHash: input.inputHash,
          graphHash: input.graphHash,
          projectorVersion: input.graph.projectorVersion,
          layoutVersion: input.graph.layoutVersion,
          status: 'ready',
          graph: input.graph,
          generatedAt: input.generatedAt,
          createdAt: input.generatedAt,
          updatedAt: input.generatedAt,
        };
        return stored;
      }),
      findProjection: vi.fn(async () => stored),
      findLatestReady: vi.fn(async () => stored),
      relationStatuses: vi.fn(async () => ({})),
      saveFeedback: vi.fn(async () => null),
    } satisfies KnowledgeGraphV2Repository;
    const synthesisRepository = {
      find: vi.fn(async () => run),
    } as unknown as SynthesisRepository;
    const service = new KnowledgeGraphProjectionService({
      ownerId: OWNER_ID,
      synthesisRepository,
      repository: graphRepository,
      flags: { enabled: true, semanticEdgesEnabled: false, webglEnabled: false },
      now: () => new Date('2026-07-24T08:00:00.000Z'),
      identifier: () => PROJECTION_ID,
    });
    const first = await service.createProjection(SYNTHESIS_ID);
    const second = await service.createProjection(SYNTHESIS_ID);
    expect(second.id).toBe(first.id);
    expect(graphRepository.saveProjection).toHaveBeenCalledTimes(1);
  });
});
