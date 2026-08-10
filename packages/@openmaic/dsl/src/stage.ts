/**
 * Stage / Scene / SceneContent — the universal lesson-skeleton contract.
 *
 * This module owns the *structural* part of a lesson: the top-level `Stage`
 * container and a per-page `Scene` whose `content` is a discriminated union of
 * the universal content kinds (`SlideContent`, `QuizContent`). `Scene`'s
 * playback `actions` default to the contract's standard {@link Action} union
 * (defined in `./action.ts`); apps still thread their own richer content
 * kinds (interactive / PBL configs) in through `Scene`'s generic parameters.
 *
 * The split keeps `@openmaic/dsl` focused on the lesson skeleton while letting the
 * runtime engine, renderer, and importer share one source of truth for it.
 *
 * No runtime dependencies. Pure types + pure discriminant guards only.
 */
import type { Slide } from './slides.js';
import type { Action } from './action.js';

/** All scene kinds the contract is aware of. Feature kinds (interactive/pbl) are still valid `type` values — their *content* shapes live in the app and are composed in via {@link Scene}'s `TContent` parameter. */
export type SceneType = 'slide' | 'quiz' | 'interactive' | 'pbl';

/** Frozen set of every valid {@link SceneType}, for cheap membership checks. */
export const SCENE_TYPES = [
  'slide',
  'quiz',
  'interactive',
  'pbl',
] as const satisfies readonly SceneType[];

// Compile-time exhaustiveness: every SceneType must appear in SCENE_TYPES.
// `satisfies` above proves the converse (each entry is a valid SceneType); this
// fails the build if the union gains a member the tuple is missing.
type _SceneTypesExhaustive = [SceneType] extends [(typeof SCENE_TYPES)[number]] ? true : never;
const _sceneTypesExhaustive: _SceneTypesExhaustive = true;
void _sceneTypesExhaustive;

/** Narrow an unknown value to a valid {@link SceneType}. Pure, no runtime deps. */
export function isSceneType(value: unknown): value is SceneType {
  return typeof value === 'string' && (SCENE_TYPES as readonly string[]).includes(value);
}

/** Lifecycle / interaction mode a {@link Stage} can be operated in. */
export type StageMode = 'autonomous' | 'playback' | 'edit';

/**
 * A whiteboard slide. Structurally a {@link Slide} minus the fields that only
 * make sense on a primary canvas (`theme`, `turningMode`, `sectionTag`, `type`).
 */
export type Whiteboard = Omit<Slide, 'theme' | 'turningMode' | 'sectionTag' | 'type'>;

export interface VideoManifestEntry {
  type: 'video';
  prompt: string;
  aspectRatio?: string;
}

export type VideoManifest = Record<string, VideoManifestEntry>;

/**
 * Provider-neutral vocal identity for an agent, described as a 3-layer recipe.
 * Consumed by any TTS integration: as an inline voice prompt where supported,
 * or as the seed for a registered/cloned voice. Part of the contract so an
 * agent's voice travels with the document (export/import, device switches)
 * instead of living in device-local storage.
 */
export interface VoiceDesign {
  /** gender / age / role */
  identity: string;
  /** pitch / vocal quality */
  texture: string;
  /** emotion / pace */
  delivery: string;
}

/**
 * A concrete TTS voice binding for an agent. `providerId` is an open string at
 * the contract level — the set of available TTS providers is app-defined, and
 * readers must treat an unknown provider as "no bound voice". Deliberately
 * minimal: fields are added here only once a producer actually emits them.
 */
export interface AgentVoiceConfig {
  providerId: string;
  voiceId: string;
}

/**
 * Generated agent configuration. Embedded in the persisted stage document
 * (`stage.generatedAgentConfigs`) so clients can hydrate the agent registry
 * without relying on IndexedDB pre-population. Present for generated-roster
 * classrooms; preset classrooms carry `agentIds` instead.
 *
 * The voice fields are optional and additive: documents written before they
 * existed simply lack them, and readers treat an absent voice as "no bound
 * voice" (the TTS path falls back at call time). Adding them did not change
 * the meaning of any existing field, so within this codebase — whose
 * structural validators tolerate unknown fields — the addition is
 * non-breaking and does not bump `DSL_VERSION` (see `version.ts`).
 *
 * It is NOT transparent to schema-validating consumers, however: the
 * generated `stage.schema.json` sets `additionalProperties: false` on every
 * definition, so a cross-language consumer validating against a pinned copy
 * of an older published schema artifact rejects any document that carries
 * these fields. Under strict schema validation, additive fields ARE a
 * breaking change — such consumers must upgrade their schema artifact in
 * lockstep with the documents they accept. (A `DSL_VERSION` bump would not
 * help them: an old schema rejects the new documents either way.)
 */
export interface GeneratedAgentConfig {
  id: string;
  name: string;
  role: string;
  persona: string;
  avatar: string;
  color: string;
  priority: number;
  /** Bound TTS voice, when the generation pipeline selected one. */
  voiceConfig?: AgentVoiceConfig;
  /** 3-layer vocal descriptor for automatic voice synthesis/registration. */
  voiceDesign?: VoiceDesign;
}

