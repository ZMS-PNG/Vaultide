import { describe, expect, it } from 'vitest';
import {
  buildTrustedKnowledgeSpace,
  selectTrustedKnowledgeSnapshots,
  type TrustedKnowledgeSnapshotInput,
} from '@/lib/learning/domain/knowledge-space-synthesis';
import { KNOWLEDGE_SNAPSHOT_PROJECTOR_VERSION } from '@/lib/learning/domain/knowledge-snapshot';

function source(referenceId: string, locator: string) {
  return {
    referenceId,
    kind: 'canonical-source' as const,
    citationId: referenceId,
    locator,
    contentHash: referenceId.padEnd(64, 'a').slice(0, 64).replace(/[^a-f0-9]/giu, 'a'),
  };
}

function trace(
  key: string,
  verifiedAt: string,
  reference = source(`S${key}`, `https://example.org/${key}`),
) {
  return {
    learningEventId: `lev_${key.toLocaleLowerCase().repeat(32).slice(0, 32)}`,
    evaluationEventId: `lev_${key.toLocaleUpperCase().repeat(32).slice(0, 32)}`,
    verifiedAt,
    confidence: 0.95,
    rubricVersion: 'knowledge-rubric-v2',
    sourceReferences: [reference],
  };
}

function snapshot(input: {
  id: string;
  session: string;
  projectId: string;
  projectName: string;
  createdAt: string;
  claim: string;
  skill: string;
  domainTag: string;
  reference: ReturnType<typeof source>;
  misconception?: string;
  correction?: string;
  question?: string;
}): TrustedKnowledgeSnapshotInput {
  const claimTrace = trace(`${input.id}c`, input.createdAt, input.reference);
  const skillTrace = trace(`${input.id}s`, input.createdAt, input.reference);
  const evaluationEventIds = [claimTrace.evaluationEventId, skillTrace.evaluationEventId];
  return {
    snapshotId: `ksn_${input.id.repeat(32).slice(0, 32)}`,
    sessionId: `lsn_${input.session.repeat(32).slice(0, 32)}`,
    scopeKind: 'project',
    scopeId: input.projectId,
    revision: 1,
    sourceManifestSha256: input.id.repeat(64).slice(0, 64).replace(/[^a-f0-9]/giu, 'a'),
    projectId: input.projectId,
    projectName: input.projectName,
    classroomId: `course_${input.id}`,
    sourceMode: 'hybrid',
    topicTags: [input.domainTag],
    createdAt: new Date(input.createdAt),
    verifiedKnowledge: [
      {
        id: `claim_${input.id}`,
        kind: 'claim',
        text: input.claim,
        trace: claimTrace,
      },
      {
        id: `skill_${input.id}`,
        kind: 'skill',
        text: input.skill,
        trace: skillTrace,
      },
    ],
    misconceptions:
      input.misconception && input.correction
        ? [
            {
              id: `mis_${input.id}`,
              misconception: input.misconception,
              correction: input.correction,
              trace: trace(`${input.id}m`, input.createdAt, input.reference),
            },
          ]
        : [],
    unresolvedItems: input.question
      ? [
          {
            id: `question_${input.id}`,
            question: input.question,
            trace: trace(`${input.id}q`, input.createdAt, input.reference),
          },
        ]
      : [],
    evidenceSummary: {
      projectorVersion: KNOWLEDGE_SNAPSHOT_PROJECTOR_VERSION,
      acceptedEvaluationEventIds: evaluationEventIds,
      evaluatedLearningEventIds: [
        claimTrace.learningEventId,
        skillTrace.learningEventId,
      ],
      sourceReferenceIds: [input.reference.referenceId],
      rejected: {
        unverifiedLearningEvents: 0,
        invalidEvaluations: 0,
        malformedEntries: 0,
        missingSourceReferences: 0,
      },
    },
    eligibleForPersistence: true,
  };
}

const projectA = `prj_${'a'.repeat(32)}`;
const projectB = `prj_${'b'.repeat(32)}`;
const snapshots = [
  snapshot({
    id: 'a',
    session: 'c',
    projectId: projectA,
    projectName: '类型系统研究',
    createdAt: '2026-06-10T08:00:00.000Z',
    claim: 'TypeScript 控制流分析会根据可达赋值缩小联合类型。',
    skill: '能够使用可辨识联合和穷尽检查建立安全状态机。',
    domainTag: 'software',
    reference: source('SA', 'https://www.typescriptlang.org/docs/handbook/2/narrowing.html'),
    misconception: '类型断言会在运行时校验外部数据。',
    correction: '类型断言仅影响静态检查，运行时校验需要独立验证器。',
    question: '外部 JSON 的运行时验证应采用哪一种可审计策略？',
  }),
  snapshot({
    id: 'b',
    session: 'd',
    projectId: projectB,
    projectName: '学习科学研究',
    createdAt: '2026-07-15T08:00:00.000Z',
    claim: '检索练习通过主动回忆增强长期记忆，而非依赖重复阅读。',
    skill: '能够依据证据安排间隔复习并记录每次检索结果。',
    domainTag: 'learning',
    reference: source('SB', 'https://example.edu/retrieval-practice'),
  }),
];

