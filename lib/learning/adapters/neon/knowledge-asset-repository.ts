import type {
  ExternalSourceReference,
  KnowledgeAssetRecord,
  KnowledgeAssetVersionRecord,
} from '../../domain/knowledge-asset';
import type {
  FindOrCreateExternalAssetInput,
  FindOrCreateKnowledgeAssetVersionInput,
  KnowledgeAssetRepository,
} from '../../ports/knowledge-asset-repository';
import { getLearningSql } from './client';

interface AssetRow {
  id: string;
  owner_id: string;
  asset_kind: KnowledgeAssetRecord['assetKind'];
  source_kind: KnowledgeAssetRecord['sourceKind'];
  canonical_key: string;
  canonical_url: string;
  title: string;
  status: KnowledgeAssetRecord['status'];
  created_at: string;
  updated_at: string;
}

interface AssetVersionRow {
  id: string;
  owner_id: string;
  asset_id: string;
  research_run_id: string | null;
  source_fingerprint: string;
  source_refs: unknown;
  card_markdown: string;
  content_hash: string;
  captured_at: string;
  created_at: string;
}

function asset(row: AssetRow): KnowledgeAssetRecord {
  return {
    id: row.id,
    ownerId: row.owner_id,
    assetKind: row.asset_kind,
    sourceKind: row.source_kind,
    canonicalKey: row.canonical_key,
    canonicalUrl: row.canonical_url,
    title: row.title,
    status: row.status,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

function sourceRefs(value: unknown): ExternalSourceReference[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null) return [];
    const source = entry as Partial<ExternalSourceReference>;
    if (typeof source.title !== 'string' || typeof source.url !== 'string') return [];
    return [
      {
        title: source.title,
        url: source.url,
        ...(typeof source.citationId === 'string' ? { citationId: source.citationId } : {}),
        ...(typeof source.domain === 'string' ? { domain: source.domain } : {}),
        ...(source.authority === 'primary' ||
        source.authority === 'authoritative' ||
        source.authority === 'general'
          ? { authority: source.authority }
          : {}),
        ...(typeof source.score === 'number' && Number.isFinite(source.score)
          ? { score: source.score }
          : {}),
      },
    ];
  });
}

function version(row: AssetVersionRow): KnowledgeAssetVersionRecord {
  return {
    id: row.id,
    ownerId: row.owner_id,
    assetId: row.asset_id,
    researchRunId: row.research_run_id ?? undefined,
    sourceFingerprint: row.source_fingerprint,
    sourceRefs: sourceRefs(row.source_refs),
    cardMarkdown: row.card_markdown,
    contentHash: row.content_hash,
    capturedAt: new Date(row.captured_at),
    createdAt: new Date(row.created_at),
  };
}

export class NeonKnowledgeAssetRepository implements KnowledgeAssetRepository {
  async findOrCreateExternalAsset(input: FindOrCreateExternalAssetInput): Promise<KnowledgeAssetRecord> {
    const rows = (await getLearningSql().query(
      `
        INSERT INTO knowledge_assets
          (id, owner_id, asset_kind, source_kind, canonical_key, canonical_url, title, status, created_at, updated_at)
        VALUES ($1, $2, 'external-card', $3, $4, $5, $6, 'active', $7, $7)
        ON CONFLICT (owner_id, asset_kind, canonical_key) DO UPDATE
        SET canonical_url = EXCLUDED.canonical_url,
            title = EXCLUDED.title,
            status = 'active',
            updated_at = EXCLUDED.updated_at
        RETURNING id, owner_id, asset_kind, source_kind, canonical_key, canonical_url, title, status,
                  created_at, updated_at
      `,
      [
        input.id,
        input.ownerId,
        input.sourceKind,
        input.canonicalKey,
        input.canonicalUrl,
        input.title,
        input.now,
      ],
    )) as AssetRow[];
    const row = rows[0];
    if (!row) throw new Error('knowledge_asset_not_created');
    return asset(row);
  }

  async findOrCreateVersion(
    input: FindOrCreateKnowledgeAssetVersionInput,
  ): Promise<KnowledgeAssetVersionRecord> {
    const rows = (await getLearningSql().query(
      `
        INSERT INTO knowledge_asset_versions
          (id, owner_id, asset_id, research_run_id, source_fingerprint, source_refs,
           card_markdown, content_hash, captured_at, created_at)
        VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10)
        ON CONFLICT (owner_id, asset_id, source_fingerprint) DO UPDATE
        SET research_run_id = COALESCE(knowledge_asset_versions.research_run_id, EXCLUDED.research_run_id)
        RETURNING id, owner_id, asset_id, research_run_id, source_fingerprint, source_refs,
                  card_markdown, content_hash, captured_at, created_at
      `,
      [
        input.id,
        input.ownerId,
        input.assetId,
        input.researchRunId ?? null,
        input.sourceFingerprint,
        JSON.stringify(input.sourceRefs),
        input.cardMarkdown,
        input.contentHash,
        input.capturedAt,
        input.now,
      ],
    )) as AssetVersionRow[];
    const row = rows[0];
    if (!row) throw new Error('knowledge_asset_version_not_created');
    return version(row);
  }
}
