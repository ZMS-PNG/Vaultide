import { parseJsonResponse } from '@/lib/generation/json-repair';
import { PROMPT_IDS, buildPrompt } from '@/lib/prompts';
import type { AICallFn } from '@/lib/generation/pipeline-types';
import { createLogger } from '@/lib/logger';
import { extractResearchTerms, hasResearchTopicOverlap } from '@/lib/web-search/relevance';

const log = createLogger('SearchQueryBuilder');
const TAVILY_SOFT_MAX_QUERY_LENGTH = 350;
export const SEARCH_QUERY_REWRITE_EXCERPT_LENGTH = 7000;

interface SearchQueryRewriteResponse {
  query: string;
}

export interface SearchQueryBuildResult {
  query: string;
  rewriteAttempted: boolean;
  rawRequirementLength: number;
  finalQueryLength: number;
  hasPdfContext: boolean;
}

function normalizeSearchRequirement(requirement: string): string {
  return requirement.replace(/\s+/g, ' ').trim();
}

function githubRepositorySearchQuery(requirement: string): string | undefined {
  const match = requirement.match(
    /https?:\/\/(?:www\.)?github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/i,
  );
  if (!match?.[1] || !match[2]) return undefined;
  const owner = match[1];
  const repository = match[2].replace(/\.git$/i, '');
  if (!repository) return undefined;
  return `${owner}/${repository} GitHub repository official README documentation architecture`;
}

