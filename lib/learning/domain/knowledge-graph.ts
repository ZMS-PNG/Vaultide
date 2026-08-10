import type { JsonObject } from '@openmaic/learning-protocol';
import type {
  KnowledgeEdge,
  KnowledgeGraph,
  KnowledgeNode,
  SynthesisClassroomInput,
  SynthesisDelta,
  SynthesisEvidenceFingerprint,
  SynthesisFilterOptions,
  SynthesisMode,
  SynthesisRequest,
  SynthesisSourceType,
  SynthesisTaskCandidate,
} from './synthesis';

const DOMAIN_RULES: Array<{ domain: string; pattern: RegExp }> = [
  {
    domain: '软件与人工智能',
    pattern:
      /\b(ai|llm|api|code|coding|software|programming|database|web|react|python|javascript|typescript|openmaic|obsidian|sourcebundle|writeback|async|queue|retry|idempotency|webhook|serverless|vercel)\b|人工智能|大模型|模型|编程|代码|软件|数据库|算法|前端|后端|异步|队列|重试|幂等|接口|系统设计|软件工程|架构|部署|插件|任务调度/i,
  },
  {
    domain: '学习与认知',
    pattern:
      /\b(active recall|spaced repetition|retrieval practice|learning science|cognitive load|metacognition|memory|forgetting)\b|主动回忆|间隔重复|检索练习|费曼|学习科学|认知负荷|元认知|记忆|遗忘|学习方法|学习策略/i,
  },
  {
    domain: '自然科学',
    pattern:
      /\b(physics|chemistry|biology|math|science|medical|medicine|climate|energy|cell|quantum)\b|物理|化学|生物|数学|医学|科学|气候|能源|细胞|量子/i,
  },
  {
    domain: '人文与社会',
    pattern:
      /\b(history|philosophy|society|politics|law|culture|psychology|education)\b|历史|哲学|社会|政治|法律|文化|心理|教育/i,
  },
  {
    domain: '商业与管理',
    pattern:
      /\b(business|finance|economics|marketing|management|product|strategy|startup)\b|商业|金融|经济|营销|管理|产品|战略|创业/i,
  },
  {
    domain: '语言与表达',
    pattern:
      /\b(language|english|chinese|writing|communication|literature|grammar)\b|语言|英语|中文|写作|表达|文学|语法/i,
  },
];

const STOPWORDS = new Set([
  'about',
  'and',
  'for',
  'from',
  'how',
  'into',
  'the',
  'this',
  'with',
  '一个',
  '什么',
  '以及',
  '如何',
  '学习',
  '理解',
  '知识',
  '课程',
]);

function clamp(value: number, minimum = 0, maximum = 1): number {
  return Math.max(minimum, Math.min(maximum, value));
}

export function classifyKnowledgeDomain(value: string): string {
  for (const rule of DOMAIN_RULES) if (rule.pattern.test(value)) return rule.domain;
  return '通用知识';
}

function scoreFromPracticePayload(payload: JsonObject): number | undefined {
  const response = payload.response;
  let value: unknown = response;
  if (typeof response === 'string') {
    try {
      value = JSON.parse(response);
    } catch {
      return undefined;
    }
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const earned = Number(record.earned);
  const possible = Number(record.possible);
  if (!Number.isFinite(earned) || !Number.isFinite(possible) || possible <= 0) return undefined;
  return clamp(earned / possible);
}

export function estimateClassroomMastery(input: SynthesisClassroomInput): number | null {
  const scores = input.practicePayloads
    .map(scoreFromPracticePayload)
    .filter((value): value is number => value !== undefined);
  if (scores.length > 0)
    return clamp(scores.reduce((sum, value) => sum + value, 0) / scores.length);
  // Legacy synthesis inputs only retain an event count, not the event's
  // evidence type. A count cannot distinguish passive browsing from recall,
  // so it must never be converted into a made-up mastery number.
  return null;
}

function tokens(value: string): Set<string> {
  const output = new Set<string>();
  const chunks = value.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  for (const chunk of chunks) {
    if (STOPWORDS.has(chunk)) continue;
    if (/\p{Script=Han}/u.test(chunk)) {
      if (chunk.length <= 4 && chunk.length >= 2) output.add(chunk);
      for (let index = 0; index < chunk.length - 1; index += 1) {
        const pair = chunk.slice(index, index + 2);
        if (!STOPWORDS.has(pair)) output.add(pair);
      }
    } else if (chunk.length >= 3) {
      output.add(chunk);
    }
  }
  return output;
}

function similarity(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) return 0;
  let intersection = 0;
  for (const token of left) if (right.has(token)) intersection += 1;
  return intersection / (left.size + right.size - intersection);
}

