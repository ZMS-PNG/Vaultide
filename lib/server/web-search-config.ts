import {
  getServerWebSearchProviders,
  isServerConfiguredProvider,
  resolveServerWebSearchProviderId,
  resolveWebSearchApiKey,
  resolveWebSearchBaseUrl,
} from '@/lib/server/provider-config';
import type { WebSearchCandidate } from './resilient-web-search';
import { WEB_SEARCH_PROVIDERS } from '@/lib/web-search/constants';
import type { BaiduSubSources, WebSearchProviderId } from '@/lib/web-search/types';

const OFFICIAL_CLIENT_BASE_URLS: Record<WebSearchProviderId, string[]> = {
  tavily: ['https://api.tavily.com', 'https://api.tavily.com/search'],
  bocha: [
    'https://api.bocha.cn',
    'https://api.bocha.cn/v1',
    'https://api.bocha.cn/v1/web-search',
    'https://api.bochaai.com',
    'https://api.bochaai.com/v1',
    'https://api.bochaai.com/v1/web-search',
  ],
  brave: [
    'https://search.brave.com',
    'https://search.brave.com/search',
    'https://api.search.brave.com',
  ],
  baidu: ['https://qianfan.baidubce.com'],
  minimax: [
    'https://api.minimaxi.com',
    'https://api.minimaxi.com/v1',
    'https://api.minimaxi.com/v1/coding_plan',
    'https://api.minimaxi.com/v1/coding_plan/search',
    'https://api.minimax.io',
    'https://api.minimax.io/v1',
    'https://api.minimax.io/v1/coding_plan',
    'https://api.minimax.io/v1/coding_plan/search',
  ],
  doubao: ['https://open.feedcoopapi.com', 'https://open.feedcoopapi.com/search_api/web_search'],
  searxng: [],
};

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, '');
}

function assertWebSearchProviderId(
  providerId: string | undefined,
): providerId is WebSearchProviderId {
  return !!providerId && providerId in WEB_SEARCH_PROVIDERS;
}

function providerMode(providerId: WebSearchProviderId, apiKey: string): WebSearchCandidate['mode'] {
  if (providerId === 'searxng') return 'self-hosted';
  if (providerId === 'brave' && !apiKey) return 'public-page';
  return 'official-api';
}

export function resolveSafeClientWebSearchBaseUrl(
  providerId: WebSearchProviderId,
  clientBaseUrl?: string,
): string | undefined {
  const trimmed = clientBaseUrl?.trim();
  if (!trimmed) return undefined;

  let normalized: string;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('Invalid protocol');
    }
    normalized = normalizeBaseUrl(parsed.toString());
  } catch {
    throw new Error(`Unsupported ${WEB_SEARCH_PROVIDERS[providerId].name} base URL`);
  }

  const allowed = OFFICIAL_CLIENT_BASE_URLS[providerId].map(normalizeBaseUrl);
  if (!allowed.includes(normalized)) {
    throw new Error(`Unsupported ${WEB_SEARCH_PROVIDERS[providerId].name} base URL`);
  }
  return normalized;
}

export function resolveWebSearchRouteBaseUrl(
  providerId: WebSearchProviderId,
  clientBaseUrl?: string,
): string | undefined {
  const safeClientBaseUrl = resolveSafeClientWebSearchBaseUrl(providerId, clientBaseUrl);
  return resolveWebSearchBaseUrl(providerId, safeClientBaseUrl);
}

/**
 * Build a credential-safe fallback chain for the interactive web-search route.
 * Client credentials are considered only for the explicitly requested provider;
 * all additional candidates must be operator-managed on the server.
 */
export function resolveWebSearchCandidates(input: {
  requestedProviderId?: WebSearchProviderId;
  clientApiKey?: string;
  clientBaseUrl?: string;
  baiduSubSources?: BaiduSubSources;
}): { requestedProviderId: WebSearchProviderId; candidates: WebSearchCandidate[] } {
  const requestedProviderId = assertWebSearchProviderId(input.requestedProviderId)
    ? input.requestedProviderId
    : ((resolveServerWebSearchProviderId() as WebSearchProviderId | undefined) ?? 'tavily');
  const requestedIsManaged = isServerConfiguredProvider('webSearch', requestedProviderId);
  const preferredManaged = resolveServerWebSearchProviderId() as WebSearchProviderId | undefined;
  const managedIds = Object.keys(getServerWebSearchProviders()).filter(assertWebSearchProviderId);

  const order: WebSearchProviderId[] = [];
  const add = (providerId: WebSearchProviderId | undefined) => {
    if (providerId && !order.includes(providerId)) order.push(providerId);
  };
  // Preserve the existing operator preference: a managed backend is primary
  // when the browser points at an unmanaged/default provider.
  if (preferredManaged && !requestedIsManaged) add(preferredManaged);
  add(requestedProviderId);
  for (const providerId of managedIds) add(providerId);

  const candidates: WebSearchCandidate[] = [];
  for (const providerId of order) {
    const provider = WEB_SEARCH_PROVIDERS[providerId];
    const managed = isServerConfiguredProvider('webSearch', providerId);
    if (!managed && providerId !== requestedProviderId) continue;
    const apiKey = resolveWebSearchApiKey(
      providerId,
      !managed && providerId === requestedProviderId ? input.clientApiKey : undefined,
    );
    if (provider.requiresApiKey && !apiKey) continue;

    const clientBaseUrl =
      !managed && providerId === requestedProviderId && providerId !== 'searxng'
        ? input.clientBaseUrl
        : undefined;
    const baseUrl = resolveWebSearchRouteBaseUrl(providerId, clientBaseUrl);
    if (provider.requiresBaseUrl && !baseUrl) continue;
    candidates.push({
      providerId,
      apiKey,
      baseUrl,
      mode: providerMode(providerId, apiKey),
      ...(providerId === 'baidu' && input.baiduSubSources
        ? { baiduSubSources: input.baiduSubSources }
        : {}),
    });
  }
  return { requestedProviderId, candidates };
}

export function resolveClassroomWebSearchConfig(input: {
  webSearchProviderId?: WebSearchProviderId;
  webSearchApiKey?: string;
  baiduSubSources?: BaiduSubSources;
}):
  | {
      providerId: WebSearchProviderId;
      apiKey: string;
      baseUrl?: string;
      baiduSubSources?: BaiduSubSources;
    }
  | undefined {
  const requestedProviderId = assertWebSearchProviderId(input.webSearchProviderId)
    ? input.webSearchProviderId
    : undefined;
  const providerId =
    requestedProviderId ?? (resolveServerWebSearchProviderId() as WebSearchProviderId | undefined);
  if (!providerId) return undefined;

  const provider = WEB_SEARCH_PROVIDERS[providerId];
  const apiKey = resolveWebSearchApiKey(providerId, input.webSearchApiKey);
  if (provider.requiresApiKey && !apiKey) return undefined;

  const baseUrl = resolveWebSearchBaseUrl(providerId);
  if (provider.requiresBaseUrl && !baseUrl) return undefined;

  return {
    providerId,
    apiKey,
    baseUrl,
    ...(providerId === 'baidu' && input.baiduSubSources
      ? { baiduSubSources: input.baiduSubSources }
      : {}),
  };
}
