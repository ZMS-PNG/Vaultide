import { describe, expect, it } from 'vitest';

import { stabilizeGeneratedSceneActions } from '@/lib/generation/action-quality-convergence';
import type { Action, SpeechAction } from '@/lib/types/action';
import type {
  GeneratedInteractiveContent,
  GeneratedPBLContent,
  GeneratedSlideContent,
  SceneOutline,
} from '@/lib/types/generation';

function outline(type: SceneOutline['type']): SceneOutline {
  return {
    id: `scene-${type}`,
    order: 3,
    type,
    title: '端到端数据流',
    description: '理解移动端数据经过云端、数据库和分析模块后形成可验证结果的机制。',
    keyPoints: ['输入与数据契约', '状态变化与处理机制', '失败条件与验收证据'],
    ...(type === 'interactive'
      ? {
          widgetType: 'diagram' as const,
          widgetOutline: { concept: '数据流', diagramType: 'flowchart' as const },
        }
      : {}),
    ...(type === 'pbl'
      ? {
          pblConfig: {
            projectTopic: '数据流验证',
            projectDescription: '验证端到端数据链路',
            targetSkills: ['诊断', '验证'],
          },
        }
      : {}),
  };
}

function assertTeachingContract(actions: Action[]) {
  const speeches = actions.filter((action): action is SpeechAction => action.type === 'speech');
  const speechText = speeches.map((action) => action.text).join(' ');
  expect(actions.length).toBeGreaterThanOrEqual(5);
  expect(speeches.length).toBeGreaterThanOrEqual(3);
  expect(speechText.length).toBeGreaterThanOrEqual(180);
  expect(speechText).toMatch(/请|观察|比较|解释|验证/);
  expect(new Set(actions.map((action) => action.type)).size).toBeGreaterThanOrEqual(2);
}

describe('stabilizeGeneratedSceneActions', () => {
  it('converges a sparse slide action sequence without another model call', () => {
    const currentOutline = outline('slide');
    const content = {
      elements: [
        {
          id: 'title-1',
          type: 'text',
          left: 20,
          top: 20,
          width: 900,
          height: 70,
          content: '<p>端到端数据流</p>',
        },
      ],
    } as GeneratedSlideContent;

    const actions = stabilizeGeneratedSceneActions(currentOutline, content, [], '中文');

    assertTeachingContract(actions);
    expect(actions.some((action) => action.type === 'spotlight')).toBe(true);
  });

  it('converges interactive narration and targets the stable learning status', () => {
    const currentOutline = outline('interactive');
    const content = {
      html: '<html><body><div id="vaultide-learning-status"></div></body></html>',
      widgetType: 'diagram',
    } as GeneratedInteractiveContent;

    const actions = stabilizeGeneratedSceneActions(currentOutline, content, [], '中文');

    assertTeachingContract(actions);
    expect(
      actions.some(
        (action) =>
          action.type === 'widget_highlight' && action.target === '#vaultide-learning-status',
      ),
    ).toBe(true);
  });

  it('ends a PBL sequence with a reviewable learner discussion', () => {
    const currentOutline = outline('pbl');
    const content = {
      projectConfig: { title: '数据流验证' },
    } as unknown as GeneratedPBLContent;

    const actions = stabilizeGeneratedSceneActions(currentOutline, content, [], '中文');

    assertTeachingContract(actions);
    const finalAction = actions.at(-1);
    expect(finalAction?.type).toBe('discussion');
    expect(finalAction?.type === 'discussion' ? finalAction.prompt : '').toContain(
      '可观察结果',
    );
  });

  it('preserves an already compliant action sequence byte-for-byte', () => {
    const currentOutline = outline('slide');
    const actions: Action[] = [
      {
        id: 'focus',
        type: 'spotlight',
        elementId: 'title-1',
      },
      ...Array.from({ length: 4 }, (_, index) => ({
        id: `speech-${index}`,
        type: 'speech' as const,
        text: `请观察、比较、解释并验证第 ${index + 1} 个状态变化，因为机制与约束共同决定可观察结果。这里补充足够的教学解释和判断依据。`,
      })),
    ];
    const content = {
      elements: [{ id: 'title-1', type: 'text' }],
    } as unknown as GeneratedSlideContent;

    expect(stabilizeGeneratedSceneActions(currentOutline, content, actions, '中文')).toEqual(
      actions,
    );
  });
});