function stableOffset(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return ((Math.abs(hash) % 1000) / 999 - 0.5) * 0.28;
}

function cleanLabel(value: string, fallback: string): string {
  return (
    value
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120) || fallback
  );
}

function classroomSearchText(input: SynthesisClassroomInput): string {
  return [
    input.projectName,
    input.title,
    input.description,
    input.goal,
    ...input.scenes.map((scene) => scene.title),
    ...input.obsidianSources.flatMap((source) => [source.title, ...source.tags]),
  ]
    .filter(Boolean)
    .join(' ');
}

export function synthesisSourceType(input: SynthesisClassroomInput): SynthesisSourceType {
  if (input.sourceBundleId && input.researchRunId) return 'hybrid';
  if (input.sourceBundleId) return 'obsidian';
  if (input.researchRunId) return 'external';
  return 'classroom';
}

function classroomTopicTags(input: SynthesisClassroomInput): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const tag of input.obsidianSources.flatMap((source) => source.tags)) {
    const normalized = tag.trim();
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    tags.push(normalized);
  }
  return tags.sort((left, right) => left.localeCompare(right));
}

export function buildSynthesisFilterOptions(
  inputs: readonly SynthesisClassroomInput[],
): SynthesisFilterOptions {
  const classrooms = inputs
    .map((input) => ({
      classroomId: input.classroomId,
      ...(input.projectId ? { projectId: input.projectId } : {}),
      ...(input.projectName ? { projectName: input.projectName } : {}),
      title: cleanLabel(input.title, input.classroomId),
      createdAt: input.createdAt.toISOString(),
      domain: classifyKnowledgeDomain(classroomSearchText(input)),
      sourceType: synthesisSourceType(input),
      topicTags: classroomTopicTags(input),
    }))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  return {
    projects: [
      ...new Map(
        inputs
          .filter(
            (input): input is SynthesisClassroomInput & { projectId: string } =>
              typeof input.projectId === 'string',
          )
          .map((input) => [
            input.projectId,
            {
              projectId: input.projectId,
              projectName: cleanLabel(input.projectName ?? '未命名项目', input.projectId),
              classroomCount: inputs.filter((item) => item.projectId === input.projectId).length,
              latestActivityAt: inputs
                .filter((item) => item.projectId === input.projectId)
                .reduce(
                  (latest, item) =>
                    item.updatedAt.toISOString() > latest ? item.updatedAt.toISOString() : latest,
                  input.updatedAt.toISOString(),
                ),
            },
          ]),
      ).values(),
    ].sort((left, right) => right.latestActivityAt.localeCompare(left.latestActivityAt)),
    classrooms,
    domains: [...new Set(classrooms.map((item) => item.domain))].sort((left, right) =>
      left.localeCompare(right),
    ),
    topicTags: [...new Set(classrooms.flatMap((item) => item.topicTags))].sort((left, right) =>
      left.localeCompare(right),
    ),
    sourceTypes: [...new Set(classrooms.map((item) => item.sourceType))],
  };
}

