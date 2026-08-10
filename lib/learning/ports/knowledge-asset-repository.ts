import type {
  ExternalAssetSourceKind,
  ExternalSourceReference,
  KnowledgeAssetRecord,
  KnowledgeAssetVersionRecord,
} from '../domain/knowledge-asset';

export interface FindOrCreateExternalAssetInput {
  id: string;
  ownerId: string;
  sourceKind: ExternalAssetSourceKind;
  canonicalKey: string;
  canonicalUrl: string;
  title: string;
  now: Date;
}

export interface FindOrCreateKnowledgeAssetVersionInput {
  id: string;
  ownerId: string;
  assetId: string;
  researchRunId?: string;
  sourceFingerprint: string;
  sourceRefs: ExternalSourceReference[];
  cardMarkdown: string;
  contentHash: string;
  capturedAt: Date;
  now: Date;
}

export interface KnowledgeAssetRepository {
  findOrCreateExternalAsset(input: FindOrCreateExternalAssetInput): Promise<KnowledgeAssetRecord>;
  findOrCreateVersion(
    input: FindOrCreateKnowledgeAssetVersionInput,
  ): Promise<KnowledgeAssetVersionRecord>;
}
