import { describe, expect, it } from 'vitest';
import {
  buildWritebackCenterSnapshot,
  markWritebackActivitySynced,
  recordWritebackActivity,
} from '../src/writeback-center-state';
import { LEARNING_PROTOCOL_VERSION, type WritebackReceipt } from '@openmaic/learning-protocol';

function receipt(commandId: string, outcome: WritebackReceipt['outcome']): WritebackReceipt {
  return {
    protocolVersion: LEARNING_PROTOCOL_VERSION,
    id: `wbr_${commandId.slice(4)}`,
    commandId,
    deviceId: 'dev_00000000000000000000000000000000',
    outcome,
    reportedAt: '2026-07-26T00:00:00.000Z',
  };
}

describe('writeback center state', () => {
  it('records one latest activity per command and marks server sync', () => {
    const commandId = 'wbc_00000000000000000000000000000000';
    const first = recordWritebackActivity([], receipt(commandId, 'failed'));
    const updated = recordWritebackActivity(first, receipt(commandId, 'applied'));
    const synced = markWritebackActivitySynced(
      updated,
      updated[0]!.receipt.id,
      '2026-07-26T00:01:00.000Z',
    );

    expect(synced).toHaveLength(1);
    expect(synced[0]?.receipt.outcome).toBe('applied');
    expect(synced[0]?.syncedAt).toBe('2026-07-26T00:01:00.000Z');
  });

  it('separates completed activities from failures and conflicts', () => {
    const activity = [
      { receipt: receipt('wbc_00000000000000000000000000000000', 'applied') },
      { receipt: receipt('wbc_11111111111111111111111111111111', 'conflicted') },
    ];
    const snapshot = buildWritebackCenterSnapshot({
      paired: true,
      pending: [],
      activity,
      pendingReceiptCount: 1,
    });

    expect(snapshot.completed).toHaveLength(1);
    expect(snapshot.failed).toHaveLength(1);
    expect(snapshot.pendingReceiptCount).toBe(1);
  });
});