export function filterSynthesisClassrooms(
  inputs: readonly SynthesisClassroomInput[],
  request: SynthesisRequest,
): SynthesisClassroomInput[] {
  const from = request.timeFrom ? Date.parse(request.timeFrom) : Number.NEGATIVE_INFINITY;
  const to = request.timeTo ? Date.parse(request.timeTo) + 86_399_999 : Number.POSITIVE_INFINITY;
  const ids = request.classroomIds?.length ? new Set(request.classroomIds) : undefined;
  const projectIds = request.projectIds?.length ? new Set(request.projectIds) : undefined;
  const query = request.domainQuery?.trim().toLowerCase();
  const requestedTags = request.topicTags?.map((tag) => tag.toLowerCase()) ?? [];
  return inputs
    .filter((input) => {
      const timestamp = input.createdAt.getTime();
      if (timestamp < from || timestamp > to) return false;
      if (ids && !ids.has(input.classroomId)) return false;
      if (projectIds && (!input.projectId || !projectIds.has(input.projectId))) return false;
      if (query && !classroomSearchText(input).toLowerCase().includes(query)) return false;
      if (request.domain && classifyKnowledgeDomain(classroomSearchText(input)) !== request.domain)
        return false;
      if (request.sourceType && synthesisSourceType(input) !== request.sourceType) return false;
      if (requestedTags.length > 0) {
        const availableTags = new Set(classroomTopicTags(input).map((tag) => tag.toLowerCase()));
        if (!requestedTags.every((tag) => availableTags.has(tag))) return false;
      }
      return true;
    })
    .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
}

