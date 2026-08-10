export type ResearchFreshness = 'fresh' | 'aging' | 'stale' | 'unknown';

export type ResearchSourceAvailability =
  | 'unverified'
  | 'available'
  | 'redirected'
  | 'unreachable'
  | 'unsafe';

export interface ResearchSourceHealth {
  citationId: string;
  title: string;
  url: string;
  domain: string;
  authority: 'primary' | 'authoritative' | 'general';
  score: number;
  availability: ResearchSourceAvailability;
  checkedAt?: string;
  httpStatus?: number;
  finalUrl?: string;
  errorKind?: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * This measures the age of the captured research manifest, not the publication
 * date of the cited page. A stale manifest means "search again before relying
 * on recency", never "the source is false".
 */
export function researchFreshness(
  fetchedAt: string | undefined,
  now = new Date(),
): ResearchFreshness {
  if (!fetchedAt) return 'unknown';
  const timestamp = Date.parse(fetchedAt);
  if (!Number.isFinite(timestamp)) return 'unknown';
  const age = Math.max(0, now.getTime() - timestamp);
  if (age <= 7 * DAY_MS) return 'fresh';
  if (age <= 30 * DAY_MS) return 'aging';
  return 'stale';
}

export function researchFreshnessLabel(value: ResearchFreshness): string {
  if (value === 'fresh') return '本周采集';
  if (value === 'aging') return '建议重新检索';
  if (value === 'stale') return '检索证据已过期';
  return '采集时间未知';
}

export function sourceAuthorityLabel(
  authority: ResearchSourceHealth['authority'] | undefined,
): string {
  if (authority === 'primary') return '第一方来源';
  if (authority === 'authoritative') return '权威来源';
  return '一般来源';
}

export function sourceAvailabilityLabel(value: ResearchSourceAvailability): string {
  if (value === 'available') return '链接可访问';
  if (value === 'redirected') return '重定向后可访问';
  if (value === 'unreachable') return '链接可能失效';
  if (value === 'unsafe') return '链接未通过安全检查';
  return '尚未实时复核';
}
