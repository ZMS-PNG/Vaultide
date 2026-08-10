import type {
  LearningEvent,
  WritebackCommand,
  WritebackOperation,
  WritebackReceipt,
} from '@openmaic/learning-protocol';
import type {
  AppendLearningEventsResult,
  CreateSynthesisWritebackDraftRecord,
  DepositionItemRecord,
  DepositionPolicyRecord,
  DepositionRunRecord,
  DepositionRunState,
  CreateWritebackDraftRecord,
  LearningCompanionRecord,
  LearningSprintRecord,
  MasteryProjectionRecord,
  ManagedBlockState,
  ReceiptRecordResult,
  ReviewQueueItemRecord,
  StoredLearningEvent,
  WritebackDraftRecord,
  WritebackTarget,
} from '../domain/learning-progress';
import type { MasteryProjection } from '../domain/mastery-evidence';
import type { ProjectLearningIndexDocumentRecord } from '../domain/project-learning';
import type { SynthesisIndexDocumentRecord } from '../domain/synthesis-index';

export interface EnsureLearningSprintInput {
  id: string;
  ownerId: string;
  classroomId: string;
  sourceBundleId?: string;
  projectId?: string;
  projectRevision?: number;
  retrievalRunId?: string;
  researchRunId?: string;
  goal: string;
  now: Date;
}

export interface ApproveWritebackDraftInput {
  ownerId: string;
  draftId: string;
  draftRevision: number;
  command: WritebackCommand;
  now: Date;
}

export interface FindOrCreateLearningCompanionInput {
  id: string;
  ownerId: string;
  vaultBindingId: string;
  sourceId: string;
  sourceBundleId?: string;
  sourceSnapshotId?: string;
  projectId?: string;
  originalRelativePath: string;
  relativePath: string;
  initialManagedBlocks: ManagedBlockState[];
  now: Date;
}

export interface FindOrCreateProjectLearningIndexInput {
  id: string;
  ownerId: string;
  projectId: string;
  vaultBindingId: string;
  relativePath: string;
  initialManagedBlocks: ManagedBlockState[];
  now: Date;
}

export interface FindOrCreateSynthesisIndexInput {
  id: string;
  ownerId: string;
  scheduleId: string;
  vaultBindingId: string;
  relativePath: string;
  initialManagedBlocks: ManagedBlockState[];
  now: Date;
}

export interface UpdateDepositionPolicyInput {
  ownerId: string;
  mode: DepositionPolicyRecord['mode'];
  managedAutoEnabled: boolean;
  allowCompanionUpdates: boolean;
  allowSynthesisIndexUpdates: boolean;
  allowExternalCards: boolean;
  now: Date;
}

export interface CreateDepositionRunInput {
  id: string;
  ownerId: string;
  sprintId?: string;
  assetType: DepositionRunRecord['assetType'];
  idempotencyKey: string;
  projectorVersion: string;
  riskLevel: DepositionRunRecord['riskLevel'];
  now: Date;
}

export interface UpdateDepositionRunInput {
  ownerId: string;
  runId: string;
  state: DepositionRunState;
  errorCode?: string;
  errorDetail?: string;
  now: Date;
}

export interface CreateDepositionItemInput {
  id: string;
  ownerId: string;
  runId: string;
  sourceVersionId?: string;
  targetKind: DepositionItemRecord['targetKind'];
  targetId?: string;
  writebackDraftId?: string;
  writebackCommandId?: string;
  state: DepositionItemRecord['state'];
  commandRiskLevel: DepositionItemRecord['commandRiskLevel'];
  now: Date;
}