export function buildKnowledgeGraph(
  classrooms: readonly SynthesisClassroomInput[],
  mode: SynthesisMode,
): KnowledgeGraph {
  if (classrooms.length === 0) throw new Error('knowledge_graph_requires_classrooms');
  const domainByClassroom = new Map(
    classrooms.map((input) => [
      input.classroomId,
      classifyKnowledgeDomain(classroomSearchText(input)),
    ]),
  );
  const domains = [...new Set(domainByClassroom.values())].sort();
  const domainCoordinate = new Map(
    domains.map((domain, index) => [
      domain,
      domains.length === 1 ? 0 : (index / (domains.length - 1)) * 2 - 1,
    ]),
  );
  const firstTime = classrooms[0].createdAt.getTime();
  const lastTime = classrooms[classrooms.length - 1].createdAt.getTime();
  const timeSpan = Math.max(1, lastTime - firstTime);
  const nodes: KnowledgeNode[] = [];
  const edges: KnowledgeEdge[] = [];
  const conceptTokens = new Map<string, Set<string>>();
  const projectNodeIds = new Set<string>();

  for (const input of classrooms) {
    const domain = domainByClassroom.get(input.classroomId) ?? '通用知识';
    const mastery = estimateClassroomMastery(input);
    const x =
      classrooms.length === 1 ? 0 : ((input.createdAt.getTime() - firstTime) / timeSpan) * 2 - 1;
    const y = domainCoordinate.get(domain) ?? 0;
    const z = mastery === null ? -1.15 : mastery * 2 - 1;
    const classroomNodeId = `classroom:${input.classroomId}`;
    if (input.projectId) {
      const projectNodeId = `project:${input.projectId}`;
      if (!projectNodeIds.has(projectNodeId)) {
        projectNodeIds.add(projectNodeId);
        nodes.push({
          id: projectNodeId,
          label: cleanLabel(input.projectName ?? '未命名项目', input.projectId),
          type: 'project',
          projectId: input.projectId,
          domain,
          timestamp: input.createdAt.toISOString(),
          mastery,
          x,
          y,
          z: clamp(z + 0.25, -1, 1),
        });
      }
      edges.push({
        id: `belongs:${classroomNodeId}:${projectNodeId}`,
        source: classroomNodeId,
        target: projectNodeId,
        type: 'belongs-to',
        weight: 1,
        label: '所属项目',
      });
    }
    nodes.push({
      id: classroomNodeId,
      label: cleanLabel(input.title, input.classroomId),
      type: 'classroom',
      classroomId: input.classroomId,
      ...(input.projectId ? { projectId: input.projectId } : {}),
      domain,
      timestamp: input.createdAt.toISOString(),
      mastery,
      x,
      y,
      z,
    });

    const scenes = [...input.scenes].sort((left, right) => left.order - right.order).slice(0, 12);
    for (const [index, scene] of scenes.entries()) {
      const nodeId = `concept:${input.classroomId}:${scene.id}`;
      const sceneOffset = scenes.length <= 1 ? 0 : (index / (scenes.length - 1) - 0.5) * 0.36;
      nodes.push({
        id: nodeId,
        label: cleanLabel(scene.title, `场景 ${index + 1}`),
        type: 'concept',
        classroomId: input.classroomId,
        ...(input.projectId ? { projectId: input.projectId } : {}),
        domain,
        timestamp: input.createdAt.toISOString(),
        mastery,
        x: clamp(x + sceneOffset, -1.2, 1.2),
        y: y + stableOffset(scene.id),
        z: clamp(z + stableOffset(scene.title) * 0.7, -1.1, 1.1),
      });
      conceptTokens.set(nodeId, tokens(`${scene.title} ${input.title} ${domain}`));
      edges.push({
        id: `contains:${classroomNodeId}:${nodeId}`,
        source: classroomNodeId,
        target: nodeId,
        type: 'contains',
        weight: 0.9,
      });
      if (index > 0) {
        const previous = `concept:${input.classroomId}:${scenes[index - 1].id}`;
        edges.push({
          id: `precedes:${previous}:${nodeId}`,
          source: previous,
          target: nodeId,
          type: 'precedes',
          weight: 0.45,
        });
      }
    }

    for (const [index, source] of input.researchSources.slice(0, 4).entries()) {
      const nodeId = `source:${input.classroomId}:${source.citationId}:${index}`;
      nodes.push({
        id: nodeId,
        label: cleanLabel(source.title, source.domain),
        type: 'source',
        classroomId: input.classroomId,
        ...(input.projectId ? { projectId: input.projectId } : {}),
        domain,
        timestamp: input.createdAt.toISOString(),
        mastery: null,
        x: clamp(x + 0.12 + index * 0.04, -1.2, 1.2),
        y: y + 0.45 + index * 0.06,
        z: -0.95 + index * 0.05,
        url: source.url,
        citationId: source.citationId,
      });
      edges.push({
        id: `cites:${classroomNodeId}:${nodeId}`,
        source: classroomNodeId,
        target: nodeId,
        type: 'cites',
        weight:
          source.authority === 'primary' ? 0.9 : source.authority === 'authoritative' ? 0.75 : 0.55,
      });
    }

    for (const [index, source] of input.obsidianSources.slice(0, 4).entries()) {
      const nodeId = `obsidian:${input.classroomId}:${index}`;
      nodes.push({
        id: nodeId,
        label: cleanLabel(source.title, 'Obsidian 来源'),
        type: 'obsidian',
        classroomId: input.classroomId,
        ...(input.projectId ? { projectId: input.projectId } : {}),
        domain,
        timestamp: input.createdAt.toISOString(),
        mastery: null,
        x: clamp(x - 0.12 - index * 0.04, -1.2, 1.2),
        y: y - 0.45 - index * 0.06,
        z: -0.9 + index * 0.05,
      });
      edges.push({
        id: `derived:${classroomNodeId}:${nodeId}`,
        source: classroomNodeId,
        target: nodeId,
        type: 'derived-from',
        weight: 0.85,
      });
    }
  }

  if (mode === 'timeline' || mode === 'combined') {
    const classroomNodes = nodes.filter((node) => node.type === 'classroom');
    for (let index = 1; index < classroomNodes.length; index += 1) {
      edges.push({
        id: `timeline:${classroomNodes[index - 1].id}:${classroomNodes[index].id}`,
        source: classroomNodes[index - 1].id,
        target: classroomNodes[index].id,
        type: 'precedes',
        weight: 0.65,
        label: '时间推进',
      });
    }
  }

  const concepts = nodes.filter((node) => node.type === 'concept');
  const related: KnowledgeEdge[] = [];
  for (let leftIndex = 0; leftIndex < concepts.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < concepts.length; rightIndex += 1) {
      const left = concepts[leftIndex];
      const right = concepts[rightIndex];
      if (left.classroomId === right.classroomId) continue;
      const score = similarity(
        conceptTokens.get(left.id) ?? new Set(),
        conceptTokens.get(right.id) ?? new Set(),
      );
      if (score < 0.2) continue;
      related.push({
        id: `related:${left.id}:${right.id}`,
        source: left.id,
        target: right.id,
        type: 'related',
        weight: Number(score.toFixed(3)),
        label: '概念关联',
      });
    }
  }
  related.sort((left, right) => right.weight - left.weight);
  edges.push(...related.slice(0, 120));

  return {
    schemaVersion: 'knowledge-graph/1',
    dimensions: { x: 'time', y: 'domain', z: 'mastery' },
    domains,
    nodes,
    edges,
  };
}

