import type { NextRequest } from 'next/server';
import {
  consolidatedApiRoutes,
  type ConsolidatedApiRoute,
} from '@/lib/server/api-route-manifest.generated';

type RouteContext = {
  params: Promise<Record<string, string | string[]>>;
};

type RouteHandler = (request: NextRequest, context: RouteContext) => Response | Promise<Response>;

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;

function decodeRouteValue(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function matchConsolidatedApiRoute(
  encodedPath: string,
): { route: ConsolidatedApiRoute; params: Record<string, string | string[]> } | null {
  let selected:
    | {
        route: ConsolidatedApiRoute;
        match: RegExpExecArray;
        dynamicCount: number;
        catchAllCount: number;
      }
    | undefined;

  for (const route of consolidatedApiRoutes) {
    const match = route.pattern.exec(encodedPath);
    if (!match) continue;

    const candidate = {
      route,
      match,
      dynamicCount: route.params.length,
      catchAllCount: route.params.filter((parameter) => parameter.catchAll).length,
    };
    if (
      !selected ||
      candidate.dynamicCount < selected.dynamicCount ||
      (candidate.dynamicCount === selected.dynamicCount &&
        candidate.catchAllCount < selected.catchAllCount) ||
      (candidate.dynamicCount === selected.dynamicCount &&
        candidate.catchAllCount === selected.catchAllCount &&
        candidate.route.pattern.source.length > selected.route.pattern.source.length)
    ) {
      selected = candidate;
    }
  }

  if (!selected) return null;
  const params: Record<string, string | string[]> = {};
  selected.route.params.forEach((parameter, index) => {
    const rawValue = selected.match[index + 1] ?? '';
    params[parameter.name] = parameter.catchAll
      ? rawValue.split('/').map(decodeRouteValue)
      : decodeRouteValue(rawValue);
  });
  return { route: selected.route, params };
}

export async function dispatchConsolidatedApiRequest(request: NextRequest): Promise<Response> {
  const encodedPath = request.nextUrl.pathname.replace(/^\/api\/?/, '');
  const match = matchConsolidatedApiRoute(encodedPath);

  if (match) {
    const routeModule = (await match.route.load()) as Record<string, unknown>;
    const requestedMethod = request.method.toUpperCase();
    const selectedMethod =
      requestedMethod === 'HEAD' && typeof routeModule.HEAD !== 'function'
        ? 'GET'
        : requestedMethod;
    const handler = routeModule[selectedMethod] as RouteHandler | undefined;

    if (typeof handler !== 'function') {
      const allowedMethods = HTTP_METHODS.filter(
        (method) =>
          typeof routeModule[method] === 'function' ||
          (method === 'HEAD' && typeof routeModule.GET === 'function'),
      );
      return Response.json(
        { success: false, errorCode: 'METHOD_NOT_ALLOWED', error: 'Method not allowed' },
        { status: 405, headers: { Allow: allowedMethods.join(', ') } },
      );
    }

    const response = await handler(request, { params: Promise.resolve(match.params) });
    if (requestedMethod !== 'HEAD' || selectedMethod !== 'GET') return response;

    return new Response(null, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  }

  return Response.json(
    { success: false, errorCode: 'NOT_FOUND', error: 'API route not found' },
    { status: 404 },
  );
}
