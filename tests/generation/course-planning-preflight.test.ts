import { describe, expect, it } from 'vitest';
import { assessCoursePlanningPreflight } from '@/lib/generation/planning/preflight';

const DEEP_PROJECT_SOURCE = `
# 项目架构与数据流

系统由客户端、API、领域服务、持久化仓储和异步任务组成。请求先经过身份与输入校验，
再进入应用服务；应用服务在事务中记录状态与审计事件，异步任务通过幂等键和租约恢复。
失败不会发布半成品，只有内容、交互和整课质量闸门全部通过后才建立正式课堂版本。

## 状态约束

任务从 queued 进入 running，再进入 verifying；只有验证通过才进入 ready。每个步骤保存输入哈希、
尝试次数、租约与错误分类，因此刷新页面或网络中断后可以从最后一个稳定检查点继续。

## 验收证据

验收需要证明来源可追溯、场景数完整、最后一页包含迁移任务与可观察产物，并验证学习记录能够回写。
`.repeat(35);

describe('course planning preflight', () => {
  it('blocks before model invocation when a reviewed project context was lost', () => {
    const result = assessCoursePlanningPreflight({
      requirements: { requirement: '理解项目架构并完成迁移练习' },
      documentText: '残缺资料',
      sourceContextExpectedChars: 39_000,
    });

    expect(result.ready).toBe(false);
    expect(result.issues.map((entry) => entry.code)).toContain('SOURCE_CONTEXT_LOST');
  });

  it('blocks a latest-information course when required external evidence is unavailable', () => {
    const result = assessCoursePlanningPreflight({
      requirements: {
        requirement: '基于最新论文理解代码代理的验证机制',
        externalEvidenceMode: 'required',
        externalEvidenceStatus: 'unavailable',
      },
      documentText: DEEP_PROJECT_SOURCE,
    });

    expect(result.ready).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'EXTERNAL_EVIDENCE_UNAVAILABLE',
          severity: 'blocker',
        }),
      ]),
    );
  });

  it('allows a deep internal course when optional external supplementation is unavailable', () => {
    const result = assessCoursePlanningPreflight({
      requirements: {
        requirement: '理解当前项目的架构边界并形成决策清单',
        externalEvidenceMode: 'supplemental',
        externalEvidenceStatus: 'unavailable',
      },
      documentText: DEEP_PROJECT_SOURCE,
      sourceContextExpectedChars: DEEP_PROJECT_SOURCE.length,
    });

    expect(result.ready).toBe(true);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'EXTERNAL_EVIDENCE_UNAVAILABLE',
          severity: 'warning',
        }),
      ]),
    );
  });

  it('rejects shallow material with an actionable recovery instruction', () => {
    const result = assessCoursePlanningPreflight({
      requirements: { requirement: '学习这个项目' },
      documentText: 'README: demo',
    });

    expect(result.ready).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'SOURCE_MATERIAL_TOO_SHALLOW',
          recovery: expect.stringContaining('补充'),
        }),
      ]),
    );
  });
});
