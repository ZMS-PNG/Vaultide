import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  learningProjectDraftStorageKey,
  readLearningProjectDraft,
  writeLearningProjectDraft,
} from '@/lib/learning/client/learning-project-draft';
import {
  createLearningProjectBrief,
  updateLearningProjectBrief,
} from '@/lib/learning/domain/learning-project-plan';

describe('learning project draft isolation', () => {
  const values = new Map<string, string>();

  beforeEach(() => {
    values.clear();
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
      },
    });
  });

  it('keeps goals isolated between Obsidian projects while preserving the global draft', () => {
    const global = updateLearningProjectBrief(createLearningProjectBrief('lp_global'), {
      goal: 'Global learning goal',
    });
    const projectA = updateLearningProjectBrief(createLearningProjectBrief('lp_a'), {
      goal: 'Learn project A',
      sourceMode: 'obsidian',
    });
    const projectB = updateLearningProjectBrief(createLearningProjectBrief('lp_b'), {
      goal: 'Learn project B',
      sourceMode: 'obsidian',
    });

    writeLearningProjectDraft(global);
    writeLearningProjectDraft(projectA, 'prj/a');
    writeLearningProjectDraft(projectB, 'prj/b');

    expect(readLearningProjectDraft()?.goal).toBe('Global learning goal');
    expect(readLearningProjectDraft('prj/a')?.goal).toBe('Learn project A');
    expect(readLearningProjectDraft('prj/b')?.goal).toBe('Learn project B');
    expect(readLearningProjectDraft('prj/c')).toBeNull();
    expect(learningProjectDraftStorageKey('prj/a')).not.toBe(
      learningProjectDraftStorageKey('prj/b'),
    );
  });
});
