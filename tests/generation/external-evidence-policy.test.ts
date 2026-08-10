import { describe, expect, it } from 'vitest';
import {
  externalEvidenceBlocksGeneration,
  resolveExternalEvidenceMode,
} from '@/lib/generation/external-evidence-policy';

describe('external evidence policy', () => {
  it('keeps external-only learning release-blocking by default', () => {
    const requirements = {
      webSearch: true,
      learningProject: { sourceMode: 'external' as const },
    };

    expect(resolveExternalEvidenceMode(requirements)).toBe('required');
    expect(externalEvidenceBlocksGeneration(requirements)).toBe(true);
  });

  it('treats web research as supplemental for a canonical private project', () => {
    const requirements = {
      webSearch: true,
      learningProject: { sourceMode: 'obsidian' as const },
    };

    expect(resolveExternalEvidenceMode(requirements)).toBe('supplemental');
    expect(externalEvidenceBlocksGeneration(requirements)).toBe(false);
  });

  it('honors the explicit contract instead of inferring from the legacy boolean', () => {
    expect(
      resolveExternalEvidenceMode({
        webSearch: true,
        externalEvidenceMode: 'off',
      }),
    ).toBe('off');
    expect(
      resolveExternalEvidenceMode({
        webSearch: false,
        externalEvidenceMode: 'required',
      }),
    ).toBe('required');
  });
});
