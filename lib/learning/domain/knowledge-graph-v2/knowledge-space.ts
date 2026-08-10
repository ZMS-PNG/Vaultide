import type {
  KnowledgeCoordinates,
  KnowledgeGraphV2,
  KnowledgeNodeTypeV2,
  KnowledgeNodeV2,
} from './contracts';

function stableVisualHash(value: string): string {
  let primary = 0x811c9dc5;
  let secondary = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    primary = Math.imul(primary ^ code, 0x01000193);
    secondary = Math.imul(secondary ^ code, 0x85ebca6b);
    secondary ^= secondary >>> 13;
  }
  return `${(primary >>> 0).toString(16).padStart(8, '0')}${(secondary >>> 0)
    .toString(16)
    .padStart(8, '0')}`;
}

export type KnowledgeSpaceLens = 'logic' | 'domain' | 'source' | 'time';

export interface KnowledgeSpaceAxis {
  label: string;
  low: string;
  high: string;
}

export interface KnowledgeSpaceLensDefinition {
  id: KnowledgeSpaceLens;
  label: string;
  shortDescription: string;
  question: string;
  axes: {
    x: KnowledgeSpaceAxis;
    y: KnowledgeSpaceAxis;
    z: KnowledgeSpaceAxis;
  };
}

export interface KnowledgeSpaceCluster {
  id: string;
  label: string;
  kind: KnowledgeSpaceLens;
  nodeIds: string[];
  coordinates: KnowledgeCoordinates;
  nodeCount: number;
  evidenceCount: number;
  unknownCount: number;
  stableCount: number;
  weakCount: number;
  reviewDueCount: number;
  sourceUpdatedCount: number;
  averageMastery: number | null;
  actionKind: KnowledgeSpaceActionKind;
  learnedSummary: string;
  gapSummary: string;
  nextAction: string;
  targetNodeId?: string;
  order: number;
}

export type KnowledgeSpaceActionKind =
  | 'review'
  | 'refresh'
  | 'reinforce'
  | 'validate'
  | 'transfer'
  | 'maintain';

export interface KnowledgeSpaceProjection {
  lens: KnowledgeSpaceLens;
  definition: KnowledgeSpaceLensDefinition;
  graph: KnowledgeGraphV2;
  clusters: KnowledgeSpaceCluster[];
}

export interface KnowledgeSpaceLabelOverrides {
  domains?: Record<string, string>;
}

export const KNOWLEDGE_SPACE_LENSES: Record<KnowledgeSpaceLens, KnowledgeSpaceLensDefinition> = {
  logic: {
    id: 'logic',
    label: '逻辑链',
    shortDescription: '按认知阶段形成离散知识簇',
    question: '知识从哪里来，经过怎样的理解与应用，最终如何复习？',
    axes: {
      x: { label: '认知流程', low: '来源', high: '复习' },
      y: { label: '知识板块', low: '板块 A', high: '板块 N' },
      z: { label: '学习证据', low: '未检验', high: '已掌握' },
    },
  },
  domain: {
    id: 'domain',
    label: '主题岛',
    shortDescription: '按知识板块观察离散主题岛',
    question: '我的知识主要聚集在哪些主题，哪些主题之间存在迁移关系？',
    axes: {
      x: { label: '项目空间', low: '独立主题', high: '跨项目' },
      y: { label: '知识板块', low: '板块 A', high: '板块 N' },
      z: { label: '掌握状态', low: '未知/薄弱', high: '稳定掌握' },
    },
  },
  source: {
    id: 'source',
    label: '来源流',
    shortDescription: '观察资料如何转化为课堂与笔记',
    question: '外部资料和 Obsidian 原笔记，是否真正转化成了理解与沉淀？',
    axes: {
      x: { label: '知识转化', low: '原始来源', high: '沉淀/复习' },
      y: { label: '项目或板块', low: '范围 A', high: '范围 N' },
      z: { label: '证据强度', low: '仅收集', high: '已验证' },
    },
  },
  time: {
    id: 'time',
    label: '时间演化',
    shortDescription: '按时间切片观察知识积累',
    question: '知识在什么时间形成，哪些板块正在增强或停滞？',
    axes: {
      x: { label: '学习时间', low: '较早', high: '最近' },
      y: { label: '知识板块', low: '板块 A', high: '板块 N' },
      z: { label: '掌握状态', low: '未知/薄弱', high: '稳定掌握' },
    },
  },
};

