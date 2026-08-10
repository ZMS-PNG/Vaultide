import { describe, expect, it } from 'vitest'

import { buildSemanticV3PlanRun, buildV3PlanRun } from '@/lib/generation/planning/v3-plan-run'
import { createLearningContract } from '@/lib/learning/domain/v3/learning-contract'

describe('V3 plan run', () => {
  it('does not need a language-model response to create a complete, auditable outline', () => {
    const result = buildV3PlanRun({
      requirements: {
        requirement: 'Learn the source-backed workflow and prepare a safe implementation decision.',
        learningContract: createLearningContract({
          projectId: 'project-1',
          sourceMode: 'obsidian',
          objectType: 'knowledge-project',
          goal: 'Learn the source-backed workflow and prepare a safe implementation decision.',
          now: new Date('2026-08-02T00:00:00.000Z'),
        }),
      },
      sourceContext: [
        '# Workflow',
        'Each durable job step is leased, persisted, and quality checked before the next step begins.',
        '',
        '# Release',
        'A classroom is published only after every scene has a durable result and an auditable evidence trail.',
      ].join('\n'),
    })

    expect(result.outlines.length).toBeGreaterThanOrEqual(9)
    expect(result.outlines.length).toBeLessThanOrEqual(12)
    expect(result.outlines.at(-1)?.activity?.artifactRequired).toBe(true)
    expect(result.outlines.every((outline) => outline.description.includes('[S'))).toBe(true)
    expect(result.courseTitle).toContain('Learn the source-backed workflow')
  })

  it('keeps a semantic teaching arc while deterministically binding it to V3 evidence and transfer rules', () => {
    const contract = createLearningContract({
      projectId: 'project-semantic-v3',
      sourceMode: 'external',
      objectType: 'repository',
      goal: '学习文档转换服务的接入决策、扩展方式、安全边界与验收方法。',
      now: new Date('2026-08-02T00:00:00.000Z'),
    })
    const semanticOutlines = [
      ['先导诊断：转换服务要解决什么', '区分纯文本抽取与保留结构的 Markdown 转换，并写下你当前的选型假设。', '输入格式决定转换策略与质量边界', '选型前先定义可验证的输出结构'],
      ['项目全景：转换器位于哪里', '从调用入口、格式识别到 Markdown 输出建立系统地图。', '入口负责隔离输入与调用边界', '输出应保留对学习有意义的结构'],
      ['转换链路：从文件到 Markdown', '追踪文件输入、解析器、结构化中间过程和最终渲染之间的因果链。', '每一步都有可观测的输入与输出', '错误必须在边界处被记录和分类'],
      ['格式支持如何影响接入范围', '比较文档、表格、演示稿和扫描件的转换差异。', '格式覆盖不等于结构保真', '复杂表格与 OCR 是高风险样本'],
      ['扩展接口：插件如何进入主链路', '分析扩展点的注册条件、依赖关系和回退策略。', '扩展必须有明确的输入输出契约', '插件失败不能破坏主转换链路'],
      ['受控部署：输入安全与权限边界', '用受控目录和最小权限设计服务调用边界。', '不可信输入需要消毒与隔离', '运行进程只应获得必要资源'],
      ['案例演练：设计一次转换验收', '选择一个样本文档并定义结构比对、失败记录和人工抽查。', '验收样本应覆盖正常与异常输入', '结果需要能回溯到转换步骤'],
      ['主动回忆：发现薄弱的判断环节', '不看资料复述转换链路并解释一个风险控制点。', '能解释为什么而不只记住接口', '错误答案需要定位到机制或边界'],
      ['迁移交付：形成接入决策记录', '为新的业务文档转换需求形成可执行的接入决策和验收方案。', '交付物包含架构路径与首个执行步骤', '完成标准是可复核的转换证据'],
    ].map(([title, description, first, second], index) => ({
      id: `semantic_${index + 1}`,
      type: 'slide' as const,
      title,
      description,
      keyPoints: [first, second, '将本场结论连接到下一步决策和可验证结果'],
      order: index + 1,
    }))

    const result = buildSemanticV3PlanRun({
      requirements: { requirement: contract.goal, learningContract: contract },
      sourceContext: [
        '# Conversion mechanism',
        'The service accepts a constrained file input, selects a parser, preserves meaningful structure, and emits Markdown for downstream review.',
        '',
        '# Deployment boundary',
        'The service sanitizes untrusted input, restricts process access, records conversion failures, and compares representative outputs before release.',
      ].join('\n'),
      semanticOutlines,
      courseTitle: '文档转换服务接入决策',
      languageDirective: '使用中文授课，并保留来源标签。',
    })

    expect(result.outlines).toHaveLength(9)
    expect(result.outlines[2]?.title).toBe('转换链路：从文件到 Markdown')
    expect(result.outlines.every((outline) => outline.description.includes('[S'))).toBe(true)
    expect(result.outlines.at(-1)?.activity).toMatchObject({
      kind: 'synthesis-transfer',
      artifactRequired: true,
      artifact: {
        artifactType: 'implementation-plan',
        requiredSections: ['Problem framing', 'Architecture or workflow', 'First executable step'],
      },
    })
  })

  it('retains a mostly useful semantic arc and repairs only sparse scene seeds with the V3 baseline', () => {
    const contract = createLearningContract({
      projectId: 'project-partial-semantic-v3',
      sourceMode: 'external',
      objectType: 'repository',
      goal: 'Learn a source-backed repository workflow and produce a safe implementation decision.',
      now: new Date('2026-08-02T00:00:00.000Z'),
    })
    const semanticOutlines = Array.from({ length: 9 }, (_, index) => ({
      id: `partial_${index + 1}`,
      type: 'slide' as const,
      title: `Repository decision ${index + 1}`,
      description:
        index < 3
          ? 'brief'
          : `Connect the repository mechanism ${index + 1} to an observable integration decision.`,
      keyPoints:
        index < 3
          ? ['brief']
          : [`Inspect source-backed mechanism ${index + 1}`, 'Compare an operating boundary'],
      order: index + 1,
    }))

    const result = buildSemanticV3PlanRun({
      requirements: { requirement: contract.goal, learningContract: contract },
      sourceContext:
        '# Repository evidence\nThe source defines an input boundary, a durable workflow, and an observable release check.',
      semanticOutlines,
    })

    expect(result.outlines).toHaveLength(9)
    expect(result.outlines[0]?.description).toContain('[S1]')
    expect(result.outlines[3]?.title).toBe('Repository decision 4')
  })
})
