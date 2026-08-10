import { describe, expect, it } from 'vitest';

import {
  normalizeSceneOutlineContract,
  normalizeSceneOutlineListContract,
  SceneOutlineContractError,
} from '@/lib/generation/scene-outline-contract';

describe('scene outline contract', () => {
  it('normalizes malformed key points to a safe empty list without inventing claims', () => {
    const outline = normalizeSceneOutlineContract({
      id: 'scene-1',
      type: 'slide',
      title: 'Durable generation',
      description: 'Explain why a persisted step has an owner and lease.',
      keyPoints: undefined,
      order: 1,
    });

    expect(outline.keyPoints).toEqual([]);
    expect(() => outline.keyPoints.join('\n')).not.toThrow();
  });

  it('rejects missing identity instead of allowing an untraceable scene downstream', () => {
    expect(() =>
      normalizeSceneOutlineContract({
        type: 'slide',
        title: 'Untitled',
        description: '',
        keyPoints: [],
        order: 1,
      }),
    ).toThrow(SceneOutlineContractError);
  });

  it('rejects duplicate order or id before content/action generation starts', () => {
    expect(() =>
      normalizeSceneOutlineListContract([
        {
          id: 'scene-1',
          type: 'slide',
          title: 'One',
          description: '',
          keyPoints: [],
          order: 1,
        },
        {
          id: 'scene-1',
          type: 'quiz',
          title: 'Two',
          description: '',
          keyPoints: [],
          order: 1,
        },
      ]),
    ).toThrow(/unique/i);
  });
});