export function recommendKnowledgeSpaceLens(question?: string): KnowledgeSpaceLens {
  const normalized = question?.trim().toLocaleLowerCase() ?? '';
  if (!normalized) return 'logic';

  const scores: Record<Exclude<KnowledgeSpaceLens, 'logic'>, number> = {
    domain: 0,
    source: 0,
    time: 0,
  };
  const countMatches = (pattern: RegExp) => normalized.match(pattern)?.length ?? 0;

  scores.time += countMatches(/时间|演化|变化|趋势|发展|先后|历史/g) * 2;
  scores.time += countMatches(/最新|近期|最近/g);
  scores.source += countMatches(/来源|证据|引用|可靠|冲突|矛盾|依据/g) * 2;
  scores.source += countMatches(/论文|研究|报告/g);
  scores.domain += countMatches(/主题|板块|领域|项目|聚类|关联|关系|迁移/g) * 2;
  scores.domain += countMatches(/比较|对比|异同|方案|选型/g) * 3;

  const ranked = (
    Object.entries(scores) as Array<[Exclude<KnowledgeSpaceLens, 'logic'>, number]>
  ).sort((left, right) => right[1] - left[1]);
  return ranked[0][1] > 0 ? ranked[0][0] : 'logic';
}

type LogicStage = 'source' | 'classroom' | 'concept' | 'application' | 'review';

const LOGIC_STAGE_ORDER: LogicStage[] = ['source', 'classroom', 'concept', 'application', 'review'];

const LOGIC_STAGE_LABEL: Record<LogicStage, string> = {
  source: '来源基础',
  classroom: '课堂脉络',
  concept: '概念建构',
  application: '应用迁移',
  review: '复习巩固',
};

const SOURCE_ROLE_ORDER = ['原始来源', '课堂理解', '概念建构', '应用沉淀', '复习巩固'] as const;

interface SpaceNodeEntry {
  node: KnowledgeNodeV2;
  coordinates: KnowledgeCoordinates;
  clusterKey: string;
  clusterLabel: string;
  topicLabel: string;
  stageLabel: string;
  clusterOrder: number;
}

function clamp(value: number, minimum = -0.96, maximum = 0.96): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function stableUnit(identity: string): number {
  const value = Number.parseInt(stableVisualHash(identity).slice(0, 8), 16) / 0xffffffff;
  return value * 2 - 1;
}

function stableJitter(identity: string, scale: number): number {
  return stableUnit(identity) * scale;
}

function lanePosition(index: number, count: number): number {
  if (count <= 1) return 0;
  return -0.88 + (index / (count - 1)) * 1.76;
}

function laneMap(
  values: readonly string[],
  preferredOrder?: readonly string[],
): Map<string, number> {
  const unique = [...new Set(values)];
  unique.sort((left, right) => {
    if (preferredOrder) {
      const leftIndex = preferredOrder.indexOf(left);
      const rightIndex = preferredOrder.indexOf(right);
      if (leftIndex >= 0 || rightIndex >= 0) {
        return (
          (leftIndex >= 0 ? leftIndex : preferredOrder.length) -
          (rightIndex >= 0 ? rightIndex : preferredOrder.length)
        );
      }
    }
    if (left === '未标注时间') return 1;
    if (right === '未标注时间') return -1;
    return left.localeCompare(right, 'zh-CN');
  });
  return new Map(unique.map((value, index) => [value, lanePosition(index, unique.length)]));
}

