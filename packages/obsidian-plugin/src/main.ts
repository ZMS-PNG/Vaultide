import { Notice, Plugin, TFile, TFolder } from 'obsidian';
import {
  LEARNING_PROTOCOL_VERSION,
  type WritebackCommand,
  type WritebackReceipt,
} from '@openmaic/learning-protocol';
import { fetchDepositionPolicy, updateDepositionPolicy } from './deposition-policy-client';
import { createEntityId, createLocalIdentity, type LocalIdentity } from './identity';
import { fetchProjectSyncCapabilities } from './integration-capabilities';
import { readSelectedNote } from './obsidian-source';
import { exchangePairingCode, refreshDeviceCredentials, revokeDeviceCredentials } from './pairing';
import {
  ensureProjectSourceIds,
  MAX_PROJECT_ARCHIVE_BYTES,
  MAX_PROJECT_SOURCE_BYTES,
  MAX_PROJECT_SOURCE_ITEMS,
  planProjectBatches,
  savedProjectBindings,
  scanProjectFolder,
  type ProjectBinding,
  type ProjectFileCandidate,
} from './project-folder';
import { ProjectFolderSelectionModal, ProjectFolderSuggestModal } from './project-folder-modal';
import { finalizeProjectSync, registerProjectBinding } from './project-client';
import {
  commitFinalizedProjectBinding,
  createProjectSyncStagingState,
  sourceIdsForProjectFinalization,
  stageValidatedProjectBatch,
} from './project-sync-state';
import { OpenMaicSettingTab } from './settings';
import {
  buildProjectSourceReferences,
  buildSourceArchive,
  buildSourceBundleFromNotes,
  type SelectedNoteInput,
} from './source-bundle';
import { SourcePreviewModal } from './source-preview-modal';
import { buildProjectSourceUploadIntent, uploadSourceArchive } from './source-upload';
import { waitForValidatedSourceUpload } from './source-upload-status';
import { normalizeServerUrl } from './server-url';
import { verifySiteAccessCode, type SiteAccessCodeVerification } from './site-access';
import {
  fetchPendingWritebacks,
  markWritebackLocallyValidated,
  submitWritebackReceipt,
} from './writeback-client';
import { confirmWriteback } from './writeback-preview-modal';
import {
  confirmWritebackBatch,
  type BatchWritebackDecision,
} from './writeback-batch-preview-modal';
import { isAutomaticallyApplicableManagedUpdate } from './writeback-automation';
import {
  buildWritebackCenterSnapshot,
  markWritebackActivitySynced,
  recordWritebackActivity,
  savedWritebackActivity,
  type WritebackActivityRecord,
  type WritebackCenterSnapshot,
} from './writeback-center-state';
import { WRITEBACK_CENTER_VIEW_TYPE, WritebackCenterView } from './writeback-center-view';
import {
  appendProjectRevisionAuditLog,
  appendWritebackAuditLog,
  appendWritebackAuditSync,
  writebackAuditLogPath,
} from './writeback-audit-log';
import {
  applyCreateManagedNote,
  applyReplaceManagedBlocks,
  applyReplaceProjectIndexBlocks,
  applyReplaceSynthesisIndexBlocks,
  applyReplaceVaultOverviewBlocks,
  DEFAULT_MANAGED_ROOT,
  resolveManagedWritebackPath,
  WritebackSafetyError,
} from './writeback-safety';

const ACCESS_TOKEN_SECRET = 'openmaic-learning-access-token';
const REFRESH_TOKEN_SECRET = 'openmaic-learning-refresh-token';
const SITE_ACCESS_CODE_SECRET = 'vaultide-site-access-code';

export interface OpenMaicPluginSettings extends LocalIdentity {
  serverUrl: string;
  retentionDays: number;
  managedRoot: string;
  pendingWritebackReceipts: WritebackReceipt[];
  writebackActivity: WritebackActivityRecord[];
  projectBindings: ProjectBinding[];
  /** Stable identities for explicitly selected single notes. */
  noteSourceIds: Record<string, string>;
  /** Manual review can be one preview per command or one explicit batch preview. */
  writebackReviewMode: 'manual' | 'batch';
  /**
   * A local, explicit consent switch. The server-side policy is only an
   * attestation of this setting; it can never cause this connector to write
   * unless this local setting remains enabled too.
   */
  managedAutomationEnabled: boolean;
  managedAutomationIntervalMinutes: number;
  managedAutomationLastRunAt?: string;
  managedAutomationLastMessage?: string;
  pairedAt?: string;
  tokenExpiresAt?: string;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function savedReceipts(value: unknown): WritebackReceipt[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => {
    if (typeof item !== 'object' || item === null) return false;
    const receipt = item as Partial<WritebackReceipt>;
    return (
      receipt.protocolVersion === LEARNING_PROTOCOL_VERSION &&
      typeof receipt.id === 'string' &&
      typeof receipt.commandId === 'string' &&
      typeof receipt.deviceId === 'string' &&
      typeof receipt.outcome === 'string' &&
      typeof receipt.reportedAt === 'string'
    );
  }) as WritebackReceipt[];
}

function savedNoteSourceIds(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const result: Record<string, string> = {};
  for (const [path, sourceId] of Object.entries(value)) {
    if (typeof sourceId === 'string' && /^sou_[a-f0-9]{32}$/.test(sourceId)) {
      result[path] = sourceId;
    }
  }
  return result;
}

function savedManagedAutomationInterval(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 5 && value <= 60
    ? value
    : 15;
}

function savedWritebackReviewMode(value: unknown): 'manual' | 'batch' {
  return value === 'batch' ? 'batch' : 'manual';
}

interface CheckWritebacksOptions {
  /** Never bypasses local safety validation; it only skips the preview for a narrow allowlist. */
  automated?: boolean;
  /** Commands already leased and displayed by the writeback center. */
  commands?: readonly WritebackCommand[];
}

export type StoredSiteAccessCodeState =
  | 'missing'
  | 'stored'
  | 'checking'
  | SiteAccessCodeVerification
  | 'unreachable';

export default class OpenMaicLearningPlugin extends Plugin {
  bridgeSettings!: OpenMaicPluginSettings;
  private managedAutomationIntervalId: number | undefined;
  private writebackCenterPending: WritebackCommand[] = [];
  private storedSiteAccessCodeState: StoredSiteAccessCodeState = 'missing';

