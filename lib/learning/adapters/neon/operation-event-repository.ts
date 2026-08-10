import { randomUUID } from 'node:crypto';
import type { JsonObject } from '@openmaic/learning-protocol';
import { loadPairingConfig } from '../../config';
import { getLearningSql } from './client';

export type LearningOperationKind =
  | 'classroom-generation'
  | 'synthesis-generation'
  | 'writeback'
  | 'source-verification';

export async function recordLearningOperation(input: {
  ownerId: string;
  kind: LearningOperationKind;
  operationId: string;
  state: 'started' | 'succeeded' | 'failed';
  errorCode?: string;
  detail?: JsonObject;
  occurredAt?: Date;
}): Promise<void> {
  const occurredAt = input.occurredAt ?? new Date();
  await getLearningSql().query(
    `
      INSERT INTO learning_operation_events
        (id, owner_id, operation_kind, operation_id, state, error_code, detail,
         occurred_at, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $8)
    `,
    [
      `ope_${randomUUID().replaceAll('-', '')}`,
      input.ownerId,
      input.kind,
      input.operationId.slice(0, 160),
      input.state,
      input.errorCode?.slice(0, 160) ?? null,
      JSON.stringify(input.detail ?? {}),
      occurredAt,
    ],
  );
}

/** Observability must never turn a successful user workflow into a failure. */
export async function recordDefaultLearningOperation(
  input: Omit<Parameters<typeof recordLearningOperation>[0], 'ownerId'>,
): Promise<void> {
  try {
    const { ownerId } = loadPairingConfig();
    await recordLearningOperation({ ...input, ownerId });
  } catch {
    // The primary workflow remains authoritative when telemetry is unavailable.
  }
}
