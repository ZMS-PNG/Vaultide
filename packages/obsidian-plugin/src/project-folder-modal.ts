import {
  FuzzySuggestModal,
  Modal,
  Notice,
  Setting,
  type App,
  type ButtonComponent,
  type TFolder,
} from 'obsidian';
import {
  isProjectEntryCandidate,
  planProjectBatches,
  projectExclusionLabel,
  projectSelectionMetrics,
  projectSyncLimitError,
  type ProjectFileCandidate,
  type ProjectFolderScan,
} from './project-folder';

function formatBytes(bytes: number): string {
  if (bytes < 1_000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${(bytes / 1_000).toFixed(1)} KB`;
  return `${(bytes / 1_000_000).toFixed(2)} MB`;
}

function statusLabel(status: ProjectFileCandidate['status']): string {
  switch (status) {
    case 'new':
      return '新增';
    case 'modified':
      return '已修改';
    case 'unchanged':
      return '未变化';
  }
}

export class ProjectFolderSuggestModal extends FuzzySuggestModal<TFolder> {
  constructor(
    app: App,
    private readonly onChooseFolder: (folder: TFolder) => void,
  ) {
    super(app);
    this.setPlaceholder('选择一个 Obsidian 项目文件夹');
  }

  getItems(): TFolder[] {
    return this.app.vault
      .getAllFolders(false)
      .filter((folder) => folder.path.length > 0)
      .sort((left, right) => left.path.localeCompare(right.path));
  }

  getItemText(folder: TFolder): string {
    return folder.path;
  }

  onChooseItem(folder: TFolder): void {
    this.onChooseFolder(folder);
  }
}

export class ProjectFolderSelectionModal extends Modal {
  private readonly selectedPaths = new Set<string>();
  private summaryEl?: HTMLDivElement;
  private errorEl?: HTMLDivElement;
  private continueButton?: ButtonComponent;

  constructor(
    app: App,
    private readonly scan: ProjectFolderScan,
    private readonly onConfirm: (files: ProjectFileCandidate[]) => Promise<void>,
  ) {
    super(app);
    const initial = scan.candidates.filter((candidate) => candidate.status !== 'unchanged');
    for (const candidate of initial) this.selectedPaths.add(candidate.file.path);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass('openmaic-project-selection');
    contentEl.createEl('h2', { text: `学习项目：${this.scan.folderPath}` });
    contentEl.createEl('p', {
      text: '这里是本地授权清单。只会上传你勾选的 Markdown；确认一次后，知洄会自动分批、逐批校验并建立检索索引。附件、回写目录、隐藏目录和模板目录不会上传。',
      cls: 'openmaic-source-preview__warning',
    });
    contentEl.createEl('p', {
      text: `本地扫描：${this.scan.candidates.length} 份可学习 Markdown · ${this.scan.excluded.length} 份规则排除 · ${this.scan.unsupported.length} 个不支持附件。服务器不会知道未授权文件的路径。`,
      cls: 'openmaic-source-preview__meta',
    });
    this.summaryEl = contentEl.createDiv({ cls: 'openmaic-source-preview__meta' });
    this.errorEl = contentEl.createDiv({ cls: 'openmaic-project-selection__error' });

    const selectionActions = new Setting(contentEl);
    selectionActions.addButton((button) =>
      button.setButtonText('全选').onClick(() => this.setAllSelected(true)),
    );
    selectionActions.addButton((button) =>
      button.setButtonText('清空').onClick(() => this.setAllSelected(false)),
    );
    selectionActions.addButton((button) =>
      button.setButtonText('仅新增/修改').onClick(() => this.selectChangedFiles()),
    );

    const list = contentEl.createDiv({ cls: 'openmaic-project-selection__files' });
    for (const candidate of this.scan.candidates) {
      const row = list.createEl('label', { cls: 'openmaic-project-selection__file' });
      const checkbox = row.createEl('input');
      checkbox.type = 'checkbox';
      checkbox.checked = this.selectedPaths.has(candidate.file.path);
      checkbox.dataset.path = candidate.file.path;
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) this.selectedPaths.add(candidate.file.path);
        else this.selectedPaths.delete(candidate.file.path);
        this.updateSummary();
      });
      row.createSpan({ text: candidate.relativePath });
      if (isProjectEntryCandidate(candidate)) {
        row.createSpan({
          text: '项目入口',
          cls: 'openmaic-project-selection__status is-entry',
        });
      }
      row.createSpan({
        text: statusLabel(candidate.status),
        cls: `openmaic-project-selection__status is-${candidate.status}`,
      });
      row.createSpan({
        text: formatBytes(candidate.byteSize),
        cls: 'openmaic-project-selection__size',
      });
    }

    if (this.scan.excluded.length > 0) {
      const details = contentEl.createEl('details');
      details.createEl('summary', {
        text: `自动排除 ${this.scan.excluded.length} 份笔记`,
      });
      const excludedList = details.createEl('ul', { cls: 'openmaic-source-preview__files' });
      for (const excluded of this.scan.excluded) {
        excludedList.createEl('li', {
          text: `${excluded.relativePath} — ${projectExclusionLabel(excluded.reason)}`,
        });
      }
    }

    if (this.scan.unsupported.length > 0) {
      const extensionCounts = new Map<string, number>();
      for (const file of this.scan.unsupported) {
        extensionCounts.set(file.extension, (extensionCounts.get(file.extension) ?? 0) + 1);
      }
      const details = contentEl.createEl('details');
      details.createEl('summary', {
        text: `不支持的附件 ${this.scan.unsupported.length} 个（不会上传）`,
      });
      details.createEl('p', {
        text: [...extensionCounts.entries()]
          .map(([extension, count]) => `${extension}: ${count}`)
          .join(' · '),
        cls: 'openmaic-source-preview__meta',
      });
    }

    const actions = new Setting(contentEl);
    actions.addButton((button) => button.setButtonText('取消').onClick(() => this.close()));
    actions.addButton((button) => {
      this.continueButton = button;
      button
        .setCta()
        .setButtonText('授权并自动同步')
        .onClick(async () => {
          const selected = this.selectedCandidates();
          const error = projectSyncLimitError(projectSelectionMetrics(selected));
          if (error) {
            new Notice(error);
            return;
          }
          button.setDisabled(true);
          this.close();
          try {
            await this.onConfirm(selected);
          } catch (caught) {
            new Notice(caught instanceof Error ? caught.message : '无法生成项目快照。');
          }
        });
    });

    this.updateSummary();
  }

  private selectedCandidates(): ProjectFileCandidate[] {
    return this.scan.candidates.filter((candidate) => this.selectedPaths.has(candidate.file.path));
  }

  private setAllSelected(selected: boolean): void {
    if (selected) {
      for (const candidate of this.scan.candidates) this.selectedPaths.add(candidate.file.path);
    } else {
      this.selectedPaths.clear();
    }
    for (const checkbox of Array.from(
      this.contentEl.querySelectorAll<HTMLInputElement>(
        '.openmaic-project-selection__file input[type="checkbox"]',
      ),
    )) {
      checkbox.checked = selected;
    }
    this.updateSummary();
  }

  private selectChangedFiles(): void {
    this.selectedPaths.clear();
    for (const candidate of this.scan.candidates.filter(
      (candidate) => candidate.status !== 'unchanged',
    )) {
      this.selectedPaths.add(candidate.file.path);
    }
    for (const checkbox of Array.from(
      this.contentEl.querySelectorAll<HTMLInputElement>(
        '.openmaic-project-selection__file input[type="checkbox"]',
      ),
    )) {
      checkbox.checked = this.selectedPaths.has(checkbox.dataset.path ?? '');
    }
    this.updateSummary();
  }

  private updateSummary(): void {
    const selected = this.selectedCandidates();
    const metrics = projectSelectionMetrics(selected);
    const error = projectSyncLimitError(metrics);
    if (this.summaryEl) {
      const changedCount = selected.filter((candidate) => candidate.status !== 'unchanged').length;
      const unauthorizedCount = this.scan.candidates.length - metrics.itemCount;
      const missingEntryCount = this.scan.candidates.filter(
        (candidate) =>
          isProjectEntryCandidate(candidate) && !this.selectedPaths.has(candidate.file.path),
      ).length;
      const batchCount = error ? 0 : planProjectBatches(selected).length;
      this.summaryEl.setText(
        `已授权 ${metrics.itemCount} 份 · ${formatBytes(metrics.byteSize)} · ${changedCount} 份新增或修改 · 将自动分为 ${batchCount} 批 · 未授权 ${unauthorizedCount} 份${missingEntryCount > 0 ? ` · 注意：有 ${missingEntryCount} 份项目入口未授权` : ''}`,
      );
    }
    if (this.errorEl) {
      this.errorEl.setText(error ?? '');
      this.errorEl.toggleClass('is-visible', Boolean(error));
    }
    this.continueButton?.setDisabled(Boolean(error));
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
