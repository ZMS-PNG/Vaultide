import type { SceneOutline } from '@/lib/types/generation';

const CITATION_PATTERN = /\[(S\d+)\]/giu;
const CJK_PATTERN = /[\u3400-\u9fff]/u;

interface FrozenEvidenceEntry {
  label: string;
  text: string;
  tokens: Set<string>;
}

export interface OutlineEvidenceConvergenceResult {
  outlines: SceneOutline[];
  changed: boolean;
  availableLabels: string[];
  usedLabels: string[];
}

function normalizedLabel(value: string): string {
  return value.toLocaleUpperCase();
}

function labelsIn(value: unknown): Set<string> {
  return new Set(
    [...String(value ?? '').matchAll(CITATION_PATTERN)].map((match) => normalizedLabel(match[1])),
  );
}

function tokenize(value: string): Set<string> {
  const normalized = value
    .toLocaleLowerCase()
    .replace(/\[(?:s\d+)\]/giu, ' ')
    .replace(/https?:\/\/\S+/giu, ' ');
  const tokens = new Set(
    normalized
      .match(/[a-z0-9][a-z0-9_.-]{2,}/giu)
      ?.map((token) => token.replace(/^[_.-]+|[_.-]+$/gu, ''))
      .filter(Boolean) ?? [],
  );
  const cjkRuns = normalized.match(/[\u3400-\u9fff]{2,}/gu) ?? [];
  for (const run of cjkRuns) {
    for (let index = 0; index < run.length - 1; index++) {
      tokens.add(run.slice(index, index + 2));
    }
  }
  return tokens;
}

function parseFrozenEvidence(sourceContext: string | undefined): FrozenEvidenceEntry[] {
  const source = sourceContext ?? '';
  const matches = [...source.matchAll(CITATION_PATTERN)];
  const byLabel = new Map<string, string[]>();
  matches.forEach((match, index) => {
    const label = normalizedLabel(match[1]);
    const start = match.index ?? 0;
    const nextStart = matches[index + 1]?.index ?? source.length;
    const block = source.slice(start, nextStart).trim().slice(0, 2_000);
    const existing = byLabel.get(label) ?? [];
    existing.push(block);
    byLabel.set(label, existing);
  });
  return [...byLabel.entries()].map(([label, blocks]) => {
    const text = blocks.join('\n');
    return { label, text, tokens: tokenize(text) };
  });
}

function stripUnknownLabels(value: string, available: ReadonlySet<string>): string {
  return value
    .replace(CITATION_PATTERN, (full, rawLabel: string) =>
      available.has(normalizedLabel(rawLabel)) ? `[${normalizedLabel(rawLabel)}]` : '',
    )
    .replace(/[ \t]{2,}/gu, ' ')
    .trim();
}

function overlapScore(value: string, evidence: FrozenEvidenceEntry): number {
  const query = tokenize(value);
  if (query.size === 0 || evidence.tokens.size === 0) return 0;
  let overlap = 0;
  for (const token of query) {
    if (evidence.tokens.has(token)) overlap++;
  }
  return overlap / Math.sqrt(query.size * evidence.tokens.size);
}

function appendLabel(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) return `[${label}]`;
  if (labelsIn(trimmed).has(label)) return trimmed;
  return `${trimmed} [${label}]`;
}

function bestEvidence(
  value: string,
  evidence: readonly FrozenEvidenceEntry[],
  usage: ReadonlyMap<string, number>,
): FrozenEvidenceEntry {
  return [...evidence].sort((left, right) => {
    const scoreDelta = overlapScore(value, right) - overlapScore(value, left);
    if (Math.abs(scoreDelta) > Number.EPSILON) return scoreDelta;
    const usageDelta = (usage.get(left.label) ?? 0) - (usage.get(right.label) ?? 0);
    if (usageDelta !== 0) return usageDelta;
    return left.label.localeCompare(right.label, undefined, { numeric: true });
  })[0];
}

function incrementUsage(usage: Map<string, number>, labels: Iterable<string>): void {
  for (const label of labels) usage.set(label, (usage.get(label) ?? 0) + 1);
}

