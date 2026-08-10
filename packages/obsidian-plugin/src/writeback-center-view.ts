import { ItemView, Notice, type WorkspaceLeaf } from 'obsidian';
import type { WritebackCommand } from '@openmaic/learning-protocol';
import type OpenMaicLearningPlugin from './main';
import type { WritebackActivityRecord, WritebackCenterSnapshot } from './writeback-center-state';

export const WRITEBACK_CENTER_VIEW_TYPE = 'vaultide-writeback-center';

function operationLabel(command: WritebackCommand): string {
  switch (command.operation) {
    case 'createManagedNote':
      return '创建学习伴随笔记';
    case 'replaceManagedBlocks':
      return '更新伴随笔记';
    case 'replaceProjectIndexBlocks':
      return '更新项目学习索引';
    case 'replaceSynthesisIndexBlocks':
      return '更新归纳索引';
    case 'replaceVaultOverviewBlocks':
      return '更新知洄总览';
    default:
      return command.operation;
  }
}

function outcomeLabel(activity: WritebackActivityRecord): string {
  switch (activity.receipt.outcome) {
    case 'applied':
      return '已完成';
    case 'conflicted':
      return '存在冲突';
    case 'expired':
      return '命令过期';
    case 'rejected':
      return '已拒绝';
    default:
      return '执行失败';
  }
}

function localTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export class WritebackCenterView extends ItemView {
  private snapshot: WritebackCenterSnapshot | null = null;
  private busy = false;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly plugin: OpenMaicLearningPlugin,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return WRITEBACK_CENTER_VIEW_TYPE;
  }

  getDisplayText(): string {
    return '知洄回写中心';
  }

  getIcon(): string {
    return 'inbox';
  }

  async onOpen(): Promise<void> {
    this.render();
    await this.refresh(true);
  }

  async refresh(fetchRemote = true): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.render();
    try {
      this.snapshot = await this.plugin.getWritebackCenterSnapshot(fetchRemote);
    } catch (error) {
      new Notice(error instanceof Error ? error.message : '无法刷新知洄回写中心。');
      this.snapshot = await this.plugin.getWritebackCenterSnapshot(false);
    } finally {
      this.busy = false;
      this.render();
    }
  }

  private render(): void {
    const root = this.containerEl.children[1];
    if (!(root instanceof HTMLElement)) return;
    root.empty();
    root.addClass('vaultide-writeback-center');

    const heading = root.createDiv({ cls: 'vaultide-writeback-center__heading' });
    const title = heading.createDiv();
    title.createEl('p', { text: 'Vaultide', cls: 'vaultide-writeback-center__eyebrow' });
    title.createEl('h2', { text: '回写中心' });
    const refreshButton = heading.createEl('button', {
      text: this.busy ? '刷新中…' : '刷新',
      cls: 'mod-muted',
    });
    refreshButton.disabled = this.busy;
    refreshButton.addEventListener('click', () => void this.refresh(true));
    const logButton = heading.createEl('button', {
      text: '打开本地日志',
      cls: 'mod-muted',
    });
    logButton.addEventListener('click', () => {
      void this.plugin.openWritebackAuditLog().catch((error) => {
        new Notice(error instanceof Error ? error.message : '无法打开回写日志。');
      });
    });

    root.createEl('p', {
      text: '集中审查学习沉淀、项目索引和归纳索引。所有写入仍逐条通过路径、身份、哈希和受管区块安全校验；原笔记不会被修改。',
      cls: 'vaultide-writeback-center__intro',
    });

    if (!this.snapshot) {
      root.createDiv({
        text: this.busy ? '正在读取回写状态…' : '尚未读取回写状态。',
        cls: 'vaultide-writeback-center__empty',
      });
      return;
    }

    if (!this.snapshot.paired) {
      const empty = root.createDiv({ cls: 'vaultide-writeback-center__empty' });
      empty.createEl('strong', { text: '这台设备尚未配对' });
      empty.createEl('p', { text: '请先在知洄插件设置中输入网页生成的六位码。' });
      return;
    }

    const metrics = root.createDiv({ cls: 'vaultide-writeback-center__metrics' });
    this.metric(metrics, '待审查', this.snapshot.pending.length, 'is-pending');
    this.metric(metrics, '已完成', this.snapshot.completed.length, 'is-completed');
    this.metric(metrics, '需处理', this.snapshot.failed.length, 'is-failed');

    if (this.snapshot.pendingReceiptCount > 0) {
      const sync = root.createDiv({ cls: 'vaultide-writeback-center__sync' });
      sync.createSpan({
        text: `${this.snapshot.pendingReceiptCount} 条本地结果等待回传网页`,
      });
      const retry = sync.createEl('button', { text: '重试状态同步' });
      retry.disabled = this.busy;
      retry.addEventListener(
        'click',
        () =>
          void this.run(async () => {
            await this.plugin.retryWritebackReceiptSync();
            await this.refresh(true);
          }),
      );
    }

    this.renderPending(root, this.snapshot.pending);
    this.renderHistory(root, '最近完成', this.snapshot.completed, false);
    this.renderHistory(root, '失败与冲突', this.snapshot.failed, true);
  }

  private metric(parent: HTMLElement, label: string, count: number, className: string): void {
    const metric = parent.createDiv({ cls: `vaultide-writeback-center__metric ${className}` });
    metric.createEl('span', { text: String(count) });
    metric.createEl('small', { text: label });
  }

  private renderPending(root: HTMLElement, commands: readonly WritebackCommand[]): void {
    const section = root.createEl('section', { cls: 'vaultide-writeback-center__section' });
    const heading = section.createDiv({ cls: 'vaultide-writeback-center__section-heading' });
    heading.createEl('h3', { text: '待审查' });
    if (commands.length > 1) {
      const applyAll = heading.createEl('button', { text: '逐项审查全部' });
      applyAll.disabled = this.busy;
      applyAll.addEventListener(
        'click',
        () =>
          void this.run(async () => {
            await this.plugin.applyWritebacksFromCenter(commands);
            await this.refresh(true);
          }),
      );
    }

    if (commands.length === 0) {
      section.createDiv({
        text: '没有待回写内容。网页批准新的学习沉淀后，它会出现在这里。',
        cls: 'vaultide-writeback-center__empty',
      });
      return;
    }

    for (const command of commands) {
      const card = section.createDiv({ cls: 'vaultide-writeback-center__card is-pending' });
      card.createEl('strong', { text: operationLabel(command) });
      card.createEl('code', { text: command.arguments.relativePath });
      card.createEl('small', { text: `有效期至 ${localTime(command.expiresAt)}` });
      const action = card.createEl('button', { text: '预览并执行', cls: 'mod-cta' });
      action.disabled = this.busy;
      action.addEventListener(
        'click',
        () =>
          void this.run(async () => {
            await this.plugin.applyWritebacksFromCenter([command]);
            await this.refresh(true);
          }),
      );
    }
  }

  private renderHistory(
    root: HTMLElement,
    title: string,
    activities: readonly WritebackActivityRecord[],
    failed: boolean,
  ): void {
    const section = root.createEl('section', { cls: 'vaultide-writeback-center__section' });
    section.createEl('h3', { text: title });
    if (activities.length === 0) {
      section.createDiv({
        text: failed ? '当前没有失败或冲突。' : '完成回写后会在这里保留最近记录。',
        cls: 'vaultide-writeback-center__empty is-compact',
      });
      return;
    }
    for (const activity of activities.slice(0, 12)) {
      const card = section.createDiv({
        cls: `vaultide-writeback-center__card ${failed ? 'is-failed' : 'is-completed'}`,
      });
      const row = card.createDiv({ cls: 'vaultide-writeback-center__card-row' });
      row.createEl('strong', { text: outcomeLabel(activity) });
      row.createEl('span', {
        text: activity.syncedAt ? '网页已收到' : '等待同步',
        cls: activity.syncedAt ? 'is-synced' : 'is-unsynced',
      });
      card.createEl('code', {
        text: activity.receipt.resultingPath ?? activity.receipt.commandId,
      });
      if (activity.receipt.conflictDetail) {
        card.createEl('p', { text: activity.receipt.conflictDetail });
      }
      card.createEl('small', { text: localTime(activity.receipt.reportedAt) });
      if (failed && !activity.syncedAt) {
        const retry = card.createEl('button', { text: '重试状态同步' });
        retry.disabled = this.busy;
        retry.addEventListener(
          'click',
          () =>
            void this.run(async () => {
              await this.plugin.retryWritebackReceiptSync();
              await this.refresh(true);
            }),
        );
      }
    }
  }

  private async run(action: () => Promise<void>): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.render();
    try {
      await action();
    } catch (error) {
      new Notice(error instanceof Error ? error.message : '知洄回写操作失败。');
    } finally {
      this.busy = false;
      this.render();
    }
  }
}