/**
 * Multi-agent discussion configuration for a single scene.
 */
export interface MultiAgentConfig {
  /** Enable multi-agent for this scene. */
  enabled: boolean;
  /** Which agents to include (from the registry). */
  agentIds: string[];
  /** Optional custom director instructions. */
  directorPrompt?: string;
}

/**
 * Optional provenance carried with a generated classroom. It lets a learning
 * integration reconnect the durable classroom to the material and goal that
 * produced it without embedding source contents in the classroom snapshot.
 */
export interface StageResearchSource {
  citationId?: string;
  title: string;
  url: string;
  domain?: string;
  authority?: 'primary' | 'authoritative' | 'general';
  score?: number;
}

export interface StageLearningProject {
  id: string;
  sourceMode: 'external' | 'obsidian' | 'hybrid';
  outcome: 'understand' | 'compare' | 'apply' | 'build';
  priorKnowledge: 'new' | 'basic' | 'working' | 'advanced';
  knownContext?: string;
  successCriteria: string[];
  evidencePolicy: 'primary-first' | 'balanced';
  createdAt: string;
  updatedAt: string;
}

export interface StageLearningContext {
  /** Durable learning session that owns generation, study, review and deposition cycles. */
  learningSessionId?: string;
  /** Frozen canonical context pack used to generate this exact course release. */
  contextPackId?: string;
  /** Latest system-verified learner knowledge inherited into the frozen context. */
  knowledgeSnapshotId?: string;
  /** Durable, resumable generation job that produced this classroom. */
  generationJobId?: string;
  /** Private SourceBundle identifier when the classroom began in Obsidian. */
  sourceBundleId?: string;
  /** Durable project identifier shared by source sync, learning, and synthesis. */
  projectId?: string;
  /** Human-readable project name captured at classroom creation time. */
  projectName?: string;
  /** Project source revision used to build this classroom. */
  projectRevision?: number;
  /** Durable project retrieval run that selected the private source excerpts. */
  retrievalRunId?: string;
  /** Versioned retrieval strategy used for the selected project excerpts. */
  retrievalStrategy?: string;
  /** Number of distinct private project sources selected for generation. */
  retrievedSourceCount?: number;
  /** Number of private project chunks selected for generation. */
  retrievedChunkCount?: number;
  /** Heuristic quality of the goal-to-project evidence match. */
  retrievalMatchQuality?: 'strong' | 'weak';
  /** Project sources or candidate excerpts unavailable during frozen retrieval. */
  retrievalUnavailableSourceCount?: number;
  /** Coverage of the locally authorized project sources at retrieval time. */
  projectCoverageState?: 'authorized-index-complete' | 'authorized-index-partial';
  /** Frozen citation locators used to build this classroom. */
  retrievalCitations?: Array<{
    citationId: string;
    sourceId: string;
    sourceVersionId: string;
    chunkId: string;
    relativePath: string;
    headingPath: string[];
    excerptChars: number;
    contentHash: string;
  }>;
  /** The learner's stated objective for this classroom. */
  goal?: string;
  /** Stable learning-project contract shared by generation, classroom evidence, and synthesis. */
  learningProject?: StageLearningProject;
  /** Whether external research was requested during generation. */
  webSearchEnabled?: boolean;
  /** Whether external evidence was disabled, supplemental, or release-blocking. */
  externalEvidenceMode?: 'off' | 'supplemental' | 'required';
  /** Observable result of the external research preflight. */
  externalEvidenceStatus?: 'not-requested' | 'ready' | 'unavailable';
  /** Human-readable evidence boundary retained with the classroom. */
  externalEvidenceWarning?: string;
  /** Durable private citation-manifest identifier, when persistence succeeded. */
  researchRunId?: string;
  /** Search backend that actually supplied the grounded context. */
  researchProviderId?: string;
  /** Time at which the source list was retrieved. */
  researchFetchedAt?: string;
  /** Ranking policy used for the source list. */
  researchSourcePolicy?: 'balanced' | 'prefer-primary';
  /** Public citation metadata used by generation; source excerpts are not embedded here. */
  researchSources?: StageResearchSource[];
}

/**
 * Stage - Represents the entire classroom/course.
 */
export interface Stage {
  id: string;
  name: string;
  description?: string;
  createdAt: number;
  updatedAt: number;
  // Stage metadata
  languageDirective?: string;
  style?: string;
  // Whiteboard data
  whiteboard?: Whiteboard[];
  // Generated video requests keyed by the mediaRef used by PPTVideoElement.
  // Runtime media state lives in the media task store / persisted media files.
  videoManifest?: VideoManifest;
  // Agent IDs selected when this classroom was created
  agentIds?: string[];
  /**
   * Server-generated agent configurations. See {@link GeneratedAgentConfig}.
   */
  generatedAgentConfigs?: GeneratedAgentConfig[];
  /**
   * True when this classroom was generated with Interactive Mode enabled
   * (the INTERACTIVE_OUTLINES prompt branch).
   * Absent on legacy classrooms, imports, and regular-mode generations.
   */
  interactiveMode?: boolean;
  /**
   * True when this classroom was generated with the vocational Task Engine
   * path enabled. This is distinct from `interactiveMode`: task-engine
   * classrooms are interactive, but not every interactive classroom is
   * vocational.
   */
  taskEngineMode?: boolean;
  /** Learning provenance used by progress tracking and controlled writeback. */
  learningContext?: StageLearningContext;
}

