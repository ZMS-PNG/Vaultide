import { describe, expect, it } from 'vitest';
import { assessOutlineQuality } from '@/lib/generation/course-quality';
import {
  fortifyOutlinesForRelease,
  OUTLINE_QUALITY_RELEASE_FLOOR,
  repairSafeOutlineQualityIssues,
} from '@/lib/generation/outline-quality-repair';
import { makeHighQualityOutlines } from './course-quality-fixtures';

describe('repairSafeOutlineQualityIssues', () => {
  it('fortifies one model pass to the same release-grade outline floor', () => {
    const raw = makeHighQualityOutlines().map((outline, index) => ({
      ...outline,
      type: 'slide' as const,
      title: index === 1 ? rawTitleFallback(index) : outline.title,
      description: index === 2 ? '解释这个部分。' : outline.description.slice(0, 55),
      keyPoints: (outline.keyPoints ?? []).map((point) => point.slice(0, 10)),
      quizConfig: undefined,
    }));
    raw[raw.length - 1] = {
      ...raw[raw.length - 1],
      title: '课程回顾',
      description: '回顾前面的内容。',
    };

    const fortified = fortifyOutlinesForRelease(raw);
    const assessment = assessOutlineQuality(fortified.outlines);

    expect(fortified.changed).toBe(true);
    expect(fortified.outlines).toHaveLength(raw.length);
    expect(fortified.outlines.some((outline) => outline.type === 'quiz')).toBe(true);
    expect(fortified.outlines.at(-1)?.description).toContain('迁移到一个课程未直接解答的新项目');
    expect(assessment.passed, JSON.stringify(assessment, null, 2)).toBe(true);
    expect(assessment.score).toBeGreaterThanOrEqual(OUTLINE_QUALITY_RELEASE_FLOOR);
  });

  it('repairs a final-scene transfer defect and still requires the full gate to pass', () => {
    const outlines = makeHighQualityOutlines();
    const lastIndex = outlines.length - 1;
    outlines[lastIndex] = {
      ...outlines[lastIndex],
      title: 'Course recap',
      description:
        'Summarize the terms already shown in the course and repeat the preceding points.',
      teachingObjective: undefined,
      keyPoints: [
        'Recap of the architecture vocabulary',
        'Review of the mechanism vocabulary',
        'Summary of previously listed limitations',
      ],
    };
    const initial = assessOutlineQuality(outlines);

    expect(initial.passed).toBe(false);
    expect(initial.issues.map((issue) => issue.code)).toContain('outline_final_transfer_missing');

    const repair = repairSafeOutlineQualityIssues(outlines, initial);
    const repairedAssessment = assessOutlineQuality(repair.outlines);

    expect(repair.changed).toBe(true);
    expect(repair.repairedIssueCodes).toEqual(['outline_final_transfer_missing']);
    expect(repair.outlines[lastIndex].description).toContain('new project, decision, or problem');
    expect(repair.outlines[lastIndex].description).toContain('acceptance criteria');
    expect(repair.outlines[lastIndex].keyPoints).toEqual(outlines[lastIndex].keyPoints);
    expect(repairedAssessment.passed, JSON.stringify(repairedAssessment, null, 2)).toBe(true);
  });

  it('does not conceal unrelated quality defects', () => {
    const outlines = makeHighQualityOutlines().slice(0, 2);
    const initial = assessOutlineQuality(outlines);
    const repair = repairSafeOutlineQualityIssues(outlines, initial);

    expect(repair.changed).toBe(true);
    expect(assessOutlineQuality(repair.outlines).passed).toBe(false);
    expect(assessOutlineQuality(repair.outlines).issues.map((issue) => issue.code)).toContain(
      'outline_count',
    );
  });

  it('adds an explicit Chinese learner artifact and verification result', () => {
    const outlines = makeHighQualityOutlines();
    const lastIndex = outlines.length - 1;
    outlines[lastIndex] = {
      ...outlines[lastIndex],
      title: '课程回顾',
      description: '回顾已经学习的架构、机制与风险要点。',
      keyPoints: ['回顾核心架构词汇', '复习运行机制词汇', '总结已知风险边界'],
    };
    const initial = assessOutlineQuality(outlines);
    const repair = repairSafeOutlineQualityIssues(outlines, initial);
    const finalDescription = repair.outlines[lastIndex].description;

    expect(finalDescription).toContain('迁移到一个未在课程中直接讲解的新项目');
    expect(finalDescription).toContain('学习者必须提交');
    expect(finalDescription).toContain('验收标准');
    expect(finalDescription).toContain('第三方复核');
    expect(assessOutlineQuality(repair.outlines).passed).toBe(true);
  });

  it('repairs shallow descriptions and vague key points without regenerating the course', () => {
    const outlines = makeHighQualityOutlines();
    outlines[2] = {
      ...outlines[2],
      description: 'Explain the flow.',
      keyPoints: ['Input', 'State', 'Output'],
    };
    const initial = assessOutlineQuality(outlines);

    expect(initial.issues.map((issue) => issue.code)).toContain('outline_description_shallow');
    expect(initial.issues.map((issue) => issue.code)).toContain('outline_keypoints_vague');

    const repair = repairSafeOutlineQualityIssues(outlines, initial);
    const repairedAssessment = assessOutlineQuality(repair.outlines);

    expect(repair.changed).toBe(true);
    expect(repair.repairedIssueCodes).toContain('outline_description_shallow');
    expect(repair.repairedIssueCodes).toContain('outline_keypoints_vague');
    expect(repair.outlines[2].description).toContain('selected-source mechanism');
    expect(repair.outlines[2].description).toContain('observable result');
    expect(repair.outlines[2].keyPoints.every((point) => point.length >= 8)).toBe(true);
    expect(repairedAssessment.passed, JSON.stringify(repairedAssessment, null, 2)).toBe(true);
  });

  it('repairs duplicate identities and order sequence deterministically', () => {
    const outlines = makeHighQualityOutlines();
    outlines[1] = { ...outlines[1], id: outlines[0].id, order: 7 };
    const initial = assessOutlineQuality(outlines);
    const repair = repairSafeOutlineQualityIssues(outlines, initial);

    expect(repair.repairedIssueCodes).toContain('outline_duplicate_ids');
    expect(repair.repairedIssueCodes).toContain('outline_order_sequence');
    expect(new Set(repair.outlines.map((outline) => outline.id)).size).toBe(outlines.length);
    expect(repair.outlines.map((outline) => outline.order)).toEqual(
      outlines.map((_, index) => index + 1),
    );
    expect(assessOutlineQuality(repair.outlines).passed).toBe(true);
  });
});

function rawTitleFallback(index: number): string {
  return `场景 ${index + 1}`;
}