describe('trusted knowledge-space synthesis core', () => {
  it('builds traceable conclusions and one semantic graph for 2D and 3D', () => {
    const now = new Date('2026-07-21T08:00:00.000Z');
    const result = buildTrustedKnowledgeSpace({
      snapshots,
      request: { mode: 'combined' },
      title: '可信归纳',
      now,
    });

    expect(result.graph.statistics.nodeCountsByType).toEqual(
      expect.objectContaining({
        concept: expect.any(Number),
        claim: expect.any(Number),
        skill: expect.any(Number),
        artifact: expect.any(Number),
      }),
    );
    expect(result.graph.statistics.nodeCountsByType.concept).toBeGreaterThan(0);
    expect(result.graph.statistics.nodeCountsByType.claim).toBeGreaterThan(0);
    expect(result.graph.statistics.nodeCountsByType.skill).toBeGreaterThan(0);
    expect(result.graph.statistics.nodeCountsByType.artifact).toBeGreaterThan(0);
    expect(result.graph.synthesis.conclusions.length).toBeGreaterThan(0);
    expect(result.graph.synthesis.evolution.length).toBeGreaterThan(0);
    expect(new Set(result.graph.synthesis.comparisons.map((item) => item.dimension))).toEqual(
      new Set(['timeline', 'domain', 'project']),
    );
    expect(result.graph.synthesis.supports.length).toBeGreaterThan(0);
    expect(result.graph.synthesis.conflicts).toHaveLength(1);
    expect(result.graph.synthesis.unknowns.length).toBeGreaterThan(0);
    expect(result.graph.synthesis.nextValidations.length).toBeGreaterThan(0);
    expect(result.graph.edges.every((edge) => edge.evidenceRefs.length > 0)).toBe(true);
    expect(result.graph.edges.every((edge) => edge.confidence >= 0.85)).toBe(true);
    expect(result.graph.edges.every((edge) => Boolean(edge.firstSeenAt && edge.lastSeenAt))).toBe(
      true,
    );
    expect(result.graph.projections.twoDimensional).toMatchObject({
      nodeModel: 'shared',
      coordinateField: 'coordinates',
      axes: ['x', 'y'],
    });
    expect(result.graph.projections.threeDimensional).toMatchObject({
      nodeModel: 'shared',
      coordinateField: 'coordinates',
      axes: ['x', 'y', 'z'],
    });
    expect(result.graph.coordinateModel).toMatchObject({
      algorithm: 'centered-tfidf-pca-with-interpretable-fallback',
      usesIdentifiersAsCoordinates: false,
    });
    expect(result.graph.nodes.every((node) => node.x === node.coordinates.x)).toBe(true);
    expect(result.graph.nodes.every((node) => node.y === node.coordinates.y)).toBe(true);
    expect(result.graph.nodes.every((node) => node.z === node.coordinates.z)).toBe(true);
    expect(result.graph.facets.timeline).toHaveLength(2);
    expect(result.graph.facets.projects).toHaveLength(2);
    expect(result.graph.facets.domains.length).toBeGreaterThanOrEqual(2);
  });

  it('keeps stable semantic identities and coordinates independent of input order', () => {
    const now = new Date('2026-07-21T08:00:00.000Z');
    const forward = buildTrustedKnowledgeSpace({
      snapshots,
      request: { mode: 'combined' },
      title: '可信归纳',
      now,
    }).graph;
    const reversed = buildTrustedKnowledgeSpace({
      snapshots: [...snapshots].reverse(),
      request: { mode: 'combined' },
      title: '可信归纳',
      now,
    }).graph;

    expect(reversed.nodes.map(({ id, coordinates }) => ({ id, coordinates }))).toEqual(
      forward.nodes.map(({ id, coordinates }) => ({ id, coordinates })),
    );
    expect(reversed.edges.map((edge) => edge.id)).toEqual(forward.edges.map((edge) => edge.id));
    expect(reversed.coordinateModel).toEqual(forward.coordinateModel);

    const reidentified = snapshots.map((item, index) => {
      const marker = index === 0 ? 'e' : 'f';
      const projectId = `prj_${marker.repeat(32)}`;
      return {
        ...item,
        snapshotId: `ksn_${marker.repeat(32)}`,
        sessionId: `lsn_${marker.repeat(32)}`,
        scopeId: projectId,
        projectId,
        classroomId: `course_reidentified_${index}`,
      };
    });
    const identifiersChanged = buildTrustedKnowledgeSpace({
      snapshots: reidentified,
      request: { mode: 'combined' },
      title: '可信归纳',
      now,
    }).graph;
    expect(
      identifiersChanged.nodes.map(({ id, coordinates }) => ({ id, coordinates })),
    ).toEqual(forward.nodes.map(({ id, coordinates }) => ({ id, coordinates })));
  });

  it('rejects learner-only or untraceable material before synthesis', () => {
    const invalid = {
      ...snapshots[0]!,
      snapshotId: `ksn_${'f'.repeat(32)}`,
      eligibleForPersistence: false,
      verifiedKnowledge: [
        {
          ...snapshots[0]!.verifiedKnowledge[0]!,
          text: '未经系统评估的自由回答不应进入可信归纳。',
        },
      ],
    };
    const selection = selectTrustedKnowledgeSnapshots([...snapshots, invalid], {
      mode: 'combined',
    });

    expect(selection.selected).toHaveLength(2);
    expect(selection.audit.rejectedSnapshots).toEqual([
      {
        snapshotId: invalid.snapshotId,
        reason: 'snapshot_not_eligible_for_persistence',
      },
    ]);
    const built = buildTrustedKnowledgeSpace({
      snapshots: [...snapshots, invalid],
      request: { mode: 'combined' },
      title: '可信归纳',
      now: new Date('2026-07-21T08:00:00.000Z'),
    });
    expect(built.markdown).not.toContain('未经系统评估的自由回答');
  });
});
