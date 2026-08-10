import type { WebSearchResult, WebSearchSource } from '@/lib/types/web-search';

const DISCOVERY_TIMEOUT_MS = 12_000;
// A repository course needs a distinct overview, mechanism, setup,
// verification, and recovery lane. Six documents (README plus five focused
// companion documents) still fit inside the 44k frozen-evidence budget while
// avoiding the old choice between setup and operational evidence.
const MAX_DISCOVERY_SOURCES = 6;
const MIN_SUBSTANTIVE_GITHUB_README_CHARS = 600;
// A tiny linked file is frequently an agent prompt, redirect stub, or command
// fragment. It is not enough material to support a distinct classroom scene.
// Keep companion documents at the same minimum depth as the README lane.
const MIN_SUBSTANTIVE_GITHUB_DOCUMENT_CHARS = 600;
const MAX_GITHUB_COMPANION_DOCUMENTS = 5;
const MAX_GITHUB_COMPANION_CANDIDATES = MAX_GITHUB_COMPANION_DOCUMENTS * 3;
const GITHUB_AGENT_PROMPT_DOCUMENT = /\b(?:this prompt guides you,?\s*a coding agent|hey agent!)\b/iu;
const GENERIC_TERMS = new Set([
  'a',
  'an',
  'and',
  'article',
  'best',
  'for',
  'github',
  'latest',
  'learn',
  'new',
  'paper',
  'papers',
  'project',
  'recent',
  'repository',
  'research',
  'the',
  'valuable',
  'with',
  '学习',
  '最新',
  '有价值',
  '论文',
  '科研',
  '文章',
  '项目',
  '仓库',
]);

function compactText(value: string, maximum = 8_000): string {
  return value
    .replace(/<[^>]+>/gu, ' ')
    .replace(/&amp;/gu, '&')
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/&quot;/gu, '"')
    .replace(/&#39;/gu, "'")
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, maximum);
}

/**
 * GitHub READMEs are instructional documents, not search snippets. Preserve
 * their paragraph, heading, list, and code boundaries so later evidence
 * selection can distinguish installation, permissions, guardrails, and
 * verification material instead of seeing one flattened wall of text.
 */
function markdownDocumentText(value: string, maximum = 8_000): string {
  return value
    .replace(/\r\n?/gu, '\n')
    .replace(/[ \t]+\n/gu, '\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim()
    .slice(0, maximum);
}

function discoveryTerms(query: string, maximum: number): string[] {
  const unique = new Set<string>();
  for (const raw of query.match(/[\p{L}\p{N}][\p{L}\p{N}._+-]{1,48}/gu) ?? []) {
    const term = raw.toLocaleLowerCase();
    if (GENERIC_TERMS.has(term) || unique.has(term)) continue;
    unique.add(term);
    if (unique.size >= maximum) break;
  }
  return [...unique];
}

function paperIntent(query: string): boolean {
  return /\b(arxiv|paper|papers|preprint|research|study)\b|论文|科研|前沿文章|研究/iu.test(query);
}

function repositoryIntent(query: string): boolean {
  return /\b(github|repo|repository|repositories|open[ -]?source)\b|github|开源项目|代码仓库|仓库/iu.test(
    query,
  );
}

function tag(entry: string, name: string): string {
  const match = entry.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'iu'));
  return compactText(match?.[1] ?? '');
}

