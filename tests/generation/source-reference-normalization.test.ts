import { describe, expect, it } from 'vitest';
import { normalizeCourseSourceReferences } from '@/lib/generation/planning/source-reference-normalization';

describe('normalizeCourseSourceReferences', () => {
  it('collapses multiple chunks from one Obsidian source version', () => {
    const result = normalizeCourseSourceReferences([
      {
        kind: 'obsidian-source',
        id: 'sou_same',
        versionId: 'svr_same',
        locator: 'Project/notes.md',
        contentHash: 'hash',
        authority: 'private-original',
        included: true,
      },
      {
        kind: 'obsidian-source',
        id: 'sou_same',
        versionId: 'svr_same',
        locator: 'Project/notes.md',
        contentHash: 'hash',
        authority: 'private-original',
        included: true,
      },
    ]);

    expect(result).toEqual([
      expect.objectContaining({
        id: 'sou_same',
        versionId: 'svr_same',
        included: true,
      }),
    ]);
  });

  it('keeps order while merging inclusion and source authority', () => {
    const result = normalizeCourseSourceReferences([
      {
        kind: 'public-source',
        id: 'source-a',
        locator: 'https://example.com/a',
        authority: 'general',
        included: false,
      },
      {
        kind: 'public-source',
        id: 'source-b',
        authority: 'authoritative',
        included: true,
      },
      {
        kind: 'public-source',
        id: 'source-a',
        authority: 'primary',
        included: true,
      },
    ]);

    expect(result.map((reference) => reference.id)).toEqual(['source-a', 'source-b']);
    expect(result[0]).toMatchObject({ authority: 'primary', included: true });
  });
});
