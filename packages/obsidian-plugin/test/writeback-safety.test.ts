import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => {
  class TFile {
    constructor(readonly path: string) {}
  }
  class TFolder {
    constructor(readonly path: string) {}
  }
  return {
    TFile,
    TFolder,
    normalizePath: (value: string) => value.replaceAll('\\', '/').replace(/\/{2,}/g, '/'),
  };
});

import { LEARNING_PROTOCOL_VERSION, stampWritebackCommand } from '@openmaic/learning-protocol';
import { TFile, TFolder } from 'obsidian';
import {
  applyCreateManagedNote,
  applyReplaceManagedBlocks,
  applyReplaceProjectIndexBlocks,
  applyReplaceSynthesisIndexBlocks,
  applyReplaceVaultOverviewBlocks,
  normalizeManagedBlockContent,
  renderManagedNote,
  resolveManagedWritebackPath,
  sha256Text,
} from '../src/writeback-safety';

function command() {
  return stampWritebackCommand({
    id: 'wbc_11111111111111111111111111111111',
    draftId: 'wbd_11111111111111111111111111111111',
    draftRevision: 1,
    ownerId: 'own_11111111111111111111111111111111',
    deviceId: 'dev_11111111111111111111111111111111',
    vaultBindingId: 'vlt_11111111111111111111111111111111',
    issuedAt: '2026-07-21T08:00:00.000Z',
    expiresAt: '2026-07-28T08:00:00.000Z',
    operation: 'createManagedNote',
    arguments: {
      relativePath: 'Vaultide/学习记录/course.md',
      content: '# 学习记录\n\n不包含原笔记覆盖操作。',
      frontmatter: {
        maic_note_id: 'learning-course',
        tags: ['openmaic', 'learning'],
      },
      expectedAbsent: true,
    },
  });
}

function replaceCommand(expectedHash: string) {
  return stampWritebackCommand({
    id: 'wbc_22222222222222222222222222222222',
    draftId: 'wbd_22222222222222222222222222222222',
    draftRevision: 1,
    ownerId: 'own_11111111111111111111111111111111',
    deviceId: 'dev_11111111111111111111111111111111',
    vaultBindingId: 'vlt_11111111111111111111111111111111',
    issuedAt: '2026-07-21T08:00:00.000Z',
    expiresAt: '2026-07-28T08:00:00.000Z',
    operation: 'replaceManagedBlocks',
    arguments: {
      relativePath: 'Vaultide/伴随笔记/course.md',
      companionId: 'cmp_11111111111111111111111111111111',
      blocks: [
        {
          id: 'progress',
          expectedHash,
          content: '## 学习进度与证据\n\n- 已完成新的练习',
        },
      ],
    },
  });
}

function projectIndexReplaceCommand(expectedHash: string) {
  return stampWritebackCommand({
    id: 'wbc_33333333333333333333333333333333',
    draftId: 'wbd_33333333333333333333333333333333',
    draftRevision: 1,
    ownerId: 'own_11111111111111111111111111111111',
    deviceId: 'dev_11111111111111111111111111111111',
    vaultBindingId: 'vlt_11111111111111111111111111111111',
    issuedAt: '2026-07-21T08:00:00.000Z',
    expiresAt: '2026-07-28T08:00:00.000Z',
    operation: 'replaceProjectIndexBlocks',
    arguments: {
      relativePath: 'Vaultide/系统/索引/project.md',
      projectId: 'prj_11111111111111111111111111111111',
      projectIndexId: 'pdx_11111111111111111111111111111111',
      blocks: [
        {
          id: 'coverage',
          expectedHash,
          content: '## Source coverage\n\n- Updated safely.',
        },
      ],
    },
  });
}

function synthesisIndexReplaceCommand(expectedHash: string) {
  return stampWritebackCommand({
    id: 'wbc_44444444444444444444444444444444',
    draftId: 'wbd_44444444444444444444444444444444',
    draftRevision: 1,
    ownerId: 'own_11111111111111111111111111111111',
    deviceId: 'dev_11111111111111111111111111111111',
    vaultBindingId: 'vlt_11111111111111111111111111111111',
    issuedAt: '2026-07-21T08:00:00.000Z',
    expiresAt: '2026-07-28T08:00:00.000Z',
    operation: 'replaceSynthesisIndexBlocks',
    arguments: {
      relativePath: 'Vaultide/归纳/周期/索引/weekly.md',
      scheduleId: 'sch_11111111111111111111111111111111',
      synthesisIndexId: 'sdx_11111111111111111111111111111111',
      blocks: [
        {
          id: 'snapshots',
          expectedHash,
          content: '## 不可变快照\n\n- Updated safely.',
        },
      ],
    },
  });
}

