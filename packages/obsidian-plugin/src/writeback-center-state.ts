import {
  LEARNING_PROTOCOL_VERSION,
  type WritebackCommand,
  type WritebackReceipt,
} from '@openmaic/learning-protocol';

export interface WritebackActivityRecord {
  receipt: WritebackReceipt;
  syncedAt?: string;
}

export interface WritebackCenterSnapshot {
  paired: boolean;
  pending: WritebackCommand[];
  completed: WritebackActivityRecord[];
  failed: WritebackActivityRecord[];
  pendingReceiptCount: number;
}

export function savedWritebackActivity(value: unknown): WritebackActivityRecord[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is WritebackActivityRecord => {
      if (typeof item !== 'object' || item === null) return false;
      const candidate = item as Partial<WritebackActivityRecord>;
      const receipt = candidate.receipt as Partial<WritebackReceipt> | undefined;
      return (
        typeof receipt === 'object' &&
        receipt !== null &&
        receipt.protocolVersion === LEARNING_PROTOCOL_VERSION &&
        typeof receipt.id === 'string' &&
        typeof receipt.commandId === 'string' &&
        typeof receipt.deviceId === 'string' &&
        typeof receipt.outcome === 'string' &&
        typeof receipt.reportedAt === 'string' &&
        (candidate.syncedAt === undefined || typeof candidate.syncedAt === 'string')
      );
    })
    .slice(0, 50);
}

export function recordWritebackActivity(
  activity: readonly WritebackActivityRecord[],
  receipt: WritebackReceipt,
): WritebackActivityRecord[] {
  const existing = activity.find((item) => item.receipt.commandId === receipt.commandId);
  if (existing) {
    return activity.map((item) =>
      item.receipt.commandId === receipt.commandId ? { ...item, receipt } : item,
    );
  }
  return [{ receipt }, ...activity].slice(0, 50);
}

export function markWritebackActivitySynced(
  activity: readonly WritebackActivityRecord[],
  receiptId: string,
  syncedAt: string,
): WritebackActivityRecord[] {
  return activity.map((item) => (item.receipt.id === receiptId ? { ...item, syncedAt } : item));
}

export function buildWritebackCenterSnapshot(input: {
  paired: boolean;
  pending: readonly WritebackCommand[];
  activity: readonly WritebackActivityRecord[];
  pendingReceiptCount: number;
}): WritebackCenterSnapshot {
  return {
    paired: input.paired,
    pending: [...input.pending],
    completed: input.activity.filter((item) => item.receipt.outcome === 'applied'),
    failed: input.activity.filter((item) => item.receipt.outcome !== 'applied'),
    pendingReceiptCount: input.pendingReceiptCount,
  };
}
