import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NeonProductOverviewRepository } from '@/lib/learning/adapters/neon/product-overview-repository';

const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('@/lib/learning/adapters/neon/client', () => ({
  getLearningSql: () => ({ query: mocks.query }),
}));

const NOW = new Date('2026-07-26T12:00:00.000Z');
const OWNER_ID = `own_${'1'.repeat(32)}`;
const VAULT_BINDING_ID = `vlt_${'2'.repeat(32)}`;
const OVERVIEW_ID = `vdx_${'3'.repeat(32)}`;
const CONTENT_HASH = '4'.repeat(64);
const MANAGED_BLOCKS = [
  {
    id: 'today',
    content: '## 今日学习行动\n',
    contentHash: '5'.repeat(64),
  },
];

function row(lastContentHash: string | null) {
  return {
    id: OVERVIEW_ID,
    owner_id: OWNER_ID,
    vault_binding_id: VAULT_BINDING_ID,
    relative_path: 'Vaultide/知洄总览.md',
    status: 'active',
    managed_blocks: MANAGED_BLOCKS,
    last_content_hash: lastContentHash,
    created_at: NOW.toISOString(),
    updated_at: NOW.toISOString(),
  };
}

describe('NeonProductOverviewRepository', () => {
  beforeEach(() => mocks.query.mockReset());

  it('recovers a missing overview hash from the latest applied writeback receipt', async () => {
    mocks.query.mockResolvedValueOnce([row(null)]).mockResolvedValueOnce([row(CONTENT_HASH)]);
    const repository = new NeonProductOverviewRepository();

    await expect(
      repository.findOrCreateOverview({
        id: OVERVIEW_ID,
        ownerId: OWNER_ID,
        vaultBindingId: VAULT_BINDING_ID,
        relativePath: 'Vaultide/知洄总览.md',
        initialManagedBlocks: MANAGED_BLOCKS,
        now: NOW,
      }),
    ).resolves.toMatchObject({
      id: OVERVIEW_ID,
      lastContentHash: CONTENT_HASH,
      managedBlocks: MANAGED_BLOCKS,
    });

    const [recoverySql, recoveryValues] = mocks.query.mock.calls[1] as [string, unknown[]];
    expect(recoverySql).toContain('WITH latest_applied AS');
    expect(recoverySql).toContain("receipt.outcome = 'applied'");
    expect(recoverySql).toContain('overview.last_content_hash IS NULL');
    expect(recoveryValues).toEqual([OWNER_ID, OVERVIEW_ID, NOW]);
  });

  it('does not run recovery when the stable overview already has a content hash', async () => {
    mocks.query.mockResolvedValueOnce([row(CONTENT_HASH)]);
    const repository = new NeonProductOverviewRepository();

    await repository.findOrCreateOverview({
      id: OVERVIEW_ID,
      ownerId: OWNER_ID,
      vaultBindingId: VAULT_BINDING_ID,
      relativePath: 'Vaultide/知洄总览.md',
      initialManagedBlocks: MANAGED_BLOCKS,
      now: NOW,
    });

    expect(mocks.query).toHaveBeenCalledTimes(1);
  });
});
