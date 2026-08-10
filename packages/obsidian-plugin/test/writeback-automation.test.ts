import { describe, expect, it } from 'vitest';
import { stampWritebackCommand } from '@openmaic/learning-protocol';
import { isAutomaticallyApplicableManagedUpdate } from '../src/writeback-automation';

function baseCommand() {
  return {
    id: 'wbc_11111111111111111111111111111111',
    draftId: 'wbd_11111111111111111111111111111111',
    draftRevision: 1,
    ownerId: 'own_11111111111111111111111111111111',
    deviceId: 'dev_11111111111111111111111111111111',
    vaultBindingId: 'vlt_11111111111111111111111111111111',
    issuedAt: '2026-07-23T08:00:00.000Z',
    expiresAt: '2026-07-30T08:00:00.000Z',
  };
}

describe('managed writeback automation allowlist', () => {
  it('allows only a non-empty managed block replacement', () => {
    const command = stampWritebackCommand({
      ...baseCommand(),
      operation: 'replaceManagedBlocks',
      arguments: {
        relativePath: 'Vaultide/伴随笔记/example.md',
        companionId: 'cmp_11111111111111111111111111111111',
        blocks: [{ id: 'progress', expectedHash: 'a'.repeat(64), content: '## 新进度' }],
      },
    });
    expect(isAutomaticallyApplicableManagedUpdate(command)).toBe(true);
  });

  it('keeps initial companion creation for a visible manual confirmation', () => {
    const command = stampWritebackCommand({
      ...baseCommand(),
      operation: 'createManagedNote',
      arguments: {
        relativePath: 'Vaultide/伴随笔记/example.md',
        content: '# 学习伴随笔记',
        frontmatter: { maic_note_id: 'cmp_11111111111111111111111111111111' },
        expectedAbsent: true,
      },
    });
    expect(isAutomaticallyApplicableManagedUpdate(command)).toBe(false);
  });

  it('allows only a hash-matched update to an existing synthesis index', () => {
    const command = stampWritebackCommand({
      ...baseCommand(),
      operation: 'replaceSynthesisIndexBlocks',
      arguments: {
        relativePath: 'Vaultide/归纳/周期/索引/weekly.md',
        synthesisIndexId: 'sdx_44444444444444444444444444444444',
        scheduleId: 'sch_55555555555555555555555555555555',
        blocks: [
          {
            id: 'summary',
            expectedHash: 'b'.repeat(64),
            content: '## 周期归纳概览\n\n- 新增快照 1 份',
          },
        ],
      },
    });
    expect(isAutomaticallyApplicableManagedUpdate(command)).toBe(true);
  });
});