function logicalStage(type: KnowledgeNodeTypeV2): LogicStage {
  if (type === 'project' || type === 'original-note' || type === 'external-source') {
    return 'source';
  }
  if (type === 'classroom') return 'classroom';
  if (type === 'concept' || type === 'claim') return 'concept';
  if (type === 'review') return 'review';
  return 'application';
}

function sourceRole(type: KnowledgeNodeTypeV2): (typeof SOURCE_ROLE_ORDER)[number] {
  const stage = logicalStage(type);
  if (stage === 'source') return '原始来源';
  if (stage === 'classroom') return '课堂理解';
  if (stage === 'concept') return '概念建构';
  if (stage === 'review') return '复习巩固';
  return '应用沉淀';
}

function learningHeight(node: KnowledgeNodeV2, evidenceFirst = false): number {
  if (evidenceFirst) {
    const evidenceSignal = Math.min(1, Math.log2(node.evidenceCount + 1) / 4);
    const confidenceSignal = Math.max(node.confidence, node.masteryConfidence);
    return clamp(-0.88 + evidenceSignal * 1.15 + confidenceSignal * 0.58);
  }
  if (node.mastery === null) {
    return clamp(-0.88 + Math.min(0.22, node.evidenceCount * 0.04));
  }
  return clamp(node.mastery * 1.72 - 0.82);
}

function domainLabels(
  graph: KnowledgeGraphV2,
  overrides?: KnowledgeSpaceLabelOverrides,
): Map<string, string> {
  const result = new Map<string, string>(Object.entries(overrides?.domains ?? {}));
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  for (const cluster of graph.clusters) {
    if (cluster.kind !== 'domain') continue;
    for (const nodeId of cluster.nodeIds) {
      const node = nodeById.get(nodeId);
      const domainId = node?.domainIds[0];
      if (
        domainId &&
        !result.has(domainId) &&
        cluster.label !== domainId &&
        !/^domain:[a-f0-9_-]{8,}$/i.test(cluster.label)
      ) {
        result.set(domainId, cluster.label);
      }
    }
  }
  const domainIds = [...new Set(graph.nodes.map((node) => node.domainIds[0] ?? '通用知识'))].sort();
  for (const [index, domainId] of domainIds.entries()) {
    if (!result.has(domainId)) {
      result.set(
        domainId,
        domainId === '通用知识' || !/^domain:[a-f0-9_-]{8,}$/i.test(domainId)
          ? domainId
          : `知识板块 ${index + 1}`,
      );
    }
  }
  return result;
}

function timeBucketFactory(graph: KnowledgeGraphV2): (node: KnowledgeNodeV2) => string {
  const timestamps = graph.nodes
    .map((node) => (node.timestamp ? Date.parse(node.timestamp) : Number.NaN))
    .filter(Number.isFinite);
  const spanDays =
    timestamps.length > 1
      ? (Math.max(...timestamps) - Math.min(...timestamps)) / (24 * 60 * 60 * 1000)
      : 0;

  return (node) => {
    if (!node.timestamp || !Number.isFinite(Date.parse(node.timestamp))) return '未标注时间';
    const date = new Date(node.timestamp);
    if (spanDays <= 45) return date.toISOString().slice(0, 10);
    if (spanDays <= 730) return date.toISOString().slice(0, 7);
    return date.toISOString().slice(0, 4);
  };
}

