import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { consolidatedApiRoutes } from '@/lib/server/api-route-manifest.generated';
import {
  dispatchConsolidatedApiRequest,
  matchConsolidatedApiRoute,
} from '@/lib/server/api-dispatcher';

describe('consolidated API dispatcher', () => {
  it('registers every migrated API route without duplicate patterns', () => {
    const patterns = consolidatedApiRoutes.map((route) => route.pattern.source);

    // The dispatcher manifest grows as durable learning routes are added. A
    // fixed count turns a valid new endpoint into a false regression; route
    // uniqueness and the explicit behavior checks below are the contract.
    expect(patterns.length).toBeGreaterThanOrEqual(93);
    expect(new Set(patterns).size).toBe(patterns.length);
  });

  it('matches exact, dynamic, and catch-all routes with decoded params', () => {
    expect(matchConsolidatedApiRoute('health')?.params).toEqual({});
    expect(
      matchConsolidatedApiRoute('v1/synthesis-schedules/run-due')?.route.pattern.source,
    ).toBe('^v1\\/synthesis-schedules\\/run-due$');
    expect(
      matchConsolidatedApiRoute('v1/projects/project%201/retrievals')?.params,
    ).toEqual({ projectId: 'project 1' });
    expect(
      matchConsolidatedApiRoute(
        'v1/research-runs/rrn_11111111111111111111111111111111/source-health',
      )?.params,
    ).toEqual({ researchRunId: 'rrn_11111111111111111111111111111111' });
    expect(
      matchConsolidatedApiRoute('classroom-media/classroom-1/slides/intro.png')?.params,
    ).toEqual({
      classroomId: 'classroom-1',
      path: ['slides', 'intro.png'],
    });
  });

  it('preserves existing handler behavior and rejects unsupported methods', async () => {
    const healthResponse = await dispatchConsolidatedApiRequest(
      new NextRequest('https://vaultide.test/api/health'),
    );
    const methodResponse = await dispatchConsolidatedApiRequest(
      new NextRequest('https://vaultide.test/api/health', { method: 'DELETE' }),
    );
    const missingResponse = await dispatchConsolidatedApiRequest(
      new NextRequest('https://vaultide.test/api/not-a-real-route'),
    );

    expect(healthResponse.status).toBe(200);
    expect(methodResponse.status).toBe(405);
    expect(methodResponse.headers.get('allow')).toContain('GET');
    expect(missingResponse.status).toBe(404);
  });
});
