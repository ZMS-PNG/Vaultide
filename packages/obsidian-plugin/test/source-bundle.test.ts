import { describe, expect, it } from 'vitest';
import { canonicalSourceManifest, validateSourceBundle } from '@openmaic/learning-protocol';
import {
  buildProjectSourceReferences,
  buildSourceArchive,
  buildSourceBundleFromNotes,
  sha256Hex,
} from '../src/source-bundle';

const identity = {
  ownerId: 'own_019f830000007000800000000001',
  deviceId: 'dev_019f830000007000800000000001',
  vaultBindingId: 'vlt_019f830000007000800000000001',
};

describe('active-note SourceBundle probe', () => {
  it('builds and validates one explicitly selected Markdown note', async () => {
    const bundle = await buildSourceBundleFromNotes({
      identity,
      selectionReason: 'Explicit test selection',
      retentionDays: 30,
      now: new Date('2026-07-21T00:00:00Z'),
      notes: [
        {
          relativePath: 'Projects/OpenMAIC.md',
          title: 'OpenMAIC',
          content: '# Goal\nLearn through a real project.',
          sourceMtime: '2026-07-20T23:00:00Z',
          sourceId: `sou_${'1'.repeat(32)}`,
          headings: [{ level: 1, text: 'Goal', line: 0 }],
          tags: ['learning'],
        },
      ],
    });
    expect(validateSourceBundle(bundle)).toEqual({ valid: true });
    expect(bundle.itemCount).toBe(1);
    expect(bundle.snapshots[0]?.origin).toBe('obsidian');
    expect(bundle.snapshots[0]?.contentHash).toBe(
      await sha256Hex('# Goal\nLearn through a real project.'),
    );
    if (bundle.snapshots[0]?.origin !== 'obsidian') throw new Error('expected Obsidian source');
    expect(bundle.snapshots[0].locator.sourceId).toBe(`sou_${'1'.repeat(32)}`);
    expect(bundle.retentionUntil).toBe('2026-08-20T00:00:00.000Z');
    expect(await sha256Hex(canonicalSourceManifest(bundle))).toBe(bundle.manifestHash);

    const transported = JSON.parse(JSON.stringify(bundle)) as typeof bundle;
    expect(await sha256Hex(canonicalSourceManifest(transported))).toBe(bundle.manifestHash);
  });

  it('fails closed for an unsafe Vault path', async () => {
    await expect(
      buildSourceBundleFromNotes({
        identity,
        selectionReason: 'Explicit test selection',
        retentionDays: 30,
        notes: [
          {
            relativePath: '../Secrets.md',
            title: 'Secrets',
            content: 'do not upload',
            sourceMtime: '2026-07-20T23:00:00Z',
          },
        ],
      }),
    ).rejects.toThrow('/snapshots/0/locator/relativePath');
  });

  it('requires a bounded retention policy', async () => {
    await expect(
      buildSourceBundleFromNotes({
        identity,
        selectionReason: 'Explicit test selection',
        retentionDays: 0,
        notes: [
          {
            relativePath: 'Projects/OpenMAIC.md',
            title: 'OpenMAIC',
            content: 'content',
            sourceMtime: '2026-07-20T23:00:00Z',
          },
        ],
      }),
    ).rejects.toThrow('Retention');
  });

  it('packages a project folder as one multi-note archive', async () => {
    const notes = [
      {
        relativePath: 'Projects/Alpha/Overview.md',
        title: 'Overview',
        content: '# Alpha\nProject overview.',
        sourceMtime: '2026-07-20T23:00:00Z',
      },
      {
        relativePath: 'Projects/Alpha/Notes/Architecture.md',
        title: 'Architecture',
        content: '# Architecture\nSystem structure.',
        sourceMtime: '2026-07-20T23:05:00Z',
      },
    ];
    const bundle = await buildSourceBundleFromNotes({
      identity,
      selectionReason: 'Project folder explicitly selected',
      retentionDays: 30,
      notes,
    });
    const archive = buildSourceArchive(bundle, notes);

    expect(bundle.itemCount).toBe(2);
    expect(bundle.byteSize).toBeGreaterThan(0);
    expect(archive.contents).toHaveLength(2);
    expect(archive.contents.map((content) => content.utf8Content)).toEqual(
      notes.map((note) => note.content),
    );
    expect(
      buildProjectSourceReferences(bundle, {
        'Projects/Alpha/Overview.md': `sou_${'a'.repeat(32)}`,
        'Projects/Alpha/Notes/Architecture.md': `sou_${'b'.repeat(32)}`,
      }),
    ).toEqual([
      { snapshotId: bundle.snapshots[0]?.id, sourceId: `sou_${'a'.repeat(32)}` },
      { snapshotId: bundle.snapshots[1]?.id, sourceId: `sou_${'b'.repeat(32)}` },
    ]);
  });
});