function mermaidLabel(value: string): string {
  return value
    .replace(/["\[\]{}|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 48);
}

export function renderSynthesisMarkdown(options: {
  id: string;
  title: string;
  mode: SynthesisMode;
  question?: string;
  classrooms: readonly SynthesisClassroomInput[];
  graph: KnowledgeGraph;
  incremental?: boolean;
  evidenceManifest?: readonly SynthesisEvidenceFingerprint[];
  delta?: SynthesisDelta;
  taskCandidates?: readonly SynthesisTaskCandidate[];
  now: Date;
}): string {
  const { id, title, mode, classrooms, graph, now } = options;
  const classroomNodes = graph.nodes.filter((node) => node.type === 'classroom');
  const projectNodes = graph.nodes.filter((node) => node.type === 'project');
  const relatedEdges = graph.edges.filter((edge) => edge.type === 'related').slice(0, 12);
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const weak = classroomNodes
    .filter((node) => node.mastery !== null && node.mastery < 0.5)
    .sort((a, b) => (a.mastery ?? 0) - (b.mastery ?? 0));
  const sourceNodes = graph.nodes.filter((node) => node.type === 'source' && node.url).slice(0, 30);
  const domainLines = graph.domains.map((domain) => {
    const count = graph.nodes.filter(
      (node) => node.type === 'concept' && node.domain === domain,
    ).length;
    return `- ${domain}：${count} 个知识点`;
  });
  const timelineLines = classroomNodes.map(
    (node) =>
      `- ${node.timestamp.slice(0, 10)}｜${node.label}｜掌握度 ${node.mastery === null ? '未知（无主动证据）' : `${Math.round(node.mastery * 100)}%`}`,
  );
  const relationLines = relatedEdges.map((edge) => {
    const source = nodeById.get(edge.source)?.label ?? edge.source;
    const target = nodeById.get(edge.target)?.label ?? edge.target;
    return `- ${source} ↔ ${target}（关联强度 ${Math.round(edge.weight * 100)}%）`;
  });
  const mermaidConcepts = graph.nodes.filter((node) => node.type === 'concept').slice(0, 18);
  const mermaidIds = new Map(mermaidConcepts.map((node, index) => [node.id, `N${index + 1}`]));
  const mermaidEdges = graph.edges
    .filter((edge) => mermaidIds.has(edge.source) && mermaidIds.has(edge.target))
    .slice(0, 30)
    .map((edge) => `  ${mermaidIds.get(edge.source)} --> ${mermaidIds.get(edge.target)}`);
  const mermaid = [
    '```mermaid',
    'graph LR',
    ...mermaidConcepts.map((node) => `  ${mermaidIds.get(node.id)}["${mermaidLabel(node.label)}"]`),
    ...mermaidEdges,
    '```',
  ];
  const delta = options.delta;
  const deltaLines = delta
    ? [
        `- 新增课堂：${delta.addedClassroomIds.length}`,
        `- 更新课堂：${delta.updatedClassroomIds.length}`,
        `- 移除课堂：${delta.removedClassroomIds.length}`,
        `- 新增/移除关系：${delta.addedEdgeIds.length}/${delta.removedEdgeIds.length}`,
        `- 掌握度强化/下降：${delta.strengthened.length}/${delta.weakened.length}`,
        ...(delta.conflicts.length === 0
          ? ['- 事实冲突：未自动推断；只有具备可追溯的矛盾证据时才会标记。']
          : delta.conflicts.map((item) => `- 冲突：${item.reason}`)),
      ]
    : [];
  const candidateLines = (options.taskCandidates ?? []).map((candidate) => {
    const checkbox = candidate.kind === 'review' ? '[ ]' : '[ ]';
    return `- ${checkbox} ${candidate.title}（${candidate.priority === 'high' ? '高优先级' : '建议'}：${candidate.rationale}）`;
  });

  return [
    `# ${title}`,
    '',
    '> 由知洄根据已持久化课堂、主动学习事件、Obsidian 来源清单和外部引用元数据生成。关系空间用于解释知识结构、证据、演化和下一步行动。',
    ...(options.question
      ? [
          '',
          '## 本次归纳问题',
          '',
          `> ${options.question}`,
          '',
          '以下内容只使用当前归纳范围内的可追溯证据回答。',
        ]
      : []),
    '',
    '## 归纳范围',
    '',
    `- 归纳模式：${mode}`,
    `- 项目数量：${projectNodes.length}`,
    `- 课堂数量：${classrooms.length}`,
    `- 图谱规模：${graph.nodes.length} 个节点，${graph.edges.length} 条关系`,
    `- 归纳编号：\`${id}\``,
    ...(options.incremental
      ? [
          `- 运行方式：仅在证据指纹发生变化时生成；本次核对 ${options.evidenceManifest?.length ?? classrooms.length} 份课堂证据。`,
        ]
      : []),
    ...(projectNodes.length
      ? [
          '',
          '### 涉及项目',
          '',
          ...projectNodes.map((node) => `- ${node.label}（\`${node.projectId}\`）`),
        ]
      : []),
    '',
    '## 时间线',
    '',
    ...(timelineLines.length ? timelineLines : ['- 暂无课堂时间线']),
    '',
    '## 知识板块',
    '',
    ...(domainLines.length ? domainLines : ['- 暂无可识别板块']),
    '',
    '## 跨课堂关键连接',
    '',
    ...(relationLines.length ? relationLines : ['- 当前样本中尚未发现足够强的跨课堂标题关联']),
    ...(deltaLines.length ? ['', '## 相对上次快照的变化', '', ...deltaLines] : []),
    '',
    '## 二维兼容关系图',
    '',
    ...mermaid,
    '',
    '## 待强化区域',
    '',
    ...(weak.length
      ? weak.map(
          (node) => `- [ ] ${node.label}：当前估算掌握度 ${Math.round((node.mastery ?? 0) * 100)}%`,
        )
      : ['- [x] 当前没有低于 50% 的已估算课堂；无主动证据的课堂显示为未知']),
    ...(candidateLines.length
      ? ['', '## 建议的复习与迁移任务（需你确认）', '', ...candidateLines]
      : []),
    '',
    '## 来源与引用',
    '',
    ...sourceNodes.map(
      (node) => `- ${node.citationId ? `[${node.citationId}] ` : ''}[${node.label}](${node.url})`,
    ),
    ...(sourceNodes.length ? [] : ['- 当前归纳没有可公开点击的外部引用']),
    '',
    '## 下一轮主动学习',
    '',
    '- [ ] 从“待强化区域”选择一个课堂，先闭卷复述核心概念',
    '- [ ] 选择一条跨课堂连接，写出两者相同点、不同点与适用边界',
    '- [ ] 完成一次迁移任务，并在对应课堂中提交练习以更新掌握度',
    '',
    `生成时间：${now.toISOString()}`,
    '',
  ].join('\n');
}
