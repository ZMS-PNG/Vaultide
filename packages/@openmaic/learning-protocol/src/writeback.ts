import type { JsonObject } from './json.js';
import type { LearningProtocolVersion } from './version.js';
import { LEARNING_PROTOCOL_VERSION, WRITEBACK_COMMAND_SCHEMA_VERSION } from './version.js';

export const WRITEBACK_OPERATIONS = [
  'createManagedNote',
  'appendManagedSection',
  'updateManagedFrontmatterKeys',
  'replaceManagedBlocks',
  'replaceProjectIndexBlocks',
  'replaceSynthesisIndexBlocks',
  'replaceVaultOverviewBlocks',
] as const;

export type WritebackOperation = (typeof WRITEBACK_OPERATIONS)[number];

export const WRITEBACK_FRONTMATTER_KEYS = [
  'maic_note_id',
  'maic_companion_id',
  'maic_project_index_id',
  'maic_synthesis_index_id',
  'maic_vault_overview_id',
  'maic_asset_id',
  'maic_asset_version_id',
  'maic_source_id',
  'maic_source_version_id',
  // Immutable verified-learning snapshots are referenced by learning records
  // so future sessions can use only the last verified knowledge state.
  'maic_knowledge_snapshot_id',
  'maic_knowledge_snapshot_revision',
  'maic_original_path',
  'maic_managed',
  'maic_project_id',
  'maic_project_revision',
  'maic_retrieval_run_id',
  'maic_coverage_state',
  'maic_selected_source_count',
  'maic_research_run_id',
  'maic_sprint_id',
  // Learning projects are a distinct planning object from Obsidian folder
  // projects. Learning-record and companion-note generators use this stable
  // identifier so their writebacks remain traceable to the learning contract.
  'maic_learning_project_id',
  'maic_synthesis_schedule_id',
  // Trusted synthesis metadata is promoted into the one canonical YAML block
  // when a generated synthesis is written back to Obsidian.
  'maic_synthesis_schema',
  'maic_knowledge_space_schema',
  'maic_generated_at',
  'maic_verified_snapshot_count',
  'maic_incremental',
  'maic_status',
  'maic_updated_at',
  'tags',
  'aliases',
] as const;

export type WritebackFrontmatterKey = (typeof WRITEBACK_FRONTMATTER_KEYS)[number];

export interface CreateManagedNoteArguments {
  relativePath: string;
  content: string;
  frontmatter?: JsonObject;
  expectedAbsent: true;
}

export interface AppendManagedSectionArguments {
  relativePath: string;
  sectionHeading: string;
  content: string;
}

export interface UpdateManagedFrontmatterKeysArguments {
  relativePath: string;
  values: Partial<Record<WritebackFrontmatterKey, string | number | boolean | null | string[]>>;
}

/**
 * A single Vaultide-owned region in a companion note. The hash is calculated
 * from the current body of that region, not from the whole file, so a user's
 * notes outside the managed regions never make an otherwise safe update fail.
 */
export interface ManagedBlockReplacement {
  id: string;
  expectedHash: string;
  content: string;
}

export interface ReplaceManagedBlocksArguments {
  relativePath: string;
  companionId: string;
  blocks: ManagedBlockReplacement[];
}

/**
 * Project indexes are Vaultide-owned aggregate documents, not user source
 * notes. They use their own stable identity so a project index can never be
 * mistaken for a learning companion during a local compare-and-swap update.
 */
export interface ReplaceProjectIndexBlocksArguments {
  relativePath: string;
  projectId: string;
  projectIndexId: string;
  blocks: ManagedBlockReplacement[];
}

/**
 * A periodic synthesis index is a single, mutable overview for a schedule.
 * It has its own identity and is deliberately separate from both source-note
 * companions and immutable synthesis snapshots.
 */
export interface ReplaceSynthesisIndexBlocksArguments {
  relativePath: string;
  scheduleId: string;
  synthesisIndexId: string;
  blocks: ManagedBlockReplacement[];
}

