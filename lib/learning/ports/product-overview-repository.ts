import type { ProductHealthSnapshot } from '../domain/product-health';
import type { VaultOverviewDocumentRecord, VaultOverviewSnapshot } from '../domain/vault-overview';
import type { ManagedBlockState } from '../domain/learning-progress';

export interface FindOrCreateVaultOverviewInput {
  id: string;
  ownerId: string;
  vaultBindingId: string;
  relativePath: string;
  initialManagedBlocks: ManagedBlockState[];
  now: Date;
}

export interface ProductOverviewRepository {
  findOrCreateOverview(input: FindOrCreateVaultOverviewInput): Promise<VaultOverviewDocumentRecord>;
  snapshot(ownerId: string, now: Date): Promise<VaultOverviewSnapshot>;
  health(ownerId: string, now: Date): Promise<ProductHealthSnapshot>;
}
