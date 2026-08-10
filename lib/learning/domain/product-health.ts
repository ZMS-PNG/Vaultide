export type ProductHealthState = 'healthy' | 'warning' | 'action-required' | 'no-data';

export interface ProductHealthMetric {
  state: ProductHealthState;
  total: number;
  succeeded: number;
  failed: number;
  pending: number;
  lastSuccessAt?: string;
  lastFailureAt?: string;
  lastFailureDetail?: string;
}

export interface ProductHealthSnapshot {
  generatedAt: string;
  windowDays: number;
  generation: ProductHealthMetric;
  synthesis: ProductHealthMetric;
  writeback: ProductHealthMetric;
  sources: ProductHealthMetric;
}

export function productHealthStateLabel(state: ProductHealthState): string {
  if (state === 'healthy') return '运行正常';
  if (state === 'warning') return '需要留意';
  if (state === 'action-required') return '需要处理';
  return '暂无数据';
}

export function healthMetric(input: {
  total: number;
  succeeded: number;
  failed: number;
  pending: number;
  lastSuccessAt?: string;
  lastFailureAt?: string;
  lastFailureDetail?: string;
}): ProductHealthMetric {
  const recoveredAfterFailure =
    input.failed > 0 &&
    Boolean(input.lastSuccessAt) &&
    Boolean(input.lastFailureAt) &&
    Date.parse(input.lastSuccessAt ?? '') >= Date.parse(input.lastFailureAt ?? '');
  const state: ProductHealthState =
    input.failed > 0
      ? recoveredAfterFailure
        ? 'warning'
        : 'action-required'
      : input.pending > 0
        ? 'warning'
        : input.total > 0
          ? 'healthy'
          : 'no-data';
  return { ...input, state };
}