async function discoverArxiv(
  query: string,
  fetcher: typeof fetch,
): Promise<WebSearchResult | null> {
  if (!paperIntent(query)) return null;
  const terms = discoveryTerms(query, 5);
  if (terms.length === 0) return null;
  const searchQuery = terms.map((term) => `all:${term}`).join(' AND ');
  const url = new URL('https://export.arxiv.org/api/query');
  url.searchParams.set('search_query', searchQuery);
  url.searchParams.set('start', '0');
  url.searchParams.set('max_results', String(MAX_DISCOVERY_SOURCES));
  url.searchParams.set('sortBy', 'submittedDate');
  url.searchParams.set('sortOrder', 'descending');
  const startedAt = Date.now();
  const response = await fetcher(url, {
    headers: { 'User-Agent': 'Vaultide/0.6.2 (learning research; contact via deployment owner)' },
    signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
  });
  if (!response.ok) return null;
  const xml = (await response.text()).slice(0, 1_500_000);
  const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/giu)].map((match) => match[1]);
  const sources = entries
    .map((entry): WebSearchSource | null => {
      const id = tag(entry, 'id').replace(/^http:/iu, 'https:');
      const title = tag(entry, 'title');
      const summary = tag(entry, 'summary');
      const published = tag(entry, 'published');
      const authors = [...entry.matchAll(/<author>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/author>/giu)]
        .map((match) => compactText(match[1], 160))
        .filter(Boolean)
        .slice(0, 12);
      if (!id || !title || summary.length < 80) return null;
      return {
        title,
        url: id,
        content: compactText(
          [
            published ? `Published: ${published}` : '',
            authors.length ? `Authors: ${authors.join(', ')}` : '',
            summary,
          ]
            .filter(Boolean)
            .join('\n'),
        ),
        score: 1,
        domain: 'arxiv.org',
        authority: 'primary',
      };
    })
    .filter((source): source is WebSearchSource => Boolean(source));
  if (sources.length === 0) return null;
  return {
    answer: '',
    sources,
    query: searchQuery,
    responseTime: Date.now() - startedAt,
  };
}

interface GitHubRepositorySearchItem {
  full_name?: string;
  html_url?: string;
  description?: string | null;
  stargazers_count?: number;
  forks_count?: number;
  language?: string | null;
  topics?: string[];
  updated_at?: string;
  default_branch?: string;
}

function explicitRepositoryReference(query: string): string | undefined {
  const fromUrl = query.match(/github\.com\/([a-z0-9_.-]+)\/([a-z0-9_.-]+)/iu);
  if (fromUrl) return `${fromUrl[1]}/${fromUrl[2]}`;

  // The source picker and the natural-language goal commonly use the compact
  // owner/repository form (for example "microsoft/markitdown") without a URL.
  // Prefer this exact primary target over a semantic repository search that
  // can return a different popular project with overlapping keywords.
  const fromSlug = query.match(/\b([a-z0-9][a-z0-9_.-]{0,38})\/([a-z0-9][a-z0-9_.-]{0,98})\b/iu);
  return fromSlug ? `${fromSlug[1]}/${fromSlug[2]}` : undefined;
}

async function githubReadme(
  fullName: string,
  fetcher: typeof fetch,
  headers: Record<string, string>,
): Promise<string> {
  const response = await fetcher(
    `https://api.github.com/repos/${encodeURIComponent(fullName.split('/')[0] ?? '')}/${encodeURIComponent(fullName.split('/')[1] ?? '')}/readme`,
    {
      headers: { ...headers, Accept: 'application/vnd.github.raw+json' },
      signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
    },
  );
  return response.ok ? markdownDocumentText(await response.text(), 8_000) : '';
}

interface GitHubCompanionDocument {
  title: string;
  url: string;
  path: string;
  score: number;
}

interface GitHubTreeEntry {
  path?: string;
  type?: string;
}

interface GitHubTreeResponse {
  truncated?: boolean;
  tree?: GitHubTreeEntry[];
}

type GitHubDocumentationLane =
  | 'architecture'
  | 'mechanism'
  | 'setup'
  | 'verification'
  | 'recovery'
  | 'other';

const GITHUB_NON_TEACHING_DOCUMENT = /(?:^|\/)\.(?:github)(?:\/|$)|(?:^|\/)(?:changeset|scratchpad|test(?:s|data)?|fixtures?|examples?|adr|blog|changelog|release-notes)(?:\/|$)|(?:^|\/)(?:contributing|code_of_conduct|license|llms(?:-full)?|community)(?:\.|\/|$)/iu;

