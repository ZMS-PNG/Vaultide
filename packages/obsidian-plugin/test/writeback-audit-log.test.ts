import { describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => {
  class TFile {
    constructor(readonly path: string) {}
  }
  return {
    TFile,
    normalizePath: (value: string) => value.replaceAll('\\', '/').replace(/\/{2,}/g, '/'),
  };
});

import { TFile } from 'obsidian';
import type { WritebackReceipt } from '@openmaic/learning-protocol';
import {
  appendProjectRevisionAuditLog,
  appendWritebackAuditLog,
  appendWritebackAuditSync,
} from '../src/writeback-audit-log';

const receipt: WritebackReceipt = {
  protocolVersion: '2026-07-draft-1',
  id: 'wbr_11111111111111111111111111111111',
  commandId: 'wbc_22222222222222222222222222222222',
  deviceId: 'dev_33333333333333333333333333333333',
  outcome: 'applied',
  resultingPath: 'Vaultide/归纳/周期/索引/weekly.md',
  resultingContentHash: 'a'.repeat(64),
  appliedAt: '2026-07-28T05:00:00.000Z',
  reportedAt: '2026-07-28T05:00:01.000Z',
};

describe('writeback audit log', () => {
  it('creates a secret-free audit note and deduplicates receipts', async () => {
    const files = new Map<string, { file: TFile; content: string }>();
    const app = {
      vault: {
        getAbstractFileByPath: vi.fn((path: string) => files.get(path)?.file ?? null),
        createFolder: vi.fn(async () => undefined),
        create: vi.fn(async (path: string, content: string) => {
          const file = new TFile();
          Object.defineProperty(file, 'path', { value: path, configurable: true });
          files.set(path, { file, content });
          return file;
        }),
        read: vi.fn(async (file: TFile) => files.get(file.path)?.content ?? ''),
        modify: vi.fn(async (file: TFile, content: string) => {
          files.set(file.path, { file, content });
        }),
      },
    };

    const first = await appendWritebackAuditLog({
      app: app as never,
      managedRoot: 'Vaultide',
      receipt,
    });
    const second = await appendWritebackAuditLog({
      app: app as never,
      managedRoot: 'Vaultide',
      receipt,
    });
    const synced = await appendWritebackAuditSync({
      app: app as never,
      managedRoot: 'Vaultide',
      receiptId: receipt.id,
      syncedAt: '2026-07-28T05:00:02.000Z',
    });
    const syncedAgain = await appendWritebackAuditSync({
      app: app as never,
      managedRoot: 'Vaultide',
      receiptId: receipt.id,
      syncedAt: '2026-07-28T05:00:02.000Z',
    });

    expect(first).toEqual({ path: 'Vaultide/系统/回写日志.md', appended: true });
    expect(second.appended).toBe(false);
    expect(synced.appended).toBe(true);
    expect(syncedAgain.appended).toBe(false);
    const content = files.get(first.path)?.content ?? '';
    expect(content).toContain(receipt.id);
    expect(content).toContain(receipt.resultingPath);
    expect(content).not.toContain('accessToken');
    expect(content).toContain('服务器同步完成');
    expect(content.match(new RegExp(`<!-- vaultide:receipt ${receipt.id} -->`, 'g'))).toHaveLength(
      1,
    );
  });

  it('records an immutable project revision once without note content or credentials', async () => {
    const files = new Map<string, { file: TFile; content: string }>();
    const app = {
      vault: {
        getAbstractFileByPath: vi.fn((path: string) => files.get(path)?.file ?? null),
        createFolder: vi.fn(async () => undefined),
        create: vi.fn(async (path: string, content: string) => {
          const file = new TFile();
          Object.defineProperty(file, 'path', { value: path, configurable: true });
          files.set(path, { file, content });
          return file;
        }),
        read: vi.fn(async (file: TFile) => files.get(file.path)?.content ?? ''),
        modify: vi.fn(async (file: TFile, content: string) => {
          files.set(file.path, { file, content });
        }),
      },
    };
    const input = {
      app: app as never,
      managedRoot: 'Vaultide',
      projectId: `prj_${'1'.repeat(32)}`,
      folderPath: 'Projects/Alpha',
      projectRevision: 9,
      manifestId: `prm_${'2'.repeat(32)}`,
      manifestSha256: '3'.repeat(64),
      sourceCount: 12,
      finalizedAt: '2026-07-28T06:00:00.000Z',
    };

    const first = await appendProjectRevisionAuditLog(input);
    const second = await appendProjectRevisionAuditLog(input);
    const content = files.get(first.path)?.content ?? '';

    expect(first.appended).toBe(true);
    expect(second.appended).toBe(false);
    expect(content).toContain('项目修订已固定');
    expect(content).toContain(input.manifestId);
    expect(content).toContain(input.manifestSha256);
    expect(content).not.toContain('accessToken');
    expect(content).not.toContain('ACCESS_CODE');
    expect(
      content.match(new RegExp(`<!-- vaultide:project-revision ${input.manifestId} -->`, 'g')),
    ).toHaveLength(1);
  });
});
