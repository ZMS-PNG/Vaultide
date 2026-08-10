import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('classroom learning UI state contract', () => {
  it('never turns manual scene browsing into sprint completion', () => {
    const panel = source('components/learning/classroom-completion-panel.tsx');

    expect(panel).not.toContain("eventType: 'sprintCompleted'");
    expect(panel).toContain('complete: learningAction.learningVerified');
    expect(panel).toContain('已浏览场景');
    expect(panel).toContain('这不会增加掌握度');
  });

  it('uses the generated-course endpoint as a publication checkpoint, not a trophy screen', () => {
    const completionPage = source('components/scene-renderers/classroom-complete.tsx');

    expect(completionPage).toContain('课程内容已准备');
    expect(completionPage).toContain('不代表你已经学会');
    expect(completionPage).not.toContain('Trophy');
    expect(completionPage).not.toContain('Confetti');
  });

  it('keeps formal synthesis and deposition locked until verification', () => {
    const driver = source('components/learning/classroom-learning-driver.tsx');
    const projectPanel = source('components/learning/project-learning-panel.tsx');

    expect(driver).toContain('disabled={!learningVerified}');
    expect(driver).toContain('归纳未解锁');
    expect(driver).toContain('沉淀未解锁');
    expect(projectPanel).toContain('完成最终迁移检验后');
    expect(projectPanel).toContain('disabled={approving || !learningVerified}');
  });

  it('supports review deep links and a non-project rumination surface', () => {
    const projectPanel = source('components/learning/project-learning-panel.tsx');

    expect(projectPanel).toContain("get('reviewItemId')");
    expect(projectPanel).toContain('setOpen(true)');
    expect(projectPanel).toContain("validProjectId ? '项目学习' : '反刍与复习'");
    expect(projectPanel).toContain('review.classroomId === classroomId');
  });
});
