// Loaded by the consolidated Vercel API dispatcher.
/**
 * Web Search API
 *
 * POST /api/web-search
 * Simple JSON request/response using the configured web search provider.
 */

import { NextRequest } from 'next/server';
import { callLLM } from '@/lib/ai/llm';
import { formatSearchResultsAsContext } from '@/lib/web-search';
import { createLogger } from '@/lib/logger';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import {
  buildSearchQuery,
  SEARCH_QUERY_REWRITE_EXCERPT_LENGTH,
} from '@/lib/server/search-query-builder';
import { resolveModelFromRequest } from '@/lib/server/resolve-model';
import type { AICallFn } from '@/lib/generation/pipeline-types';
import { WEB_SEARCH_PROVIDERS } from '@/lib/web-search/constants';
import type { BaiduSubSources, WebSearchProviderId } from '@/lib/web-search/types';
import { resolveWebSearchCandidates } from '@/lib/server/web-search-config';
import { searchWebResilient, WebSearchExhaustedError } from '@/lib/server/resilient-web-search';
import type { WebSearchProvenance, WebSearchSourcePolicy } from '@/lib/types/web-search';
import {
  enrichWebSearchResultWithDirectContent,
  fetchDirectSourcesFromRequirement,
} from '@/lib/server/direct-source-fetch';
import type { ExternalEvidenceMode } from '@/lib/generation/external-evidence-policy';
import { plainCourseText } from '@/lib/generation/course-quality';
import { discoverOfficialSources } from '@/lib/server/official-source-discovery';

const log = createLogger('WebSearch');