export interface LearningProgressRepository {
  findSprint(ownerId: string, sprintId: string): Promise<LearningSprintRecord | null>;
  findSprintByClassroom(ownerId: string, classroomId: string): Promise<LearningSprintRecord | null>;
  ensureSprint(input: EnsureLearningSprintInput): Promise<LearningSprintRecord>;
  findWritebackTarget(ownerId: string, sourceBundleId?: string): Promise<WritebackTarget | null>;
  findOrCreateCompanion(
    input: FindOrCreateLearningCompanionInput,
  ): Promise<LearningCompanionRecord>;
  findOrCreateProjectLearningIndex(
    input: FindOrCreateProjectLearningIndexInput,
  ): Promise<ProjectLearningIndexDocumentRecord>;
  findOrCreateSynthesisIndex(
    input: FindOrCreateSynthesisIndexInput,
  ): Promise<SynthesisIndexDocumentRecord>;
  getDepositionPolicy(ownerId: string): Promise<DepositionPolicyRecord>;
  updateDepositionPolicy(input: UpdateDepositionPolicyInput): Promise<DepositionPolicyRecord>;
  findOrCreateDepositionRun(input: CreateDepositionRunInput): Promise<DepositionRunRecord>;
  updateDepositionRun(input: UpdateDepositionRunInput): Promise<DepositionRunRecord | null>;
  createDepositionItem(input: CreateDepositionItemInput): Promise<DepositionItemRecord>;
  markCommandLocallyValidated(
    ownerId: string,
    deviceId: string,
    vaultBindingId: string,
    commandId: string,
    now: Date,
  ): Promise<boolean>;
  appendEvents(
    events: readonly LearningEvent[],
    receivedAt: Date,
  ): Promise<AppendLearningEventsResult>;
  markSprintCompleted(ownerId: string, sprintId: string, now: Date): Promise<void>;
  replaceMasteryProjections(
    ownerId: string,
    sprintId: string,
    projections: readonly MasteryProjection[],
    now: Date,
  ): Promise<void>;
  listMasteryProjections(
    ownerId: string,
    options: { sprintId?: string; projectId?: string; conceptId?: string },
  ): Promise<MasteryProjectionRecord[]>;
  listReviewQueue(
    ownerId: string,
    options: { projectId?: string; dueOnly?: boolean; limit: number },
    now: Date,
  ): Promise<ReviewQueueItemRecord[]>;
  findReviewQueueItem(
    ownerId: string,
    reviewItemId: string,
    now: Date,
  ): Promise<ReviewQueueItemRecord | null>;
  listEvents(ownerId: string, sprintId: string, limit: number): Promise<StoredLearningEvent[]>;
  createDraft(input: CreateWritebackDraftRecord): Promise<WritebackDraftRecord>;
  findOpenDraftBySprint(
    ownerId: string,
    sprintId: string,
    draftKind: 'learning-summary',
  ): Promise<WritebackDraftRecord | null>;
  findOpenDraftByAssetVersion(
    ownerId: string,
    assetVersionId: string,
  ): Promise<WritebackDraftRecord | null>;
  findOpenDraftByProjectIndex(
    ownerId: string,
    projectIndexId: string,
  ): Promise<WritebackDraftRecord | null>;
  findOpenDraftBySynthesisIndex(
    ownerId: string,
    synthesisIndexId: string,
  ): Promise<WritebackDraftRecord | null>;
  findOpenDraftByVaultOverview(
    ownerId: string,
    vaultOverviewId: string,
  ): Promise<WritebackDraftRecord | null>;
  createSynthesisDraft(input: CreateSynthesisWritebackDraftRecord): Promise<WritebackDraftRecord>;
  findDraft(ownerId: string, draftId: string): Promise<WritebackDraftRecord | null>;
  approveDraft(input: ApproveWritebackDraftInput): Promise<WritebackCommand | null>;
  leaseCommands(
    ownerId: string,
    deviceId: string,
    vaultBindingId: string,
    now: Date,
    leaseUntil: Date,
    limit: number,
    operations?: readonly WritebackOperation[],
  ): Promise<WritebackCommand[]>;
  recordReceipt(
    ownerId: string,
    deviceId: string,
    receipt: WritebackReceipt,
    now: Date,
  ): Promise<ReceiptRecordResult>;
}
