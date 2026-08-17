/**
 * Two-Stage Generation Pipeline
 *
 * Barrel re-export ? official OpenMAIC generation rules.
 */

// Types
export type {
  AgentInfo,
  SceneGenerationContext,
  GeneratedSlideData,
  GenerationResult,
  AICallFn,
} from './pipeline-types';

// Prompt formatters ? official @openmaic/generation
export {
  buildCourseContext,
  formatAgentsForPrompt,
  formatTeacherPersonaForPrompt,
  formatImageDescription,
  formatImagePlaceholder,
  buildVisionUserContent,
  buildLanguageText,
} from '@openmaic/generation';

// JSON repair ? official parse; keep Vaultide-only tryParseJson for local callers
export { parseJsonResponse } from '@openmaic/generation';
export { tryParseJson } from './json-repair';

// Outline generator (Stage 1) ? official
export { generateSceneOutlinesFromRequirements, applyOutlineFallbacks } from '@openmaic/generation';

// Scene generator (Stage 2) ? official
export { generateSceneContent, generateSceneActions } from '@openmaic/generation';
export type { SceneContentOptions, SceneActionsOptions } from '@openmaic/generation';
export { createSceneWithActions } from './scene-generator';

// Scene builder ? official build/assembly; keep Vaultide wrapper for legacy callers
export { buildCompleteScene, uniquifyMediaElementIds } from '@openmaic/generation';
export { buildSceneFromOutline } from './scene-builder';