function buildEntries(
  graph: KnowledgeGraphV2,
  lens: KnowledgeSpaceLens,
  overrides?: KnowledgeSpaceLabelOverrides,
): SpaceNodeEntry[] {
  const labelsByDomain = domainLabels(graph, overrides);
  const domainKeys = graph.nodes.map((node) => node.domainIds[0] ?? '通用知识');
  const domains = laneMap(domainKeys);
  const projectKeys = graph.nodes.map(
    (node) => node.projectIds[0] ?? node.domainIds[0] ?? '独立主题',
  );
  const projects = laneMap(projectKeys);
  const bucketFor = timeBucketFactory(graph);
  const timeKeys = graph.nodes.map(bucketFor);
  const times = laneMap(timeKeys);

  return graph.nodes.map((node) => {
    const domainId = node.domainIds[0] ?? '通用知识';
    const domainLabel = labelsByDomain.get(domainId) ?? domainId;
    const projectId = node.projectIds[0] ?? domainId;
    const stage = logicalStage(node.type);
    const stageIndex = LOGIC_STAGE_ORDER.indexOf(stage);
    const role = sourceRole(node.type);
    const roleIndex = SOURCE_ROLE_ORDER.indexOf(role);
    const bucket = bucketFor(node);
    const jitterX = stableJitter(`${lens}:x:${node.id}`, 0.035);
    const jitterZ = stableJitter(`${lens}:z:${node.id}`, 0.045);

    if (lens === 'logic') {
      const x = lanePosition(stageIndex, LOGIC_STAGE_ORDER.length);
      return {
        node,
        coordinates: {
          x: clamp(x + jitterX),
          y: domains.get(domainId) ?? 0,
          z: clamp(learningHeight(node, true) + jitterZ),
        },
        clusterKey: `${stage}:${domainId}`,
        clusterLabel: `${domainLabel} · ${LOGIC_STAGE_LABEL[stage]}`,
        topicLabel: domainLabel,
        stageLabel: LOGIC_STAGE_LABEL[stage],
        clusterOrder:
          stageIndex * Math.max(1, domains.size) + [...domains.keys()].indexOf(domainId),
      };
    }

    if (lens === 'domain') {
      return {
        node,
        coordinates: {
          x: clamp((projects.get(projectId) ?? 0) + jitterX),
          y: domains.get(domainId) ?? 0,
          z: clamp(learningHeight(node) + jitterZ),
        },
        clusterKey: domainId,
        clusterLabel: domainLabel,
        topicLabel: domainLabel,
        stageLabel: LOGIC_STAGE_LABEL[stage],
        clusterOrder: [...domains.keys()].indexOf(domainId),
      };
    }

    if (lens === 'source') {
      return {
        node,
        coordinates: {
          x: clamp(lanePosition(roleIndex, SOURCE_ROLE_ORDER.length) + jitterX),
          y: projects.get(projectId) ?? 0,
          z: clamp(learningHeight(node, true) + jitterZ),
        },
        clusterKey: role,
        clusterLabel: role,
        topicLabel: domainLabel,
        stageLabel: LOGIC_STAGE_LABEL[stage],
        clusterOrder: roleIndex,
      };
    }

    return {
      node,
      coordinates: {
        x: clamp((times.get(bucket) ?? 0) + jitterX),
        y: domains.get(domainId) ?? 0,
        z: clamp(learningHeight(node) + jitterZ),
      },
      clusterKey: bucket,
      clusterLabel: bucket,
      topicLabel: domainLabel,
      stageLabel: LOGIC_STAGE_LABEL[stage],
      clusterOrder: [...times.keys()].indexOf(bucket),
    };
  });
}