  async onload(): Promise<void> {
    await this.loadSettings();
    this.storedSiteAccessCodeState = this.hasStoredSiteAccessCode() ? 'stored' : 'missing';
    this.addSettingTab(new OpenMaicSettingTab(this.app, this));
    this.registerView(WRITEBACK_CENTER_VIEW_TYPE, (leaf) => new WritebackCenterView(leaf, this));

    this.addRibbonIcon('book-open-check', 'Preview active note for Vaultide', () => {
      void this.previewActiveNote();
    });

    this.addRibbonIcon('inbox', 'Open Vaultide writeback center', () => {
      void this.openWritebackCenter();
    });

    this.addCommand({
      id: 'preview-active-note-source-bundle',
      name: 'Preview active note as a SourceBundle',
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        const available = file instanceof TFile && file.extension.toLowerCase() === 'md';
        if (available && !checking) void this.previewActiveNote();
        return available;
      },
    });

    this.addCommand({
      id: 'check-and-apply-writebacks',
      name: 'Check and apply Vaultide writebacks',
      callback: () => void this.checkWritebacks(),
    });

    this.addCommand({
      id: 'open-writeback-center',
      name: 'Open Vaultide writeback center',
      callback: () => void this.openWritebackCenter(),
    });

    this.addCommand({
      id: 'open-vaultide-website',
      name: 'Open Vaultide website and copy saved access code',
      callback: () => void this.openWebsiteWithAccessCode(),
    });

    this.addCommand({
      id: 'verify-vaultide-site-access-code',
      name: 'Verify saved Vaultide website access code',
      callback: () => void this.verifyStoredSiteAccessCodeWithNotice(),
    });

    this.addCommand({
      id: 'copy-vaultide-site-access-code',
      name: 'Retrieve saved Vaultide website access code',
      callback: () =>
        void this.copyStoredSiteAccessCode()
          .then(() => new Notice('网页访问码已从 SecretStorage 取回并复制。'))
          .catch(
            (error) => new Notice(error instanceof Error ? error.message : '无法取回网页访问码。'),
          ),
    });

    this.addCommand({
      id: 'preview-project-folder-source-bundle',
      name: 'Preview a project folder as a SourceBundle',
      callback: () => this.openProjectFolderPicker(),
    });

    this.registerEvent(
      this.app.workspace.on('file-menu', (menu, file) => {
        if (!(file instanceof TFolder)) return;
        menu.addItem((item) =>
          item
            .setTitle('用知洄学习此项目文件夹')
            .setIcon('book-open-check')
            .onClick(() => void this.previewProjectFolder(file)),
        );
      }),
    );

    this.registerEvent(
      this.app.vault.on('rename', (file, oldPath) => {
        if (!(file instanceof TFile)) return;
        void this.preserveSourceIdentityOnRename(file, oldPath);
      }),
    );

