import { describe, expect, it } from 'vitest';
import { selectObsidianCompanionSource } from '@/lib/learning/application/learning-progress-service';

describe('project companion source selection', () => {
  const source = (relativePath: string, suffix: string) => ({
    sourceId: `sou_${suffix.repeat(32)}`,
    snapshotId: `snp_${suffix.repeat(32)}`,
    relativePath,
  });

  it('keeps a single note bound to its own companion', () => {
    const note = source('Notes/one.md', '1');
    expect(selectObsidianCompanionSource([note], false)).toEqual(note);
  });

  it('uses the shallowest project README as the stable project companion anchor', () => {
    const rootReadme = source('Projects/demo/README.md', '1');
    const nestedReadme = source('Projects/demo/docs/README.md', '2');
    const detail = source('Projects/demo/docs/design.md', '3');

    expect(
      selectObsidianCompanionSource([detail, nestedReadme, rootReadme], true),
    ).toEqual(rootReadme);
  });

  it('does not choose an arbitrary source for a multi-note non-project bundle', () => {
    expect(
      selectObsidianCompanionSource(
        [source('Notes/one.md', '1'), source('Notes/two.md', '2')],
        false,
      ),
    ).toBeNull();
  });
});
