import * as repositoryModule from '../lib/learning/adapters/neon/product-overview-repository';
import * as configModule from '../lib/learning/config';
import * as researchModule from '../lib/learning/adapters/neon/research-repository';
import * as clientModule from '../lib/learning/adapters/neon/client';
import * as verifierModule from '../lib/server/research-source-verifier';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

async function loadEnvFile(path: string) {
  try {
    const content = await readFile(path, 'utf8');
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const equals = line.indexOf('=');
      if (equals < 1) continue;
      const key = line.slice(0, equals).trim();
      let value = line.slice(equals + 1).trim();
      if (
        value.length >= 2 &&
        ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'")))
      ) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = value;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

async function main() {
  await loadEnvFile(resolve('.env.local'));
  await loadEnvFile(resolve('.env.development.local'));
  await loadEnvFile(resolve('.env.production.local'));
  const repositoryExports = (
    'default' in repositoryModule ? repositoryModule.default : repositoryModule
  ) as typeof import('../lib/learning/adapters/neon/product-overview-repository');
  const configExports = (
    'default' in configModule ? configModule.default : configModule
  ) as typeof import('../lib/learning/config');
  const { ownerId } = configExports.loadPairingConfig();
  const repository = new repositoryExports.NeonProductOverviewRepository();
  const now = new Date();
  const clientExports = (
    'default' in clientModule ? clientModule.default : clientModule
  ) as typeof import('../lib/learning/adapters/neon/client');
  const [health, snapshot, overviewRows, receiptRows] = await Promise.all([
    repository.health(ownerId, now),
    repository.snapshot(ownerId, now),
    clientExports.getLearningSql().query(
      `
        SELECT id,
               relative_path,
               last_content_hash IS NOT NULL AS has_content_hash,
               jsonb_array_length(managed_blocks) AS managed_block_count
        FROM vault_overviews
        WHERE owner_id = $1 AND status = 'active'
        ORDER BY updated_at DESC
      `,
      [ownerId],
    ) as unknown as Promise<
      Array<{
        id: string;
        relative_path: string;
        has_content_hash: boolean;
        managed_block_count: number;
      }>
    >,
    clientExports.getLearningSql().query(
      `
        SELECT receipt.outcome,
               receipt.resulting_content_hash IS NOT NULL AS has_content_hash,
               draft.draft_kind,
               draft.operation,
               draft.managed_blocks->0 ? 'contentHash' AS has_state_hash,
               draft.managed_blocks->0 ? 'expectedHash' AS has_expected_hash
        FROM writeback_receipts receipt
        JOIN writeback_commands command ON command.id = receipt.command_id
        JOIN writeback_drafts draft ON draft.id = command.draft_id
        WHERE receipt.owner_id = $1
        ORDER BY receipt.created_at DESC
        LIMIT 3
      `,
      [ownerId],
    ) as unknown as Promise<
      Array<{
        outcome: string;
        has_content_hash: boolean;
        draft_kind: string;
        operation: string;
        has_state_hash: boolean;
        has_expected_hash: boolean;
      }>
    >,
  ]);
  if (process.argv.includes('--expire-overview-drafts')) {
    await clientExports.getLearningSql().query(
      `
        UPDATE writeback_drafts
        SET status = 'expired', updated_at = $2
        WHERE owner_id = $1
          AND draft_kind = 'vault-overview'
          AND status IN ('generated', 'edited', 'approved')
      `,
      [ownerId, now],
    );
    return;
  }
  if (process.argv.includes('--repair-overview-state')) {
    const recoverableRows = (await clientExports.getLearningSql().query(
      `
        SELECT id, vault_binding_id, relative_path, managed_blocks
        FROM vault_overviews
        WHERE owner_id = $1 AND status = 'active'
        ORDER BY updated_at DESC
        LIMIT 1
      `,
      [ownerId],
    )) as Array<{
      id: string;
      vault_binding_id: string;
      relative_path: string;
      managed_blocks: Array<{
        id: string;
        content: string;
        contentHash: string;
      }>;
    }>;
    const recoverable = recoverableRows[0];
    if (recoverable) {
      await repository.findOrCreateOverview({
        id: recoverable.id,
        ownerId,
        vaultBindingId: recoverable.vault_binding_id,
        relativePath: recoverable.relative_path,
        initialManagedBlocks: recoverable.managed_blocks,
        now,
      });
    }
    return;
  }
  let verifiedLatest:
    | {
        researchRunId: string;
        checked: number;
        available: number;
        failed: number;
        details: Array<{
          domain: string;
          availability: string;
          httpStatus?: number;
          errorKind?: string;
        }>;
      }
    | undefined;
  if (process.argv.includes('--verify-latest') || process.argv.includes('--reset-latest-health')) {
    const researchExports = (
      'default' in researchModule ? researchModule.default : researchModule
    ) as typeof import('../lib/learning/adapters/neon/research-repository');
    const clientExports = (
      'default' in clientModule ? clientModule.default : clientModule
    ) as typeof import('../lib/learning/adapters/neon/client');
    const verifierExports = (
      'default' in verifierModule ? verifierModule.default : verifierModule
    ) as typeof import('../lib/server/research-source-verifier');
    const runs = (await clientExports.getLearningSql().query(
      `
        SELECT run_id
        FROM research_sources
        WHERE owner_id = $1
        GROUP BY run_id
        ORDER BY MAX(created_at) DESC
        LIMIT 1
      `,
      [ownerId],
    )) as Array<{ run_id: string }>;
    const researchRunId = runs[0]?.run_id;
    if (researchRunId) {
      if (process.argv.includes('--reset-latest-health')) {
        await clientExports.getLearningSql().query(
          `
            UPDATE research_sources
            SET availability = 'unverified',
                checked_at = NULL,
                http_status = NULL,
                final_url = NULL,
                health_error = NULL
            WHERE owner_id = $1 AND run_id = $2
          `,
          [ownerId, researchRunId],
        );
        return;
      }
      const research = new researchExports.NeonResearchRepository();
      const sources = await research.sourceHealth(ownerId, researchRunId);
      const checked = await verifierExports.verifyResearchSources(sources);
      const persisted = await research.updateSourceHealth(ownerId, researchRunId, checked);
      verifiedLatest = {
        researchRunId,
        checked: persisted.length,
        available: persisted.filter(
          (source) => source.availability === 'available' || source.availability === 'redirected',
        ).length,
        failed: persisted.filter(
          (source) => source.availability === 'unreachable' || source.availability === 'unsafe',
        ).length,
        details: persisted.map((source) => ({
          domain: source.domain,
          availability: source.availability,
          ...(source.httpStatus ? { httpStatus: source.httpStatus } : {}),
          ...(source.errorKind ? { errorKind: source.errorKind } : {}),
        })),
      };
    }
  }

  console.log(
    JSON.stringify(
      {
        health: {
          generation: health.generation,
          synthesis: health.synthesis,
          writeback: health.writeback,
          sources: health.sources,
        },
        overview: overviewRows.map((overview) => ({
          id: overview.id,
          relativePath: overview.relative_path,
          hasContentHash: overview.has_content_hash,
          managedBlockCount: Number(overview.managed_block_count),
        })),
        latestReceipts: receiptRows.map((receipt) => ({
          outcome: receipt.outcome,
          hasContentHash: receipt.has_content_hash,
          draftKind: receipt.draft_kind,
          operation: receipt.operation,
          hasStateHash: receipt.has_state_hash,
          hasExpectedHash: receipt.has_expected_hash,
        })),
        snapshot: {
          projects: snapshot.projects.length,
          recentLearning: snapshot.recentLearning.length,
          reviews: snapshot.reviews.length,
          syntheses: snapshot.syntheses.length,
        },
        ...(verifiedLatest ? { verifiedLatest } : {}),
      },
      null,
      2,
    ),
  );
}

void main();
