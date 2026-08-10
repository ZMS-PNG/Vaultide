import type {
  KnowledgeRelationStatus,
  KnowledgeGraphProjectionContext,
  KnowledgeGraphProjectionRecord,
  KnowledgeGraphV2,
  KnowledgeRelationFeedbackRecord,
} from '../domain/knowledge-graph-v2/contracts';

export interface LoadKnowledgeGraphContextInput {
  ownerId: string;
  classroomIds: string[];
  projectIds: string[];
}

export interface SaveKnowledgeGraphProjectionInput {
  id: string;
  ownerId: string;
  synthesisId: string;
  scopeHash: string;
  inputHash: string;
  graphHash: string;
  graph: KnowledgeGraphV2;
  generatedAt: Date;
}

export interface SaveKnowledgeRelationFeedbackInput {
  id: string;
  ownerId: string;
  relationId: string;
  action: 'confirm' | 'reject';
  reason?: string;
  now: Date;
}

export interface KnowledgeGraphV2Repository {
  loadProjectionContext(
    input: LoadKnowledgeGraphContextInput,
  ): Promise<KnowledgeGraphProjectionContext>;
  findReadyByInput(
    ownerId: string,
    synthesisId: string,
    inputHash: string,
    projectorVersion: string,
    layoutVersion: string,
  ): Promise<KnowledgeGraphProjectionRecord | null>;
  saveProjection(input: SaveKnowledgeGraphProjectionInput): Promise<KnowledgeGraphProjectionRecord>;
  findProjection(
    ownerId: string,
    projectionId: string,
  ): Promise<KnowledgeGraphProjectionRecord | null>;
  findLatestReady(
    ownerId: string,
    synthesisId: string,
  ): Promise<KnowledgeGraphProjectionRecord | null>;
  relationStatuses(
    ownerId: string,
    relationIds: string[],
  ): Promise<Record<string, KnowledgeRelationStatus>>;
  saveFeedback(
    input: SaveKnowledgeRelationFeedbackInput,
  ): Promise<KnowledgeRelationFeedbackRecord | null>;
}
