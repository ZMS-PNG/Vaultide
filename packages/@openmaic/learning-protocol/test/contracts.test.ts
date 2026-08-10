import { describe, expect, it } from 'vitest';
import {
  LEARNING_PROTOCOL_VERSION,
  SOURCE_ARCHIVE_SCHEMA_VERSION,
  SOURCE_BUNDLE_SCHEMA_VERSION,
  WRITEBACK_COMMAND_SCHEMA_VERSION,
  canonicalSourceManifest,
  learningEventDedupeKey,
  negotiateProtocol,
  stampLearningEvent,
  validateLearningEvent,
  validateSourceBundle,
  validateSourceArchive,
  validateWritebackCommand,
  type SourceBundle,
  type WritebackCommand,
} from '@openmaic/learning-protocol';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const NOW = '2026-07-21T06:00:00Z';
const LATER = '2026-08-20T06:00:00Z';

function validBundle(): SourceBundle {
  return {
    protocolVersion: LEARNING_PROTOCOL_VERSION,
    schemaVersion: SOURCE_BUNDLE_SCHEMA_VERSION,
    id: 'src_019f830000007000800000000001',
    ownerId: 'own_019f830000007000800000000001',
    revision: 1,
    manifestHash: HASH_A,
    byteSize: 30,
    itemCount: 2,
    selectionReason: 'Learn the exact project blocker',
    sourcePolicy: {
      externalSearch: 'official-only',
      allowedDomains: ['react.dev'],
    },
    snapshots: [
      {
        id: 'snp_019f830000007000800000000001',
        origin: 'obsidian',
        title: 'Project notes',
        contentHash: HASH_A,
        mimeType: 'text/markdown',
        byteSize: 10,
        locator: {
          kind: 'obsidian',
          vaultBindingId: 'vlt_019f830000007000800000000001',
          relativePath: 'Projects/OpenMAIC.md',
          sourceId: `sou_${'c'.repeat(32)}`,
          sourceMtime: NOW,
        },
      },
      {
        id: 'snp_019f830000007000800000000002',
        origin: 'web',
        title: 'React versions',
        contentHash: HASH_B,
        mimeType: 'text/html',
        byteSize: 20,
        locator: {
          kind: 'web',
          canonicalUrl: 'https://react.dev/versions',
          retrievedAt: NOW,
        },
      },
    ],
    retentionUntil: LATER,
    createdAt: NOW,
  };
}

function validCreateCommand(): WritebackCommand {
  return {
    protocolVersion: LEARNING_PROTOCOL_VERSION,
    schemaVersion: WRITEBACK_COMMAND_SCHEMA_VERSION,
    id: 'wbc_019f830000007000800000000001',
    draftId: 'wbd_019f830000007000800000000001',
    draftRevision: 1,
    ownerId: 'own_019f830000007000800000000001',
    deviceId: 'dev_019f830000007000800000000001',
    vaultBindingId: 'vlt_019f830000007000800000000001',
    issuedAt: NOW,
    expiresAt: LATER,
    operation: 'createManagedNote',
    arguments: {
      relativePath: 'MAIC Learning/Projects/first-sprint.md',
      content: '# Learning record',
      frontmatter: {
        maic_note_id: 'note_019f830000007000800000000001',
        maic_project_revision: 4,
        maic_retrieval_run_id: 'prr_019f830000007000800000000001',
        maic_coverage_state: 'authorized-index-complete',
        maic_selected_source_count: 8,
        maic_research_run_id: 'rsr_019f830000007000800000000001',
        tags: ['maic', 'learning'],
      },
      expectedAbsent: true,
    },
  };
}