function vaultOverviewReplaceCommand(expectedHash: string) {
  return stampWritebackCommand({
    id: 'wbc_55555555555555555555555555555555',
    draftId: 'wbd_55555555555555555555555555555555',
    draftRevision: 1,
    ownerId: 'own_11111111111111111111111111111111',
    deviceId: 'dev_11111111111111111111111111111111',
    vaultBindingId: 'vlt_11111111111111111111111111111111',
    issuedAt: '2026-07-21T08:00:00.000Z',
    expiresAt: '2026-07-28T08:00:00.000Z',
    operation: 'replaceVaultOverviewBlocks',
    arguments: {
      relativePath: 'Vaultide/知洄总览.md',
      vaultOverviewId: 'vdx_11111111111111111111111111111111',
      blocks: [
        {
          id: 'today',
          expectedHash,
          content: '## 今日行动\n\n- Updated safely.',
        },
      ],
    },
  });
}

describe('Obsidian managed writeback safety', () => {
  beforeEach(() => {
    expect(LEARNING_PROTOCOL_VERSION).toBe('2026-07-draft-1');
  });

  it('refuses traversal, absolute paths, and targets outside the managed root', () => {
    expect(() => resolveManagedWritebackPath('../Secrets.md', 'Vaultide')).toThrow('unsafe');
    expect(() => resolveManagedWritebackPath('C:\\Secrets.md', 'Vaultide')).toThrow('relative');
    expect(() => resolveManagedWritebackPath('Notes/course.md', 'Vaultide')).toThrow('inside');
  });

  it('renders only allowlisted flat frontmatter', () => {
    expect(
      renderManagedNote('# Body', { maic_status: 'active', tags: ['openmaic', 'learning'] }),
    ).toBe('---\nmaic_status: "active"\ntags: ["openmaic","learning"]\n---\n\n# Body');
    expect(
      renderManagedNote('# Synthesis', {
        maic_synthesis_schema: 'trusted-synthesis/1',
        maic_verified_snapshot_count: 3,
        maic_incremental: false,
      }),
    ).toBe(
      '---\nmaic_synthesis_schema: "trusted-synthesis/1"\nmaic_verified_snapshot_count: 3\nmaic_incremental: false\n---\n\n# Synthesis',
    );
    expect(() => renderManagedNote('# Body', { unsafe_key: 'no' })).toThrow('not allowed');
  });

  it('creates once, hashes the persisted note, and refuses overwrite', async () => {
    const entries = new Map<string, TFile | TFolder>();
    const contents = new Map<string, string>();
    const app = {
      vault: {
        getAbstractFileByPath: (path: string) => entries.get(path) ?? null,
        createFolder: async (path: string) => {
          const folder = new (TFolder as unknown as new (path: string) => TFolder)(path);
          entries.set(path, folder);
          return folder;
        },
        create: async (path: string, content: string) => {
          const file = new (TFile as unknown as new (path: string) => TFile)(path);
          entries.set(path, file);
          contents.set(path, content);
          return file;
        },
        read: async (file: TFile) => contents.get(file.path) ?? '',
        modify: async (file: TFile, content: string) => {
          contents.set(file.path, content);
        },
      },
    };

    const result = await applyCreateManagedNote({
      app: app as never,
      command: command(),
      managedRoot: 'Vaultide',
    });
    expect(result.path).toBe('Vaultide/学习记录/course.md');
    expect(result.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(contents.get(result.path)).toContain('maic_note_id: "learning-course"');

    await expect(
      applyCreateManagedNote({ app: app as never, command: command(), managedRoot: 'Vaultide' }),
    ).rejects.toMatchObject({ outcome: 'conflicted' });
  });

  it('replaces only a hash-matched managed companion block and preserves free edits', async () => {
    const path = 'Vaultide/伴随笔记/course.md';
    const oldBlock = '## 学习进度与证据\n\n- 已完成旧的练习';
    const expectedHash = await sha256Text(normalizeManagedBlockContent(oldBlock));
    const content = [
      '---',
      'maic_note_id: "cmp_11111111111111111111111111111111"',
      'maic_companion_id: "cmp_11111111111111111111111111111111"',
      'maic_managed: true',
      '---',
      '',
      '# 学习伴随笔记',
      '',
      '<!-- vaultide:managed block=progress companion=cmp_11111111111111111111111111111111 -->',
      oldBlock,
      '<!-- /vaultide:managed -->',
      '',
      '## 我的补充',
      '',
      '这段文字只能由我编辑。',
      '',
    ].join('\n');
    const file = new (TFile as unknown as new (path: string) => TFile)(path);
    const entries = new Map<string, TFile | TFolder>([[path, file]]);
    const contents = new Map<string, string>([[path, content]]);
    const app = {
      vault: {
        getAbstractFileByPath: (filePath: string) => entries.get(filePath) ?? null,
        read: async (target: TFile) => contents.get(target.path) ?? '',
        modify: async (target: TFile, next: string) => {
          contents.set(target.path, next);
        },
      },
    };

    const result = await applyReplaceManagedBlocks({
      app: app as never,
      command: replaceCommand(expectedHash),
      managedRoot: 'Vaultide',
    });
    expect(result.path).toBe(path);
    expect(contents.get(path)).toContain('- 已完成新的练习');
    expect(contents.get(path)).toContain('这段文字只能由我编辑。');
  });

  it('refuses a managed replacement after the target block changed locally', async () => {
    const path = 'Vaultide/伴随笔记/course.md';
    const expectedHash = await sha256Text('a'.repeat(8));
    const file = new (TFile as unknown as new (path: string) => TFile)(path);
    const entries = new Map<string, TFile | TFolder>([[path, file]]);
    const contents = new Map<string, string>([
      [
        path,
        [
          '---',
          'maic_companion_id: "cmp_11111111111111111111111111111111"',
          'maic_managed: true',
          '---',
          '',
          '<!-- vaultide:managed block=progress companion=cmp_11111111111111111111111111111111 -->',
          '本地修改后的内容',
          '<!-- /vaultide:managed -->',
        ].join('\n'),
      ],
    ]);
    const app = {
      vault: {
        getAbstractFileByPath: (filePath: string) => entries.get(filePath) ?? null,
        read: async (target: TFile) => contents.get(target.path) ?? '',
        modify: async () => {
          throw new Error('must not modify on conflict');
        },
      },
    };

    await expect(
      applyReplaceManagedBlocks({
        app: app as never,
        command: replaceCommand(expectedHash),
        managedRoot: 'Vaultide',
      }),
    ).rejects.toMatchObject({ outcome: 'conflicted' });
  });

  it('updates only hash-matched project-index blocks and leaves the user area untouched', async () => {
    const path = 'Vaultide/系统/索引/project.md';
    const oldBlock = '## Source coverage\n\n- Before update.';
    const expectedHash = await sha256Text(normalizeManagedBlockContent(oldBlock));
    const content = [
      '---',
      'maic_project_index_id: "pdx_11111111111111111111111111111111"',
      'maic_project_id: "prj_11111111111111111111111111111111"',
      'maic_managed: true',
      '---',
      '',
      '<!-- vaultide:managed block=coverage project-index=pdx_11111111111111111111111111111111 -->',
      oldBlock,
      '<!-- /vaultide:managed -->',
      '',
      '## 我的补充',
      '',
      'This remains mine.',
      '',
    ].join('\n');
    const file = new (TFile as unknown as new (path: string) => TFile)(path);
    const entries = new Map<string, TFile | TFolder>([[path, file]]);
    const contents = new Map<string, string>([[path, content]]);
    const app = {
      vault: {
        getAbstractFileByPath: (filePath: string) => entries.get(filePath) ?? null,
        read: async (target: TFile) => contents.get(target.path) ?? '',
        modify: async (target: TFile, next: string) => {
          contents.set(target.path, next);
        },
      },
    };

    await applyReplaceProjectIndexBlocks({
      app: app as never,
      command: projectIndexReplaceCommand(expectedHash),
      managedRoot: 'Vaultide',
    });
    expect(contents.get(path)).toContain('- Updated safely.');
    expect(contents.get(path)).toContain('This remains mine.');
  });

  it('refuses a project-index update when its target is outside the dedicated index root', async () => {
    const unsafe = projectIndexReplaceCommand('a'.repeat(64));
    unsafe.arguments.relativePath = 'Vaultide/伴随笔记/project.md';
    const file = new (TFile as unknown as new (path: string) => TFile)(
      unsafe.arguments.relativePath,
    );
    const app = {
      vault: {
        getAbstractFileByPath: () => file,
        read: async () => '',
      },
    };
    await expect(
      applyReplaceProjectIndexBlocks({
        app: app as never,
        command: unsafe,
        managedRoot: 'Vaultide',
      }),
    ).rejects.toMatchObject({ outcome: 'conflicted' });
  });

  it('updates only hash-matched synthesis-index blocks and leaves snapshots plus user text intact', async () => {
    const path = 'Vaultide/归纳/周期/索引/weekly.md';
    const oldBlock = '## 不可变快照\n\n- Before update.';
    const expectedHash = await sha256Text(normalizeManagedBlockContent(oldBlock));
    const content = [
      '---',
      'maic_synthesis_index_id: "sdx_11111111111111111111111111111111"',
      'maic_synthesis_schedule_id: "sch_11111111111111111111111111111111"',
      'maic_managed: true',
      '---',
      '',
      '<!-- vaultide:managed block=snapshots synthesis-index=sdx_11111111111111111111111111111111 -->',
      oldBlock,
      '<!-- /vaultide:managed -->',
      '',
      '## 历史快照链接',
      '',
      '- 不可变快照原文不会由索引回写替换。',
      '',
      '## 我的补充',
      '',
      'This remains mine.',
      '',
    ].join('\n');
    const file = new (TFile as unknown as new (path: string) => TFile)(path);
    const entries = new Map<string, TFile | TFolder>([[path, file]]);
    const contents = new Map<string, string>([[path, content]]);
    const app = {
      vault: {
        getAbstractFileByPath: (filePath: string) => entries.get(filePath) ?? null,
        read: async (target: TFile) => contents.get(target.path) ?? '',
        modify: async (target: TFile, next: string) => {
          contents.set(target.path, next);
        },
      },
    };

    await applyReplaceSynthesisIndexBlocks({
      app: app as never,
      command: synthesisIndexReplaceCommand(expectedHash),
      managedRoot: 'Vaultide',
    });
    expect(contents.get(path)).toContain('- Updated safely.');
    expect(contents.get(path)).toContain('不可变快照原文不会由索引回写替换。');
    expect(contents.get(path)).toContain('This remains mine.');
  });

  it('refuses a synthesis-index update outside its dedicated index root', async () => {
    const unsafe = synthesisIndexReplaceCommand('a'.repeat(64));
    unsafe.arguments.relativePath = 'Vaultide/归纳/周期/weekly.md';
    const file = new (TFile as unknown as new (path: string) => TFile)(
      unsafe.arguments.relativePath,
    );
    const app = {
      vault: {
        getAbstractFileByPath: () => file,
        read: async () => '',
      },
    };
    await expect(
      applyReplaceSynthesisIndexBlocks({
        app: app as never,
        command: unsafe,
        managedRoot: 'Vaultide',
      }),
    ).rejects.toMatchObject({ outcome: 'conflicted' });
  });

  it('updates only hash-matched Vault-overview blocks at the one stable path', async () => {
    const path = 'Vaultide/知洄总览.md';
    const oldBlock = '## 今日行动\n\n- Before update.';
    const expectedHash = await sha256Text(normalizeManagedBlockContent(oldBlock));
    const content = [
      '---',
      'maic_vault_overview_id: "vdx_11111111111111111111111111111111"',
      'maic_managed: true',
      '---',
      '',
      '<!-- vaultide:managed block=today vault-overview=vdx_11111111111111111111111111111111 -->',
      oldBlock,
      '<!-- /vaultide:managed -->',
      '',
      '## 我的补充',
      '',
      'This remains mine.',
      '',
    ].join('\n');
    const file = new (TFile as unknown as new (path: string) => TFile)(path);
    const contents = new Map<string, string>([[path, content]]);
    const app = {
      vault: {
        getAbstractFileByPath: (filePath: string) => (filePath === path ? file : null),
        read: async (target: TFile) => contents.get(target.path) ?? '',
        modify: async (target: TFile, next: string) => contents.set(target.path, next),
      },
    };

    await applyReplaceVaultOverviewBlocks({
      app: app as never,
      command: vaultOverviewReplaceCommand(expectedHash),
      managedRoot: 'Vaultide',
    });
    expect(contents.get(path)).toContain('- Updated safely.');
    expect(contents.get(path)).toContain('This remains mine.');
  });

  it('refuses a Vault-overview update at any other path', async () => {
    const unsafe = vaultOverviewReplaceCommand('a'.repeat(64));
    unsafe.arguments.relativePath = 'Vaultide/系统/知洄总览.md';
    const file = new (TFile as unknown as new (path: string) => TFile)(
      unsafe.arguments.relativePath,
    );
    const app = {
      vault: {
        getAbstractFileByPath: () => file,
        read: async () => '',
      },
    };
    await expect(
      applyReplaceVaultOverviewBlocks({
        app: app as never,
        command: unsafe,
        managedRoot: 'Vaultide',
      }),
    ).rejects.toMatchObject({ outcome: 'conflicted' });
  });
});