function githubDocumentationLane(path: string): GitHubDocumentationLane {
  const normalized = path.toLocaleLowerCase();
  if (/(?:architecture|security|guardrails?|threat)/u.test(normalized)) return 'architecture';
  if (/(?:cli|commands?|compile|lock(?:file)?|validat(?:e|ion)|testing)/u.test(normalized)) return 'verification';
  if (/(?:monitor|observ|troubleshoot|debug|recover|error|logs?|operations)/u.test(normalized)) return 'recovery';
  if (/(?:quick-start|install|setup|init|getting-started)/u.test(normalized)) return 'setup';
  if (/(?:how-they-work|concept|introduction|overview|workflow-structure|structure)/u.test(normalized)) return 'mechanism';
  // A generic reference page is useful only after a runnable CLI/command
  // page has been considered. Keep it in the verification lane, but score it
  // below a concrete command or validation guide.
  if (/(?:^|\/)reference(?:\/|$)/u.test(normalized)) return 'verification';
  return 'other';
}

function githubDocumentationScore(path: string): number {
  const normalized = path.toLocaleLowerCase();
  if (GITHUB_NON_TEACHING_DOCUMENT.test(normalized)) return 0;
  let score = 0;
  switch (githubDocumentationLane(normalized)) {
    case 'architecture':
      score += 190;
      break;
    case 'recovery':
      score += 180;
      break;
    case 'verification':
      score += 175;
      break;
    case 'setup':
      score += 170;
      break;
    case 'mechanism':
      score += 165;
      break;
    default:
      break;
  }
  if (/(?:quick-start|getting-started)/u.test(normalized)) score += 45;
  else if (/(?:install|setup)/u.test(normalized)) score += 20;
  // Prefer a concrete CLI manual over an arbitrary document that merely says
  // “validation”. The latter can still be cited later, but cannot substitute
  // for the learner's executable verification path.
  if (/(?:^|[\/_.-])cli(?:$|[\/_.-])/u.test(normalized)) score += 110;
  else if (/(?:^|[\/_.-])commands?(?:$|[\/_.-])/u.test(normalized)) score += 60;
  else if (/(?:compile|lock(?:file)?)/u.test(normalized)) score += 50;
  if (/(?:^|\/)troubleshooting(?:\/|$)/u.test(normalized)) score += 45;
  else if (/(?:debug|recover)/u.test(normalized)) score += 30;
  else if (/(?:monitor|observ|operations)/u.test(normalized)) score += 15;
  if (/(?:^|\/)experimental(?:\/|$)/u.test(normalized)) score -= 80;
  // “reference” alone is a taxonomy label, not proof that a learner can run
  // or verify anything. It remains available, but cannot outrank the CLI.
  if (/(?:^|\/)reference(?:\/|$)/u.test(normalized) && !/(?:cli|commands?|compile|lock|validat|test)/u.test(normalized)) score -= 55;
  if (/(?:^|\/)setup(?:\/|$)/u.test(normalized) && !/(?:quick-start|getting-started|install)/u.test(normalized)) score -= 25;
  if (/(?:^|\/)docs?(?:\/|$)|(?:^|\/)documentation(?:\/|$)|(?:^|\/)guides?(?:\/|$)/u.test(normalized)) score += 25;
  if (/\.mdx$/u.test(normalized)) score += 4;
  return score;
}

function titleForGitHubCompanion(fullName: string, path: string): string {
  return `${fullName} · ${path.split('/').at(-1) ?? path}`;
}

/**
 * Select documents by instructional role before filling the remaining slots by
 * relevance. A flat top-N list routinely selected five security documents or
 * five troubleshooting pages, leaving learners without a runnable setup or a
 * way to verify their work.
 */
