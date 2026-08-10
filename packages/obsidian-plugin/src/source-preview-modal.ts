import { Modal, Notice, Setting, type App } from 'obsidian';
import type { SourceBundle } from '@openmaic/learning-protocol';

export class SourcePreviewModal extends Modal {
  constructor(
    app: App,
    private readonly bundle: SourceBundle,
    private readonly actions: {
      title?: string;
      canUpload: boolean;
      onUpload: () => Promise<void>;
    },
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass('openmaic-source-preview');
    contentEl.createEl('h2', { text: this.actions.title ?? '知洄资料快照预览' });
    contentEl.createEl('p', {
      text: '只有在你明确批准后才会上传；上传内容仅包含下面列出的笔记快照。',
      cls: 'openmaic-source-preview__warning',
    });
    contentEl.createEl('div', {
      text: `${this.bundle.itemCount} 份笔记 · ${this.bundle.byteSize.toLocaleString()} bytes · 保留至 ${this.bundle.retentionUntil.slice(0, 10)}`,
      cls: 'openmaic-source-preview__meta',
    });
    const list = contentEl.createEl('ul', { cls: 'openmaic-source-preview__files' });
    for (const snapshot of this.bundle.snapshots) {
      const path = snapshot.origin === 'obsidian' ? snapshot.locator.relativePath : snapshot.title;
      list.createEl('li', {
        text: `${path} — ${snapshot.byteSize.toLocaleString()} bytes — ${snapshot.contentHash.slice(0, 12)}…`,
      });
    }
    contentEl
      .createEl('details')
      .createEl('summary', { text: '快照身份信息' })
      .parentElement?.createEl('pre', {
        text: `bundleId: ${this.bundle.id}\nmanifestHash: ${this.bundle.manifestHash}`,
      });

    const actions = new Setting(contentEl);
    actions.addButton((button) => button.setButtonText('关闭').onClick(() => this.close()));
    actions.addButton((button) => {
      button
        .setCta()
        .setButtonText(this.actions.canUpload ? '批准私有上传' : '请先配对设备')
        .setDisabled(!this.actions.canUpload)
        .onClick(async () => {
          button.setDisabled(true);
          try {
            await this.actions.onUpload();
            this.close();
          } catch (error) {
            new Notice(error instanceof Error ? error.message : '私有上传失败。');
          } finally {
            button.setDisabled(false);
          }
        });
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