function dominantLabel(
  members: readonly SpaceNodeEntry[],
  select: (entry: SpaceNodeEntry) => string,
): string {
  const counts = new Map<string, number>();
  for (const member of members) {
    const value = select(member);
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return (
    [...counts.entries()].sort(
      (left, right) => right[1] - left[1] || left[0].localeCompare(right[0], 'zh-CN'),
    )[0]?.[0] ?? '通用知识'
  );
}

function clusterDisplayLabel(
  lens: KnowledgeSpaceLens,
  key: string,
  members: readonly SpaceNodeEntry[],
): string {
  if (lens === 'logic') return members[0]?.clusterLabel ?? key;
  if (lens === 'domain') {
    return `${members[0]?.topicLabel ?? key}｜${dominantLabel(
      members,
      (entry) => entry.stageLabel,
    )}`;
  }
  if (lens === 'source') {
    return `${key}｜${dominantLabel(members, (entry) => entry.topicLabel)}`;
  }
  return `${key}｜${dominantLabel(members, (entry) => entry.topicLabel)}`;
}

function conciseNodeLabel(node: KnowledgeNodeV2): string {
  const normalized = node.label.replaceAll(/\s+/g, ' ').trim() || '该知识点';
  return normalized.length > 28 ? `${normalized.slice(0, 28)}…` : normalized;
}

function clusterAction(
  members: readonly SpaceNodeEntry[],
  knownMasteries: readonly number[],
): Pick<
  KnowledgeSpaceCluster,
  'actionKind' | 'learnedSummary' | 'gapSummary' | 'nextAction' | 'targetNodeId'
> {
  const stable = members
    .filter((entry) => (entry.node.mastery ?? 0) >= 0.75 && entry.node.masteryConfidence >= 0.5)
    .sort((left, right) => (right.node.mastery ?? 0) - (left.node.mastery ?? 0));
  const weak = members
    .filter(
      (entry) =>
        entry.node.mastery !== null &&
        entry.node.mastery < 0.7 &&
        entry.node.masteryConfidence >= 0.25,
    )
    .sort((left, right) => (left.node.mastery ?? 1) - (right.node.mastery ?? 1));
  const due = members.find((entry) => entry.node.statusFlags.includes('review-due'));
  const updated = members.find((entry) => entry.node.statusFlags.includes('source-updated'));
  const unknown = [...members]
    .filter((entry) => entry.node.mastery === null)
    .sort((left, right) => right.node.evidenceCount - left.node.evidenceCount)[0];
  const stableTarget = stable[0];
  const knownCount = knownMasteries.length;
  const average =
    knownCount > 0 ? knownMasteries.reduce((total, value) => total + value, 0) / knownCount : null;
  const learnedSummary =
    stable.length > 0
      ? `已有 ${stable.length} 个节点达到稳定掌握，代表节点“${conciseNodeLabel(
          stableTarget.node,
        )}”。`
      : knownCount > 0
        ? `已有 ${knownCount} 个节点形成主动学习证据，平均掌握 ${Math.round(
            (average ?? 0) * 100,
          )}%。`
        : '当前主要完成了知识收集与组织，尚无可确认的主动学习证据。';

  if (due) {
    return {
      actionKind: 'review',
      learnedSummary,
      gapSummary: `有 ${members.filter((entry) => entry.node.statusFlags.includes('review-due')).length} 个节点已经到期，记忆稳定性需要重新检验。`,
      nextAction: `先对“${conciseNodeLabel(due.node)}”做一次闭卷回忆，再依据结果补强。`,
      targetNodeId: due.node.id,
    };
  }
  if (updated) {
    return {
      actionKind: 'refresh',
      learnedSummary,
      gapSummary: '来源内容已经变化，现有理解可能与最新版本不一致。',
      nextAction: `检查“${conciseNodeLabel(updated.node)}”的变化，并刷新对应课堂与伴生笔记。`,
      targetNodeId: updated.node.id,
    };
  }
  if (weak[0]) {
    return {
      actionKind: 'reinforce',
      learnedSummary,
      gapSummary: `有 ${weak.length} 个薄弱节点，当前最低掌握 ${Math.round(
        (weak[0].node.mastery ?? 0) * 100,
      )}%。`,
      nextAction: `回到“${conciseNodeLabel(weak[0].node)}”，先找错因，再完成一道针对性练习。`,
      targetNodeId: weak[0].node.id,
    };
  }
  if (unknown) {
    return {
      actionKind: 'validate',
      learnedSummary,
      gapSummary: `有 ${members.filter((entry) => entry.node.mastery === null).length} 个节点缺少可确认的主动学习证据。`,
      nextAction: `用“${conciseNodeLabel(unknown.node)}”完成一次闭卷回忆或自我解释，建立首条掌握证据。`,
      targetNodeId: unknown.node.id,
    };
  }
  if (stableTarget || (average ?? 0) >= 0.7) {
    const target = stableTarget?.node ?? members[0]?.node;
    return {
      actionKind: 'transfer',
      learnedSummary,
      gapSummary: '当前掌握较稳定，但还需要用新情境确认知识能否迁移。',
      nextAction: target
        ? `围绕“${conciseNodeLabel(target)}”完成一次跨项目应用、反例分析或方案对比。`
        : '完成一次跨项目应用、反例分析或方案对比。',
      targetNodeId: target?.id,
    };
  }
  const target = members[0]?.node;
  return {
    actionKind: 'maintain',
    learnedSummary,
    gapSummary: '当前没有紧急缺口，继续积累高质量学习证据即可。',
    nextAction: target
      ? `继续学习“${conciseNodeLabel(target)}”，并在完成后安排一次间隔复习。`
      : '继续学习并安排一次间隔复习。',
    targetNodeId: target?.id,
  };
}

function aggregateClusters(
  entries: readonly SpaceNodeEntry[],
  lens: KnowledgeSpaceLens,
): KnowledgeSpaceCluster[] {
  const grouped = new Map<string, SpaceNodeEntry[]>();
  for (const entry of entries) {
    const group = grouped.get(entry.clusterKey) ?? [];
    group.push(entry);
    grouped.set(entry.clusterKey, group);
  }

  return [...grouped.entries()]
    .map(([key, members]) => {
      const knownMasteries = members
        .map((entry) => entry.node.mastery)
        .filter((value): value is number => value !== null);
      const action = clusterAction(members, knownMasteries);
      return {
        id: `space:${lens}:${stableVisualHash(key)}`,
        label: clusterDisplayLabel(lens, key, members),
        kind: lens,
        nodeIds: members.map((entry) => entry.node.id),
        coordinates: {
          x:
            members.reduce((total, entry) => total + entry.coordinates.x, 0) /
            Math.max(1, members.length),
          y:
            members.reduce((total, entry) => total + entry.coordinates.y, 0) /
            Math.max(1, members.length),
          z:
            members.reduce((total, entry) => total + entry.coordinates.z, 0) /
            Math.max(1, members.length),
        },
        nodeCount: members.length,
        evidenceCount: members.reduce((total, entry) => total + entry.node.evidenceCount, 0),
        unknownCount: members.filter((entry) => entry.node.mastery === null).length,
        stableCount: members.filter(
          (entry) => (entry.node.mastery ?? 0) >= 0.75 && entry.node.masteryConfidence >= 0.5,
        ).length,
        weakCount: members.filter(
          (entry) =>
            entry.node.mastery !== null &&
            entry.node.mastery < 0.7 &&
            entry.node.masteryConfidence >= 0.25,
        ).length,
        reviewDueCount: members.filter((entry) => entry.node.statusFlags.includes('review-due'))
          .length,
        sourceUpdatedCount: members.filter((entry) =>
          entry.node.statusFlags.includes('source-updated'),
        ).length,
        averageMastery:
          knownMasteries.length > 0
            ? knownMasteries.reduce((total, value) => total + value, 0) / knownMasteries.length
            : null,
        ...action,
        order: Math.min(...members.map((entry) => entry.clusterOrder)),
      };
    })
    .sort(
      (left, right) =>
        left.order - right.order ||
        right.nodeCount - left.nodeCount ||
        left.label.localeCompare(right.label, 'zh-CN'),
    );
}

export function projectKnowledgeSpace(
  graph: KnowledgeGraphV2,
  lens: KnowledgeSpaceLens,
  overrides?: KnowledgeSpaceLabelOverrides,
): KnowledgeSpaceProjection {
  const entries = buildEntries(graph, lens, overrides);
  const coordinatesById = new Map(entries.map((entry) => [entry.node.id, entry.coordinates]));
  const nodes = graph.nodes.map((node) => {
    const coordinates = coordinatesById.get(node.id) ?? node.coordinates;
    return {
      ...node,
      coordinates,
      layoutCoordinates: coordinates,
    };
  });

  return {
    lens,
    definition: KNOWLEDGE_SPACE_LENSES[lens],
    graph: {
      ...graph,
      nodes,
      layoutVersion: `${graph.layoutVersion}:space-${lens}-v1`,
    },
    clusters: aggregateClusters(entries, lens),
  };
}
