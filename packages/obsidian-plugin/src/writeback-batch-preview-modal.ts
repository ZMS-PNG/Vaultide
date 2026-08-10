import { Modal, Setting, type App } from 'obsidian';
import type { WritebackCommand } from '@openmaic/learning-protocol';

export type BatchWritebackDecision = 'apply' | 'defer' | 'reject';

function preview(command: WritebackCommand): string {
  const content =
    command.operation === 'createManagedNote'
      ? command.arguments.content
      : command.operation === 'replaceManagedBlocks' ||
          command.operation === 'replaceProjectIndexBlocks' ||
          command.operation === 'replaceSynthesisIndexBlocks' ||
          command.operation === 'replaceVaultOverviewBlocks'
        ? command.arguments.blocks
            .map((block) => `## ${block.id}\n\n${block.content}`)
            .join('\n\n---\n\n')
        : `当前连接器不支持该操作：${command.operation}`;
  const limit = 1800;
  return content.length > limit ? `${content.slice(0, limit)}\n\n…（预览已截断）` : content;
}

class WritebackBatchPreviewModal extends Modal {
  private settled = false;

  constructor(
    app: App,
    private readonly commands: readonly WritebackCommand[],
    private readonly settle: (decision: BatchWritebackDecision) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass('openmaic-writeback-preview');
    contentEl.createEl('h2', { text: `批量审查 ${this.commands.length} 条知洄回写` });
    contentEl.createEl('p', {
      text: '请先审查每一项的目标路径与内容。即使一次确认，插件仍会逐条执行路径、身份、哈希与受管区块安全校验；任一冲突都会停止该项，不会触碰原有笔记。',
      cls: 'openmaic-source-preview__warning',
    });

    for (const [index, command] of this.commands.entries()) {
      const details = contentEl.createEl('details');
      if (index === 0) details.setAttr('open', '');
      details.createEl('summary', {
        text: `${index + 1}. ${command.operation === 'createManagedNote' ? '创建受管笔记' : command.operation === 'replaceProjectIndexBlocks' ? '更新项目学习索引' : command.operation === 'replaceSynthesisIndexBlocks' ? '更新周期归纳索引' : command.operation === 'replaceVaultOverviewBlocks' ? '更新知洄总览' : '更新伴随笔记受管区块'} · ${command.arguments.relativePath}`,
      });
      details.createEl('div', {
        text: `目标路径：${command.arguments.relativePath}`,
        cls: 'openmaic-source-preview__meta',
      });
      details.createEl('pre', {
        text: preview(command),
        cls: 'openmaic-writeback-preview__content',
      });
    }

    const actions = new Setting(contentEl);
    actions.addButton((button) =>
      button.setButtonText('稍后处理').onClick(() => this.finish('defer')),
    );
    actions.addButton((button) =>
      button
        .setWarning()
        .setButtonText('拒绝这批')
        .onClick(() => this.finish('reject')),
    );
    actions.addButton((button) =>
      button
        .setCta()
        .setButtonText(`确认应用 ${this.commands.length} 项`)
        .onClick(() => this.finish('apply')),
    );
  }

  onClose(): void {
    if (!this.settled) this.settle('defer');
    this.contentEl.empty();
  }

  private finish(decision: BatchWritebackDecision): void {
    if (this.settled) return;
    this.settled = true;
    this.settle(decision);
    this.close();
  }
}

export function confirmWritebackBatch(
  app: App,
  commands: readonly WritebackCommand[],
): Promise<BatchWritebackDecision> {
  return new Promise((resolve) => new WritebackBatchPreviewModal(app, commands, resolve).open());
}