/**
 * The Vault overview is the single cross-project dashboard owned by Vaultide.
 * It has an independent identity and may only replace explicitly marked blocks.
 */
export interface ReplaceVaultOverviewBlocksArguments {
  relativePath: string;
  vaultOverviewId: string;
  blocks: ManagedBlockReplacement[];
}

interface WritebackCommandBase {
  protocolVersion: LearningProtocolVersion;
  schemaVersion: typeof WRITEBACK_COMMAND_SCHEMA_VERSION;
  id: string;
  draftId: string;
  draftRevision: number;
  ownerId: string;
  deviceId: string;
  vaultBindingId: string;
  issuedAt: string;
  expiresAt: string;
}

export interface CreateManagedNoteCommand extends WritebackCommandBase {
  operation: 'createManagedNote';
  arguments: CreateManagedNoteArguments;
}

export interface AppendManagedSectionCommand extends WritebackCommandBase {
  operation: 'appendManagedSection';
  baseContentHash: string;
  arguments: AppendManagedSectionArguments;
}

export interface UpdateManagedFrontmatterKeysCommand extends WritebackCommandBase {
  operation: 'updateManagedFrontmatterKeys';
  baseContentHash: string;
  arguments: UpdateManagedFrontmatterKeysArguments;
}

export interface ReplaceManagedBlocksCommand extends WritebackCommandBase {
  operation: 'replaceManagedBlocks';
  arguments: ReplaceManagedBlocksArguments;
}

export interface ReplaceProjectIndexBlocksCommand extends WritebackCommandBase {
  operation: 'replaceProjectIndexBlocks';
  arguments: ReplaceProjectIndexBlocksArguments;
}

export interface ReplaceSynthesisIndexBlocksCommand extends WritebackCommandBase {
  operation: 'replaceSynthesisIndexBlocks';
  arguments: ReplaceSynthesisIndexBlocksArguments;
}

export interface ReplaceVaultOverviewBlocksCommand extends WritebackCommandBase {
  operation: 'replaceVaultOverviewBlocks';
  arguments: ReplaceVaultOverviewBlocksArguments;
}

export type WritebackCommand =
  | CreateManagedNoteCommand
  | AppendManagedSectionCommand
  | UpdateManagedFrontmatterKeysCommand
  | ReplaceManagedBlocksCommand
  | ReplaceProjectIndexBlocksCommand
  | ReplaceSynthesisIndexBlocksCommand
  | ReplaceVaultOverviewBlocksCommand;

export type WritebackOutcome = 'applied' | 'conflicted' | 'failed' | 'expired' | 'rejected';

export interface WritebackReceipt {
  protocolVersion: LearningProtocolVersion;
  id: string;
  commandId: string;
  deviceId: string;
  outcome: WritebackOutcome;
  resultingContentHash?: string;
  resultingPath?: string;
  conflictDetail?: string;
  appliedAt?: string;
  reportedAt: string;
}

export type UnstampedWritebackCommand =
  | Omit<CreateManagedNoteCommand, 'protocolVersion' | 'schemaVersion'>
  | Omit<AppendManagedSectionCommand, 'protocolVersion' | 'schemaVersion'>
  | Omit<UpdateManagedFrontmatterKeysCommand, 'protocolVersion' | 'schemaVersion'>
  | Omit<ReplaceManagedBlocksCommand, 'protocolVersion' | 'schemaVersion'>
  | Omit<ReplaceProjectIndexBlocksCommand, 'protocolVersion' | 'schemaVersion'>
  | Omit<ReplaceSynthesisIndexBlocksCommand, 'protocolVersion' | 'schemaVersion'>
  | Omit<ReplaceVaultOverviewBlocksCommand, 'protocolVersion' | 'schemaVersion'>;

export function stampWritebackCommand(command: UnstampedWritebackCommand): WritebackCommand {
  return {
    ...command,
    protocolVersion: LEARNING_PROTOCOL_VERSION,
    schemaVersion: WRITEBACK_COMMAND_SCHEMA_VERSION,
  } as WritebackCommand;
}
