import { createHash } from 'node:crypto';
import type {
  KnowledgeGraph,
  SynthesisClassroomInput,
  SynthesisDelta,
  SynthesisEvidenceFingerprint,
  SynthesisMode,
  SynthesisSchedulePeriod,
  SynthesisScope,
  SynthesisTaskCandidate,
} from './synthesis';

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value
      .map(canonical)
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonical(item)]),
    );
  }
  return value;
}

/** Stable identity for a schedule's mode and inclusion scope. */
export function synthesisScopeHash(mode: SynthesisMode, scope: SynthesisScope): string {
  return sha256(JSON.stringify(canonical({ mode, scope })));
}

function daysInUtcMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/**
 * Schedule calculation is deliberately anchored to a persisted instant. The
 * timezone is kept for presentation and future calendar-time controls; no
 * browser locale can silently change the durable execution boundary.
 */
export function nextSynthesisScheduleRunAt(
  after: Date,
  period: SynthesisSchedulePeriod,
  intervalMinutes?: number,
): Date {
  const result = new Date(after.getTime());
  switch (period) {
    case 'daily':
      result.setUTCDate(result.getUTCDate() + 1);
      return result;
    case 'weekly':
      result.setUTCDate(result.getUTCDate() + 7);
      return result;
    case 'monthly': {
      const day = result.getUTCDate();
      result.setUTCDate(1);
      result.setUTCMonth(result.getUTCMonth() + 1);
      result.setUTCDate(
        Math.min(day, daysInUtcMonth(result.getUTCFullYear(), result.getUTCMonth())),
      );
      return result;
    }
    case 'custom':
      return new Date(after.getTime() + Math.max(15, intervalMinutes ?? 60) * 60_000);
  }
}

/**
 * Only identifiers, timestamps and already-authorized classroom metadata are
 * fingerprinted. Full source text and learner answers never enter schedule
 * state merely to decide whether a run is incremental.
 */
export function synthesisEvidenceManifest(
  classrooms: readonly SynthesisClassroomInput[],
): SynthesisEvidenceFingerprint[] {
  return classrooms
    .map((classroom) => ({
      classroomId: classroom.classroomId,
      activityAt: classroom.updatedAt.toISOString(),
      fingerprint: sha256(
        JSON.stringify(
          canonical({
            classroomId: classroom.classroomId,
            activityAt: classroom.updatedAt.toISOString(),
            projectId: classroom.projectId,
            projectRevision: classroom.projectRevision,
            sourceBundleId: classroom.sourceBundleId,
            researchRunId: classroom.researchRunId,
            activeLearningEventCount: classroom.activeLearningEventCount,
            scenes: classroom.scenes.map((scene) => ({
              id: scene.id,
              title: scene.title,
              order: scene.order,
              type: scene.type,
            })),
            obsidianSources: classroom.obsidianSources,
            researchSources: classroom.researchSources.map((source) => ({
              citationId: source.citationId,
              url: source.url,
              authority: source.authority,
              score: source.score,
            })),
          }),
        ),
      ),
    }))
    .sort((left, right) => left.classroomId.localeCompare(right.classroomId));
}

function evidenceChange(
  current: readonly SynthesisEvidenceFingerprint[],
  baseline: readonly SynthesisEvidenceFingerprint[],
): Pick<SynthesisDelta, 'addedClassroomIds' | 'updatedClassroomIds' | 'removedClassroomIds'> {
  const aggregateByClassroom = (items: readonly SynthesisEvidenceFingerprint[]) => {
    const grouped = new Map<string, SynthesisEvidenceFingerprint[]>();
    for (const item of items) {
      grouped.set(item.classroomId, [...(grouped.get(item.classroomId) ?? []), item]);
    }
    return new Map(
      [...grouped.entries()].map(([classroomId, evidence]) => [
        classroomId,
        sha256(
          JSON.stringify(
            evidence
              .map((item) => ({
                snapshotId: item.snapshotId ?? item.classroomId,
                fingerprint: item.fingerprint,
              }))
              .sort((left, right) => left.snapshotId.localeCompare(right.snapshotId)),
          ),
        ),
      ]),
    );
  };
  const previousById = aggregateByClassroom(baseline);
  const currentById = aggregateByClassroom(current);
  const addedClassroomIds: string[] = [];
  const updatedClassroomIds: string[] = [];
  const removedClassroomIds: string[] = [];
  for (const [classroomId, fingerprint] of currentById) {
    const prior = previousById.get(classroomId);
    if (!prior) addedClassroomIds.push(classroomId);
    else if (prior !== fingerprint) updatedClassroomIds.push(classroomId);
  }
  for (const classroomId of previousById.keys()) {
    if (!currentById.has(classroomId)) removedClassroomIds.push(classroomId);
  }
  return { addedClassroomIds, updatedClassroomIds, removedClassroomIds };
}

