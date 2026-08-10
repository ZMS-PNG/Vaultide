import { createHash } from 'node:crypto';

export function stableHash(value: unknown): string {
  return createHash('sha256').update(stableStringify(value), 'utf8').digest('hex');
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`;
}

export function stableEntityId(
  prefix: 'kgc' | 'kgr' | 'kge' | 'kgp' | 'kgf',
  identity: unknown,
): string {
  return `${prefix}_${stableHash(identity).slice(0, 32)}`;
}

export function normalizeConceptLabel(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('und')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}

export function cleanKnowledgeLabel(value: string, fallback: string): string {
  return (
    value
      .normalize('NFKC')
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 300) || fallback
  );
}

export function canonicalConceptIdentity(
  label: string,
  domainId: string,
  ownerId = '',
): {
  id: string;
  key: string;
  normalizedLabel: string;
} {
  const normalizedLabel = normalizeConceptLabel(label) || 'unnamed-concept';
  const key = stableHash({ domainId, normalizedLabel });
  return {
    id: `kgc_${stableHash({ ownerId, key }).slice(0, 32)}`,
    key,
    normalizedLabel,
  };
}

export function stableDomainId(label: string): string {
  return `domain:${stableHash(normalizeConceptLabel(label) || 'general').slice(0, 16)}`;
}
