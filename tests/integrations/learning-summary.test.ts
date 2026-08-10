import { describe, expect, it } from 'vitest';
import { renderLearningSummary } from '@/lib/learning/domain/learning-summary';

describe('learning summary writeback artifact', () => {
  it('renders a managed, source-aware note without learner answer contents', () => {
    const result = renderLearningSummary({
      now: new Date('2026-07-21T08:00:00.000Z'),
      classroom: {
        id: 'course_123',
        stage: {
          id: 'course_123',
          name: 'TypeScript: 类型系统 / 入门?',
          learningContext: {
            goal: '能够解释联合类型并完成迁移练习。',
            sourceBundleId: 'src_11111111111111111111111111111111',
            projectCoverageState: 'authorized-index-partial',
            retrievalMatchQuality: 'strong',
            retrievalUnavailableSourceCount: 1,
            retrievedSourceCount: 1,
            retrievedChunkCount: 1,
            retrievalCitations: [
              {
                citationId: 'V1',
                sourceId: 'sou_11111111111111111111111111111111',
                sourceVersionId: 'svr_11111111111111111111111111111111',
                chunkId: 'chk_11111111111111111111111111111111',
                relativePath: 'Projects/TypeScript/Union.md',
                headingPath: ['联合类型'],
                excerptChars: 320,
                contentHash: 'a'.repeat(64),
              },
            ],
            researchSources: [
              { title: 'TypeScript Handbook', url: 'https://www.typescriptlang.org/docs/' },
              { title: 'unsafe', url: 'javascript:alert(1)' },
            ],
          },
        },
        scenes: [
          { id: 'scene_2', title: '主动回忆', order: 2, type: 'quiz' },
          { id: 'scene_1', title: '概念讲解', order: 1, type: 'slide' },
        ],
        createdAt: '2026-07-21T07:00:00.000Z',
      },
      sprint: {
        id: 'spr_11111111111111111111111111111111',
        ownerId: 'own_11111111111111111111111111111111',
        classroomId: 'course_123',
        projectId: 'prj_22222222222222222222222222222222',
        projectName: 'TypeScript 项目',
        projectRevision: 3,
        retrievalRunId: 'prr_11111111111111111111111111111111',
        sourceBundleId: 'src_11111111111111111111111111111111',
        goal: '能够解释联合类型并完成迁移练习。',
        status: 'active',
        createdAt: new Date('2026-07-21T07:00:00.000Z'),
        updatedAt: new Date('2026-07-21T08:00:00.000Z'),
      },
      progress: {
        currentSceneId: 'scene_2',
        quizSummaries: [
          {
            sceneId: 'scene_2',
            title: '主动回忆',
            answered: 3,
            total: 3,
            earned: 2,
            possible: 3,
          },
        ],
      },
      events: [],
    });

    expect(result.relativePath).toBe(
      'Vaultide/学习记录/TypeScript 项目--22222222/2026-07-21-TypeScript- 类型系统 - 入门--course_123.md',
    );
    expect(result.content).toContain('能够解释联合类型并完成迁移练习。');
    expect(result.content).toContain('主动回忆：已答 3/3，得分 2/3');
    expect(result.content.indexOf('概念讲解')).toBeLessThan(
      result.content.indexOf('主动回忆（quiz）'),
    );
    expect(result.content).toContain('[TypeScript Handbook](https://www.typescriptlang.org/docs/)');
    expect(result.content).not.toContain('javascript:');
    expect(result.content).not.toContain('用户答案');
    expect(result.frontmatter.maic_sprint_id).toBe('spr_11111111111111111111111111111111');
    expect(result.frontmatter.maic_project_id).toBe('prj_22222222222222222222222222222222');
    expect(result.frontmatter.maic_project_revision).toBe(3);
    expect(result.frontmatter.maic_retrieval_run_id).toBe('prr_11111111111111111111111111111111');
    expect(result.frontmatter.maic_coverage_state).toBe('authorized-index-partial');
    expect(result.frontmatter.maic_selected_source_count).toBe(1);
    expect(result.content).toContain('[V1] Projects/TypeScript/Union.md');
    expect(result.content).toContain('学习时项目版本：3');
    expect(result.content).toContain('# 知洄 Vaultide 学习记录｜TypeScript: 类型系统 / 入门?');
    expect(result.frontmatter.tags).toContain('vaultide');
    expect(result.frontmatter.aliases).toEqual([
      '知洄 Vaultide 学习记录 TypeScript: 类型系统 / 入门?',
    ]);
  });

  it('keeps legacy classrooms compatible without inventing a project identity', () => {
    const result = renderLearningSummary({
      now: new Date('2026-07-21T08:00:00.000Z'),
      classroom: {
        id: 'legacy_course',
        stage: { id: 'legacy_course', name: '旧课堂' },
        scenes: [],
        createdAt: '2026-07-20T08:00:00.000Z',
      },
      sprint: {
        id: 'spr_33333333333333333333333333333333',
        ownerId: 'own_11111111111111111111111111111111',
        classroomId: 'legacy_course',
        goal: '',
        status: 'active',
        createdAt: new Date('2026-07-20T08:00:00.000Z'),
        updatedAt: new Date('2026-07-21T08:00:00.000Z'),
      },
      progress: { quizSummaries: [] },
      events: [],
    });

    expect(result.relativePath).toBe('Vaultide/学习记录/2026-07-21-旧课堂-legacy_course.md');
    expect(result.frontmatter).not.toHaveProperty('maic_project_id');
  });
});
