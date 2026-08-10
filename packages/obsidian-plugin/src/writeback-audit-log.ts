import { normalizePath, TFile, type App } from 'obsidian';
import type { WritebackReceipt } from '@openmaic/learning-protocol';
import { normalizeManagedRoot } from './writeback-safety';

function oneLine(value: string): string {
  return value.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').trim();
}

async function ensureFolder(app: App, path: string): Promise<void> {
  let current = '';
  for (const segment of path.split('/').filter(Boolean)) {
    current = current ? `${current}/${segment}` : segment;
    if (!app.vault.getAbstractFileByPath(current)) {
      await app.vault.createFolder(current);
    }
  }
}

function initialLog(): string {
  return [
    '---',
    'tags: ["vaultide","writeback-audit"]',
    'maic_status: "active"',
    'maic_managed: true',
    '---',
    '',
    '# 知洄同步与回写日志',
    '',
    '> 本日志只记录项目修订、回写结果、目标路径和同步状态，不保存访问码、设备令牌、模型密钥或笔记正文。',
    '',
  ].join('\n');
}

function receiptEntry(receipt: WritebackReceipt): string {
  const marker = `<!-- vaultide:receipt ${receipt.id} -->`;
  const fields = [
    receipt.reportedAt,
    receipt.outcome,
    receipt.resultingPath ?? receipt.commandId,
    '服务器同步：待回传',
    receipt.appliedAt ? `应用于 ${receipt.appliedAt}` : undefined,
    receipt.resultingContentHash ? `SHA-256 ${receipt.resultingContentHash}` : undefined,
    receipt.conflictDetail ? oneLine(receipt.conflictDetail) : undefined,
  ].filter((value): value is string => Boolean(value));
  return `${marker}\n- ${fields.map(oneLine).join(' | ')}\n`;
}

export function writebackAuditLogPath(managedRoot: string): string {
  return normalizePath(`${normalizeManagedRoot(managedRoot)}/系统/回写日志.md`);
}

export async function appendWritebackAuditLog(options: {
  app: App;
  managedRoot: string;
  receipt: WritebackReceipt;
}): Promise<{ path: string; appended: boolean }> {
  const root = normalizeManagedRoot(options.managedRoot);
  const folder = normalizePath(`${root}/系统`);
  const path = writebackAuditLogPath(root);
  const marker = `<!-- vaultide:receipt ${options.receipt.id} -->`;
  const existing = options.app.vault.getAbstractFileByPath(path);
  if (existing instanceof TFile) {
    const current = await options.app.vault.read(existing);
    if (current.includes(marker)) return { path, appended: false };
    await options.app.vault.modify(
      existing,
      `${current.replace(/\s*$/, '\n\n')}${receiptEntry(options.receipt)}`,
    );
    return { path, appended: true };
  }
  if (existing) throw new Error(`Writeback audit path is not a Markdown file: ${path}`);
  await ensureFolder(options.app, folder);
  await options.app.vault.create(path, `${initialLog()}${receiptEntry(options.receipt)}`);
  return { path, appended: true };
}

export async function appendWritebackAuditSync(options: {
  app: App;
  managedRoot: string;
  receiptId: string;
  syncedAt: string;
}): Promise<{ path: string; appended: boolean }> {
  const path = writebackAuditLogPath(options.managedRoot);
  const marker = `<!-- vaultide:receipt-sync ${options.receiptId} -->`;
  const file = options.app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) {
    throw new Error(`Writeback audit log was not found: ${path}`);
  }
  const current = await options.app.vault.read(file);
  if (current.includes(marker)) return { path, appended: false };
  const entry = `${marker}\n  - 服务器同步完成：${oneLine(options.syncedAt)}\n`;
  await options.app.vault.modify(file, `${current.replace(/\s*$/, '\n')}${entry}`);
  return { path, appended: true };
}

export async function appendProjectRevisionAuditLog(options: {
  app: App;
  managedRoot: string;
  projectId: string;
  folderPath: string;
  projectRevision: number;
  manifestId: string;
  manifestSha256: string;
  sourceCount: number;
  finalizedAt: string;
}): Promise<{ path: string; appended: boolean }> {
  const root = normalizeManagedRoot(options.managedRoot);
  const folder = normalizePath(`${root}/系统`);
  const path = writebackAuditLogPath(root);
  const marker = `<!-- vaultide:project-revision ${options.manifestId} -->`;
  const entry = [
    marker,
    `- ${oneLine(options.finalizedAt)} | 项目修订已固定 | ${oneLine(options.folderPath)} | revision ${options.projectRevision} | ${options.sourceCount} 份来源 | manifest ${oneLine(options.manifestId)} | SHA-256 ${oneLine(options.manifestSha256)} | project ${oneLine(options.projectId)}`,
    '',
  ].join('\n');
  const existing = options.app.vault.getAbstractFileByPath(path);
  if (existing instanceof TFile) {
    const current = await options.app.vault.read(existing);
    if (current.includes(marker)) return { path, appended: false };
    await options.app.vault.modify(existing, `${current.replace(/\s*$/, '\n\n')}${entry}`);
    return { path, appended: true };
  }
  if (existing) throw new Error(`Writeback audit path is not a Markdown file: ${path}`);
  await ensureFolder(options.app, folder);
  await options.app.vault.create(path, `${initialLog()}${entry}`);
  return { path, appended: true };
}
