import { LEARNING_PROTOCOL_VERSION } from '@openmaic/learning-protocol';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAccessToken } from '@/lib/server/access-token';

const mocks = vi.hoisted(() => ({
  latestForSynthesis: vi.fn(),
  createProjection: vi.fn(),
  getProjection: vi.fn(),
  getNode: vi.fn(),
  neighborhood: vi.fn(),
  path: vi.fn(),
  feedback: vi.fn(),
}));

vi.mock('@/lib/learning/knowledge-graphs', () => ({
  getKnowledgeGraphProjectionService: () => mocks,
}));

import {
  GET as latestProjection,
  POST as createProjection,
} from '@/lib/server/api-routes/v1/knowledge-graphs/projections/handler';
import { GET as getProjection } from '@/lib/server/api-routes/v1/knowledge-graphs/projections/[projectionId]/handler';
import { GET as getNode } from '@/lib/server/api-routes/v1/knowledge-graphs/nodes/[nodeId]/handler';
import { GET as getNeighborhood } from '@/lib/server/api-routes/v1/knowledge-graphs/nodes/[nodeId]/neighborhood/handler';
import { GET as getPath } from '@/lib/server/api-routes/v1/knowledge-graphs/path/handler';
import { POST as saveFeedback } from '@/lib/server/api-routes/v1/knowledge-graphs/feedback/handler';

const ACCESS_CODE = 'knowledge-graph-v2-route-access';
const PROJECTION_ID = `kgp_${'1'.repeat(32)}`;
const SYNTHESIS_ID = `syn_${'2'.repeat(32)}`;
const RELATION_ID = `kgr_${'3'.repeat(32)}`;
const originalAccessCode = process.env.ACCESS_CODE;
const originalWebglFlag = process.env.KNOWLEDGE_GRAPH_WEBGL_ENABLED;
const originalVaultName = process.env.OBSIDIAN_VAULT_NAME;