function normalizePdfExcerpt(pdfText?: string): string {
  if (!pdfText) {
    return '';
  }

  return pdfText
    .slice(0, SEARCH_QUERY_REWRITE_EXCERPT_LENGTH)
    .split(/\r?\n/)
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

function isGenericLearningGoal(value: string): boolean {
  const normalized = value.toLowerCase();
  const refersToProjectWithoutPublicIdentity =
    /该项目|这个项目|本项目|当前项目|快速了解|整体了解|项目全貌|project overview|this project/i.test(
      normalized,
    );
  const refersToSuppliedMaterial =
    /这些资料|这些材料|所给资料|supplied (sources?|materials?)|these (sources?|materials?)/i.test(
      normalized,
    );
  const containsTeachingInstructions =
    /诊断|讲解|循序渐进|主动回忆|实践练习|diagnose|explain|teach|active recall|practice/i.test(
      normalized,
    );
  return (
    refersToProjectWithoutPublicIdentity ||
    (refersToSuppliedMaterial && containsTeachingInstructions)
  );
}

const PUBLIC_TECH_PATTERNS: ReadonlyArray<{ pattern: RegExp; label: string }> = [
  { pattern: /\breact(?:\s+1[89])?\b/i, label: 'React' },
  { pattern: /\btypescript\b/i, label: 'TypeScript' },
  { pattern: /\bvite(?:\s+[456])?\b/i, label: 'Vite' },
  { pattern: /\breact router(?:\s+7)?\b/i, label: 'React Router' },
  { pattern: /\bcapacitor\b/i, label: 'Capacitor' },
  { pattern: /\bfastapi\b/i, label: 'FastAPI' },
  { pattern: /\bnext\.?js\b/i, label: 'Next.js' },
  { pattern: /\bnode\.?js\b/i, label: 'Node.js' },
  { pattern: /\bpython\b/i, label: 'Python' },
  { pattern: /\bpostgres(?:ql)?\b/i, label: 'PostgreSQL' },
  { pattern: /\bmysql\b/i, label: 'MySQL' },
  { pattern: /\bredis\b/i, label: 'Redis' },
  { pattern: /\bdocker\b/i, label: 'Docker' },
  { pattern: /\brest(?:ful)?\s+api\b/i, label: 'REST API' },
  { pattern: /\breact query\b/i, label: 'React Query' },
  { pattern: /\bswr\b/i, label: 'SWR' },
];

const PUBLIC_DOMAIN_PATTERNS: ReadonlyArray<{ pattern: RegExp; label: string }> = [
  { pattern: /智慧农业|智能农业/i, label: 'smart agriculture' },
  { pattern: /无人机/i, label: 'agricultural drone' },
  { pattern: /气象监测|天气监测|天气系统/i, label: 'weather monitoring' },
  { pattern: /病虫害/i, label: 'pest detection' },
  { pattern: /任务管理/i, label: 'mission management' },
  { pattern: /图像识别/i, label: 'image recognition' },
];

function publicProjectTopicCandidates(pdfExcerpt: string): string[] {
  const topics: string[] = [];
  for (const candidate of [...PUBLIC_TECH_PATTERNS, ...PUBLIC_DOMAIN_PATTERNS]) {
    if (candidate.pattern.test(pdfExcerpt)) topics.push(candidate.label);
  }
  return [...new Set(topics)].slice(0, 10);
}

function sourceTopicCandidates(pdfExcerpt: string): string[] {
  const candidates: string[] = [];
  const seen = new Set<string>();
  const add = (value: string) => {
    const cleaned = value
      .replace(/^[-*\s]+/, '')
      .replace(/\.(md|markdown|txt|pdf)$/i, '')
      .replace(/[\\/]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120);
    if (!cleaned || extractResearchTerms(cleaned).size < 2 || seen.has(cleaned)) return;
    seen.add(cleaned);
    candidates.push(cleaned);
  };

  for (const line of pdfExcerpt.split(/\r?\n/).slice(0, 160)) {
    const source = line.match(/^---\s*SOURCE:\s*(.+?)\s*---$/i)?.[1];
    const heading = line.match(/^#{1,3}\s+(.+)$/)?.[1];
    const metadata = line.match(/^(?:title|tags|aliases)\s*:\s*(.+)$/i)?.[1];
    if (source) add(source);
    if (heading) add(heading);
    if (metadata) add(metadata.replace(/[\[\]"']/g, ' '));
    if (candidates.length >= 5) break;
  }
  return candidates;
}

function deterministicSearchQuery(requirement: string, pdfExcerpt: string): string {
  const requirementIsGeneric = isGenericLearningGoal(requirement);
  const publicTopics = publicProjectTopicCandidates(pdfExcerpt);
  const topics = sourceTopicCandidates(pdfExcerpt);
  const parts = [
    ...(requirementIsGeneric ? [] : [requirement]),
    ...publicTopics,
    ...topics,
    ...(requirementIsGeneric && publicTopics.length > 0
      ? ['official documentation architecture best practices']
      : []),
  ];
  const value = [...new Set(parts)]
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, TAVILY_SOFT_MAX_QUERY_LENGTH);
  return value || requirement;
}

function shouldRewriteSearchQuery(
  normalizedRequirement: string,
  normalizedPdfExcerpt: string,
): boolean {
  if (normalizedRequirement.length > 400 || Boolean(normalizedPdfExcerpt)) return true;

  // A short topic such as "PostgreSQL index optimization" is already a good
  // search query. A short *learning brief*, however, commonly mixes a topic
  // with teaching goals, comparisons, and deliverables. Sending that whole
  // sentence to authority-first search often yields no qualifying evidence.
  // Route those requests through the dedicated rewriter while preserving
  // concise, topic-only queries as-is.
  const containsLearningBriefLanguage =
    /\b(i want to|help me|learn|understand|compare|evaluate|design|explain|teach|practice)\b|我想|请帮我|学习|理解|比较|评估|设计|讲解|实践|取舍|实验/.test(
      normalizedRequirement.toLowerCase(),
    );
  const hasMultipleClauses = /[,，;；、]|(?:并|以及|然后|和)/.test(normalizedRequirement);
  return containsLearningBriefLanguage && hasMultipleClauses;
}

export async function buildSearchQuery(
  requirement: string,
  pdfText: string | undefined,
  aiCall?: AICallFn,
): Promise<SearchQueryBuildResult> {
  const normalizedRequirement = normalizeSearchRequirement(requirement);
  const pdfExcerpt = normalizePdfExcerpt(pdfText);
  const hasPdfContext = Boolean(pdfExcerpt);
  const directRepositoryQuery = hasPdfContext
    ? undefined
    : githubRepositorySearchQuery(normalizedRequirement);
  const deterministicPublicTopics = publicProjectTopicCandidates(pdfExcerpt);
  const rewriteAttempted =
    !directRepositoryQuery &&
    !(
      hasPdfContext &&
      isGenericLearningGoal(normalizedRequirement) &&
      deterministicPublicTopics.length >= 2
    ) &&
    shouldRewriteSearchQuery(normalizedRequirement, pdfExcerpt);
  const deterministicQuery = directRepositoryQuery
    ? directRepositoryQuery
    : hasPdfContext
      ? deterministicSearchQuery(normalizedRequirement, pdfExcerpt)
      : normalizedRequirement;

  const fallback = {
    query: deterministicQuery,
    rewriteAttempted,
    rawRequirementLength: normalizedRequirement.length,
    finalQueryLength: deterministicQuery.length,
    hasPdfContext,
  } satisfies SearchQueryBuildResult;

  if (!normalizedRequirement || !rewriteAttempted) {
    return fallback;
  }

  if (!aiCall) {
    log.warn('Query rewrite AI call unavailable, using deterministic search query');
    return fallback;
  }

  const prompts = buildPrompt(PROMPT_IDS.WEB_SEARCH_QUERY_REWRITE, {
    requirement: normalizedRequirement,
    pdfExcerpt: pdfExcerpt || 'None',
  });

  if (!prompts) {
    log.warn('Query rewrite prompt not found, falling back to raw requirement');
    return fallback;
  }

  try {
    const response = await aiCall(prompts.system, prompts.user);
    const parsed = parseJsonResponse<SearchQueryRewriteResponse>(response);
    const rewrittenQuery = normalizeSearchRequirement(parsed?.query || '').slice(
      0,
      TAVILY_SOFT_MAX_QUERY_LENGTH,
    );
    if (!rewrittenQuery) {
      log.warn('Query rewrite returned empty output, falling back to raw requirement');
      return fallback;
    }
    if (hasPdfContext && !hasResearchTopicOverlap(deterministicQuery, rewrittenQuery)) {
      log.warn('Query rewrite lost the supplied source topic, using deterministic fallback');
      return fallback;
    }

    return {
      ...fallback,
      query: rewrittenQuery,
      finalQueryLength: rewrittenQuery.length,
    };
  } catch (error) {
    log.warn('Query rewrite failed, falling back to raw requirement:', error);
    return fallback;
  }
}
