import { describe, expect, it } from 'vitest';
import {
  researchFreshness,
  researchFreshnessLabel,
  sourceAuthorityLabel,
  sourceAvailabilityLabel,
} from '@/lib/learning/domain/source-quality';

describe('external source quality semantics', () => {
  const now = new Date('2026-07-26T12:00:00.000Z');

  it('labels the retrieval-manifest age without claiming source truth', () => {
    expect(researchFreshness('2026-07-24T12:00:00.000Z', now)).toBe('fresh');
    expect(researchFreshness('2026-07-10T12:00:00.000Z', now)).toBe('aging');
    expect(researchFreshness('2026-06-01T12:00:00.000Z', now)).toBe('stale');
    expect(researchFreshness(undefined, now)).toBe('unknown');
    expect(researchFreshnessLabel('stale')).toBe('检索证据已过期');
  });

  it('keeps authority and link availability as separate, conservative signals', () => {
    expect(sourceAuthorityLabel('primary')).toBe('第一方来源');
    expect(sourceAuthorityLabel('general')).toBe('一般来源');
    expect(sourceAvailabilityLabel('available')).toBe('链接可访问');
    expect(sourceAvailabilityLabel('unreachable')).toBe('链接可能失效');
    expect(sourceAvailabilityLabel('unverified')).toBe('尚未实时复核');
  });
});
