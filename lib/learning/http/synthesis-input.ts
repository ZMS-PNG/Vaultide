import type {
  SynthesisMode,
  SynthesisRequest,
  SynthesisSchedulePeriod,
  SynthesisScheduleStatus,
  SynthesisScope,
} from '../domain/synthesis';
import type {
  CreateSynthesisScheduleRequest,
  UpdateSynthesisScheduleRequest,
} from '../application/synthesis-service';

const SYNTHESIS_SCOPE_KEYS = new Set([
  'question',
  'timeFrom',
  'timeTo',
  'domainQuery',
  'domain',
  'sourceType',
  'topicTags',
  'projectIds',
  'classroomIds',
]);

const SCHEDULE_CREATE_KEYS = new Set([
  'name',
  'period',
  'intervalMinutes',
  'timezone',
  'mode',
  'scope',
]);

const SCHEDULE_PATCH_KEYS = new Set([
  'name',
  'period',
  'intervalMinutes',
  'timezone',
  'mode',
  'scope',
  'status',
]);

function recordOf(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function hasOnlyKeys(record: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
  return Object.keys(record).every((key) => allowed.has(key));
}

function validMode(value: unknown): value is SynthesisMode {
  return value === 'timeline' || value === 'domain' || value === 'combined';
}

function validPeriod(value: unknown): value is SynthesisSchedulePeriod {
  return value === 'daily' || value === 'weekly' || value === 'monthly' || value === 'custom';
}

function validScheduleStatus(value: unknown): value is SynthesisScheduleStatus {
  return value === 'active' || value === 'paused';
}

function validName(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 160;
}

function validTimezone(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 80;
}

function validInterval(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 15 && value <= 525_600;
}

function parseSynthesisScope(value: unknown): SynthesisScope | null {
  const record = recordOf(value);
  if (!record || !hasOnlyKeys(record, SYNTHESIS_SCOPE_KEYS)) return null;
  const parsed = parseSynthesisRequest({ mode: 'combined', ...record });
  if (!parsed) return null;
  const { mode: _mode, ...scope } = parsed;
  return scope;
}

function validDate(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}

export function parseSynthesisRequest(value: unknown): SynthesisRequest | null {
  const record = recordOf(value);
  if (!record || !validMode(record.mode)) return null;
  if (record.timeFrom !== undefined && !validDate(record.timeFrom)) return null;
  if (record.timeTo !== undefined && !validDate(record.timeTo)) return null;
  if (
    record.timeFrom &&
    record.timeTo &&
    Date.parse(String(record.timeFrom)) > Date.parse(String(record.timeTo))
  ) {
    return null;
  }
  if (
    record.question !== undefined &&
    (typeof record.question !== 'string' ||
      record.question.trim().length === 0 ||
      record.question.trim().length > 300)
  ) {
    return null;
  }
  if (
    record.domainQuery !== undefined &&
    (typeof record.domainQuery !== 'string' || record.domainQuery.trim().length > 120)
  ) {
    return null;
  }
  if (
    record.domain !== undefined &&
    (typeof record.domain !== 'string' ||
      record.domain.trim().length === 0 ||
      record.domain.trim().length > 120)
  ) {
    return null;
  }
  if (
    record.sourceType !== undefined &&
    !['obsidian', 'external', 'hybrid', 'classroom'].includes(String(record.sourceType))
  ) {
    return null;
  }
  let topicTags: string[] | undefined;
  if (record.topicTags !== undefined) {
    if (
      !Array.isArray(record.topicTags) ||
      record.topicTags.length > 30 ||
      record.topicTags.some(
        (tag) => typeof tag !== 'string' || tag.trim().length === 0 || tag.trim().length > 80,
      )
    ) {
      return null;
    }
    topicTags = [...new Set(record.topicTags.map((tag) => tag.trim()))];
  }
  let classroomIds: string[] | undefined;
  if (record.classroomIds !== undefined) {
    if (
      !Array.isArray(record.classroomIds) ||
      record.classroomIds.length > 30 ||
      record.classroomIds.some((id) => typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(id))
    ) {
      return null;
    }
    classroomIds = [...new Set(record.classroomIds)];
  }
  let projectIds: string[] | undefined;
  if (record.projectIds !== undefined) {
    if (
      !Array.isArray(record.projectIds) ||
      record.projectIds.length > 30 ||
      record.projectIds.some((id) => typeof id !== 'string' || !/^prj_[a-f0-9]{32}$/.test(id))
    ) {
      return null;
    }
    projectIds = [...new Set(record.projectIds)];
  }
  return {
    mode: record.mode,
    ...(typeof record.question === 'string' ? { question: record.question.trim() } : {}),
    ...(typeof record.timeFrom === 'string' ? { timeFrom: record.timeFrom } : {}),
    ...(typeof record.timeTo === 'string' ? { timeTo: record.timeTo } : {}),
    ...(typeof record.domainQuery === 'string' && record.domainQuery.trim()
      ? { domainQuery: record.domainQuery.trim() }
      : {}),
    ...(typeof record.domain === 'string' ? { domain: record.domain.trim() } : {}),
    ...(typeof record.sourceType === 'string'
      ? { sourceType: record.sourceType as SynthesisRequest['sourceType'] }
      : {}),
    ...(topicTags?.length ? { topicTags } : {}),
    ...(projectIds?.length ? { projectIds } : {}),
    ...(classroomIds?.length ? { classroomIds } : {}),
  };
}

export function parseSynthesisScheduleCreate(
  value: unknown,
): CreateSynthesisScheduleRequest | null {
  const record = recordOf(value);
  if (!record || !hasOnlyKeys(record, SCHEDULE_CREATE_KEYS)) return null;
  if (!validName(record.name) || !validPeriod(record.period) || !validMode(record.mode))
    return null;
  if (!Object.hasOwn(record, 'scope')) return null;
  const scope = parseSynthesisScope(record.scope);
  if (!scope) return null;
  if (record.timezone !== undefined && !validTimezone(record.timezone)) return null;
  if (record.intervalMinutes !== undefined && !validInterval(record.intervalMinutes)) return null;
  if (record.period === 'custom' && !validInterval(record.intervalMinutes)) return null;
  if (record.period !== 'custom' && record.intervalMinutes !== undefined) return null;
  return {
    name: record.name.trim(),
    period: record.period,
    ...(record.intervalMinutes !== undefined ? { intervalMinutes: record.intervalMinutes } : {}),
    ...(record.timezone !== undefined ? { timezone: record.timezone.trim() } : {}),
    mode: record.mode,
    scope,
  };
}

export function parseSynthesisSchedulePatch(value: unknown): UpdateSynthesisScheduleRequest | null {
  const record = recordOf(value);
  if (!record || Object.keys(record).length === 0 || !hasOnlyKeys(record, SCHEDULE_PATCH_KEYS)) {
    return null;
  }
  if (record.name !== undefined && !validName(record.name)) return null;
  if (record.period !== undefined && !validPeriod(record.period)) return null;
  if (record.intervalMinutes !== undefined && !validInterval(record.intervalMinutes)) return null;
  if (record.timezone !== undefined && !validTimezone(record.timezone)) return null;
  if (record.mode !== undefined && !validMode(record.mode)) return null;
  if (record.status !== undefined && !validScheduleStatus(record.status)) return null;
  const scope = record.scope === undefined ? undefined : parseSynthesisScope(record.scope);
  if (record.scope !== undefined && !scope) return null;
  return {
    ...(record.name !== undefined ? { name: record.name.trim() } : {}),
    ...(record.period !== undefined ? { period: record.period } : {}),
    ...(record.intervalMinutes !== undefined ? { intervalMinutes: record.intervalMinutes } : {}),
    ...(record.timezone !== undefined ? { timezone: record.timezone.trim() } : {}),
    ...(record.mode !== undefined ? { mode: record.mode } : {}),
    ...(scope ? { scope } : {}),
    ...(record.status !== undefined ? { status: record.status } : {}),
  };
}

export function parseRunDueSynthesesRequest(value: unknown): { limit?: number } | null {
  const record = recordOf(value);
  if (!record || !hasOnlyKeys(record, new Set(['limit']))) return null;
  const limit = record.limit;
  if (
    limit !== undefined &&
    (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 20)
  ) {
    return null;
  }
  return limit === undefined ? {} : { limit };
}
