import { Modal, Setting, type App } from 'obsidian';
import type { WritebackCommand } from '@openmaic/learning-protocol';

export class WritebackPreviewModal extends Modal {
  private settled = false;

  constructor(
    app: App,
    private readonly command: WritebackCommand,
    private readonly settle: (approved: boolean) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass('openmaic-writeback-preview');
    const isCreate = this.command.operation === 'createManagedNote';
    const isManagedUpdate = this.command.operation === 'replaceManagedBlocks';
    const isProjectIndexUpdate = this.command.operation === 'replaceProjectIndexBlocks';
    const isSynthesisIndexUpdate = this.command.operation === 'replaceSynthesisIndexBlocks';
    const isVaultOverviewUpdate = this.command.operation === 'replaceVaultOverviewBlocks';

    contentEl.createEl('h2', { text: '确认知洄回写' });
    if (
      !isCreate &&
      !isManagedUpdate &&
      !isProjectIndexUpdate &&
      !isSynthesisIndexUpdate &&
      !isVaultOverviewUpdate
    ) {
      contentEl.createEl('p', {
        text: `当前连接器不支持该操作：${this.command.operation}`,
        cls: 'openmaic-source-preview__warning',
      });
      new Setting(contentEl).addButton((button) =>
        button.setButtonText('关闭').onClick(() => this.finish(false)),
      );
      return;
    }

    contentEl.createEl('p', {
      text: isCreate
        ? '本操作只会在 Vaultide 受管目录创建一份新的受管笔记，不会覆盖或修改你的原有笔记。'
        : isProjectIndexUpdate
          ? '本操作只会替换项目学习索引中哈希一致的 Vaultide 受管区块；你的“我的补充”和其他自由编辑内容不会被修改。'
          : isSynthesisIndexUpdate
            ? '本操作只会替换周期归纳索引中哈希一致的 Vaultide 受管区块；每份历史快照和你的“我的补充”都不会被修改。'
            : isVaultOverviewUpdate
              ? '本操作只会替换知洄总览中哈希一致的 Vaultide 受管区块；你的“我的补充”和所有原始笔记都不会被修改。'
              : '本操作只会替换伴随笔记中哈希一致的 Vaultide 受管区块；你的“我的补充”和其他自由编辑内容不会被修改。',
      cls: 'openmaic-source-preview__warning',
    });
    contentEl.createEl('div', {
      text: `目标路径：${this.command.arguments.relativePath}`,
      cls: 'openmaic-source-preview__meta',
    });
    contentEl.createEl('pre', {
      text: isCreate
        ? this.command.arguments.content
        : this.command.arguments.blocks
            .map((block) => `# 受管区块：${block.id}\n\n${block.content}`)
            .join('\n\n---\n\n'),
      cls: 'openmaic-writeback-preview__content',
    });

    const actions = new Setting(contentEl);
    actions.addButton((button) =>
      button
        .setWarning()
        .setButtonText('拒绝')
        .onClick(() => this.finish(false)),
    );
    actions.addButton((button) =>
      button
        .setCta()
        .setButtonText(
          isCreate
            ? '创建受管笔记'
            : isProjectIndexUpdate
              ? '更新项目学习索引'
              : isSynthesisIndexUpdate
                ? '更新周期归纳索引'
                : isVaultOverviewUpdate
                  ? '更新知洄总览'
                  : '更新受管区块',
        )
        .onClick(() => this.finish(true)),
    );
  }

  onClose(): void {
    if (!this.settled) this.settle(false);
    this.contentEl.empty();
  }

  private finish(approved: boolean): void {
    if (this.settled) return;
    this.settled = true;
    this.settle(approved);
    this.close();
  }
}

export function confirmWriteback(app: App, command: WritebackCommand): Promise<boolean> {
  return new Promise((resolve) => new WritebackPreviewModal(app, command, resolve).open());
}
