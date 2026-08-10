import { describe, expect, it } from 'vitest';
import {
  buildKnowledgeGraph,
  buildSynthesisFilterOptions,
  classifyKnowledgeDomain,
  estimateClassroomMastery,
  filterSynthesisClassrooms,
  renderSynthesisMarkdown,
} from '@/lib/learning/domain/knowledge-graph';
import type { SynthesisClassroomInput } from '@/lib/learning/domain/synthesis';

function classroom(
  classroomId: string,
  title: string,
  createdAt: string,
  overrides: Partial<SynthesisClassroomInput> = {},
): SynthesisClassroomInput {
  const timestamp = new Date(createdAt);
  return {
    classroomId,
    sprintId: `spr_${classroomId}`,
    goal: `掌握 ${title}`,
    createdAt: timestamp,
    updatedAt: timestamp,
    activeLearningEventCount: 0,
    practicePayloads: [],
    researchSources: [],
    title,
    description: `${title} 的结构化课程`,
    scenes: [
      { id: 'intro', title: `${title} 核心概念`, order: 1, type: 'content' },
      { id: 'practice', title: `${title} 主动练习`, order: 2, type: 'quiz' },
    ],
    obsidianSources: [],
    ...overrides,
  };
}

describe('deterministic synthesis knowledge graph', () => {
  it('classifies domains and prefers quiz evidence for mastery', () => {
    expect(classifyKnowledgeDomain('React TypeScript 前端编程')).toBe('软件与人工智能');
    expect(classifyKnowledgeDomain('OpenMAIC Obsidian 回写与异步队列')).toBe('软件与人工智能');
    expect(classifyKnowledgeDomain('主动回忆与间隔重复的学习策略')).toBe('学习与认知');
    expect(classifyKnowledgeDomain('量子物理与能源')).toBe('自然科学');
    expect(classifyKnowledgeDomain('随手记录')).toBe('通用知识');

    const input = classroom('course_a', 'TypeScript 类型收窄', '2026-07-01T00:00:00Z', {
      activeLearningEventCount: 20,
      practicePayloads: [
        { response: JSON.stringify({ earned: 3, possible: 4 }) },
        { response: { earned: 1, possible: 2 } },
      ],
    });
    expect(estimateClassroomMastery(input)).toBe(0.625);
  });

  it('builds time, domain, and mastery coordinates with traceable source edges', () => {
    const first = classroom('course_a', 'TypeScript 类型收窄', '2026-07-01T00:00:00Z', {
      practicePayloads: [{ response: JSON.stringify({ earned: 3, possible: 4 }) }],
      researchSources: [
        {
          citationId: 'S1',
          title: 'TypeScript Handbook',
          url: 'https://www.typescriptlang.org/docs/handbook/2/narrowing.html',
          domain: 'typescriptlang.org',
          authority: 'primary',
          score: 0.98,
        },
      ],
      obsidianSources: [{ title: 'TypeScript 学习索引', tags: ['typescript', '编程'] }],
    });
    const second = classroom('course_b', 'React TypeScript 类型收窄实践', '2026-07-20T00:00:00Z', {
      activeLearningEventCount: 4,
    });

    const graph = buildKnowledgeGraph([first, second], 'combined');
    expect(graph.dimensions).toEqual({ x: 'time', y: 'domain', z: 'mastery' });
    expect(graph.nodes.filter((node) => node.type === 'classroom')).toHaveLength(2);
    expect(graph.nodes.some((node) => node.type === 'source' && node.citationId === 'S1')).toBe(
      true,
    );
    expect(graph.nodes.some((node) => node.type === 'obsidian')).toBe(true);
    expect(graph.edges.some((edge) => edge.type === 'cites')).toBe(true);
    expect(graph.edges.some((edge) => edge.type === 'derived-from')).toBe(true);
    expect(graph.edges.some((edge) => edge.type === 'related')).toBe(true);

    const classroomNodes = graph.nodes.filter((node) => node.type === 'classroom');
    expect(classroomNodes[0].x).toBe(-1);
    expect(classroomNodes[1].x).toBe(1);
    expect(classroomNodes[0].z).toBe(0.5);
  });

  it('does not infer mastery from passive navigation or an untyped legacy event count', () => {
    const input = classroom('course_passive', 'Passive workflow only', '2026-07-02T00:00:00Z');
    expect(estimateClassroomMastery(input)).toBeNull();

    const withTwoActiveActions = {
      ...input,
      activeLearningEventCount: 2,
    };
    expect(estimateClassroomMastery(withTwoActiveActions)).toBeNull();
  });

  it('filters by inclusive dates, classroom ids, and searchable domain text', () => {
    const inputs = [
      classroom('course_a', 'TypeScript 类型收窄', '2026-06-30T23:59:59Z'),
      classroom('course_b', 'React 项目实践', '2026-07-15T12:00:00Z'),
      classroom('course_c', '产品战略', '2026-07-31T23:59:59Z'),
    ];
    const selected = filterSynthesisClassrooms(inputs, {
      mode: 'combined',
      timeFrom: '2026-07-01',
      timeTo: '2026-07-31',
      classroomIds: ['course_b', 'course_c'],
      domainQuery: 'React',
    });
    expect(selected.map((item) => item.classroomId)).toEqual(['course_b']);
  });

  it('offers and applies explicit project, source, domain, and Obsidian tag filters', () => {
    const hybrid = classroom('course_hybrid', 'TypeScript 项目', '2026-07-15T12:00:00Z', {
      projectId: `prj_${'4'.repeat(32)}`,
      projectName: 'TypeScript 学习工程',
      sourceBundleId: `src_${'1'.repeat(32)}`,
      researchRunId: `rrn_${'2'.repeat(32)}`,
      obsidianSources: [{ title: '项目索引', tags: ['typescript', '项目'] }],
    });
    const external = classroom('course_external', '量子物理', '2026-07-20T12:00:00Z', {
      researchRunId: `rrn_${'3'.repeat(32)}`,
    });
    const options = buildSynthesisFilterOptions([hybrid, external]);
    expect(options.classrooms.map((item) => item.classroomId)).toEqual([
      'course_external',
      'course_hybrid',
    ]);
    expect(options.projects).toEqual([
      expect.objectContaining({
        projectId: `prj_${'4'.repeat(32)}`,
        projectName: 'TypeScript 学习工程',
        classroomCount: 1,
      }),
    ]);
    expect(options.sourceTypes).toEqual(expect.arrayContaining(['hybrid', 'external']));
    expect(options.topicTags).toEqual(expect.arrayContaining(['typescript', '项目']));

    const selected = filterSynthesisClassrooms([hybrid, external], {
      mode: 'combined',
      projectIds: [`prj_${'4'.repeat(32)}`],
      sourceType: 'hybrid',
      domain: classifyKnowledgeDomain('TypeScript 项目'),
      topicTags: ['typescript'],
    });
    expect(selected.map((item) => item.classroomId)).toEqual(['course_hybrid']);

    const graph = buildKnowledgeGraph([hybrid], 'combined');
    expect(graph.nodes).toContainEqual(
      expect.objectContaining({
        type: 'project',
        projectId: `prj_${'4'.repeat(32)}`,
      }),
    );
    expect(graph.edges).toContainEqual(expect.objectContaining({ type: 'belongs-to' }));
  });

  it('renders an Obsidian-ready summary with a 2D fallback and cited sources', () => {
    const input = classroom('course_a', 'TypeScript 类型收窄', '2026-07-01T00:00:00Z', {
      researchSources: [
        {
          citationId: 'S1',
          title: 'TypeScript Handbook',
          url: 'https://www.typescriptlang.org/docs/handbook/2/narrowing.html',
          domain: 'typescriptlang.org',
          authority: 'primary',
          score: 1,
        },
      ],
    });
    const graph = buildKnowledgeGraph([input], 'timeline');
    const markdown = renderSynthesisMarkdown({
      id: `syn_${'1'.repeat(32)}`,
      title: 'OpenMAIC 知识归纳',
      mode: 'timeline',
      classrooms: [input],
      graph,
      now: new Date('2026-07-21T08:00:00Z'),
    });
    expect(markdown).toContain('关系空间用于解释知识结构、证据、演化和下一步行动');
    expect(markdown).toContain('```mermaid');
    expect(markdown).toContain('[S1] [TypeScript Handbook]');
    expect(markdown).toContain('## 下一轮主动学习');
  });
});
