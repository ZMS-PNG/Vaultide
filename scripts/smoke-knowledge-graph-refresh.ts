import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { getLearningSql } from '../lib/learning/adapters/neon/client';
import { NeonSynthesisRepository } from '../lib/learning/adapters/neon/synthesis-repository';
import { loadPairingConfig } from '../lib/learning/config';
import { getKnowledgeGraphRefreshService } from '../lib/learning/knowledge-graph-refresh';

async function loadEnvFile(path: string): Promise<void> {
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
  } catch (error: unknown) {
    if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'ENOENT') {
      throw error;
    }
  }
}

async function main(): Promise<void> {
  await loadEnvFile(resolve('.env.local'));
  await loadEnvFile(resolve('.env.production.local'));
  await loadEnvFile(resolve('.env.development.local'));

  const config = loadPairingConfig();
  const synthesis = (await new NeonSynthesisRepository().list(config.ownerId, 1))[0];
  if (!synthesis) {
    console.log(JSON.stringify({ ok: false, reason: 'no_synthesis' }));
    return;
  }

  const triggerId = `smoke-${randomUUID()}`;
  const service = getKnowledgeGraphRefreshService();
  const queued = await service.enqueue({
    triggerKind: 'synthesis',
    triggerId,
    synthesisId: synthesis.id,
    ...(synthesis.projectId ? { projectId: synthesis.projectId } : {}),
  });
  const processed = await service.processPending(50);
  const rows = (await getLearningSql().query(
    `
      SELECT state, attempt_count, result
      FROM knowledge_graph_refresh_requests
      WHERE owner_id = $1 AND id = $2
      LIMIT 1
    `,
    [config.ownerId, queued.id],
  )) as Array<{ state: string; attempt_count: number; result: unknown }>;
  const row = rows[0];
  const storedResult =
    row?.result && typeof row.result === 'object' && !Array.isArray(row.result)
      ? (row.result as Record<string, unknown>)
      : {};

  console.log(
    JSON.stringify({
      ok: row?.state === 'succeeded',
      requestId: queued.id,
      state: row?.state ?? 'missing',
      attempts: Number(row?.attempt_count ?? 0),
      affectedSyntheses: Array.isArray(storedResult.synthesisIds)
        ? storedResult.synthesisIds.length
        : 0,
      projections: Array.isArray(storedResult.projectionIds)
        ? storedResult.projectionIds.length
        : 0,
      processed,
    }),
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