    this.app.workspace.onLayoutReady(() => {
      void this.backfillWritebackAuditLog();
      if (!this.isPaired()) return;
      if (this.bridgeSettings.pendingWritebackReceipts.length > 0) {
        void this.flushPendingReceipts().catch((error) => {
          console.warn('Vaultide pending receipt sync did not complete.', error);
        });
      }
      this.configureManagedAutomation();
      if (this.bridgeSettings.managedAutomationEnabled) {
        void this.checkWritebacks({ automated: true });
      }
    });
  }

  onunload(): void {
    this.stopManagedAutomation();
  }

  async openWritebackCenter(): Promise<void> {
    let leaf = this.app.workspace.getLeavesOfType(WRITEBACK_CENTER_VIEW_TYPE)[0];
    if (!leaf) {
      leaf = this.app.workspace.getRightLeaf(false) ?? this.app.workspace.getLeaf(true);
      await leaf.setViewState({
        type: WRITEBACK_CENTER_VIEW_TYPE,
        active: true,
      });
    }
    await this.app.workspace.revealLeaf(leaf);
  }

  async openWritebackAuditLog(): Promise<void> {
    const path = writebackAuditLogPath(this.bridgeSettings.managedRoot);
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      throw new Error('回写日志尚未生成；完成一次回写后会自动创建。');
    }
    await this.app.workspace.getLeaf(true).openFile(file);
  }

  async getWritebackCenterSnapshot(fetchRemote: boolean): Promise<WritebackCenterSnapshot> {
    if (!this.isPaired()) {
      return buildWritebackCenterSnapshot({
        paired: false,
        pending: [],
        activity: this.bridgeSettings.writebackActivity,
        pendingReceiptCount: this.bridgeSettings.pendingWritebackReceipts.length,
      });
    }
    if (fetchRemote) {
      const accessToken = await this.validAccessToken();
      await this.flushPendingReceipts(accessToken);
      const fetched = await fetchPendingWritebacks({
        serverUrl: this.bridgeSettings.serverUrl,
        accessToken,
        limit: 20,
      });
      const terminalCommands = new Set(
        this.bridgeSettings.writebackActivity.map((item) => item.receipt.commandId),
      );
      const merged = new Map(
        [...this.writebackCenterPending, ...fetched]
          .filter(
            (command) =>
              Date.parse(command.expiresAt) > Date.now() && !terminalCommands.has(command.id),
          )
          .map((command) => [command.id, command]),
      );
      this.writebackCenterPending = [...merged.values()];
    }
    return buildWritebackCenterSnapshot({
      paired: true,
      pending: this.writebackCenterPending,
      activity: this.bridgeSettings.writebackActivity,
      pendingReceiptCount: this.bridgeSettings.pendingWritebackReceipts.length,
    });
  }

  async applyWritebacksFromCenter(commands: readonly WritebackCommand[]): Promise<void> {
    await this.checkWritebacks({ commands });
  }

  async retryWritebackReceiptSync(): Promise<void> {
    if (!this.isPaired()) throw new Error('请先配对这台 Obsidian 设备。');
    await this.flushPendingReceipts();
    new Notice('知洄回写状态已同步到网页。');
  }

  async previewActiveNote(): Promise<void> {
    const file = this.app.workspace.getActiveFile();
    if (!(file instanceof TFile) || file.extension.toLowerCase() !== 'md') {
      new Notice('Open a Markdown note before creating a SourceBundle preview.');
      return;
    }
    try {
      resolveManagedWritebackPath(file.path, this.bridgeSettings.managedRoot);
      new Notice('Vaultide 伴随笔记不能作为新的原始学习来源；请打开它所链接的原有笔记。');
      return;
    } catch {
      // The active file is outside the managed root, which is the only
      // allowed source state for an original user-owned note.
    }
    try {
      const sourceId = this.sourceIdForSingleNote(file.path);
      await this.saveSettings();
      const note = await readSelectedNote(this.app, file, sourceId);
      await this.previewNotes({
        notes: [note],
        selectionReason: 'Active note explicitly selected by the user for a Vaultide preview.',
        previewTitle: `知洄笔记快照：${file.basename}`,
      });
    } catch (error) {
      new Notice(error instanceof Error ? error.message : 'Unable to package the active note.');
    }
  }

  private openProjectFolderPicker(): void {
    new ProjectFolderSuggestModal(this.app, (folder) => {
      void this.previewProjectFolder(folder);
    }).open();
  }

  async previewProjectFolder(folder: TFolder): Promise<void> {
    const binding = this.projectBindingForFolder(folder.path);
    const scan = scanProjectFolder(
      this.app,
      folder,
      this.bridgeSettings.managedRoot,
      binding.files,
    );
    if (scan.candidates.length === 0) {
      new Notice('这个文件夹没有可用于学习的 Markdown 笔记。');
      return;
    }
    new ProjectFolderSelectionModal(this.app, scan, async (candidates) => {
      await this.syncProjectBatches(folder, binding, candidates, scan.candidates);
    }).open();
  }

  private async syncProjectBatches(
    folder: TFolder,
    binding: ProjectBinding,
    candidates: ProjectFileCandidate[],
    allCandidates: ProjectFileCandidate[],
  ): Promise<void> {
    if (!this.isPaired()) throw new Error('请先在知洄设置中配对这台设备。');
    const capabilities = await fetchProjectSyncCapabilities(this.bridgeSettings.serverUrl);
    if (!capabilities.supported || !capabilities.goalRetrievalSupported) {
      throw new Error('当前知洄服务器尚未启用项目自动分批与目标检索，请先升级服务器。');
    }
    const accessToken = await this.validAccessToken();
    let currentBinding = ensureProjectSourceIds(
      binding,
      candidates.map((candidate) => candidate.file.path),
    );
    // Stable source identities are persisted before any network work. A retry
    // therefore cannot silently create a second identity for the same note.
    this.upsertProjectBinding(currentBinding);
    await this.saveSettings();

    const registered = await registerProjectBinding({
      serverUrl: this.bridgeSettings.serverUrl,
      accessToken,
      projectId: currentBinding.id,
      displayName: folder.name,
      folderPath: currentBinding.folderPath,
      expectedBindingRevision: currentBinding.bindingRevision,
    });
    currentBinding = {
      ...currentBinding,
      bindingRevision: registered.bindingRevision,
      registeredAt: registered.registeredAt,
    };
    this.upsertProjectBinding(currentBinding);
    await this.saveSettings();

    const queue = planProjectBatches(candidates);
    let staged = createProjectSyncStagingState({
      projectRevision: registered.projectRevision,
      ...(registered.latestManifestHash ? { baseManifestHash: registered.latestManifestHash } : {}),
    });

    new Notice(`知洄开始同步 ${candidates.length} 份笔记，共 ${queue.length} 批。`, 5000);
    try {
      while (queue.length > 0) {
        const batchCandidates = queue.shift();
        if (!batchCandidates) break;
        const notes = await Promise.all(
          batchCandidates.map((candidate) =>
            readSelectedNote(
              this.app,
              candidate.file,
              currentBinding.sourceIds[candidate.file.path],
            ),
          ),
        );
        const bundle = await buildSourceBundleFromNotes({
          notes,
          identity: this.bridgeSettings,
          selectionReason: `Vaultide project ${currentBinding.id}; folder "${folder.path}"; ${candidates.length} Markdown notes explicitly authorized for automatic batching.`,
          retentionDays: this.bridgeSettings.retentionDays,
        });
        const archive = buildSourceArchive(bundle, notes);
        const archiveBytes = new TextEncoder().encode(JSON.stringify(archive)).byteLength;
        if (archiveBytes > MAX_PROJECT_ARCHIVE_BYTES) {
          if (batchCandidates.length === 1) {
            throw new Error(
              `${batchCandidates[0]?.relativePath ?? '该笔记'} 的安全归档超过 10 MB，无法上传。`,
            );
          }
          const midpoint = Math.ceil(batchCandidates.length / 2);
          queue.unshift(batchCandidates.slice(midpoint));
          queue.unshift(batchCandidates.slice(0, midpoint));
          continue;
        }

        const uploadIntent = buildProjectSourceUploadIntent({
          archive,
          projectId: currentBinding.id,
          expectedProjectRevision: staged.currentProjectRevision,
          baseManifestHash: staged.baseManifestHash,
          coverage: 'partial',
          sources: buildProjectSourceReferences(bundle, currentBinding.sourceIds),
        });
        await uploadSourceArchive({
          serverUrl: this.bridgeSettings.serverUrl,
          accessToken,
          archive,
          uploadIntent,
        });
        const status = await waitForValidatedSourceUpload({
          serverUrl: this.bridgeSettings.serverUrl,
          accessToken,
          bundleId: bundle.id,
          projectId: currentBinding.id,
          expectedProjectRevision: staged.currentProjectRevision,
          requireReadyIndex: true,
        });
        if (status.projectRevision === undefined || status.chunkIndexStatus !== 'ready') {
          throw new Error('项目批次已上传，但检索索引尚未确认可用。');
        }

        const notesByPath = new Map(notes.map((note) => [note.relativePath, note]));
        const files: ProjectBinding['files'] = {};
        for (const snapshot of bundle.snapshots) {
          if (snapshot.origin !== 'obsidian') continue;
          const note = notesByPath.get(snapshot.locator.relativePath);
          files[snapshot.locator.relativePath] = {
            sourceMtime:
              snapshot.locator.sourceMtime ?? note?.sourceMtime ?? new Date(0).toISOString(),
            byteSize: snapshot.byteSize,
            contentHash: snapshot.contentHash,
          };
        }
        staged = stageValidatedProjectBatch(staged, {
          expectedProjectRevision: staged.currentProjectRevision,
          projectRevision: status.projectRevision,
          manifestHash: bundle.manifestHash,
          bundleId: bundle.id,
          indexedChunkCount: status.indexedChunkCount ?? 0,
          files,
        });
        new Notice(
          `项目同步：已校验 ${staged.completedBatches} 批，剩余 ${queue.length} 批；完整修订尚未提交。`,
          4000,
        );
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : '未知错误';
      throw new Error(
        `项目同步在校验 ${staged.completedBatches} 批后中断：${detail} 本地项目修订未推进；重新执行即可安全重试。`,
      );
    }

    if (!staged.lastBundleId) throw new Error('项目同步没有生成可用批次。');
    const sourceIds = sourceIdsForProjectFinalization({
      binding: currentBinding,
      allCandidates,
      selectedCandidates: candidates,
    });
    const finalized = await finalizeProjectSync({
      serverUrl: this.bridgeSettings.serverUrl,
      accessToken,
      projectId: currentBinding.id,
      expectedProjectRevision: staged.currentProjectRevision,
      sourceIds,
      sourceBundleId: staged.lastBundleId,
    });
    const finalizedAt = new Date().toISOString();
    currentBinding = commitFinalizedProjectBinding({
      binding: { ...currentBinding, folderPath: folder.path },
      allCandidates,
      selectedCandidates: candidates,
      staged,
      finalized,
      sourceIds,
      finalizedAt,
    });
    this.upsertProjectBinding(currentBinding);
    await this.saveSettings();
    try {
      await appendProjectRevisionAuditLog({
        app: this.app,
        managedRoot: this.bridgeSettings.managedRoot,
        projectId: currentBinding.id,
        folderPath: currentBinding.folderPath,
        projectRevision: finalized.projectRevision,
        manifestId: finalized.manifestId,
        manifestSha256: finalized.manifestSha256,
        sourceCount: finalized.sourceCount,
        finalizedAt,
      });
    } catch (error) {
      console.warn('Vaultide could not append the local project revision audit log.', error);
    }
    new Notice(
      `项目修订 ${finalized.projectRevision} 已固定：${finalized.sourceCount} 份来源、${staged.completedBatches} 批、${staged.indexedChunks} 个检索分块。`,
      8000,
    );
    window.open(
      `${normalizeServerUrl(this.bridgeSettings.serverUrl)}/learning-source/${staged.lastBundleId}`,
      '_blank',
      'noopener,noreferrer',
    );
  }

  private projectBindingForFolder(folderPath: string): ProjectBinding {
    const existing = this.bridgeSettings.projectBindings.find(
      (binding) => binding.folderPath === folderPath,
    );
    if (existing) return existing;
    return {
      id: createEntityId('prj'),
      folderPath,
      files: {},
      sourceIds: {},
    };
  }

  private upsertProjectBinding(binding: ProjectBinding): void {
    this.bridgeSettings.projectBindings = [
      ...this.bridgeSettings.projectBindings.filter((item) => item.id !== binding.id),
      binding,
    ];
  }

  private async previewNotes(options: {
    notes: SelectedNoteInput[];
    selectionReason: string;
    previewTitle: string;
  }): Promise<void> {
    const bundle = await buildSourceBundleFromNotes({
      notes: options.notes,
      identity: this.bridgeSettings,
      selectionReason: options.selectionReason,
      retentionDays: this.bridgeSettings.retentionDays,
    });
    if (bundle.itemCount > MAX_PROJECT_SOURCE_ITEMS) {
      throw new Error(`一次最多上传 ${MAX_PROJECT_SOURCE_ITEMS} 份笔记。`);
    }
    if (bundle.byteSize > MAX_PROJECT_SOURCE_BYTES) {
      throw new Error('所选笔记总量超过 8 MB。');
    }
    const archive = buildSourceArchive(bundle, options.notes);
    const archiveBytes = new TextEncoder().encode(JSON.stringify(archive)).byteLength;
    if (archiveBytes > MAX_PROJECT_ARCHIVE_BYTES) {
      throw new Error('项目快照归档超过 10 MB；请减少所选笔记后重试。');
    }
    new SourcePreviewModal(this.app, bundle, {
      title: options.previewTitle,
      canUpload: this.isPaired(),
      onUpload: async () => {
        const accessToken = await this.validAccessToken();
        await uploadSourceArchive({
          serverUrl: this.bridgeSettings.serverUrl,
          accessToken,
          archive,
        });
        new Notice('SourceBundle 已私密上传到知洄。');
        const launchUrl = `${normalizeServerUrl(this.bridgeSettings.serverUrl)}/learning-source/${bundle.id}`;
        window.open(launchUrl, '_blank', 'noopener,noreferrer');
      },
    }).open();
  }

  isPaired(): boolean {
    return Boolean(this.app.secretStorage.getSecret(ACCESS_TOKEN_SECRET));
  }

  async pair(code: string): Promise<void> {
    const result = await exchangePairingCode({
      serverUrl: this.bridgeSettings.serverUrl,
      code,
      identity: this.bridgeSettings,
      vaultName: this.app.vault.getName(),
      pluginVersion: this.manifest.version,
    });
    this.app.secretStorage.setSecret(ACCESS_TOKEN_SECRET, result.accessToken);
    this.app.secretStorage.setSecret(REFRESH_TOKEN_SECRET, result.refreshToken);
    this.bridgeSettings.ownerId = result.ownerId;
    this.bridgeSettings.pairedAt = new Date().toISOString();
    this.bridgeSettings.tokenExpiresAt = result.expiresAt;
    await this.saveSettings();
    this.configureManagedAutomation();
  }

  async disconnect(): Promise<void> {
    const refreshToken = this.app.secretStorage.getSecret(REFRESH_TOKEN_SECRET);
    if (refreshToken) {
      try {
        await revokeDeviceCredentials({
          serverUrl: this.bridgeSettings.serverUrl,
          refreshToken,
        });
      } catch {
        console.warn('Vaultide server-side credential revocation did not complete.');
      }
    }
    // SecretStorage currently has no delete API; an empty value is treated as absent.
    this.app.secretStorage.setSecret(ACCESS_TOKEN_SECRET, '');
    this.app.secretStorage.setSecret(REFRESH_TOKEN_SECRET, '');
    this.bridgeSettings.managedAutomationEnabled = false;
    this.stopManagedAutomation();
    delete this.bridgeSettings.pairedAt;
    delete this.bridgeSettings.tokenExpiresAt;
    await this.saveSettings();
  }

  async setManagedAutomationEnabled(enabled: boolean): Promise<void> {
    if (!enabled) {
      // Local consent is removed first. A network error while mirroring that
      // change to the server can never leave an unattended local write path.
      this.bridgeSettings.managedAutomationEnabled = false;
      this.stopManagedAutomation();
      await this.saveSettings();
      if (!this.isPaired()) return;
      try {
        const accessToken = await this.validAccessToken();
        await updateDepositionPolicy({
          serverUrl: this.bridgeSettings.serverUrl,
          accessToken,
          policy: {
            mode: this.bridgeSettings.writebackReviewMode,
            managedAutoEnabled: false,
            allowCompanionUpdates: false,
            allowSynthesisIndexUpdates: false,
            allowExternalCards: false,
          },
        });
      } catch (error) {
        console.warn('Vaultide server automation policy could not be disabled.', error);
        new Notice('本地自动沉淀已关闭；服务器策略会在下次成功连接时同步关闭。');
      }
      return;
    }

    if (!this.isPaired()) {
      throw new Error('请先配对这台 Obsidian 设备，再开启自动沉淀。');
    }
    const accessToken = await this.validAccessToken();
    await updateDepositionPolicy({
      serverUrl: this.bridgeSettings.serverUrl,
      accessToken,
      policy: {
        mode: 'managed-auto',
        managedAutoEnabled: true,
        allowCompanionUpdates: true,
        allowSynthesisIndexUpdates: true,
        allowExternalCards: false,
      },
    });
    this.bridgeSettings.managedAutomationEnabled = true;
    await this.saveSettings();
    this.configureManagedAutomation();
    void this.checkWritebacks({ automated: true });
  }

  async setManagedAutomationIntervalMinutes(minutes: number): Promise<void> {
    const normalized = Math.max(5, Math.min(60, Math.round(minutes)));
    this.bridgeSettings.managedAutomationIntervalMinutes = normalized;
    await this.saveSettings();
    this.configureManagedAutomation();
  }

  async setWritebackReviewMode(mode: 'manual' | 'batch'): Promise<void> {
    if (this.bridgeSettings.managedAutomationEnabled) {
      throw new Error('请先关闭受控自动沉淀，再切换回写确认方式。');
    }
    const previous = this.bridgeSettings.writebackReviewMode;
    this.bridgeSettings.writebackReviewMode = mode;
    await this.saveSettings();
    if (!this.isPaired()) return;
    try {
      const accessToken = await this.validAccessToken();
      await updateDepositionPolicy({
        serverUrl: this.bridgeSettings.serverUrl,
        accessToken,
        policy: {
          mode,
          managedAutoEnabled: false,
          allowCompanionUpdates: false,
          allowSynthesisIndexUpdates: false,
          allowExternalCards: false,
        },
      });
    } catch (error) {
      this.bridgeSettings.writebackReviewMode = previous;
      await this.saveSettings();
      throw error;
    }
  }

  private configureManagedAutomation(): void {
    this.stopManagedAutomation();
    if (!this.isPaired() || !this.bridgeSettings.managedAutomationEnabled) return;
    const intervalMs = this.bridgeSettings.managedAutomationIntervalMinutes * 60_000;
    this.managedAutomationIntervalId = window.setInterval(() => {
      void this.checkWritebacks({ automated: true });
    }, intervalMs);
  }

  private stopManagedAutomation(): void {
    if (this.managedAutomationIntervalId === undefined) return;
    window.clearInterval(this.managedAutomationIntervalId);
    this.managedAutomationIntervalId = undefined;
  }

  private async recordManagedAutomationStatus(message: string): Promise<void> {
    this.bridgeSettings.managedAutomationLastRunAt = new Date().toISOString();
    this.bridgeSettings.managedAutomationLastMessage = message;
    await this.saveSettings();
  }

  async checkWritebacks(options: CheckWritebacksOptions = {}): Promise<void> {
    const automated = options.automated === true;
    if (!this.isPaired()) {
      if (!automated) new Notice('请先配对这台 Obsidian 设备，再检查知洄回写。');
      return;
    }
    if (automated && !this.bridgeSettings.managedAutomationEnabled) return;
    try {
      const accessToken = await this.validAccessToken();
      await this.flushPendingReceipts(accessToken);
      const automatedOperations: Array<'replaceManagedBlocks' | 'replaceSynthesisIndexBlocks'> = [];
      if (automated) {
        const policy = await fetchDepositionPolicy({
          serverUrl: this.bridgeSettings.serverUrl,
          accessToken,
        });
        if (policy.mode !== 'managed-auto' || !policy.managedAutoEnabled) {
          await this.recordManagedAutomationStatus('自动沉淀已暂停：服务器端未确认本地授权。');
          return;
        }
        if (policy.allowCompanionUpdates) {
          automatedOperations.push('replaceManagedBlocks');
        }
        if (policy.allowSynthesisIndexUpdates) {
          automatedOperations.push('replaceSynthesisIndexBlocks');
        }
        if (automatedOperations.length === 0) {
          await this.recordManagedAutomationStatus('自动沉淀已暂停：没有获准自动更新的资产类型。');
          return;
        }
      }
      const commands = options.commands
        ? [...options.commands]
        : await fetchPendingWritebacks({
            serverUrl: this.bridgeSettings.serverUrl,
            accessToken,
            // Do not lease a manual draft merely because a background check ran.
            operations: automated ? automatedOperations : undefined,
          });
      if (commands.length === 0) {
        if (automated) {
          await this.recordManagedAutomationStatus('自动检查完成：没有待更新的受管学习资产。');
        } else {
          new Notice('当前没有待处理的知洄回写。');
        }
        return;
      }

      let batchDecision: BatchWritebackDecision | undefined;
      const batchEligibleIds = new Set<string>();
      if (!automated && this.bridgeSettings.writebackReviewMode === 'batch') {
        const batchCandidates = commands.filter((command) => {
          if (
            command.ownerId !== this.bridgeSettings.ownerId ||
            command.deviceId !== this.bridgeSettings.deviceId ||
            command.vaultBindingId !== this.bridgeSettings.vaultBindingId ||
            Date.parse(command.expiresAt) <= Date.now()
          ) {
            return false;
          }
          try {
            resolveManagedWritebackPath(
              command.arguments.relativePath,
              this.bridgeSettings.managedRoot,
            );
            return (
              command.operation === 'createManagedNote' ||
              command.operation === 'replaceManagedBlocks' ||
              command.operation === 'replaceProjectIndexBlocks' ||
              command.operation === 'replaceSynthesisIndexBlocks' ||
              command.operation === 'replaceVaultOverviewBlocks'
            );
          } catch {
            return false;
          }
        });
        if (batchCandidates.length > 0) {
          batchCandidates.forEach((command) => batchEligibleIds.add(command.id));
          batchDecision = await confirmWritebackBatch(this.app, batchCandidates);
          if (batchDecision === 'defer') {
            new Notice('这批回写已保留，稍后可再次执行“Check and apply Vaultide writebacks”。');
            return;
          }
        }
      }

      let applied = 0;
      let skipped = 0;
      for (const command of commands) {
        if (
          command.ownerId !== this.bridgeSettings.ownerId ||
          command.deviceId !== this.bridgeSettings.deviceId ||
          command.vaultBindingId !== this.bridgeSettings.vaultBindingId
        ) {
          console.error(
            'Vaultide rejected a command whose identity did not match this Vault.',
            command.id,
          );
          if (!automated) new Notice('一条知洄回写因设备身份与当前 Vault 不匹配而被拒绝。');
          skipped += 1;
          continue;
        }

        if (Date.parse(command.expiresAt) <= Date.now()) {
          await this.queueReceipt(
            this.makeReceipt(command.id, 'expired', {
              conflictDetail: 'Command expired before local approval.',
            }),
          );
          continue;
        }

        try {
          resolveManagedWritebackPath(
            command.arguments.relativePath,
            this.bridgeSettings.managedRoot,
          );
        } catch (error) {
          await this.queueReceipt(
            this.makeReceipt(command.id, 'failed', {
              conflictDetail: error instanceof Error ? error.message : 'Unsafe managed path.',
            }),
          );
          continue;
        }

        if (automated && !isAutomaticallyApplicableManagedUpdate(command)) {
          // This is intentionally not receipted/rejected: a later manual
          // check must still show it to the user for a visible decision.
          skipped += 1;
          continue;
        }

        if (batchDecision === 'reject' && batchEligibleIds.has(command.id)) {
          await this.queueReceipt(
            this.makeReceipt(command.id, 'rejected', {
              conflictDetail: 'User rejected the local Obsidian batch confirmation.',
            }),
          );
          continue;
        }

        const approved =
          automated || (batchDecision === 'apply' && batchEligibleIds.has(command.id))
            ? true
            : await confirmWriteback(this.app, command);
        if (!approved) {
          await this.queueReceipt(
            this.makeReceipt(command.id, 'rejected', {
              conflictDetail: 'User rejected the local Obsidian confirmation.',
            }),
          );
          continue;
        }

        await markWritebackLocallyValidated({
          serverUrl: this.bridgeSettings.serverUrl,
          accessToken,
          commandId: command.id,
        }).catch((error) => {
          // Observability failure must not turn a locally approved command
          // into an unreliable write. The eventual immutable receipt still
          // records the terminal outcome.
          console.warn('Vaultide could not record local writeback validation.', error);
        });

        try {
          const result =
            command.operation === 'createManagedNote'
              ? await applyCreateManagedNote({
                  app: this.app,
                  command,
                  managedRoot: this.bridgeSettings.managedRoot,
                })
              : command.operation === 'replaceManagedBlocks'
                ? await applyReplaceManagedBlocks({
                    app: this.app,
                    command,
                    managedRoot: this.bridgeSettings.managedRoot,
                  })
                : command.operation === 'replaceProjectIndexBlocks'
                  ? await applyReplaceProjectIndexBlocks({
                      app: this.app,
                      command,
                      managedRoot: this.bridgeSettings.managedRoot,
                    })
                  : command.operation === 'replaceSynthesisIndexBlocks'
                    ? await applyReplaceSynthesisIndexBlocks({
                        app: this.app,
                        command,
                        managedRoot: this.bridgeSettings.managedRoot,
                      })
                    : command.operation === 'replaceVaultOverviewBlocks'
                      ? await applyReplaceVaultOverviewBlocks({
                          app: this.app,
                          command,
                          managedRoot: this.bridgeSettings.managedRoot,
                        })
                      : (() => {
                          throw new WritebackSafetyError(
                            `This connector does not permit ${command.operation}.`,
                          );
                        })();
          await this.queueReceipt(
            this.makeReceipt(command.id, 'applied', {
              resultingContentHash: result.contentHash,
              resultingPath: result.path,
              appliedAt: new Date().toISOString(),
            }),
          );
          applied += 1;
          if (!automated) {
            const message =
              command.operation === 'createManagedNote'
                ? `知洄已创建受管笔记：${result.path}`
                : command.operation === 'replaceProjectIndexBlocks'
                  ? `知洄已更新项目学习索引：${result.path}`
                  : command.operation === 'replaceSynthesisIndexBlocks'
                    ? `知洄已更新周期归纳索引：${result.path}`
                    : command.operation === 'replaceVaultOverviewBlocks'
                      ? `知洄已更新总览：${result.path}`
                      : `知洄已更新伴随笔记的受管区块：${result.path}`;
            new Notice(message);
          }
        } catch (error) {
          const outcome = error instanceof WritebackSafetyError ? error.outcome : 'failed';
          await this.queueReceipt(
            this.makeReceipt(command.id, outcome, {
              conflictDetail: (error instanceof Error
                ? error.message
                : 'Local writeback failed.'
              ).slice(0, 2000),
            }),
          );
        }
      }

      await this.flushPendingReceipts(accessToken);
      const processedIds = new Set(
        this.bridgeSettings.writebackActivity.map((item) => item.receipt.commandId),
      );
      this.writebackCenterPending = this.writebackCenterPending.filter(
        (command) => !processedIds.has(command.id),
      );
      if (automated) {
        await this.recordManagedAutomationStatus(
          applied > 0
            ? `自动沉淀完成：已更新 ${applied} 份受管学习资产${skipped > 0 ? `；${skipped} 条保留人工确认` : ''}。`
            : skipped > 0
              ? `自动检查完成：${skipped} 条回写保留人工确认。`
              : '自动检查完成：没有可安全自动更新的受管学习资产。',
        );
        if (applied > 0) {
          new Notice(`知洄已自动更新 ${applied} 份受管学习资产。`);
        }
      } else if (applied > 0) {
        new Notice(`已应用 ${applied} 条知洄回写。`);
      }
    } catch (error) {
      if (automated) {
        const message = error instanceof Error ? error.message : '自动检查回写失败。';
        console.warn('Vaultide managed automation check failed.', error);
        try {
          await this.recordManagedAutomationStatus(`自动检查失败：${message}`);
        } catch (statusError) {
          console.warn('Vaultide could not persist automation status.', statusError);
        }
      } else {
        new Notice(error instanceof Error ? error.message : '无法检查知洄回写。');
      }
    }
  }

  private makeReceipt(
    commandId: string,
    outcome: WritebackReceipt['outcome'],
    details: Pick<
      WritebackReceipt,
      'resultingContentHash' | 'resultingPath' | 'conflictDetail' | 'appliedAt'
    > = {},
  ): WritebackReceipt {
    return {
      protocolVersion: LEARNING_PROTOCOL_VERSION,
      id: `wbr_${crypto.randomUUID().replaceAll('-', '')}`,
      commandId,
      deviceId: this.bridgeSettings.deviceId,
      outcome,
      ...details,
      reportedAt: new Date().toISOString(),
    };
  }

  private async queueReceipt(receipt: WritebackReceipt): Promise<void> {
    this.bridgeSettings.writebackActivity = recordWritebackActivity(
      this.bridgeSettings.writebackActivity,
      receipt,
    );
    const existing = this.bridgeSettings.pendingWritebackReceipts.find(
      (item) => item.commandId === receipt.commandId,
    );
    if (!existing) this.bridgeSettings.pendingWritebackReceipts.push(receipt);
    await this.saveSettings();
    try {
      await appendWritebackAuditLog({
        app: this.app,
        managedRoot: this.bridgeSettings.managedRoot,
        receipt,
      });
    } catch (error) {
      console.warn('Vaultide could not append the local writeback audit log.', error);
    }
  }

  private async flushPendingReceipts(accessToken?: string): Promise<void> {
    if (this.bridgeSettings.pendingWritebackReceipts.length === 0) return;
    const token = accessToken ?? (await this.validAccessToken());
    for (const receipt of [...this.bridgeSettings.pendingWritebackReceipts]) {
      await submitWritebackReceipt({
        serverUrl: this.bridgeSettings.serverUrl,
        accessToken: token,
        receipt,
      });
      this.bridgeSettings.writebackActivity = markWritebackActivitySynced(
        this.bridgeSettings.writebackActivity,
        receipt.id,
        new Date().toISOString(),
      );
      this.bridgeSettings.pendingWritebackReceipts =
        this.bridgeSettings.pendingWritebackReceipts.filter((item) => item.id !== receipt.id);
      await this.saveSettings();
      try {
        await appendWritebackAuditSync({
          app: this.app,
          managedRoot: this.bridgeSettings.managedRoot,
          receiptId: receipt.id,
          syncedAt: new Date().toISOString(),
        });
      } catch (error) {
        console.warn('Vaultide could not append the writeback sync audit event.', error);
      }
    }
  }

  private async validAccessToken(): Promise<string> {
    const accessToken = this.app.secretStorage.getSecret(ACCESS_TOKEN_SECRET);
    const expiresAt = Date.parse(this.bridgeSettings.tokenExpiresAt ?? '');
    if (accessToken && Number.isFinite(expiresAt) && expiresAt > Date.now() + 60_000) {
      return accessToken;
    }
    const refreshToken = this.app.secretStorage.getSecret(REFRESH_TOKEN_SECRET);
    if (!refreshToken) throw new Error('使用知洄连接器前，请先配对这台设备。');
    const result = await refreshDeviceCredentials({
      serverUrl: this.bridgeSettings.serverUrl,
      refreshToken,
    });
    this.app.secretStorage.setSecret(ACCESS_TOKEN_SECRET, result.accessToken);
    this.app.secretStorage.setSecret(REFRESH_TOKEN_SECRET, result.refreshToken);
    this.bridgeSettings.ownerId = result.ownerId;
    this.bridgeSettings.tokenExpiresAt = result.expiresAt;
    await this.saveSettings();
    return result.accessToken;
  }

  hasStoredSiteAccessCode(): boolean {
    return Boolean(this.app.secretStorage.getSecret(SITE_ACCESS_CODE_SECRET));
  }

  siteAccessCodeState(): StoredSiteAccessCodeState {
    if (!this.hasStoredSiteAccessCode()) return 'missing';
    return this.storedSiteAccessCodeState === 'missing' ? 'stored' : this.storedSiteAccessCodeState;
  }

  saveSiteAccessCode(value: string): void {
    const code = value.trim();
    if (code.length === 0 || code.length > 256) {
      throw new Error('访问码应为 1–256 个字符。');
    }
    this.app.secretStorage.setSecret(SITE_ACCESS_CODE_SECRET, code);
    this.storedSiteAccessCodeState = 'stored';
  }

  clearSiteAccessCode(): void {
    this.app.secretStorage.setSecret(SITE_ACCESS_CODE_SECRET, '');
    this.storedSiteAccessCodeState = 'missing';
  }

  async copyStoredSiteAccessCode(): Promise<void> {
    const code = this.app.secretStorage.getSecret(SITE_ACCESS_CODE_SECRET);
    if (!code) throw new Error('请先在知洄插件设置中保存一次网页访问码。');
    await navigator.clipboard.writeText(code);
  }

  async verifyStoredSiteAccessCode(): Promise<SiteAccessCodeVerification> {
    const code = this.app.secretStorage.getSecret(SITE_ACCESS_CODE_SECRET);
    if (!code) {
      this.storedSiteAccessCodeState = 'missing';
      throw new Error('请先在知洄插件设置中保存一次网页访问码。');
    }
    this.storedSiteAccessCodeState = 'checking';
    try {
      const state = await verifySiteAccessCode({
        serverUrl: this.bridgeSettings.serverUrl,
        code,
      });
      this.storedSiteAccessCodeState = state;
      return state;
    } catch (error) {
      this.storedSiteAccessCodeState = 'unreachable';
      throw error;
    }
  }

  async verifyStoredSiteAccessCodeWithNotice(): Promise<void> {
    try {
      const state = await this.verifyStoredSiteAccessCode();
      new Notice(
        state === 'valid'
          ? '网页访问码有效。'
          : state === 'disabled'
            ? '当前站点未启用访问码，无需填写。'
            : '网页访问码已失效，请在插件设置中更新。',
      );
    } catch (error) {
      new Notice(error instanceof Error ? error.message : '无法验证网页访问码。');
    }
  }

  openSiteAccessCodeRecovery(): void {
    new Notice(
      '请在 Vercel 项目的 Settings → Environment Variables 中重新设置 ACCESS_CODE，部署完成后回到这里保存并验证。此插件不会读取或展示其他服务端密钥。',
      10_000,
    );
    window.open('https://vercel.com/dashboard', '_blank', 'noopener,noreferrer');
  }

  async openWebsiteWithAccessCode(): Promise<void> {
    try {
      if (this.hasStoredSiteAccessCode()) {
        await this.copyStoredSiteAccessCode();
        new Notice('网页访问码已复制；若网页要求登录，直接粘贴即可。');
      } else {
        new Notice('尚未保存网页访问码；可以先在插件设置中保存一次。');
      }
      window.open(
        normalizeServerUrl(this.bridgeSettings.serverUrl),
        '_blank',
        'noopener,noreferrer',
      );
    } catch (error) {
      new Notice(error instanceof Error ? error.message : '无法打开知洄网页。');
    }
  }

  async saveSettings(): Promise<void> {
    // Access/refresh tokens are deliberately absent from this object.
    await this.saveData(this.bridgeSettings);
  }

  private async backfillWritebackAuditLog(): Promise<void> {
    for (const binding of this.bridgeSettings.projectBindings) {
      if (
        binding.projectRevision === undefined ||
        !binding.lastManifestId ||
        !binding.lastManifestHash ||
        binding.lastSourceCount === undefined ||
        !binding.lastFinalizedAt
      ) {
        continue;
      }
      try {
        await appendProjectRevisionAuditLog({
          app: this.app,
          managedRoot: this.bridgeSettings.managedRoot,
          projectId: binding.id,
          folderPath: binding.folderPath,
          projectRevision: binding.projectRevision,
          manifestId: binding.lastManifestId,
          manifestSha256: binding.lastManifestHash,
          sourceCount: binding.lastSourceCount,
          finalizedAt: binding.lastFinalizedAt,
        });
      } catch (error) {
        console.warn('Vaultide could not backfill the project revision audit log.', error);
        return;
      }
    }
    for (const activity of [...this.bridgeSettings.writebackActivity].reverse()) {
      try {
        await appendWritebackAuditLog({
          app: this.app,
          managedRoot: this.bridgeSettings.managedRoot,
          receipt: activity.receipt,
        });
        if (activity.syncedAt) {
          await appendWritebackAuditSync({
            app: this.app,
            managedRoot: this.bridgeSettings.managedRoot,
            receiptId: activity.receipt.id,
            syncedAt: activity.syncedAt,
          });
        }
      } catch (error) {
        console.warn('Vaultide could not backfill the local writeback audit log.', error);
        return;
      }
    }
  }

  private sourceIdForSingleNote(path: string): string {
    const existing = this.bridgeSettings.noteSourceIds[path];
    if (existing && /^sou_[a-f0-9]{32}$/.test(existing)) return existing;
    const sourceId = createEntityId('sou');
    this.bridgeSettings.noteSourceIds[path] = sourceId;
    return sourceId;
  }

  private async preserveSourceIdentityOnRename(file: TFile, oldPath: string): Promise<void> {
    let changed = false;
    const sourceId = this.bridgeSettings.noteSourceIds[oldPath];
    if (sourceId && /^sou_[a-f0-9]{32}$/.test(sourceId)) {
      delete this.bridgeSettings.noteSourceIds[oldPath];
      this.bridgeSettings.noteSourceIds[file.path] = sourceId;
      changed = true;
    }
    this.bridgeSettings.projectBindings = this.bridgeSettings.projectBindings.map((binding) => {
      const projectSourceId = binding.sourceIds[oldPath];
      const priorFile = binding.files[oldPath];
      if (!projectSourceId && !priorFile) return binding;
      const sourceIds = { ...binding.sourceIds };
      const files = { ...binding.files };
      if (projectSourceId) {
        delete sourceIds[oldPath];
        sourceIds[file.path] = projectSourceId;
      }
      if (priorFile) {
        delete files[oldPath];
        files[file.path] = priorFile;
      }
      changed = true;
      return { ...binding, sourceIds, files };
    });
    if (changed) await this.saveSettings();
  }

  private async loadSettings(): Promise<void> {
    const loaded = (await this.loadData()) as Record<string, unknown> | null;
    const generated = createLocalIdentity();
    const retentionDays = typeof loaded?.retentionDays === 'number' ? loaded.retentionDays : 30;
    this.bridgeSettings = {
      serverUrl: optionalString(loaded?.serverUrl) ?? 'https://openmaic-eight-eosin.vercel.app',
      retentionDays:
        Number.isInteger(retentionDays) && retentionDays >= 1 && retentionDays <= 90
          ? retentionDays
          : 30,
      managedRoot:
        optionalString(loaded?.managedRoot) === 'OpenMAIC'
          ? DEFAULT_MANAGED_ROOT
          : (optionalString(loaded?.managedRoot) ?? DEFAULT_MANAGED_ROOT),
      pendingWritebackReceipts: savedReceipts(loaded?.pendingWritebackReceipts).filter(
        (receipt) =>
          !savedWritebackActivity(loaded?.writebackActivity).some(
            (activity) => activity.receipt.id === receipt.id && Boolean(activity.syncedAt),
          ),
      ),
      writebackActivity: savedWritebackActivity(loaded?.writebackActivity),
      projectBindings: savedProjectBindings(loaded?.projectBindings),
      noteSourceIds: savedNoteSourceIds(loaded?.noteSourceIds),
      writebackReviewMode: savedWritebackReviewMode(loaded?.writebackReviewMode),
      managedAutomationEnabled: loaded?.managedAutomationEnabled === true,
      managedAutomationIntervalMinutes: savedManagedAutomationInterval(
        loaded?.managedAutomationIntervalMinutes,
      ),
      managedAutomationLastRunAt: optionalString(loaded?.managedAutomationLastRunAt),
      managedAutomationLastMessage: optionalString(loaded?.managedAutomationLastMessage),
      ownerId: optionalString(loaded?.ownerId) ?? generated.ownerId,
      deviceId: optionalString(loaded?.deviceId) ?? generated.deviceId,
      vaultBindingId: optionalString(loaded?.vaultBindingId) ?? generated.vaultBindingId,
      pairedAt: optionalString(loaded?.pairedAt),
      tokenExpiresAt: optionalString(loaded?.tokenExpiresAt),
    };
    await this.saveSettings();
  }
}
