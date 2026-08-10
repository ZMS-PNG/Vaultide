import { describe, expect, it } from 'vitest';
import type { App, TFile, TFolder } from 'obsidian';
import {
  ensureProjectSourceIds,
  planProjectBatches,
  projectSelectionLimitError,
  projectSelectionMetrics,
  projectSyncLimitError,
  recommendedProjectBatch,
  savedProjectBindings,
  scanProjectFolder,
  type ProjectFileCandidate,
} from '../src/project-folder';

function markdown(path: string, size = 100): TFile {
  return {
    path,
    extension: 'md',
    stat: { size, ctime: 0, mtime: 0 },
  } as TFile;
}

function appWithFiles(files: TFile[]): App {
  return {
    vault: {
      getMarkdownFiles: () => files,
      getFiles: () => files,
    },
  } as unknown as App;
}

describe('project folder selection', () => {
  it('recursively collects Markdown notes inside the selected folder', () => {
    const scan = scanProjectFolder(
      appWithFiles([
        markdown('Projects/Alpha/Overview.md'),
        markdown('Projects/Alpha/Notes/Deep.md'),
        markdown('Projects/Beta/Overview.md'),
      ]),
      { path: 'Projects/Alpha' } as TFolder,
      'Vaultide',
    );

    expect(scan.candidates.map((candidate) => candidate.relativePath)).toEqual([
      'Notes/Deep.md',
      'Overview.md',
    ]);
    expect(scan.excluded).toEqual([]);
  });

  it('excludes managed, hidden, template, and dependency folders', () => {
    const scan = scanProjectFolder(
      appWithFiles([
        markdown('Projects/Alpha.md'),
        markdown('Vaultide/学习记录/Alpha.md'),
        markdown('.private/Secret.md'),
        markdown('Templates/Prompt.md'),
        markdown('模板/课程.md'),
        markdown('Projects/Alpha/node_modules/package/README.md'),
        markdown('Projects/Alpha/bower_components/package/README.md'),
      ]),
      { path: '' } as TFolder,
      'Vaultide',
    );

    expect(scan.candidates.map((candidate) => candidate.relativePath)).toEqual([
      'Projects/Alpha.md',
    ]);
    expect(scan.excluded).toHaveLength(6);
    expect(scan.excluded).toEqual(
      expect.arrayContaining([
        { relativePath: '.private/Secret.md', reason: 'hidden-folder' },
        { relativePath: 'Templates/Prompt.md', reason: 'template-folder' },
        { relativePath: 'Vaultide/学习记录/Alpha.md', reason: 'managed-root' },
        { relativePath: '模板/课程.md', reason: 'template-folder' },
        {
          relativePath: 'Projects/Alpha/node_modules/package/README.md',
          reason: 'dependency-folder',
        },
        {
          relativePath: 'Projects/Alpha/bower_components/package/README.md',
          reason: 'dependency-folder',
        },
      ]),
    );
  });

  it('enforces the server item and source-size limits before upload', () => {
    const candidates = Array.from(
      { length: 51 },
      (_, index) =>
        ({
          file: markdown(`Project/${index}.md`, 100),
          relativePath: `${index}.md`,
          byteSize: 100,
          status: 'new',
        }) satisfies ProjectFileCandidate,
    );
    expect(projectSelectionLimitError(projectSelectionMetrics(candidates))).toContain('50');

    const oversized = [
      {
        file: markdown('Project/Large.md', 8_000_001),
        relativePath: 'Large.md',
        byteSize: 8_000_001,
        status: 'new' as const,
      },
    ];
    expect(projectSelectionLimitError(projectSelectionMetrics(oversized))).toContain('8 MB');
  });

  it('prepares a safe next batch and prioritizes files not uploaded before', () => {
    const candidates = Array.from(
      { length: 55 },
      (_, index) =>
        ({
          file: markdown(`Project/${index}.md`, 100),
          relativePath: `${index}.md`,
          byteSize: 100,
          status: index < 5 ? 'unchanged' : 'new',
        }) satisfies ProjectFileCandidate,
    );
    const batch = recommendedProjectBatch(candidates);
    expect(batch).toHaveLength(50);
    expect(batch.every((candidate) => candidate.status === 'new')).toBe(true);
    expect(projectSelectionLimitError(projectSelectionMetrics(batch))).toBeUndefined();
  });

  it.each([
    [120, [50, 50, 20]],
    [200, [50, 50, 50, 50]],
  ])('automatically plans every one of %i authorized files across safe batches', (count, sizes) => {
    const candidates = Array.from(
      { length: count },
      (_, index) =>
        ({
          file: markdown(`Project/${index}.md`, 100),
          relativePath: `${index}.md`,
          byteSize: 100,
          status: 'new',
        }) satisfies ProjectFileCandidate,
    );
    const batches = planProjectBatches(candidates);
    expect(batches.map((batch) => batch.length)).toEqual(sizes);
    expect(batches.flat()).toHaveLength(count);
    expect(new Set(batches.flat().map((candidate) => candidate.file.path)).size).toBe(count);
    for (const batch of batches) {
      expect(projectSelectionLimitError(projectSelectionMetrics(batch))).toBeUndefined();
    }
    expect(projectSyncLimitError(projectSelectionMetrics(candidates))).toBeUndefined();
  });

  it('keeps unsupported attachments local and reports oversized Markdown explicitly', () => {
    const attachment = markdown('Projects/Alpha/diagram.pdf', 500);
    attachment.extension = 'pdf';
    const scan = scanProjectFolder(
      appWithFiles([
        markdown('Projects/Alpha/Overview.md'),
        markdown('Projects/Alpha/Huge.md', 8_000_001),
        attachment,
      ]),
      { path: 'Projects/Alpha' } as TFolder,
      'Vaultide',
    );

    expect(scan.candidates.map((candidate) => candidate.relativePath)).toEqual(['Overview.md']);
    expect(scan.excluded).toContainEqual({
      relativePath: 'Huge.md',
      reason: 'oversized',
    });
    expect(scan.unsupported).toEqual([{ relativePath: 'diagram.pdf', extension: 'pdf' }]);
  });

  it('marks bound project files as unchanged or modified', () => {
    const unchanged = markdown('Projects/Alpha/Stable.md', 100);
    unchanged.stat.mtime = Date.parse('2026-07-22T00:00:00Z');
    const changed = markdown('Projects/Alpha/Changed.md', 200);
    changed.stat.mtime = Date.parse('2026-07-22T01:00:00Z');
    const scan = scanProjectFolder(
      appWithFiles([unchanged, changed]),
      { path: 'Projects/Alpha' } as TFolder,
      'Vaultide',
      {
        'Projects/Alpha/Stable.md': {
          sourceMtime: '2026-07-22T00:00:00.000Z',
          byteSize: 100,
          contentHash: 'a'.repeat(64),
        },
        'Projects/Alpha/Changed.md': {
          sourceMtime: '2026-07-22T00:00:00.000Z',
          byteSize: 200,
          contentHash: 'b'.repeat(64),
        },
      },
    );

    expect(
      Object.fromEntries(
        scan.candidates.map((candidate) => [candidate.relativePath, candidate.status]),
      ),
    ).toEqual({
      'Changed.md': 'modified',
      'Stable.md': 'unchanged',
    });
  });

  it('loads only valid persisted project bindings', () => {
    const bindings = savedProjectBindings([
      {
        id: `prj_${'a'.repeat(32)}`,
        folderPath: 'Projects/Alpha',
        files: {
          'Projects/Alpha/Overview.md': {
            sourceMtime: '2026-07-22T00:00:00.000Z',
            byteSize: 100,
            contentHash: 'a'.repeat(64),
          },
        },
        projectRevision: 7,
        lastBundleId: `src_${'b'.repeat(32)}`,
        lastManifestId: `prm_${'c'.repeat(32)}`,
        lastManifestHash: 'd'.repeat(64),
        lastSourceCount: 1,
        lastFinalizedAt: '2026-07-22T01:00:00.000Z',
      },
      { id: 'invalid', folderPath: 'Bad', files: {} },
    ]);
    expect(bindings).toHaveLength(1);
    expect(bindings[0]?.sourceIds).toEqual({});
    expect(bindings[0]).toMatchObject({
      projectRevision: 7,
      lastManifestId: `prm_${'c'.repeat(32)}`,
      lastManifestHash: 'd'.repeat(64),
      lastSourceCount: 1,
    });
  });

  it('adds stable source ids without marking files as uploaded', () => {
    const binding = {
      id: `prj_${'a'.repeat(32)}`,
      folderPath: 'Projects/Alpha',
      files: {},
      sourceIds: {
        'Projects/Alpha/Stable.md': `sou_${'b'.repeat(32)}`,
      },
    };
    const generated = [`sou_${'c'.repeat(32)}`];
    const prepared = ensureProjectSourceIds(
      binding,
      ['Projects/Alpha/Stable.md', 'Projects/Alpha/New.md'],
      () => generated.shift() ?? '',
    );

    expect(prepared.sourceIds).toEqual({
      'Projects/Alpha/Stable.md': `sou_${'b'.repeat(32)}`,
      'Projects/Alpha/New.md': `sou_${'c'.repeat(32)}`,
    });
    expect(prepared.files).toEqual({});
  });
});
