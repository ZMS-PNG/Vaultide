export class TimestampBoundaryError extends Error {
  constructor(readonly value: unknown) {
    super('Timestamp values must be valid ISO-8601 timestamps or Date instances.')
    this.name = 'TimestampBoundaryError'
  }
}

/**
 * Normalizes timestamp values at the persistence boundary. SQL parameters are
 * always sent as ISO timestamps, never as an untyped application string.
 */
export function normalizeTimestamp(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) {
    throw new TimestampBoundaryError(value)
  }
  return date.toISOString()
}
