import type {
  KnowledgeEdgeTypeV2,
  KnowledgeGraphProjectionQuery,
  KnowledgeNodeTypeV2,
} from './contracts';

const NODE_TYPES: KnowledgeNodeTypeV2[] = [
  'project',
  'original-note',
  'companion-note',
  'external-source',
  'classroom',
  'concept',
  'claim',
  'skill',
  'artifact',
  'review',
];
const EDGE_TYPES: KnowledgeEdgeTypeV2[] = [
  'belongs-to',
  'contains',
  'cites',
  'derived-from',
  'companion-of',
  'precedes',
  'prerequisite',
  'supports',
  'contradicts',
  'applies-to',
  'related-to',
  'review-of',
];

function list<T extends string>(value: string | null, allowed: readonly T[]): T[] | undefined {
  if (!value) return undefined;
  const values = [
    ...new Set(
      value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
  if (values.length === 0 || values.some((item) => !allowed.includes(item as T))) return undefined;
  return values.slice(0, 50) as T[];
}

function date(value: string | null): string | undefined {
  if (!value || !Number.isFinite(Date.parse(value))) return undefined;
  return new Date(value).toISOString();
}

function projectIds(value: string | null): string[] | undefined {
  if (!value) return undefined;
  const values = [
    ...new Set(
      value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
  if (
    values.length === 0 ||
    values.length > 50 ||
    values.some((item) => !/^prj_[a-f0-9]{32}$/.test(item))
  ) {
    return undefined;
  }
  return values;
}

export function parseKnowledgeGraphQuery(params: URLSearchParams): KnowledgeGraphProjectionQuery {
  const lodValue = Number(params.get('lod') ?? '0');
  const minimumValue = Number(params.get('minConfidence') ?? '0');
  const projects = projectIds(params.get('projectIds'));
  return {
    lod: lodValue === 1 || lodValue === 2 ? lodValue : 0,
    ...(list(params.get('nodeTypes'), NODE_TYPES)
      ? { nodeTypes: list(params.get('nodeTypes'), NODE_TYPES) }
      : {}),
    ...(list(params.get('edgeTypes'), EDGE_TYPES)
      ? { edgeTypes: list(params.get('edgeTypes'), EDGE_TYPES) }
      : {}),
    ...(projects ? { projectIds: projects } : {}),
    ...(date(params.get('timeFrom')) ? { timeFrom: date(params.get('timeFrom')) } : {}),
    ...(date(params.get('timeTo')) ? { timeTo: date(params.get('timeTo')) } : {}),
    minConfidence: Number.isFinite(minimumValue) ? Math.max(0, Math.min(1, minimumValue)) : 0,
    includeCandidates: params.get('includeCandidates') === 'true',
  };
}
