import type { JsonObject } from '@openmaic/learning-protocol';

export const PROJECT_ID_PATTERN = /^prj_[a-f0-9]{32}$/;

export interface ProjectBindingInput {
  projectId: string;
  vaultBindingId: string;
  kind: string;
  projectName: string;
  rootPath: string;
  bindingKeyHash: string;
  metadata: JsonObject;
  expectedBindingRevision?: number;
}

export interface LearningProjectRecord {
  id: string;
  ownerId: string;
  vaultBindingId: string;
  kind: string;
  projectName: string;
  rootPath: string;
  status: 'active' | 'archived';
  bindingRevision: number;
  projectRevision: number;
  latestManifestHash?: string;
  metadata: JsonObject;
  lastIndexedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProjectUploadSummary {
  bundleId: string;
  manifestHash: string;
  status: 'pending' | 'validated' | 'rejected' | 'deleted';
  coverage: 'partial' | 'complete';
  bundleRevision?: number;
  itemCount: number;
  createdAt: Date;
  completedAt?: Date;
}

export interface ProjectStatusRecord {
  project: LearningProjectRecord;
  activeSourceCount: number;
  latestUpload?: ProjectUploadSummary;
}

export interface ProjectStatusView {
  projectId: string;
  vaultBindingId: string;
  kind: string;
  projectName: string;
  rootPath: string;
  status: LearningProjectRecord['status'];
  bindingRevision: number;
  projectRevision: number;
  latestManifestHash?: string;
  sourceCount: number;
  lastIndexedAt?: string;
  latestUpload?: {
    bundleId: string;
    manifestHash: string;
    status: ProjectUploadSummary['status'];
    coverage: ProjectUploadSummary['coverage'];
    bundleRevision?: number;
    itemCount: number;
    createdAt: string;
    completedAt?: string;
  };
  createdAt: string;
  updatedAt: string;
}