function selectGitHubCompanionDocuments<T extends GitHubCompanionDocument>(
  documents: T[],
  maximum: number,
): T[] {
  const sorted = [...documents].sort((left, right) => right.score - left.score || left.url.localeCompare(right.url));
  const selected: T[] = [];
  const selectedUrls = new Set<string>();
  for (const lane of ['architecture', 'mechanism', 'setup', 'verification', 'recovery'] as const) {
    const candidate = sorted.find((document) => githubDocumentationLane(document.path) === lane && !selectedUrls.has(document.url));
    if (!candidate) continue;
    selected.push(candidate);
    selectedUrls.add(candidate.url);
    if (selected.length >= maximum) return selected;
  }
  for (const candidate of sorted) {
    if (selectedUrls.has(candidate.url)) continue;
    selected.push(candidate);
    selectedUrls.add(candidate.url);
    if (selected.length >= maximum) break;
  }
  return selected;
}

function mergeGitHubCompanionDocuments(documents: GitHubCompanionDocument[]): GitHubCompanionDocument[] {
  const byUrl = new Map<string, GitHubCompanionDocument>();
  for (const document of documents) {
    const current = byUrl.get(document.url);
    if (!current || document.score > current.score) byUrl.set(document.url, document);
  }
  return [...byUrl.values()];
}

function githubRawDocumentUrl(
  value: string,
  fullName: string,
  branch: string,
): { url: string; path: string } | null {
  try {
    const parsed = new URL(value);
    const [owner = '', repository = ''] = fullName.split('/');
    const expectedOwner = owner.toLocaleLowerCase();
    const expectedRepository = repository.toLocaleLowerCase();
    const normalizedHost = parsed.hostname.toLocaleLowerCase();
    const parts = parsed.pathname.split('/').filter(Boolean).map(decodeURIComponent);

    if (normalizedHost === 'raw.githubusercontent.com') {
      const [rawOwner, rawRepository, rawBranch, ...pathParts] = parts;
      if (
        rawOwner?.toLocaleLowerCase() !== expectedOwner ||
        rawRepository?.toLocaleLowerCase() !== expectedRepository ||
        !rawBranch ||
        pathParts.length === 0
      ) {
        return null;
      }
      const path = pathParts.join('/');
      return {
        path,
        url: `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/${encodeURIComponent(rawBranch)}/${pathParts.map(encodeURIComponent).join('/')}`,
      };
    }

    if (normalizedHost === 'github.com') {
      const [githubOwner, githubRepository, marker, linkedBranch, ...pathParts] = parts;
      if (
        githubOwner?.toLocaleLowerCase() !== expectedOwner ||
        githubRepository?.toLocaleLowerCase() !== expectedRepository ||
        marker !== 'blob' ||
        !linkedBranch ||
        pathParts.length === 0
      ) {
        return null;
      }
      const path = pathParts.join('/');
      return {
        path,
        url: `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/${encodeURIComponent(linkedBranch || branch)}/${pathParts.map(encodeURIComponent).join('/')}`,
      };
    }
  } catch {
    return null;
  }
  return null;
}

function githubCompanionDocuments(
  fullName: string,
  branch: string,
  readme: string,
): GitHubCompanionDocument[] {
  const urls = new Set<string>();
  for (const match of readme.matchAll(/\[[^\]]+\]\((https?:\/\/[^\s)]+)\)|https?:\/\/[^\s<>()]+/giu)) {
    const raw = (match[1] ?? match[0] ?? '').replace(/[.,;:]+$/u, '');
    if (raw) urls.add(raw);
  }

  return [...urls]
    .map((value) => githubRawDocumentUrl(value, fullName, branch))
    .filter((value): value is { url: string; path: string } => Boolean(value))
    .filter(({ path }) => /\.(?:md|mdx|txt)$/iu.test(path) && !GITHUB_NON_TEACHING_DOCUMENT.test(path))
    .map(({ url, path }) => ({
      title: titleForGitHubCompanion(fullName, path),
      url,
      path,
      score: githubDocumentationScore(path),
    }))
    .filter((document) => document.score > 0)
    .sort((left, right) => right.score - left.score || left.url.localeCompare(right.url))
    .filter((document, index, all) => all.findIndex((candidate) => candidate.url === document.url) === index)
    // Fetch more than the final limit. A superficially relevant file may turn
    // out to be an agent prompt or short stub after retrieval; applying the
    // cap before that check previously discarded the official CLI and
    // troubleshooting documents needed to teach verification and recovery.
    .slice(0, MAX_GITHUB_COMPANION_CANDIDATES);
}

