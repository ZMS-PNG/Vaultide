import { describe, expect, test } from 'vitest';

import { assessGeneratedSceneContent } from '@/lib/generation/course-quality';
import {
  ensureInteractiveLearningShell,
  postProcessInteractiveHtml,
} from '@/lib/generation/interactive-post-processor';
import type { SceneOutline } from '@/lib/types/generation';
import type { WidgetType } from '@/lib/types/widgets';

const outline: SceneOutline = {
  id: 'interactive-data-flow',
  order: 3,
  type: 'interactive',
  title: '交互式架构图：数据流动路径',
  description: '观察移动端数据如何经过云端接口、数据库、AI 分析并形成无人机与天气告警。',
  keyPoints: ['移动端到云端的数据契约', '数据库与 AI 分析的状态变化', '无人机与天气告警的失败条件'],
  widgetType: 'diagram',
  widgetOutline: {
    concept: '端到端数据流',
    diagramType: 'flowchart',
  },
};

const minimalWorkingDiagram = `<!doctype html>
<html>
  <head><title>diagram</title></head>
  <body>
    <button id="previous">上一步</button>
    <button id="next">下一步</button>
    <div id="feedback" role="status">结果：等待操作</div>
    <svg><g id="node-client" data-node="client"><text>移动端</text></g></svg>
    <script>
      document.getElementById('previous').addEventListener('click', function () {});
      document.getElementById('next').addEventListener('click', function () {});
    </script>
  </body>
</html>`;

describe('interactive learning shell', () => {
  test('adds learner-visible guidance, feedback, and a working replay control', () => {
    const html = ensureInteractiveLearningShell(minimalWorkingDiagram, {
      title: outline.title,
      description: outline.description,
      keyPoints: outline.keyPoints,
    });

    expect(html).toContain('data-vaultide-learning-shell="true"');
    expect(html).toContain('role="status"');
    expect(html).toContain('重置并重放');
    expect(html).toContain('window.location.reload()');
    expect(html).toContain('移动端到云端的数据契约');
  });

  test('is idempotent', () => {
    const once = ensureInteractiveLearningShell(minimalWorkingDiagram, {
      title: outline.title,
      keyPoints: outline.keyPoints,
    });
    const twice = ensureInteractiveLearningShell(once, {
      title: outline.title,
      keyPoints: outline.keyPoints,
    });

    expect(twice).toBe(once);
  });

  test('brings a functional but under-explained diagram across the quality contract', () => {
    const html = ensureInteractiveLearningShell(postProcessInteractiveHtml(minimalWorkingDiagram), {
      title: outline.title,
      description: outline.description,
      keyPoints: outline.keyPoints,
    });
    const assessment = assessGeneratedSceneContent(outline, {
      html,
      widgetType: 'diagram',
    });

    expect(assessment.metrics?.visibleTextChars).toBeGreaterThanOrEqual(240);
    expect(assessment.metrics?.hasFeedback).toBe(true);
    expect(assessment.metrics?.hasReset).toBe(true);
    expect(Number(assessment.metrics?.htmlChars)).toBeLessThan(12_000);
    expect(assessment.issues.map((entry) => entry.code)).not.toContain('scene_interactive_depth');
    expect(assessment.issues.map((entry) => entry.code)).not.toContain(
      'scene_interactive_feedback',
    );
    expect(assessment.passed).toBe(true);
  });

  test.each<WidgetType>(['diagram', 'simulation', 'code', 'game', 'visualization3d'])(
    'applies the same learner-visible contract to %s widgets',
    (widgetType) => {
      const typedOutline = {
        ...outline,
        widgetType,
      };
      const html = ensureInteractiveLearningShell(
        postProcessInteractiveHtml(minimalWorkingDiagram),
        {
          title: typedOutline.title,
          description: typedOutline.description,
          keyPoints: typedOutline.keyPoints,
        },
      );
      const assessment = assessGeneratedSceneContent(typedOutline, {
        html,
        widgetType,
      });

      expect(html).toContain('data-vaultide-learning-shell="true"');
      expect(assessment.metrics?.hasFeedback).toBe(true);
      expect(assessment.metrics?.hasReset).toBe(true);
      expect(assessment.passed).toBe(true);
    },
  );
});
