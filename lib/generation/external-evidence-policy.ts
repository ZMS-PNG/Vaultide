export type ExternalEvidenceMode = 'off' | 'supplemental' | 'required';
export type ExternalEvidenceStatus = 'not-requested' | 'ready' | 'unavailable';

interface ExternalEvidenceRequirementInput {
  externalEvidenceMode?: ExternalEvidenceMode;
  webSearch?: boolean;
  learningProject?: {
    sourceMode: 'external' | 'obsidian' | 'hybrid';
  };
}

/**
 * Resolve the external-evidence contract once and reuse it throughout the
 * generation pipeline. `webSearch` is retained for backwards compatibility,
 * but it must never decide whether a provider failure blocks an internal
 * project course.
 */
export function resolveExternalEvidenceMode(
  requirements: ExternalEvidenceRequirementInput,
): ExternalEvidenceMode {
  if (requirements.externalEvidenceMode) return requirements.externalEvidenceMode;
  if (requirements.webSearch !== true) return 'off';
  return requirements.learningProject?.sourceMode === 'external' ? 'required' : 'supplemental';
}

export function externalEvidenceRequested(requirements: ExternalEvidenceRequirementInput): boolean {
  return resolveExternalEvidenceMode(requirements) !== 'off';
}

export function externalEvidenceBlocksGeneration(
  requirements: ExternalEvidenceRequirementInput,
): boolean {
  return resolveExternalEvidenceMode(requirements) === 'required';
}