/**
 * A README is intentionally concise in many healthy repositories. When it
 * does not link the operational documentation, inspect the repository's own
 * documentation tree instead of guessing from search snippets. This remains
 * fully primary-source grounded and is used only to fill missing teaching
 * lanes such as CLI verification or troubleshooting.
 */
async function githubDocumentationIndexDocuments(
  item: GitHubRepositorySearchItem,
  fetcher: typeof fetch,
  headers: Record<string, string>,
): Promise<GitHubCompanionDocument[]> {
  if (!item.full_name) return [];
  const [owner = '', repository = ''] = item.full_name.split('/');
  const branch = item.default_branch || 'HEAD';
  if (!owner || !repository) return [];
  const response = await fetcher(
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
    {
      headers: { ...headers, Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
    },
  ).catch(() => null);
  if (!response?.ok) return [];
  const payload = await response.json().catch(() => null) as GitHubTreeResponse | null;
  if (payload?.truncated || !Array.isArray(payload?.tree)) return [];

  const documentationRoot = /^(?:docs?|documentation|guides?)\//iu;
  const candidates = payload.tree
    .filter((entry) => entry.type === 'blob' && typeof entry.path === 'string')
    .map((entry) => entry.path as string)
    .filter((path) => documentationRoot.test(path) && /\.(?:md|mdx|txt)$/iu.test(path))
    .filter((path) => !GITHUB_NON_TEACHING_DOCUMENT.test(path))
    .map((path) => ({
      title: titleForGitHubCompanion(item.full_name!, path),
      path,
      url: `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/${encodeURIComponent(branch)}/${path.split('/').map(encodeURIComponent).join('/')}`,
      score: githubDocumentationScore(path),
    }))
    .filter((document) => document.score > 0);
  return selectGitHubCompanionDocuments(
    mergeGitHubCompanionDocuments(candidates),
    MAX_GITHUB_COMPANION_CANDIDATES,
  );
}

function githubCompanionsNeedIndex(documents: GitHubCompanionDocument[]): boolean {
  const lanes = new Set(documents.map((document) => githubDocumentationLane(document.path)));
  return ['architecture', 'mechanism', 'setup', 'verification', 'recovery']
    .some((lane) => !lanes.has(lane as GitHubDocumentationLane));
}

type ResolvedGitHubCompanionDocument = GitHubCompanionDocument & { source: WebSearchSource };

async function resolveGitHubCompanionDocument(
  document: GitHubCompanionDocument,
  fetcher: typeof fetch,
  headers: Record<string, string>,
): Promise<ResolvedGitHubCompanionDocument | null> {
  const response = await fetcher(document.url, {
    headers: { ...headers, Accept: 'text/plain, text/markdown, */*' },
    signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
  }).catch(() => null);
  if (!response?.ok) return null;
  const content = markdownDocumentText(await response.text(), 7_000);
  if (
    content.length < MIN_SUBSTANTIVE_GITHUB_DOCUMENT_CHARS ||
    GITHUB_AGENT_PROMPT_DOCUMENT.test(content)
  ) return null;
  return {
    ...document,
    source: {
      title: document.title,
      url: document.url,
      content,
      score: Math.max(0.55, Math.min(0.95, document.score / 220)),
      domain: 'raw.githubusercontent.com',
      authority: 'primary',
    },
  };
}

async function githubCompanionSources(
  item: GitHubRepositorySearchItem,
  readme: string,
  fetcher: typeof fetch,
  headers: Record<string, string>,
): Promise<WebSearchSource[]> {
  if (!item.full_name || !readme) return [];
  const linkedDocuments = githubCompanionDocuments(item.full_name, item.default_branch || 'HEAD', readme);
  const indexedDocuments = githubCompanionsNeedIndex(linkedDocuments)
    ? await githubDocumentationIndexDocuments(item, fetcher, headers)
    : [];
  const documents = selectGitHubCompanionDocuments(
    mergeGitHubCompanionDocuments([...linkedDocuments, ...indexedDocuments]),
    MAX_GITHUB_COMPANION_CANDIDATES,
  );
  const primaryDocuments = selectGitHubCompanionDocuments(
    documents,
    MAX_GITHUB_COMPANION_DOCUMENTS,
  );
  // Fetch the five role-selected documents first. Fetching every candidate in
  // parallel can make an otherwise healthy GitHub raw-content request lose
  // the CLI document to transient rate limits, then silently substitute an
  // unrelated lower-priority page.
  const resolved = await Promise.all(
    primaryDocuments.map((document) => resolveGitHubCompanionDocument(document, fetcher, headers)),
  );
  const accepted: ResolvedGitHubCompanionDocument[] = resolved.filter(
    (source): source is ResolvedGitHubCompanionDocument => Boolean(source),
  );
  const tried = new Set(primaryDocuments.map((document) => document.url));

  // Only a demonstrated retrieval failure permits a replacement. Prefer the
  // same instructional lane, so a failed CLI page cannot be replaced by a
  // second monitoring page merely because it ranks highly.
  for (const lane of ['architecture', 'mechanism', 'setup', 'verification', 'recovery'] as const) {
    if (accepted.some((document) => githubDocumentationLane(document.path) === lane)) continue;
    for (const candidate of documents) {
      if (tried.has(candidate.url) || githubDocumentationLane(candidate.path) !== lane) continue;
      tried.add(candidate.url);
      const replacement = await resolveGitHubCompanionDocument(candidate, fetcher, headers);
      if (!replacement) continue;
      accepted.push(replacement);
      break;
    }
  }

  // If a repository genuinely lacks a teaching lane, keep any additional
  // primary source only after the role-specific attempts above are exhausted.
  for (const candidate of documents) {
    if (accepted.length >= MAX_GITHUB_COMPANION_DOCUMENTS) break;
    if (tried.has(candidate.url)) continue;
    tried.add(candidate.url);
    const replacement = await resolveGitHubCompanionDocument(candidate, fetcher, headers);
    if (replacement) accepted.push(replacement);
  }
  return selectGitHubCompanionDocuments(accepted, MAX_GITHUB_COMPANION_DOCUMENTS)
    .map((resolvedSource) => resolvedSource.source);
}

function githubRepositorySources(
  item: GitHubRepositorySearchItem,
  readme: string,
  companionSources: WebSearchSource[] = [],
): WebSearchSource[] {
  if (!item.full_name || !item.html_url) return [];
  const [owner = '', repository = ''] = item.full_name.split('/');
  const branch = item.default_branch || 'HEAD';
  const metadata = compactText(
    [
      item.description || '',
      `Stars: ${item.stargazers_count ?? 0}; Forks: ${item.forks_count ?? 0}; Language: ${item.language || 'unknown'}; Updated: ${item.updated_at || 'unknown'}; Default branch: ${branch}.`,
      item.topics?.length ? `Topics: ${item.topics.join(', ')}.` : '',
    ]
      .filter(Boolean)
      .join('\n\n'),
  );
  // Repository metadata is useful for selection, but it is not instructional
  // evidence. If a substantive README exists, make it the only source in the
  // teaching lane; otherwise a course could alternate between stars/forks and
  // real documentation simply because both are "primary" GitHub responses.
  if (readme.length >= MIN_SUBSTANTIVE_GITHUB_README_CHARS && owner && repository) {
    const sources: WebSearchSource[] = [
      {
        title: `${item.full_name} README`,
        url: `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/${encodeURIComponent(branch)}/README.md`,
        content: readme,
        score: 1,
        domain: 'raw.githubusercontent.com',
        authority: 'primary',
      },
      ...companionSources,
    ];
    return sources.slice(0, MAX_DISCOVERY_SOURCES);
  }
  // Retain a non-substantive repository record only for discovery diagnostics.
  // The source-readiness gate will prevent it from becoming a classroom by
  // itself, and no README-sized source means the user receives an early,
  // actionable source-quality message instead of a shallow course.
  return metadata.length >= 120
    ? [
        {
          title: item.full_name,
          url: item.html_url,
          content: metadata,
          score: 1,
          domain: 'github.com',
          authority: 'primary',
        },
      ]
    : [];
}

async function exactGitHubRepository(
  fullName: string,
  fetcher: typeof fetch,
  headers: Record<string, string>,
): Promise<GitHubRepositorySearchItem | null> {
  const [owner = '', repository = ''] = fullName.split('/');
  if (!owner || !repository) return null;
  const response = await fetcher(
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}`,
    { headers, signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS) },
  );
  if (!response.ok) return null;
  const item = (await response.json()) as GitHubRepositorySearchItem;
  return item.full_name && item.html_url ? item : null;
}

async function discoverGitHub(
  query: string,
  fetcher: typeof fetch,
): Promise<WebSearchResult | null> {
  if (!repositoryIntent(query)) return null;
  const terms = discoveryTerms(query, 7);
  if (terms.length === 0) return null;
  const url = new URL('https://api.github.com/search/repositories');
  url.searchParams.set('q', `${terms.join(' ')} archived:false in:name,description,readme`);
  url.searchParams.set('sort', 'stars');
  url.searchParams.set('order', 'desc');
  url.searchParams.set('per_page', '3');
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'Vaultide/0.6.2',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (process.env.GITHUB_TOKEN?.trim()) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN.trim()}`;
  }
  const startedAt = Date.now();
  const explicit = explicitRepositoryReference(query);
  if (explicit) {
    const item = await exactGitHubRepository(explicit, fetcher, headers);
    if (item) {
      const readme = await githubReadme(item.full_name!, fetcher, headers).catch(() => '');
      const companions = await githubCompanionSources(item, readme, fetcher, headers);
      const sources = githubRepositorySources(item, readme, companions);
      if (sources.length > 0) {
        return {
          answer: '',
          sources,
          query: explicit,
          responseTime: Date.now() - startedAt,
        };
      }
    }
  }
  const response = await fetcher(url, {
    headers,
    signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
  });
  if (!response.ok) return null;
  const payload = (await response.json()) as { items?: GitHubRepositorySearchItem[] };
  const items = Array.isArray(payload.items) ? payload.items.slice(0, 3) : [];
  const sourceGroups = await Promise.all(
    items.map(async (item): Promise<WebSearchSource[]> => {
      if (!item.full_name || !item.html_url) return [];
      const readme = await githubReadme(item.full_name, fetcher, headers).catch(() => '');
      const companions = await githubCompanionSources(item, readme, fetcher, headers);
      return githubRepositorySources(item, readme, companions);
    }),
  );
  const usable = sourceGroups.flat().slice(0, MAX_DISCOVERY_SOURCES);
  if (usable.length === 0) return null;
  return {
    answer: '',
    sources: usable,
    query: terms.join(' '),
    responseTime: Date.now() - startedAt,
  };
}

/**
 * Credential-free, authority-scoped fallback for the two external learning
 * targets the product explicitly supports: public GitHub repositories and
 * current arXiv papers. It runs only after configured general search and
 * direct-URL recovery have failed.
 */
export async function discoverOfficialSources(
  query: string,
  fetcher: typeof fetch = fetch,
): Promise<{ providerId: 'github-official' | 'arxiv-official'; result: WebSearchResult } | null> {
  const discoverers = repositoryIntent(query)
    ? ([['github-official', discoverGitHub], ['arxiv-official', discoverArxiv]] as const)
    : ([['arxiv-official', discoverArxiv], ['github-official', discoverGitHub]] as const);
  for (const [providerId, discover] of discoverers) {
    const result = await discover(query, fetcher).catch(() => null);
    if (result?.sources.length) return { providerId, result };
  }
  return null;
}