export async function POST(req: NextRequest) {
  let query: string | undefined;
  let effectiveQuery = '';
  let requestedProviderIdForFallback: WebSearchProviderId = 'brave';
  let sourcePolicyForFallback: WebSearchSourcePolicy = 'prefer-primary';
  let externalEvidenceModeForFallback: ExternalEvidenceMode = 'required';
  let canonicalSourceTextForFallback: string | undefined;
  try {
    const body = await req.json();
    const {
      query: requestQuery,
      pdfText,
      providerId: requestProviderId,
      apiKey: bodyApiKey,
      baseUrl: bodyBaseUrl,
      baiduSubSources,
      sourcePolicy: requestedSourcePolicy,
      externalEvidenceMode: requestedExternalEvidenceMode,
    } = body as {
      query?: string;
      pdfText?: string;
      providerId?: WebSearchProviderId;
      apiKey?: string;
      baseUrl?: string;
      baiduSubSources?: BaiduSubSources;
      sourcePolicy?: WebSearchSourcePolicy;
      externalEvidenceMode?: ExternalEvidenceMode;
    };
    query = requestQuery;
    canonicalSourceTextForFallback = pdfText;

    if (!query || !query.trim()) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'query is required');
    }

    const requestedProviderId: WebSearchProviderId =
      requestProviderId && WEB_SEARCH_PROVIDERS[requestProviderId] ? requestProviderId : 'tavily';
    const sourcePolicy: WebSearchSourcePolicy =
      requestedSourcePolicy === 'balanced' ? 'balanced' : 'prefer-primary';
    requestedProviderIdForFallback = requestedProviderId;
    sourcePolicyForFallback = sourcePolicy;
    externalEvidenceModeForFallback =
      requestedExternalEvidenceMode === 'off' ||
      requestedExternalEvidenceMode === 'supplemental' ||
      requestedExternalEvidenceMode === 'required'
        ? requestedExternalEvidenceMode
        : 'required';

    // A learner who supplied a concrete repository, paper, patent, or article
    // URL already supplied the best retrieval target. Fetch it before asking a
    // general-search provider, so this normal learning path is not blocked by
    // a provider quota or an unrelated API-key outage.
    const directResult = await fetchDirectSourcesFromRequirement({
      requirement: query,
      sourcePolicy,
    });
    if (directResult) {
      const provenance: WebSearchProvenance = {
        requestedProviderId: requestedProviderIdForFallback,
        providerId: 'direct-url',
        mode: 'direct-url',
        fetchedAt: new Date().toISOString(),
        sourcePolicy,
        attempts: [
          {
            providerId: 'direct-url',
            mode: 'direct-url',
            try: 1,
            strategy: 'original',
            outcome: 'success',
            rawSourceCount: directResult.sources.length,
            qualifyingSourceCount: directResult.sources.length,
          },
        ],
        outcome: 'ready',
        storagePolicy: 'citation-metadata-only',
      };
      try {
        const { recordResearchRunIfConfigured } = await import('@/lib/learning/research');
        const recorded = await recordResearchRunIfConfigured(directResult, provenance);
        if (recorded) provenance.researchRunId = recorded.id;
      } catch (error) {
        log.warn('Direct source succeeded but citation metadata could not be persisted:', error);
      }
      return apiSuccess({
        answer: directResult.answer,
        sources: directResult.sources,
        context: formatSearchResultsAsContext(directResult),
        query: directResult.query,
        responseTime: directResult.responseTime,
        provenance,
        fallback: 'direct-url',
      });
    }

    // For a named public repository or a paper/research request, the official
    // origin is a stronger first source than a generic search result. This is
    // especially important for a compact `owner/repository` reference, where a
    // semantic search can return a popular but different project. The fallback
    // remains in place for broad topics and for any official API outage.
    const officialTarget = await discoverOfficialSources(query).catch(() => null);
    if (officialTarget) {
      const sources = officialTarget.result.sources.map((source, index) => ({
        ...source,
        citationId: `S${index + 1}`,
      }));
      const result = { ...officialTarget.result, sources };
      const provenance: WebSearchProvenance = {
        requestedProviderId: requestedProviderIdForFallback,
        providerId: officialTarget.providerId,
        mode: 'official-api',
        fetchedAt: new Date().toISOString(),
        sourcePolicy,
        attempts: [
          {
            providerId: officialTarget.providerId,
            mode: 'official-api',
            try: 1,
            strategy: 'authority-rescue',
            outcome: 'success',
            rawSourceCount: sources.length,
            qualifyingSourceCount: sources.length,
          },
        ],
        outcome: 'ready',
        storagePolicy: 'citation-metadata-only',
      };
      try {
        const { recordResearchRunIfConfigured } = await import('@/lib/learning/research');
        const recorded = await recordResearchRunIfConfigured(result, provenance);
        if (recorded) provenance.researchRunId = recorded.id;
      } catch (error) {
        log.warn('Official source target succeeded but citation metadata could not be persisted:', error);
      }
      return apiSuccess({
        answer: result.answer,
        sources,
        context: formatSearchResultsAsContext(result),
        query: result.query,
        responseTime: result.responseTime,
        provenance,
        fallback: officialTarget.providerId,
      });
    }
    let resolved: ReturnType<typeof resolveWebSearchCandidates>;
    try {
      resolved = resolveWebSearchCandidates({
        requestedProviderId,
        clientApiKey: bodyApiKey,
        clientBaseUrl: bodyBaseUrl,
        baiduSubSources,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid web search configuration';
      return apiError('INVALID_REQUEST', 400, message);
    }
    if (resolved.candidates.length === 0) {
      // GitHub repositories and current arXiv papers have credential-free
      // official discovery paths. Try those before declaring external learning
      // unavailable merely because no generic search provider is configured.
      const officialDiscovery = await discoverOfficialSources(query).catch(() => null);
      if (officialDiscovery) {
        const sources = officialDiscovery.result.sources.map((source, index) => ({
          ...source,
          citationId: `S${index + 1}`,
        }));
        const result = { ...officialDiscovery.result, sources };
        const provenance: WebSearchProvenance = {
          requestedProviderId: requestedProviderIdForFallback,
          providerId: officialDiscovery.providerId,
          mode: 'official-api',
          fetchedAt: new Date().toISOString(),
          sourcePolicy,
          attempts: [
            {
              providerId: officialDiscovery.providerId,
              mode: 'official-api',
              try: 1,
              strategy: 'authority-rescue',
              outcome: 'success',
              rawSourceCount: sources.length,
              qualifyingSourceCount: sources.length,
            },
          ],
          outcome: 'ready',
          storagePolicy: 'citation-metadata-only',
        };
        try {
          const { recordResearchRunIfConfigured } = await import('@/lib/learning/research');
          const recorded = await recordResearchRunIfConfigured(result, provenance);
          if (recorded) provenance.researchRunId = recorded.id;
        } catch (error) {
          log.warn('Official discovery succeeded but citation metadata could not be persisted:', error);
        }
        return apiSuccess({
          answer: result.answer,
          sources,
          context: formatSearchResultsAsContext(result),
          query: result.query,
          responseTime: result.responseTime,
          provenance,
          fallback: officialDiscovery.providerId,
        });
      }
      const provider = WEB_SEARCH_PROVIDERS[requestedProviderId];
      if (provider.requiresApiKey) {
        return apiError(
          'MISSING_API_KEY',
          400,
          `${provider.name} API key is not configured. Set it in Settings -> Web Search or configure ${getWebSearchEnvKey(requestedProviderId)} on the server.`,
        );
      }
      return apiError(
        'MISSING_REQUIRED_FIELD',
        400,
        getMissingBaseUrlMessage(requestedProviderId, provider.name),
      );
    }

    // Clamp rewrite input at the route boundary; framework body limits still apply to total request size.
    const boundedPdfText = pdfText?.slice(0, SEARCH_QUERY_REWRITE_EXCERPT_LENGTH);

    let aiCall: AICallFn | undefined;
    try {
      const { model: languageModel } = await resolveModelFromRequest(
        req,
        body,
        'web-search-query-rewrite',
      );
      aiCall = async (systemPrompt, userPrompt) => {
        const result = await callLLM(
          {
            model: languageModel,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
            ],
            maxOutputTokens: 256,
          },
          'web-search-query-rewrite',
          undefined,
          {
            mode: 'disabled',
            enabled: false,
            excludeReasoningOutput: true,
          },
        );
        return result.text;
      };
    } catch (error) {
      log.warn('Search query rewrite model unavailable, falling back to raw requirement:', error);
    }

    const searchQuery = await buildSearchQuery(query, boundedPdfText, aiCall);
    effectiveQuery = searchQuery.query;

    log.info('Running web search API request', {
      hasPdfContext: searchQuery.hasPdfContext,
      rawRequirementLength: searchQuery.rawRequirementLength,
      rewriteAttempted: searchQuery.rewriteAttempted,
      finalQueryLength: searchQuery.finalQueryLength,
    });

    const { result: shallowResult, provenance } = await searchWebResilient({
      requestedProviderId: resolved.requestedProviderId,
      candidates: resolved.candidates,
      query: searchQuery.query,
      sourcePolicy,
    });
    const result =
      process.env.NODE_ENV === 'test'
        ? shallowResult
        : await enrichWebSearchResultWithDirectContent(shallowResult);
    try {
      // Load the database adapter only after a grounded search succeeds.
      const { recordResearchRunIfConfigured } = await import('@/lib/learning/research');
      const recorded = await recordResearchRunIfConfigured(result, provenance);
      if (recorded) provenance.researchRunId = recorded.id;
    } catch (error) {
      // Search remains usable if provenance storage is temporarily down. The
      // response makes the absence explicit by omitting researchRunId.
      log.warn('Web search succeeded but citation metadata could not be persisted:', error);
    }
    const context = formatSearchResultsAsContext(result);

    return apiSuccess({
      answer: result.answer,
      sources: result.sources,
      context,
      query: result.query,
      responseTime: result.responseTime,
      provenance,
    });
  } catch (err) {
    if (err instanceof WebSearchExhaustedError) {
      const attemptSummary = err.attempts
        .map(
          (attempt) =>
            `${attempt.providerId}/${attempt.mode}/${attempt.strategy}:${attempt.outcome}${
              attempt.status ? `(${attempt.status})` : ''
            }${
              typeof attempt.rawSourceCount === 'number'
                ? `[raw=${attempt.rawSourceCount},qualified=${attempt.qualifyingSourceCount ?? 0}]`
                : ''
            }`,
        )
        .join(', ');
      log.error('Web search provider chain exhausted.', {
        requestedProviderId: requestedProviderIdForFallback,
        errorCode: err.code,
        attempts: attemptSummary,
      });
      const directResult = query
        ? await fetchDirectSourcesFromRequirement({
            requirement: query,
            sourcePolicy: sourcePolicyForFallback,
          })
        : undefined;
      if (directResult) {
        const provenance: WebSearchProvenance = {
          requestedProviderId: requestedProviderIdForFallback,
          providerId: 'direct-url',
          mode: 'direct-url' as const,
          fetchedAt: new Date().toISOString(),
          sourcePolicy: sourcePolicyForFallback,
          attempts: [
            ...err.attempts,
            {
              providerId: 'direct-url',
              mode: 'direct-url' as const,
              try: 1,
              strategy: 'original' as const,
              outcome: 'success' as const,
            },
          ],
          storagePolicy: 'citation-metadata-only' as const,
        };
        try {
          const { recordResearchRunIfConfigured } = await import('@/lib/learning/research');
          const recorded = await recordResearchRunIfConfigured(directResult, provenance);
          if (recorded) provenance.researchRunId = recorded.id;
        } catch (error) {
          log.warn('Direct source succeeded but citation metadata could not be persisted:', error);
        }
        return apiSuccess({
          answer: directResult.answer,
          sources: directResult.sources,
          context: formatSearchResultsAsContext(directResult),
          query: directResult.query,
          responseTime: directResult.responseTime,
          provenance,
          warningCode: err.code,
          fallback: 'direct-url',
        });
      }

      const officialDiscovery = query
        ? await discoverOfficialSources(effectiveQuery || query)
        : null;
      if (officialDiscovery) {
        const provenance: WebSearchProvenance = {
          requestedProviderId: requestedProviderIdForFallback,
          providerId: officialDiscovery.providerId,
          mode: 'official-api',
          fetchedAt: new Date().toISOString(),
          sourcePolicy: sourcePolicyForFallback,
          attempts: [
            ...err.attempts,
            {
              providerId: officialDiscovery.providerId,
              mode: 'official-api',
              try: 1,
              strategy: 'authority-rescue',
              outcome: 'success',
              rawSourceCount: officialDiscovery.result.sources.length,
              qualifyingSourceCount: officialDiscovery.result.sources.length,
            },
          ],
          outcome: 'ready',
          storagePolicy: 'citation-metadata-only',
        };
        try {
          const { recordResearchRunIfConfigured } = await import('@/lib/learning/research');
          const recorded = await recordResearchRunIfConfigured(
            officialDiscovery.result,
            provenance,
          );
          if (recorded) provenance.researchRunId = recorded.id;
        } catch (error) {
          log.warn('Official source discovery succeeded but metadata could not be persisted:', error);
        }
        return apiSuccess({
          answer: officialDiscovery.result.answer,
          sources: officialDiscovery.result.sources.map((source, index) => ({
            ...source,
            citationId: `S${index + 1}`,
          })),
          context: formatSearchResultsAsContext({
            ...officialDiscovery.result,
            sources: officialDiscovery.result.sources.map((source, index) => ({
              ...source,
              citationId: `S${index + 1}`,
            })),
          }),
          query: officialDiscovery.result.query,
          responseTime: officialDiscovery.result.responseTime,
          provenance,
          warningCode: err.code,
          fallback: officialDiscovery.providerId,
        });
      }

      const localSourceChars = plainCourseText(canonicalSourceTextForFallback).length;
      if (externalEvidenceModeForFallback === 'supplemental' && localSourceChars >= 2_500) {
        const warning =
          '外部权威资料本轮未取得；课堂将严格以已审查的内部原始资料为依据，且不会声称包含最新外部结论。';
        log.warn(
          'Supplemental external research unavailable; canonical source remains sufficient.',
          {
            localSourceChars,
            requestedProviderId: requestedProviderIdForFallback,
            attempts: attemptSummary,
          },
        );
        return apiSuccess({
          answer: '',
          sources: [],
          context: '',
          query: effectiveQuery || query?.trim() || '',
          responseTime: 0,
          degraded: true,
          warningCode: err.code,
          warning,
          fallback: 'canonical-source',
          provenance: {
            requestedProviderId: requestedProviderIdForFallback,
            providerId: 'unavailable',
            mode: 'unavailable' as const,
            fetchedAt: new Date().toISOString(),
            sourcePolicy: sourcePolicyForFallback,
            attempts: err.attempts,
            outcome: 'unavailable' as const,
            storagePolicy: 'citation-metadata-only' as const,
          },
        });
      }

      // The learner explicitly requested current external evidence. Never
      // silently turn that into an internal-only classroom: fail with the
      // provider-level reason so credentials can be fixed or the search retried.
      const response = apiError(
        err.code,
        err.status,
        err.message,
        attemptSummary
          ? `Search attempts: ${attemptSummary}`
          : `No usable result was returned for ${effectiveQuery || query?.trim() || 'the query'}.`,
      );
      if (err.retryAfterMs !== undefined) {
        response.headers.set(
          'Retry-After',
          String(Math.max(1, Math.ceil(err.retryAfterMs / 1000))),
        );
      }
      return response;
    }
    log.error(`Web search failed [query="${query?.substring(0, 60) ?? 'unknown'}"]:`, err);
    const message = err instanceof Error ? err.message : 'Web search failed';
    return apiError('INTERNAL_ERROR', 500, message);
  }
}

function getMissingBaseUrlMessage(providerId: WebSearchProviderId, providerName: string): string {
  if (providerId === 'searxng') {
    return `${providerName} base URL is not configured. Set SEARXNG_BASE_URL on the server.`;
  }
  return `${providerName} base URL is not configured. Set ${getWebSearchEnvKey(providerId)} on the server or configure the base URL in Settings -> Web Search.`;
}

function getWebSearchEnvKey(providerId: WebSearchProviderId): string {
  switch (providerId) {
    case 'baidu':
      return 'BAIDU_API_KEY';
    case 'bocha':
      return 'BOCHA_API_KEY';
    case 'brave':
      return 'BRAVE_API_KEY';
    case 'minimax':
      return 'WEB_SEARCH_MINIMAX_API_KEY';
    case 'searxng':
      return 'SEARXNG_BASE_URL';
    case 'tavily':
    default:
      return 'TAVILY_API_KEY';
  }
}