describe('SourceBundle contract', () => {
  it('accepts an explicitly selected mixed Obsidian/external bundle', () => {
    expect(validateSourceBundle(validBundle())).toEqual({ valid: true });
  });

  it('rejects a locator whose kind does not match its source origin', () => {
    const bundle = validBundle();
    bundle.snapshots[1] = {
      ...bundle.snapshots[1],
      origin: 'web',
      locator: {
        kind: 'web',
        canonicalUrl: 'http://react.dev/versions',
        retrievedAt: NOW,
      },
    };
    const result = validateSourceBundle(bundle);
    expect(result.valid).toBe(false);
    if (result.valid) throw new Error('unreachable');
    expect(result.errors.map((error) => error.code)).toContain('url_protocol');
  });

  it('enforces manifest totals and immutable SHA-256 identities', () => {
    const result = validateSourceBundle({
      ...validBundle(),
      manifestHash: 'not-a-hash',
      itemCount: 3,
      byteSize: 999,
    });
    expect(result.valid).toBe(false);
    if (result.valid) throw new Error('unreachable');
    const paths = result.errors.map((error) => error.path);
    expect(paths).toEqual(expect.arrayContaining(['/manifestHash', '/itemCount', '/byteSize']));
  });

  it('rejects duplicate snapshot ids and Vault traversal paths', () => {
    const bundle = validBundle();
    const snapshot = bundle.snapshots[0];
    if (snapshot.origin !== 'obsidian') throw new Error('Expected an Obsidian snapshot');
    bundle.snapshots[1] = {
      ...snapshot,
      id: snapshot.id,
      locator: {
        kind: 'obsidian',
        vaultBindingId: 'vlt_019f830000007000800000000001',
        relativePath: '../Secrets.md',
      },
    };
    const result = validateSourceBundle(bundle);
    expect(result.valid).toBe(false);
    if (result.valid) throw new Error('unreachable');
    expect(result.errors.map((error) => error.code)).toEqual(
      expect.arrayContaining(['duplicate', 'unsafe_path']),
    );
  });

  it('keeps the manifest stable across JSON transport with omitted optional fields', () => {
    const bundle = validBundle();
    const snapshot = bundle.snapshots[0];
    if (snapshot.origin !== 'obsidian') throw new Error('Expected an Obsidian snapshot');

    snapshot.headings = undefined;
    snapshot.tags = undefined;
    snapshot.outboundLinks = undefined;
    snapshot.locator.noteId = undefined;

    const transported = JSON.parse(JSON.stringify(bundle)) as SourceBundle;
    expect(canonicalSourceManifest(transported)).toBe(canonicalSourceManifest(bundle));
  });
});

describe('SourceArchive contract', () => {
  it('requires exactly one byte-consistent content entry per snapshot', () => {
    const bundle = validBundle();
    bundle.snapshots = [bundle.snapshots[0]];
    bundle.itemCount = 1;
    bundle.byteSize = 10;
    const archive = {
      protocolVersion: LEARNING_PROTOCOL_VERSION,
      schemaVersion: SOURCE_ARCHIVE_SCHEMA_VERSION,
      bundle,
      contents: [{ snapshotId: bundle.snapshots[0].id, utf8Content: '0123456789' }],
    };
    expect(validateSourceArchive(archive)).toEqual({ valid: true });
    expect(validateSourceArchive({ ...archive, contents: [] }).valid).toBe(false);
    expect(
      validateSourceArchive({
        ...archive,
        contents: [{ ...archive.contents[0], utf8Content: 'too short' }],
      }).valid,
    ).toBe(false);
  });
});

