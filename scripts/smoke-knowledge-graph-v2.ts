import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { NeonKnowledgeGraphV2Repository } from '../lib/learning/adapters/neon/knowledge-graph-v2-repository';
import { NeonSynthesisRepository } from '../lib/learning/adapters/neon/synthesis-repository';
import { loadPairingConfig } from '../lib/learning/config';
import { getKnowledgeGraphProjectionService } from '../lib/learning/knowledge-graphs';

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
  const syntheses = await new NeonSynthesisRepository().list(config.ownerId, 1);
  const synthesis = syntheses[0];
  if (!synthesis) {
    console.log(JSON.stringify({ ok: false, reason: 'no_synthesis' }));
    return;
  }

  const classroomIds = [
    ...new Set(
      synthesis.graph.nodes
        .map((node) => node.classroomId)
        .filter((value): value is string => Boolean(value)),
    ),
  ];
  const projectIds = [
    ...new Set(
      synthesis.graph.nodes
        .map((node) => node.projectId)
        .filter((value): value is string => Boolean(value)),
    ),
  ];
  const context = await new NeonKnowledgeGraphV2Repository().loadProjectionContext({
    ownerId: config.ownerId,
    classroomIds,
    projectIds,
  });
  const globalContext = await new NeonKnowledgeGraphV2Repository().loadProjectionContext({
    ownerId: config.ownerId,
    classroomIds: [],
    projectIds: [],
  });
  const service = getKnowledgeGraphProjectionService();
  const first = await service.createProjection(synthesis.id);
  const cached = await service.createProjection(synthesis.id);
  const read = await service.getProjection(first.id, { lod: 2 });

  console.log(
    JSON.stringify({
      ok: true,
      synthesisId: synthesis.id,
      projectionId: first.id,
      cacheReused: first.id === cached.id,
      status: read.status,
      synthesisClassrooms: classroomIds.length,
      synthesisProjects: projectIds.length,
      matchedSources: context.sources.length,
      matchedSourcesWithPath: context.sources.filter((source) => source.originalRelativePath).length,
      matchedCompanions: context.companions.length,
      totalSources: globalContext.sources.length,
      totalCompanions: globalContext.companions.length,
      nodes: read.graph.nodes.length,
      edges: read.graph.edges.length,
      companionEdges: read.graph.edges.filter((edge) => edge.type === 'companion-of').length,
      unknownMastery: read.graph.nodes.filter((node) => node.mastery === null).length,
      readOnlyOriginals: read.graph.nodes.filter(
        (node) => node.type === 'original-note' && !node.writable,
      ).length,
      readOnlyOriginalsWithPath: read.graph.nodes.filter(
        (node) => node.type === 'original-note' && !node.writable && node.originalPath,
      ).length,
      writableCompanions: read.graph.nodes.filter(
        (node) => node.type === 'companion-note' && node.writable,
      ).length,
    }),
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