function outlineText(outline: SceneOutline): string {
  return `${outline.title}\n${outline.description}\n${(outline.keyPoints ?? []).join('\n')}`;
}

function evidenceCoverage(outlines: readonly SceneOutline[]): Set<string> {
  const used = new Set<string>();
  for (const outline of outlines) {
    for (const label of labelsIn(outlineText(outline))) used.add(label);
  }
  return used;
}

/**
 * Converges citation coverage without inventing evidence.
 *
 * Every attached label is parsed from the immutable source context. Existing
 * valid labels are preserved; unknown labels are removed. Claims without a
 * label receive the semantically closest frozen source, with balanced usage as
 * a deterministic tie-breaker. Any still-unused source is attached to the most
 * relevant scene description so the full frozen evidence set remains auditable.
 */
export function convergeOutlineEvidence(
  sourceContext: string | undefined,
  outlines: readonly SceneOutline[],
): OutlineEvidenceConvergenceResult {
  const evidence = parseFrozenEvidence(sourceContext);
  if (evidence.length === 0 || outlines.length === 0) {
    return {
      outlines: outlines.map((outline) => ({ ...outline })),
      changed: false,
      availableLabels: evidence.map((entry) => entry.label),
      usedLabels: [],
    };
  }

  const available = new Set(evidence.map((entry) => entry.label));
  const usage = new Map<string, number>();
  const converged = outlines.map((original) => {
    const title = stripUnknownLabels(original.title, available);
    let description = stripUnknownLabels(original.description, available);
    const keyPoints = (original.keyPoints ?? []).map((point) =>
      stripUnknownLabels(point, available),
    );
    const existing = labelsIn(`${description}\n${keyPoints.join('\n')}`);
    incrementUsage(usage, existing);

    if (labelsIn(description).size === 0) {
      const selected = bestEvidence(`${title}\n${description}`, evidence, usage);
      description = appendLabel(description, selected.label);
      incrementUsage(usage, [selected.label]);
    }

    const traceableKeyPoints = keyPoints.map((point) => {
      if (labelsIn(point).size > 0) return point;
      const selected = bestEvidence(`${title}\n${point}`, evidence, usage);
      incrementUsage(usage, [selected.label]);
      return appendLabel(point, selected.label);
    });

    return {
      ...original,
      title,
      description,
      keyPoints: traceableKeyPoints,
    };
  });

  const used = evidenceCoverage(converged);
  for (const missing of evidence.filter((entry) => !used.has(entry.label))) {
    let bestIndex = 0;
    let bestScore = Number.NEGATIVE_INFINITY;
    converged.forEach((outline, index) => {
      const score =
        overlapScore(outlineText(outline), missing) -
        labelsIn(outline.description).size * 0.001 -
        index * 0.000001;
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    });
    const target = converged[bestIndex];
    converged[bestIndex] = {
      ...target,
      description: appendLabel(target.description, missing.label),
    };
    used.add(missing.label);
  }

  // The transfer scene must retain inspectable support even if the model placed
  // all citations in earlier scenes. Claim-level convergence above normally
  // satisfies this; keep the invariant explicit for future schema changes.
  const finalIndex = converged.length - 1;
  const finalOutline = converged[finalIndex];
  if (labelsIn(outlineText(finalOutline)).size === 0) {
    const selected = bestEvidence(outlineText(finalOutline), evidence, usage);
    converged[finalIndex] = {
      ...finalOutline,
      description: appendLabel(finalOutline.description, selected.label),
    };
  }

  const before = JSON.stringify(outlines);
  const after = JSON.stringify(converged);
  const usedLabels = [...evidenceCoverage(converged)].sort((left, right) =>
    left.localeCompare(right, undefined, { numeric: true }),
  );
  return {
    outlines: converged,
    changed: before !== after,
    availableLabels: evidence.map((entry) => entry.label),
    usedLabels,
  };
}

export function sourceContextUsesCjk(sourceContext: string | undefined): boolean {
  return CJK_PATTERN.test(sourceContext ?? '');
}
