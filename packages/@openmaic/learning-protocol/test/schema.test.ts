import { describe, expect, it } from 'vitest';
import { generateSchema, ROOTS } from '../scripts/gen-schema.mjs';

describe('published JSON Schemas', () => {
  // Schema generation walks the complete protocol graph. On a cold Windows
  // workspace this can exceed Vitest's generic 5s unit-test budget even though
  // the generated contracts are valid; keep the regression assertion while
  // giving this known integration-sized check a realistic bound.
  it('generates every protocol root', () => {
    expect(Object.keys(ROOTS)).toEqual([
      'SourceBundle',
      'SourceArchive',
      'LearningEvent',
      'ProjectBindingContract',
      'SourceUploadIntent',
      'WritebackCommand',
    ]);
    for (const typeName of Object.keys(ROOTS)) {
      const schema = generateSchema(typeName);
      expect(schema).toHaveProperty('$schema');
      expect(schema).toHaveProperty('definitions');
      expect(JSON.stringify(schema)).toContain('protocolVersion');
    }
  }, 20_000);

  it('preserves discriminants and the writeback allowlist', () => {
    const source = JSON.stringify(generateSchema('SourceBundle'));
    const event = JSON.stringify(generateSchema('LearningEvent'));
    const writeback = JSON.stringify(generateSchema('WritebackCommand'));
    expect(source).toContain('obsidian');
    expect(source).toContain('github');
    expect(event).toContain('retrievalAttempted');
    expect(event).toContain('transferTaskCompleted');
    expect(event).toContain('whiteboardNoteAdded');
    expect(event).toContain('discussionParticipated');
    expect(writeback).toContain('createManagedNote');
    expect(writeback).toContain('replaceManagedBlocks');
    expect(writeback).toContain('replaceSynthesisIndexBlocks');
    expect(writeback).toContain('replaceVaultOverviewBlocks');
    expect(writeback).toContain('updateManagedFrontmatterKeys');
    expect(writeback).not.toContain('deleteFile');
  });

  it('publishes strict project contracts without changing the SourceBundle root', () => {
    const project = JSON.stringify(generateSchema('ProjectBindingContract'));
    const upload = JSON.stringify(generateSchema('SourceUploadIntent'));
    const source = generateSchema('SourceBundle') as {
      definitions?: { SourceBundle?: { properties?: Record<string, unknown> } };
    };

    expect(project).toContain('project-binding/1');
    expect(project).toContain('obsidian-folder');
    expect(project).toContain('bindingRevision');
    expect(upload).toContain('source-upload-intent/1');
    expect(upload).toContain('expectedProjectRevision');
    expect(upload).toContain('partial');
    expect(source.definitions?.SourceBundle?.properties).not.toHaveProperty('project');
    expect(source.definitions?.SourceBundle?.properties).not.toHaveProperty('projectId');
  });
});
