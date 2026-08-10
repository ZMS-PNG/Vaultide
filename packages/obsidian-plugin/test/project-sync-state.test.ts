import { describe, expect, it } from 'vitest';
import type { TFile } from 'obsidian';
import type { ProjectBinding, ProjectFileCandidate } from '../src/project-folder';
import {
  commitFinalizedProjectBinding,
  createProjectSyncStagingState,
  sourceIdsForProjectFinalization,
  stageValidatedProjectBatch,
} from '../src/project-sync-state';

const PROJECT_ID = `prj_${'a'.repeat(32)}`;
const SOURCE_A = `sou_${'a'.repeat(32)}`;
const SOURCE_B = `sou_${'b'.repeat(32)}`;
const SOURCE_C = `sou_${'c'.repeat(32)}`;
const SOURCE_DELETED = `sou_${'d'.repeat(32)}`;

function candidate(path: string, status: ProjectFileCandidate['status']): ProjectFileCandidate {
  return {
    file: { path, extension: 'md', stat: { size: 100, ctime: 0, mtime: 0 } } as TFile,
    relativePath: path.replace('Projects/Alpha/', ''),
    byteSize: 100,
    status,
  };
}

function binding(): ProjectBinding {
  return {
    id: PROJECT_ID,
    folderPath: 'Projects/Alpha',
    projectRevision: 5,
    files: {
      'Projects/Alpha/A.md': {
        sourceMtime: '2026-07-28T00:00:00.000Z',
        byteSize: 100,
        contentHash: '1'.repeat(64),
      },
      'Projects/Alpha/Deleted.md': {
        sourceMtime: '2026-07-28T00:00:00.000Z',
        byteSize: 100,
        contentHash: '2'.repeat(64),
      },
    },
    sourceIds: {
      'Projects/Alpha/A.md': SOURCE_A,
      'Projects/Alpha/B.md': SOURCE_B,
      'Projects/Alpha/C.md': SOURCE_C,
      'Projects/Alpha/Deleted.md': SOURCE_DELETED,
    },
  };
}

describe('project synchronization transaction state', () => {
  it('builds a complete revision from committed current files plus selected staged files', () => {
    const current = binding();
    const allCandidates = [
      candidate('Projects/Alpha/A.md', 'unchanged'),
      candidate('Projects/Alpha/B.md', 'new'),
      candidate('Projects/Alpha/C.md', 'new'),
    ];
    const selectedCandidates = [allCandidates[1] as ProjectFileCandidate];

    expect(
      sourceIdsForProjectFinalization({
        binding: current,
        allCandidates,
        selectedCandidates,
      }),
    ).toEqual([SOURCE_A, SOURCE_B]);
  });

  it('keeps local revision and manifest unchanged until finalization succeeds', () => {
    const current = binding();
    const allCandidates = [
      candidate('Projects/Alpha/A.md', 'unchanged'),
      candidate('Projects/Alpha/B.md', 'new'),
    ];
    const selectedCandidates = [allCandidates[1] as ProjectFileCandidate];
    const sourceIds = sourceIdsForProjectFinalization({
      binding: current,
      allCandidates,
      selectedCandidates,
    });
    const initial = createProjectSyncStagingState({
      projectRevision: 5,
      baseManifestHash: '3'.repeat(64),
    });
    const staged = stageValidatedProjectBatch(initial, {
      expectedProjectRevision: 5,
      projectRevision: 6,
      manifestHash: '4'.repeat(64),
      bundleId: `src_${'e'.repeat(32)}`,
      indexedChunkCount: 12,
      files: {
        'Projects/Alpha/B.md': {
          sourceMtime: '2026-07-28T01:00:00.000Z',
          byteSize: 100,
          contentHash: '5'.repeat(64),
        },
      },
    });

    expect(current.projectRevision).toBe(5);
    expect(current.lastManifestHash).toBeUndefined();
    expect(current.files['Projects/Alpha/B.md']).toBeUndefined();

    const committed = commitFinalizedProjectBinding({
      binding: current,
      allCandidates,
      selectedCandidates,
      staged,
      finalized: {
        projectId: PROJECT_ID,
        projectRevision: 7,
        manifestId: `prm_${'f'.repeat(32)}`,
        manifestSha256: '6'.repeat(64),
        sourceCount: 2,
      },
      sourceIds,
      finalizedAt: '2026-07-28T02:00:00.000Z',
    });

    expect(committed.projectRevision).toBe(7);
    expect(committed.lastManifestId).toBe(`prm_${'f'.repeat(32)}`);
    expect(committed.lastManifestHash).toBe('6'.repeat(64));
    expect(committed.lastSourceCount).toBe(2);
    expect(committed.sourceIds).toEqual({
      'Projects/Alpha/A.md': SOURCE_A,
      'Projects/Alpha/B.md': SOURCE_B,
    });
    expect(committed.files['Projects/Alpha/Deleted.md']).toBeUndefined();
    expect(current.projectRevision).toBe(5);
  });

  it('rejects a batch that skips or reuses a project revision', () => {
    const staged = createProjectSyncStagingState({ projectRevision: 5 });
    expect(() =>
      stageValidatedProjectBatch(staged, {
        expectedProjectRevision: 5,
        projectRevision: 7,
        manifestHash: '4'.repeat(64),
        bundleId: `src_${'e'.repeat(32)}`,
        indexedChunkCount: 0,
        files: {},
      }),
    ).toThrow('revision chain');
  });
});