describe('LearningEvent contract', () => {
  it('binds event type to its required payload and creates a stable dedupe key', () => {
    const event = stampLearningEvent({
      id: 'evt_019f830000007000800000000001',
      ownerId: 'own_019f830000007000800000000001',
      sprintId: 'spr_019f830000007000800000000001',
      eventType: 'retrievalAttempted',
      clientEventId: 'client-1',
      deviceId: 'dev_019f830000007000800000000001',
      occurredAt: NOW,
      source: 'obsidian-plugin',
      payload: { promptId: 'prompt-1', response: 'My own answer', durationMs: 4200 },
    });
    expect(validateLearningEvent(event)).toEqual({ valid: true });
    expect(learningEventDedupeKey(event)).toBe(
      'own_019f830000007000800000000001:dev_019f830000007000800000000001:client-1',
    );
  });

  it('rejects an unknown event and an invalid score', () => {
    const event = stampLearningEvent({
      id: 'evt_019f830000007000800000000002',
      ownerId: 'own_019f830000007000800000000001',
      sprintId: 'spr_019f830000007000800000000001',
      eventType: 'feedbackReceived',
      clientEventId: 'client-2',
      deviceId: 'dev_019f830000007000800000000001',
      occurredAt: NOW,
      source: 'web',
      payload: { targetEventId: 'evt_1', summary: 'Feedback', score: 2 },
    });
    const invalidScore = validateLearningEvent(event);
    expect(invalidScore.valid).toBe(false);
    expect(validateLearningEvent({ ...event, eventType: 'modelSaidSo' }).valid).toBe(false);
  });

  it('accepts privacy-preserving classroom activity events', () => {
    const event = stampLearningEvent({
      id: 'evt_019f830000007000800000000003',
      ownerId: 'own_019f830000007000800000000001',
      sprintId: 'spr_019f830000007000800000000001',
      eventType: 'whiteboardNoteAdded',
      clientEventId: 'client-3',
      deviceId: 'dev_019f830000007000800000000001',
      occurredAt: NOW,
      source: 'web',
      payload: { sceneId: 'scene-1', noteKind: 'question', characterCount: 42 },
    });
    expect(validateLearningEvent(event)).toEqual({ valid: true });
    expect(JSON.stringify(event.payload)).not.toContain('note content');
  });

  it('separates scene completion from a complete classroom snapshot', () => {
    const base = {
      id: 'evt_019f830000007000800000000004',
      ownerId: 'own_019f830000007000800000000001',
      sprintId: 'spr_019f830000007000800000000001',
      clientEventId: 'completion-1',
      deviceId: 'dev_019f830000007000800000000001',
      occurredAt: NOW,
      source: 'web' as const,
    };
    const scene = stampLearningEvent({
      ...base,
      eventType: 'sceneCompleted',
      payload: { sceneId: 'scene-1', completionKind: 'manual' },
    });
    expect(validateLearningEvent(scene)).toEqual({ valid: true });

    const invalidSprint = stampLearningEvent({
      ...base,
      id: 'evt_019f830000007000800000000005',
      clientEventId: 'completion-2',
      eventType: 'sprintCompleted',
      payload: {
        completionVersion: 1,
        completedSceneIds: ['scene-1', 'scene-1'],
        totalSceneCount: 2,
      },
    });
    expect(validateLearningEvent(invalidSprint).valid).toBe(false);
  });
});