function masteryChanges(current: KnowledgeGraph, baseline: KnowledgeGraph) {
  const previousById = new Map(baseline.nodes.map((node) => [node.id, node]));
  const strengthened: SynthesisDelta['strengthened'] = [];
  const weakened: SynthesisDelta['weakened'] = [];
  for (const node of current.nodes) {
    const prior = previousById.get(node.id);
    if (!prior || prior.mastery === null || node.mastery === null) continue;
    const difference = node.mastery - prior.mastery;
    if (difference >= 0.05) {
      strengthened.push({
        nodeId: node.id,
        label: node.label,
        from: prior.mastery,
        to: node.mastery,
      });
    } else if (difference <= -0.05) {
      weakened.push({ nodeId: node.id, label: node.label, from: prior.mastery, to: node.mastery });
    }
  }
  return { strengthened, weakened };
}

/** Compare two immutable graph snapshots without inventing semantic conflicts. */
export function diffSynthesisGraphs(input: {
  current: KnowledgeGraph;
  baseline?: KnowledgeGraph;
  baselineSynthesisId?: string;
  currentEvidence: readonly SynthesisEvidenceFingerprint[];
  baselineEvidence?: readonly SynthesisEvidenceFingerprint[];
}): SynthesisDelta {
  const baseline = input.baseline;
  const currentNodes = new Map(input.current.nodes.map((node) => [node.id, node]));
  const baselineNodes = new Map((baseline?.nodes ?? []).map((node) => [node.id, node]));
  const currentEdges = new Map(input.current.edges.map((edge) => [edge.id, edge]));
  const baselineEdges = new Map((baseline?.edges ?? []).map((edge) => [edge.id, edge]));
  const graphChanges = masteryChanges(
    input.current,
    baseline ?? { ...input.current, nodes: [], edges: [] },
  );
  const evidence = evidenceChange(input.currentEvidence, input.baselineEvidence ?? []);
  const addedNodeIds = [...currentNodes.keys()].filter((id) => !baselineNodes.has(id));
  const removedNodeIds = [...baselineNodes.keys()].filter((id) => !currentNodes.has(id));
  const addedEdgeIds = [...currentEdges.keys()].filter((id) => !baselineEdges.has(id));
  const removedEdgeIds = [...baselineEdges.keys()].filter((id) => !currentEdges.has(id));
  const relationChanges = [
    ...addedEdgeIds
      .map((id) => currentEdges.get(id))
      .filter((edge) => edge?.type === 'related')
      .map((edge) => ({
        edgeId: edge!.id,
        kind: 'added' as const,
        label: edge!.label ?? 'concept relation',
      })),
    ...removedEdgeIds
      .map((id) => baselineEdges.get(id))
      .filter((edge) => edge?.type === 'related')
      .map((edge) => ({
        edgeId: edge!.id,
        kind: 'removed' as const,
        label: edge!.label ?? 'concept relation',
      })),
  ];
  return {
    schemaVersion: 'synthesis-delta/1',
    ...(input.baselineSynthesisId ? { baselineSynthesisId: input.baselineSynthesisId } : {}),
    ...evidence,
    addedNodeIds,
    removedNodeIds,
    addedEdgeIds,
    removedEdgeIds,
    strengthened: graphChanges.strengthened,
    weakened: graphChanges.weakened,
    relationChanges,
    // Graph topology alone cannot establish a factual contradiction. Keeping
    // this empty is safer than labelling two superficially similar concepts as
    // conflicting without cited primary evidence.
    conflicts: [],
  };
}

/** Candidates are suggestions only; no review or transfer task is silently created. */
export function synthesisTaskCandidates(graph: KnowledgeGraph): SynthesisTaskCandidate[] {
  const candidates: SynthesisTaskCandidate[] = [];
  for (const node of graph.nodes.filter((item) => item.type === 'classroom')) {
    if (node.mastery === null || node.mastery >= 0.5) continue;
    candidates.push({
      id: `review:${node.id}`,
      kind: 'review',
      title: `复习：${node.label}`,
      priority: node.mastery < 0.35 ? 'high' : 'normal',
      ...(node.classroomId ? { classroomId: node.classroomId } : {}),
      relatedNodeIds: [node.id],
      rationale: `当前掌握证据为 ${Math.round(node.mastery * 100)}%，建议进行一次不看答案的主动回忆。`,
    });
  }
  for (const edge of graph.edges.filter((item) => item.type === 'related').slice(0, 12)) {
    const source = graph.nodes.find((node) => node.id === edge.source);
    const target = graph.nodes.find((node) => node.id === edge.target);
    if (!source || !target) continue;
    candidates.push({
      id: `transfer:${edge.id}`,
      kind: 'transfer',
      title: `迁移练习：${source.label} × ${target.label}`,
      priority: edge.weight >= 0.45 ? 'high' : 'normal',
      ...(source.classroomId ? { classroomId: source.classroomId } : {}),
      relatedNodeIds: [source.id, target.id],
      rationale: `两项知识存在 ${(edge.weight * 100).toFixed(0)}% 的跨课堂关系，建议说明共同机制和适用边界。`,
    });
  }
  return candidates.slice(0, 24);
}

export function hasSynthesisEvidenceChanges(delta: SynthesisDelta): boolean {
  return (
    delta.addedClassroomIds.length > 0 ||
    delta.updatedClassroomIds.length > 0 ||
    delta.removedClassroomIds.length > 0
  );
}
