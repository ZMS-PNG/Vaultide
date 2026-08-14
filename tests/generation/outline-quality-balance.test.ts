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
  it('keeps a hands-on, interactive-first course interactive', () => {
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
    // Interactive scenes are no longer flattened to slides.
    expect(result.filter((item) => item.type === 'interactive')).toHaveLength(6);
    // A recall quiz is still injected when the model produced none.
    expect(result.some((item) => item.type === 'quiz')).toBe(true);
  });

  it('removes widget-only fields when an opening or closing interactive scene becomes a slide', () => {
    const result = normalizeQualityFirstOutlines([
      outline(1, 'interactive', 'Opening simulation'),
      outline(2, 'slide', 'Context'),
      outline(3, 'slide', 'Mechanism'),
      outline(4, 'slide', 'Worked example'),
      outline(5, 'slide', 'Limitations'),
      outline(6, 'interactive', 'Closing simulation'),
    ]);

    expect(result[0].type).toBe('slide');
    expect(result[0].widgetType).toBeUndefined();
    expect(result[0].widgetOutline).toBeUndefined();
    expect(result[5].type).toBe('slide');
    expect(result[5].widgetType).toBeUndefined();
    expect(result[5].widgetOutline).toBeUndefined();
  });
});
