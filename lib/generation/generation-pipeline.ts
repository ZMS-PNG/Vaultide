/**
 * Two-Stage Generation Pipeline
 *
 * Barrel re-export — all symbols previously exported from this file
 * are now spread across focused sub-modules.
 */

// Types
export type {
  AgentInfo,
  SceneGenerationContext,
  GeneratedSlideData,
  GenerationResult,
  AICallFn,
} from './pipeline-types';

// Prompt formatters
export {
  buildCourseContext,
  formatAgentsForPrompt,
  formatTeacherPersonaForPrompt,
  formatImageDescription,
  formatImagePlaceholder,
  buildVisionUserContent,
  buildLanguageText,
} from './prompt-formatters';

// JSON repair
export { parseJsonResponse, tryParseJson } from './json-repair';

// Outline generator (Stage 1)
export { generateSceneOutlinesFromRequirements, applyOutlineFallbacks } from './outline-generator';

// Scene generator (Stage 2) ? official OpenMAIC generation
export { generateSceneContent, generateSceneActions } from '@openmaic/generation';
export type { SceneContentOptions, SceneActionsOptions } from '@openmaic/generation';
export { createSceneWithActions } from './scene-generator';

// Scene builder (standalone)
export {
  buildSceneFromOutline,
  buildCompleteScene,
  uniquifyMediaElementIds,
} from './scene-builder';