/**
 * Slide content - PPTist Canvas data.
 *
 * `schemaVersion` tags the on-disk shape of this content so future schema
 * changes can ship behind a migration step (see the app's `migrateSlideContent`).
 * Optional for backward compatibility — legacy / pre-versioning data lacks the
 * field and the app normalizes it.
 */
export interface SlideContent {
  type: 'slide';
  schemaVersion?: number;
  // PPTist slide data structure
  canvas: Slide;
}

export interface QuizOption {
  label: string; // Display text
  value: string; // Selection key: "A", "B", "C", "D"
}

export interface QuizQuestion {
  id: string;
  type: 'single' | 'multiple' | 'short_answer';
  question: string;
  options?: QuizOption[];
  answer?: string[]; // Correct answer values: ["A"], ["A","C"], or undefined for text
  analysis?: string; // Explanation shown after grading
  commentPrompt?: string; // Grading guidance for text questions
  hasAnswer?: boolean; // Whether auto-grading is possible
  points?: number; // Points per question (default 1)
}

/**
 * Quiz content - React component props/data.
 */
export interface QuizContent {
  type: 'quiz';
  questions: QuizQuestion[];
}

/**
 * The universal scene-content kinds owned by the contract.
 *
 * App-specific kinds (interactive / pbl) are NOT members here: they carry
 * richer feature coupling (Ultra-mode widgets, PBL project configs) and stay in
 * the consuming app. Apps compose their full content union as
 * `SceneContent | InteractiveContent | PBLContent` and feed it to {@link Scene}'s
 * `TContent` parameter.
 */
export type SceneContent = SlideContent | QuizContent;

/**
 * The content-kind-independent fields of a {@link Scene}. Everything except the
 * `type` discriminant and the `content` payload, which {@link Scene} binds
 * together per kind.
 */
export interface SceneCore<TAction = Action> {
  id: string;
  stageId: string; // ID of the parent stage (for data integrity checks)
  title: string;
  order: number; // Display order

  // Actions to execute during playback (app-injected)
  actions?: TAction[];

  // Whiteboards to explain deeply
  whiteboards?: Slide[];

  // Multi-agent discussion configuration
  multiAgent?: MultiAgentConfig;

  // Metadata
  createdAt?: number;
  updatedAt?: number;
}

/**
 * Scene - Represents a single page/scene in the course.
 *
 * The scene-level `type` discriminant is **bound to its `content`**: a
 * slide-typed scene must carry `SlideContent`, a quiz-typed scene `QuizContent`,
 * and so on. This is a real invariant — consumers branch on `scene.type` and
 * then read `scene.content` as the matching shape — so the contract enforces it
 * at the type level rather than leaving the two free to disagree.
 *
 * Implemented as a distributive conditional over `TContent`: the binding holds
 * per member of the content union, so the default `Scene<Action, SlideContent |
 * QuizContent>` is `({ type: 'slide'; content: SlideContent } | { type: 'quiz';
 * content: QuizContent }) & SceneCore`, and an app can still widen `TContent`
 * with its own content kinds — each new kind ties its own `type` to its shape.
 *
 * ```ts
 * // app side — widen content; widen actions only if the app adds its own
 * type AppScene = Scene<Action, AppSceneContent>;
 * ```
 *
 * Skeleton-only consumers that reject actions entirely can still opt out with
 * `Scene<never, …>`.
 *
 * @template TAction  - The playback action type (defaults to the standard {@link Action} union).
 * @template TContent - The scene-content union; any object union tagged with a
 *                      `type: {@link SceneType}` discriminant (defaults to the
 *                      two universal kinds). Each member binds its own `type`.
 */
export type Scene<
  TAction = Action,
  TContent extends { type: SceneType } = SlideContent | QuizContent,
> = TContent extends unknown
  ? SceneCore<TAction> & { type: TContent['type']; content: TContent }
  : never;

// ---------------------------------------------------------------------------
// Pure discriminant guards
// ---------------------------------------------------------------------------

/**
 * Narrow a candidate to {@link SlideContent}. Accepts any value tagged with a
 * `type: SceneType` discriminant — including an app-widened content union that
 * adds interactive / pbl kinds beyond the contract's universal two.
 * Pure, no runtime deps.
 */
export function isSlideContent<T extends { type: SceneType }>(
  content: T,
): content is T & SlideContent {
  return content.type === 'slide';
}

/**
 * Narrow a candidate to {@link QuizContent}. Accepts any value tagged with a
 * `type: SceneType` discriminant — including an app-widened content union that
 * adds interactive / pbl kinds beyond the contract's universal two.
 * Pure, no runtime deps.
 */
export function isQuizContent<T extends { type: SceneType }>(
  content: T,
): content is T & QuizContent {
  return content.type === 'quiz';
}