function request(url: string, method = 'GET', body?: unknown, authenticated = true): NextRequest {
  return new NextRequest(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-MAIC-Protocol-Version': LEARNING_PROTOCOL_VERSION,
      ...(authenticated ? { Cookie: `openmaic_access=${createAccessToken(ACCESS_CODE)}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe('knowledge graph v2 routes', () => {
  beforeEach(() => {
    process.env.ACCESS_CODE = ACCESS_CODE;
    delete process.env.KNOWLEDGE_GRAPH_WEBGL_ENABLED;
    delete process.env.OBSIDIAN_VAULT_NAME;
    Object.values(mocks).forEach((mock) => mock.mockReset());
  });

  afterEach(() => {
    if (originalAccessCode === undefined) delete process.env.ACCESS_CODE;
    else process.env.ACCESS_CODE = originalAccessCode;
    if (originalWebglFlag === undefined) delete process.env.KNOWLEDGE_GRAPH_WEBGL_ENABLED;
    else process.env.KNOWLEDGE_GRAPH_WEBGL_ENABLED = originalWebglFlag;
    if (originalVaultName === undefined) delete process.env.OBSIDIAN_VAULT_NAME;
    else process.env.OBSIDIAN_VAULT_NAME = originalVaultName;
  });

  it('requires the administrator cookie for projection creation', async () => {
    const response = await createProjection(
      request(
        'http://localhost/api/v1/knowledge-graphs/projections',
        'POST',
        { synthesisId: SYNTHESIS_ID },
        false,
      ),
    );
    expect(response.status).toBe(401);
    expect(mocks.createProjection).not.toHaveBeenCalled();
  });

  it('creates, reads and filters an owner-scoped projection', async () => {
    const projection = { id: PROJECTION_ID, graph: { nodes: [], edges: [], evidence: [] } };
    mocks.createProjection.mockResolvedValue(projection);
    mocks.latestForSynthesis.mockResolvedValue(projection);
    mocks.getProjection.mockResolvedValue(projection);

    const createResponse = await createProjection(
      request('http://localhost/api/v1/knowledge-graphs/projections', 'POST', {
        synthesisId: SYNTHESIS_ID,
      }),
    );
    expect(createResponse.status).toBe(201);
    expect(await createResponse.clone().json()).toMatchObject({
      renderer: { webglEnabled: false },
    });
    expect(mocks.createProjection).toHaveBeenCalledWith(SYNTHESIS_ID, { force: false });

    process.env.KNOWLEDGE_GRAPH_WEBGL_ENABLED = 'true';
    process.env.OBSIDIAN_VAULT_NAME = 'Learning Vault';
    const latestResponse = await latestProjection(
      request(
        `http://localhost/api/v1/knowledge-graphs/projections?synthesisId=${SYNTHESIS_ID}&lod=1&minConfidence=0.75`,
      ),
    );
    expect(latestResponse.status).toBe(200);
    expect(await latestResponse.clone().json()).toMatchObject({
      renderer: { webglEnabled: true, obsidianVaultName: 'Learning Vault' },
    });
    expect(mocks.latestForSynthesis).toHaveBeenCalledWith(
      SYNTHESIS_ID,
      expect.objectContaining({ lod: 1, minConfidence: 0.75 }),
    );

    const getResponse = await getProjection(
      request(
        `http://localhost/api/v1/knowledge-graphs/projections/${PROJECTION_ID}?nodeTypes=concept,review`,
      ),
      { params: Promise.resolve({ projectionId: PROJECTION_ID }) },
    );
    expect(getResponse.status).toBe(200);
    expect(mocks.getProjection).toHaveBeenCalledWith(
      PROJECTION_ID,
      expect.objectContaining({ nodeTypes: ['concept', 'review'] }),
    );
  });

  it('exposes accessible node, neighborhood, path and relation-feedback operations', async () => {
    mocks.getNode.mockResolvedValue({ id: 'concept:one' });
    mocks.neighborhood.mockResolvedValue({ nodes: [{ id: 'concept:one' }], edges: [] });
    mocks.path.mockResolvedValue({ found: true, nodes: [], edges: [] });
    mocks.feedback.mockResolvedValue({ relationId: RELATION_ID, action: 'confirm' });

    const nodeResponse = await getNode(
      request(
        `http://localhost/api/v1/knowledge-graphs/nodes/concept%3Aone?projectionId=${PROJECTION_ID}`,
      ),
      { params: Promise.resolve({ nodeId: 'concept:one' }) },
    );
    expect(nodeResponse.status).toBe(200);

    const neighborhoodResponse = await getNeighborhood(
      request(
        `http://localhost/api/v1/knowledge-graphs/nodes/concept%3Aone/neighborhood?projectionId=${PROJECTION_ID}&depth=2`,
      ),
      { params: Promise.resolve({ nodeId: 'concept:one' }) },
    );
    expect(neighborhoodResponse.status).toBe(200);
    expect(mocks.neighborhood).toHaveBeenCalledWith(PROJECTION_ID, 'concept:one', 2);

    const pathResponse = await getPath(
      request(
        `http://localhost/api/v1/knowledge-graphs/path?projectionId=${PROJECTION_ID}&from=project%3Aone&to=concept%3Aone`,
      ),
    );
    expect(pathResponse.status).toBe(200);
    expect(mocks.path).toHaveBeenCalledWith(PROJECTION_ID, 'project:one', 'concept:one');

    const feedbackResponse = await saveFeedback(
      request('http://localhost/api/v1/knowledge-graphs/feedback', 'POST', {
        relationId: RELATION_ID,
        action: 'confirm',
      }),
    );
    expect(feedbackResponse.status).toBe(201);
    expect(mocks.feedback).toHaveBeenCalledWith({
      relationId: RELATION_ID,
      action: 'confirm',
    });
  });
});