describe('WritebackCommand contract', () => {
  it('accepts only the managed-note create command', () => {
    expect(validateWritebackCommand(validCreateCommand())).toEqual({ valid: true });
  });

  it('rejects traversal, unknown fields, and unapproved frontmatter', () => {
    const command = validCreateCommand();
    const result = validateWritebackCommand({
      ...command,
      script: 'delete everything',
      arguments: {
        ...command.arguments,
        relativePath: '../../private.md',
        frontmatter: { arbitrary_secret: 'value' },
      },
    });
    expect(result.valid).toBe(false);
    if (result.valid) throw new Error('unreachable');
    expect(result.errors.map((error) => error.code)).toEqual(
      expect.arrayContaining(['unknown_field', 'unsafe_path', 'frontmatter_key']),
    );
  });

  it('accepts the learning-project traceability field in managed frontmatter', () => {
    const command = validCreateCommand();
    if (command.operation !== 'createManagedNote')
      throw new Error('test fixture must create a note');

    const result = validateWritebackCommand({
      ...command,
      arguments: {
        ...command.arguments,
        frontmatter: {
          ...command.arguments.frontmatter,
          maic_learning_project_id: `lp_${'a'.repeat(32)}`,
        },
      },
    });

    expect(result).toEqual({ valid: true });
  });

  it('requires a base hash for mutations of an existing managed note', () => {
    const command = validCreateCommand();
    const result = validateWritebackCommand({
      ...command,
      operation: 'appendManagedSection',
      arguments: {
        relativePath: 'MAIC Learning/Projects/first-sprint.md',
        sectionHeading: 'Evidence',
        content: 'Verified output',
      },
    });
    expect(result.valid).toBe(false);
    if (result.valid) throw new Error('unreachable');
    expect(result.errors.map((error) => error.path)).toContain('/baseContentHash');
  });

  it('accepts a bounded compare-and-swap replacement for companion blocks', () => {
    const command = {
      ...validCreateCommand(),
      operation: 'replaceManagedBlocks',
      arguments: {
        relativePath: 'Vaultide/伴随笔记/first.md',
        companionId: `cmp_${'d'.repeat(32)}`,
        blocks: [
          {
            id: 'progress',
            expectedHash: HASH_A,
            content: '## 学习进度\n\n- 已完成练习',
          },
        ],
      },
    };
    expect(validateWritebackCommand(command)).toEqual({ valid: true });
  });

  it('accepts a separately identified bounded replacement for project indexes', () => {
    const command = {
      ...validCreateCommand(),
      operation: 'replaceProjectIndexBlocks',
      arguments: {
        relativePath: 'Vaultide/System/Indexes/project.md',
        projectId: `prj_${'e'.repeat(32)}`,
        projectIndexId: `pdx_${'f'.repeat(32)}`,
        blocks: [
          {
            id: 'coverage',
            expectedHash: HASH_A,
            content: '## Source coverage\n\n- Original sources remain read-only.',
          },
        ],
      },
    };
    expect(validateWritebackCommand(command)).toEqual({ valid: true });
  });

  it('accepts a separately identified bounded replacement for a periodic synthesis index', () => {
    const command = {
      ...validCreateCommand(),
      operation: 'replaceSynthesisIndexBlocks',
      arguments: {
        relativePath: 'Vaultide/归纳/周期/索引/weekly.md',
        scheduleId: `sch_${'e'.repeat(32)}`,
        synthesisIndexId: `sdx_${'f'.repeat(32)}`,
        blocks: [
          {
            id: 'snapshots',
            expectedHash: HASH_A,
            content: '## 不可变快照\n\n- 本周新增一份。',
          },
        ],
      },
    };
    expect(validateWritebackCommand(command)).toEqual({ valid: true });
  });

  it('accepts a separately identified bounded replacement for the Vault overview', () => {
    const command = {
      ...validCreateCommand(),
      operation: 'replaceVaultOverviewBlocks',
      arguments: {
        relativePath: 'Vaultide/知洄总览.md',
        vaultOverviewId: `vdx_${'a'.repeat(32)}`,
        blocks: [
          {
            id: 'today',
            expectedHash: HASH_A,
            content: '## 今日行动\n\n- 完成一次主动回忆。',
          },
        ],
      },
    };
    expect(validateWritebackCommand(command)).toEqual({ valid: true });
  });

  it('rejects a project-index replacement with a mismatched stable identity', () => {
    const command = {
      ...validCreateCommand(),
      operation: 'replaceProjectIndexBlocks',
      arguments: {
        relativePath: 'Vaultide/System/Indexes/project.md',
        projectId: `prj_${'e'.repeat(32)}`,
        projectIndexId: `cmp_${'f'.repeat(32)}`,
        blocks: [{ id: 'coverage', expectedHash: HASH_A, content: 'safe replacement' }],
      },
    };
    const result = validateWritebackCommand(command);
    expect(result.valid).toBe(false);
    if (result.valid) throw new Error('unreachable');
    expect(result.errors.map((error) => error.path)).toContain('/arguments/projectIndexId');
  });

  it('rejects marker injection and duplicate managed block ids', () => {
    const command = {
      ...validCreateCommand(),
      operation: 'replaceManagedBlocks',
      arguments: {
        relativePath: 'Vaultide/伴随笔记/first.md',
        companionId: `cmp_${'d'.repeat(32)}`,
        blocks: [
          { id: 'progress', expectedHash: HASH_A, content: '<!-- vaultide:managed -->' },
          { id: 'progress', expectedHash: HASH_B, content: 'another block' },
        ],
      },
    };
    const result = validateWritebackCommand(command);
    expect(result.valid).toBe(false);
    if (result.valid) throw new Error('unreachable');
    expect(result.errors.map((error) => error.code)).toEqual(
      expect.arrayContaining(['safety', 'duplicate']),
    );
  });

  it('rejects every operation outside the P0 allowlist', () => {
    expect(
      validateWritebackCommand({ ...validCreateCommand(), operation: 'deleteFile' }).valid,
    ).toBe(false);
  });
});

describe('protocol negotiation', () => {
  it('fails closed for missing and unknown protocol versions', () => {
    expect(negotiateProtocol(undefined)).toMatchObject({ compatible: false, reason: 'missing' });
    expect(negotiateProtocol('2099-01')).toMatchObject({
      compatible: false,
      reason: 'unsupported',
    });
    expect(negotiateProtocol(LEARNING_PROTOCOL_VERSION)).toMatchObject({ compatible: true });
  });
});
