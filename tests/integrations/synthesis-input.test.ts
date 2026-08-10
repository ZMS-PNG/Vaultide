import { describe, expect, it } from 'vitest';
import {
  parseRunDueSynthesesRequest,
  parseSynthesisRequest,
  parseSynthesisScheduleCreate,
  parseSynthesisSchedulePatch,
} from '@/lib/learning/http/synthesis-input';

describe('parseSynthesisRequest', () => {
  it('normalizes valid filters and deduplicates classroom ids', () => {
    expect(
      parseSynthesisRequest({
        mode: 'combined',
        question: '  这些方案为什么发生变化？  ',
        timeFrom: '2026-07-01',
        timeTo: '2026-07-31',
        domainQuery: '  TypeScript  ',
        domain: ' 软件与人工智能 ',
        sourceType: 'hybrid',
        topicTags: ['typescript', 'typescript', '项目'],
        projectIds: [`prj_${'1'.repeat(32)}`, `prj_${'1'.repeat(32)}`, `prj_${'2'.repeat(32)}`],
        classroomIds: ['course_a', 'course_a', 'course_b'],
      }),
    ).toEqual({
      mode: 'combined',
      question: '这些方案为什么发生变化？',
      timeFrom: '2026-07-01',
      timeTo: '2026-07-31',
      domainQuery: 'TypeScript',
      domain: '软件与人工智能',
      sourceType: 'hybrid',
      topicTags: ['typescript', '项目'],
      projectIds: [`prj_${'1'.repeat(32)}`, `prj_${'2'.repeat(32)}`],
      classroomIds: ['course_a', 'course_b'],
    });
  });

  it('rejects invalid modes, reversed dates, and unsafe classroom ids', () => {
    expect(parseSynthesisRequest({ mode: 'freeform' })).toBeNull();
    expect(
      parseSynthesisRequest({ mode: 'timeline', timeFrom: '2026-08-01', timeTo: '2026-07-01' }),
    ).toBeNull();
    expect(parseSynthesisRequest({ mode: 'domain', classroomIds: ['../../vault'] })).toBeNull();
    expect(parseSynthesisRequest({ mode: 'domain', projectIds: ['prj_invalid'] })).toBeNull();
    expect(parseSynthesisRequest({ mode: 'domain', sourceType: 'everything' })).toBeNull();
    expect(parseSynthesisRequest({ mode: 'domain', topicTags: [''] })).toBeNull();
    expect(parseSynthesisRequest({ mode: 'domain', question: '' })).toBeNull();
    expect(parseSynthesisRequest({ mode: 'domain', question: 'x'.repeat(301) })).toBeNull();
  });
});

describe('synthesis schedule input', () => {
  it('accepts a bounded schedule and strips no extra scope data', () => {
    expect(
      parseSynthesisScheduleCreate({
        name: 'Weekly TypeScript review',
        period: 'weekly',
        timezone: 'Asia/Shanghai',
        mode: 'combined',
        scope: {
          question: '当前最薄弱的知识链是什么？',
          projectIds: [`prj_${'1'.repeat(32)}`],
          topicTags: ['typescript', 'typescript'],
        },
      }),
    ).toEqual({
      name: 'Weekly TypeScript review',
      period: 'weekly',
      timezone: 'Asia/Shanghai',
      mode: 'combined',
      scope: {
        question: '当前最薄弱的知识链是什么？',
        projectIds: [`prj_${'1'.repeat(32)}`],
        topicTags: ['typescript'],
      },
    });
    expect(
      parseSynthesisScheduleCreate({
        name: 'Every 90 minutes',
        period: 'custom',
        intervalMinutes: 90,
        mode: 'timeline',
        scope: {},
      }),
    ).toMatchObject({ period: 'custom', intervalMinutes: 90 });
  });

  it('rejects schedule scope escalation and invalid time controls', () => {
    expect(
      parseSynthesisScheduleCreate({
        name: 'Unsafe',
        period: 'daily',
        mode: 'timeline',
        scope: { mode: 'domain' },
      }),
    ).toBeNull();
    expect(
      parseSynthesisScheduleCreate({
        name: 'Wrong custom interval',
        period: 'custom',
        intervalMinutes: 5,
        mode: 'timeline',
        scope: {},
      }),
    ).toBeNull();
    expect(
      parseSynthesisScheduleCreate({
        name: 'Unknown owner field',
        period: 'weekly',
        mode: 'timeline',
        scope: {},
        ownerId: 'forged',
      }),
    ).toBeNull();
    expect(parseSynthesisSchedulePatch({ status: 'paused', unknown: true })).toBeNull();
  });

  it('parses a small explicit run request and a pause patch', () => {
    expect(parseSynthesisSchedulePatch({ status: 'paused' })).toEqual({ status: 'paused' });
    expect(parseRunDueSynthesesRequest({ limit: 3 })).toEqual({ limit: 3 });
    expect(parseRunDueSynthesesRequest({ limit: 21 })).toBeNull();
  });
});
