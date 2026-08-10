const GENERIC_TERMS = new Set([
  'about',
  'arrange',
  'based',
  'explain',
  'learn',
  'learning',
  'material',
  'materials',
  'practice',
  'please',
  'understand',
  'understanding',
  '主动',
  '先诊',
  '回忆',
  '基于',
  '安排',
  '循序',
  '渐进',
  '理解',
  '目前',
  '练习',
  '讲解',
  '资料',
  '这些',
]);

function normalizedLatinTerm(value: string): string {
  if (value.length > 5 && value.endsWith('ing')) return value.slice(0, -3);
  if (value.length > 4 && value.endsWith('ed')) return value.slice(0, -2);
  if (value.length > 4 && value.endsWith('s')) return value.slice(0, -1);
  return value;
}

export function extractResearchTerms(value: string): Set<string> {
  const terms = new Set<string>();
  for (const chunk of value.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
    if (/\p{Script=Han}/u.test(chunk)) {
      if (chunk.length === 2 && !GENERIC_TERMS.has(chunk)) terms.add(chunk);
      for (let index = 0; index < chunk.length - 1; index += 1) {
        const pair = chunk.slice(index, index + 2);
        if (!GENERIC_TERMS.has(pair)) terms.add(pair);
      }
      continue;
    }
    if (chunk.length < 3) continue;
    const term = normalizedLatinTerm(chunk);
    if (!GENERIC_TERMS.has(term)) terms.add(term);
  }
  return terms;
}

export function researchTermOverlap(query: string, candidate: string): number {
  const queryTerms = extractResearchTerms(query);
  if (queryTerms.size === 0) return 1;
  const candidateTerms = extractResearchTerms(candidate);
  let overlap = 0;
  for (const term of queryTerms) if (candidateTerms.has(term)) overlap += 1;
  return overlap;
}

export function hasResearchTopicOverlap(query: string, candidate: string): boolean {
  const terms = extractResearchTerms(query);
  if (terms.size < 2) return true;
  return researchTermOverlap(query, candidate) > 0;
}
