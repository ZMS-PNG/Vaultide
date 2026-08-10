import { describe, expect, it } from 'vitest';
import { parseReviewCompletion } from '@/lib/learning/http/learning-progress-input';

describe('review completion input', () => {
  it('requires a bounded active-recall response and a stable attempt id', () => {
    expect(parseReviewCompletion({ rating: 'easy' })).toBeUndefined();
    expect(
      parseReviewCompletion({
        attemptId: 'review_attempt_001',
        response: 'too short',
        rating: 'good',
      }),
    ).toBeUndefined();
    expect(
      parseReviewCompletion({
        attemptId: 'review_attempt_001',
        response: '我能够闭卷写出核心机制、关键依据、新情境应用，以及自己仍不确定的部分。',
        rating: 'good',
        durationMs: 45_000,
      }),
    ).toEqual({
      attemptId: 'review_attempt_001',
      response: '我能够闭卷写出核心机制、关键依据、新情境应用，以及自己仍不确定的部分。',
      rating: 'good',
      durationMs: 45_000,
    });
  });

  it('rejects invalid ratings, oversized responses, and impossible durations', () => {
    const base = {
      attemptId: 'review_attempt_002',
      response: '这是一段足够长的闭卷回忆内容，用于验证输入边界和复习证据契约。',
    };
    expect(parseReviewCompletion({ ...base, rating: 'perfect' })).toBeUndefined();
    expect(
      parseReviewCompletion({ ...base, rating: 'hard', durationMs: 86_400_001 }),
    ).toBeUndefined();
    expect(
      parseReviewCompletion({ ...base, rating: 'hard', response: '知'.repeat(4_001) }),
    ).toBeUndefined();
  });
});
