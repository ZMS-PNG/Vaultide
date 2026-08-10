import { describe, expect, test, vi } from 'vitest';

import { assessGeneratedSceneContent } from '@/lib/generation/course-quality';
import { generateWidgetContent } from '@/lib/generation/scene-generator';
import type { AICallFn } from '@/lib/generation/pipeline-types';
import type { GeneratedInteractiveContent, SceneOutline } from '@/lib/types/generation';

async function renderDiagram(widgetOutline: SceneOutline['widgetOutline']) {
  const aiCall = vi.fn(async () => 'the deterministic diagram must not call the model') as AICallFn;
  const outline: SceneOutline = {
    id: 'diagram-scene',
    type: 'interactive',
    title: '系统状态与数据流',
    description:
      '沿着输入、状态转换、验证结果与失败边界追踪系统机制，并用可观察证据判断连接是否成立。',
    keyPoints: [
      '输入契约决定允许进入系统的数据',
      '状态转换必须保留可验证结果',
      '失败边界用于定位第一个失效连接',
    ],
    order: 1,
    widgetType: 'diagram',
    widgetOutline,
  };

  const content = (await generateWidgetContent(
    outline,
    aiCall,
    '请使用简体中文',
  )) as GeneratedInteractiveContent;
  return { aiCall, content, outline };
}

describe('deterministic diagram first-pass contract', () => {
  test('preserves prescribed nodes, hierarchy, and requested maximum without a model call', async () => {
    const { aiCall, content } = await renderDiagram({
      diagramType: 'hierarchy',
      nodeCount: 3,
      nodes: [
        { id: 'root', label: '输入契约', details: '定义可接受输入和拒绝条件。' },
        { id: 'branch', label: '状态转换', parentId: 'root', details: '根据契约改变系统状态。' },
      ],
    });

    expect(aiCall).not.toHaveBeenCalled();
    expect(content.widgetConfig).toMatchObject({
      type: 'diagram',
      diagramType: 'hierarchy',
    });
    const config = content.widgetConfig as {
      nodes: Array<{ id: string; label: string }>;
      edges: Array<{ from: string; to: string }>;
    };
    expect(config.nodes).toHaveLength(2);
    expect(config.nodes.map((node) => node.id)).toEqual(['root', 'branch']);
    expect(config.edges).toContainEqual(expect.objectContaining({ from: 'root', to: 'branch' }));
  });

  test('builds a complete feedback, replay, and verification experience that passes quality', async () => {
    const { aiCall, content, outline } = await renderDiagram({
      diagramType: 'flowchart',
      nodeCount: 4,
    });
    const assessment = assessGeneratedSceneContent(outline, content);

    expect(aiCall).not.toHaveBeenCalled();
    expect(content.html).toContain('role="status"');
    expect(content.html).toContain('id="diagram-compare"');
    expect(content.html).toContain('id="diagram-verify"');
    expect(content.html).toContain('id="vaultide-learning-reset"');
    expect(content.html).toContain('addEventListener');
    expect(assessment.passed).toBe(true);
    expect(assessment.score).toBeGreaterThanOrEqual(90);
  });

  test('derives nodes from approved key points when no node constraints are provided', async () => {
    const { content } = await renderDiagram({ diagramType: 'system' });
    const config = content.widgetConfig as { nodes: Array<{ label: string }> };

    expect(config.nodes.length).toBeGreaterThanOrEqual(3);
    expect(config.nodes.map((node) => node.label).join(' ')).toContain('输入契约');
    expect(content.html).not.toContain('{{');
  });
});
