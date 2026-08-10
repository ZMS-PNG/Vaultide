import { randomUUID } from 'node:crypto';
import type { WritebackDraftRecord, WritebackDraftView } from '../domain/learning-progress';
import {
  renderVaultOverview,
  VAULT_OVERVIEW_PATH,
  vaultOverviewDraftBlocks,
} from '../domain/vault-overview';
import type { LearningProgressRepository } from '../ports/learning-progress-repository';
import type { ProductOverviewRepository } from '../ports/product-overview-repository';
import { LearningProgressServiceError } from './learning-progress-service';

function identifier(prefix: 'vdx' | 'wbd'): string {
  return `${prefix}_${randomUUID().replaceAll('-', '')}`;
}

export interface ProductOverviewServiceOptions {
  ownerId: string;
  repository: ProductOverviewRepository;
  learningProgressRepository: LearningProgressRepository;
  now?: () => Date;
}

export class ProductOverviewService {
  private readonly now: () => Date;

  constructor(private readonly options: ProductOverviewServiceOptions) {
    this.now = options.now ?? (() => new Date());
  }

  health() {
    return this.options.repository.health(this.options.ownerId, this.now());
  }

  snapshot() {
    return this.options.repository.snapshot(this.options.ownerId, this.now());
  }

  async createVaultOverviewDraft(): Promise<WritebackDraftView> {
    const target = await this.options.learningProgressRepository.findWritebackTarget(
      this.options.ownerId,
    );
    if (!target) {
      throw new LearningProgressServiceError(
        'conflict',
        409,
        'No active paired Obsidian Vault is available for the Vault overview.',
      );
    }
    const now = this.now();
    const snapshot = await this.options.repository.snapshot(this.options.ownerId, now);
    const provisionalId = identifier('vdx');
    const provisional = renderVaultOverview({
      vaultOverviewId: provisionalId,
      snapshot,
      now,
    });
    const document = await this.options.repository.findOrCreateOverview({
      id: provisionalId,
      ownerId: this.options.ownerId,
      vaultBindingId: target.vaultBindingId,
      relativePath: VAULT_OVERVIEW_PATH,
      initialManagedBlocks: provisional.managedBlocks,
      now,
    });
    const rendered = renderVaultOverview({
      vaultOverviewId: document.id,
      snapshot,
      now,
    });
    let managedBlocks;
    try {
      managedBlocks = vaultOverviewDraftBlocks(rendered.managedBlocks, document);
    } catch (error) {
      throw new LearningProgressServiceError(
        'conflict',
        409,
        error instanceof Error ? error.message : 'Vault overview needs manual review.',
      );
    }
    const existing = await this.options.learningProgressRepository.findOpenDraftByVaultOverview(
      this.options.ownerId,
      document.id,
    );
    if (existing) return this.draftView(existing, target.vaultName);
    const created = await this.options.learningProgressRepository.createDraft({
      id: identifier('wbd'),
      ownerId: this.options.ownerId,
      draftKind: 'vault-overview',
      vaultOverviewId: document.id,
      targetDeviceId: target.deviceId,
      targetVaultBindingId: target.vaultBindingId,
      operation: document.lastContentHash ? 'replaceVaultOverviewBlocks' : 'createManagedNote',
      managedBlocks,
      relativePath: document.relativePath,
      content: rendered.content,
      frontmatter: rendered.frontmatter,
      now,
    });
    return this.draftView(created, target.vaultName);
  }

  private draftView(draft: WritebackDraftRecord, targetVaultName: string): WritebackDraftView {
    return {
      id: draft.id,
      revision: draft.revision,
      draftKind: draft.draftKind,
      ...(draft.vaultOverviewId ? { vaultOverviewId: draft.vaultOverviewId } : {}),
      targetVaultName,
      operation: draft.operation,
      relativePath: draft.relativePath,
      content: draft.content,
      status: draft.status,
    };
  }
}
