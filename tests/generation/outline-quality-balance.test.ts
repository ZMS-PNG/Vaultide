import { describe, expect, it } from 'vitest';
import { normalizeQualityFirstOutlines } from '@/lib/generation/outline-generator';
import type { SceneOutline } from '@/lib/types/generation';

function outline(order: number, type: SceneOutline['type'], title: string): SceneOutline {
  return {
    id: `scene-${order}`,
    order,
    type,
    title,
    description: `${title} description`,
    keyPoints: ['one', 'two', 'three'],
    ...(type === 'interactive'
      ? {
          widgetType: 'simulation' as const,
          widgetOutline: { concept: title, keyVariables: ['x'] },
        }
      : {}),
  };
}

describe('normalizeQualityFirstOutlines', () => {
  it('turns a 70%-interactive technical course into a balanced learning sequence', () => {
    const result = normalizeQualityFirstOutlines([
      outline(1, 'slide', 'Introduction'),
      outline(2, 'interactive', 'Architecture'),
      outline(3, 'interactive', 'Data flow'),
      outline(4, 'interactive', 'Concurrency simulation'),
      outline(5, 'slide', 'Worked example'),
      outline(6, 'interactive', 'Pipeline'),
      outline(7, 'interactive', 'Code practice'),
      outline(8, 'interactive', 'Security challenge'),
      outline(9, 'interactive', 'Risk review'),
      outline(10, 'slide', 'Summary'),
    ]);

    expect(result).toHaveLength(10);
    expect(result[0].type).toBe('slide');
    expect(result[9].type).toBe('slide');
    expect(result.filter((item) => item.type === 'interactive').length).toBeLessThanOrEqual(4);
    expect(result.filter((item) => item.type === 'slide').length).toBeGreaterThanOrEqual(5);
    expect(result.some((item) => item.type === 'quiz')).toBe(true);

    let streak = 0;
    for (const item of result) {
      streak = item.type === 'interactive' ? streak + 1 : 0;
      expect(streak).toBeLessThanOrEqual(2);
    }
  });

  it('removes widget-only fields when an excess interaction becomes a slide', () => {
    const result = normalizeQualityFirstOutlines(
      Array.from({ length: 8 }, (_, index) =>
        outline(index + 1, index === 0 || index === 7 ? 'slide' : 'interactive', `Topic ${index}`),
      ),
    );
    const converted = result.find(
      (item) => item.type === 'slide' && item.id !== 'scene-1' && item.id !== 'scene-8',
    );

    expect(converted).toBeDefined();
    expect(converted?.widgetType).toBeUndefined();
    expect(converted?.widgetOutline).toBeUndefined();
  });
});
