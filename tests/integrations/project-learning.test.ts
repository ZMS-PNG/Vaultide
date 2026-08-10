import { describe, expect, it } from 'vitest';
import {
  projectIndexDraftBlocks,
  projectLearningIndexSummary,
  renderProjectLearningIndex,
  sourceLearningState,
  type ProjectLearningIndexRecord,
} from '@/lib/learning/domain/project-learning';

const now = new Date('2026-07-23T12:00:00.000Z');
const ownerId = `own_${'1'.repeat(32)}`;
const projectId = `prj_${'2'.repeat(32)}`;
const projectIndexId = `pdx_${'3'.repeat(32)}`;

function indexFixture(): ProjectLearningIndexRecord {
  return {
    project: {
      id: projectId,
      ownerId,
      vaultBindingId: `vlt_${'4'.repeat(32)}`,
      kind: 'folder',
      projectName: 'Learning Project',
      rootPath: 'Projects/Learning Project',
      status: 'active',
      bindingRevision: 1,
      projectRevision: 4,
      metadata: {},
      createdAt: now,
      updatedAt: now,
    },
    sources: [
      {
        sourceId: `sou_${'5'.repeat(32)}`,
        title: 'Original project note',
        relativePath: 'Projects/Learning Project/Original.md',
        latestVersionId: `sov_${'6'.repeat(32)}`,
        latestContentHash: 'a'.repeat(64),
        indexStatus: 'ready',
        indexedChunkCount: 8,
        lastSeenAt: now,
        latestSprint: {
          id: `spr_${'7'.repeat(32)}`,
          classroomId: 'course_project_note',
          status: 'completed',
          sourceVersionId: `sov_${'8'.repeat(32)}`,
          updatedAt: now,
        },
        latestCompletedSourceVersionId: `sov_${'8'.repeat(32)}`,
        mastery: {
          estimate: 0.88,
          confidence: 0.6,
          evidenceCount: 3,
        },
        learningState: 'verified',
        sourceUpdated: true,
      },
    ],
    generatedAt: now,
  };
}

describe('project learning index', () => {
  it('keeps a source-version change visible without silently reducing mastery', () => {
    const learningState = sourceLearningState({
      latestSprint: {
        id: `spr_${'7'.repeat(32)}`,
        classroomId: 'course_project_note',
        status: 'completed',
        sourceVersionId: `sov_${'8'.repeat(32)}`,
        updatedAt: now,
      },
      mastery: { estimate: 0.88, confidence: 0.6, evidenceCount: 3 },
      now,
    });
    expect(learningState).toBe('verified');

    const summary = projectLearningIndexSummary(indexFixture());
    expect(summary).toMatchObject({ verifiedCount: 1, sourceUpdatedCount: 1 });
  });

  it('renders a separate stable aggregate document with managed blocks and a user-only area', () => {
    const rendered = renderProjectLearningIndex({
      projectIndexId,
      index: indexFixture(),
      now,
    });
    expect(rendered.relativePath).toMatch(/^Vaultide\/.*\/.*--22222222\.md$/);
    expect(rendered.frontmatter).toMatchObject({
      maic_project_index_id: projectIndexId,
      maic_project_id: projectId,
      maic_managed: true,
    });
    expect(rendered.content).toContain(`project-index=${projectIndexId}`);
    expect(rendered.content).toContain('Original.md');
    expect(rendered.content).toContain('## 我的补充');
    expect(rendered.managedBlocks.map((block) => block.id)).toEqual([
      'summary',
      'coverage',
      'reviews',
      'links',
    ]);
  });

  it('requires exact prior managed-block hashes after the index has been written once', () => {
    const rendered = renderProjectLearningIndex({
      projectIndexId,
      index: indexFixture(),
      now,
    });
    const drafts = projectIndexDraftBlocks(rendered.managedBlocks, {
      id: projectIndexId,
      ownerId,
      projectId,
      vaultBindingId: `vlt_${'4'.repeat(32)}`,
      relativePath: rendered.relativePath,
      status: 'active',
      managedBlocks: rendered.managedBlocks,
      lastContentHash: 'b'.repeat(64),
      createdAt: now,
      updatedAt: now,
    });
    expect(drafts).toHaveLength(4);
    expect(drafts.every((block) => block.expectedHash === block.contentHash)).toBe(true);
  });
});
