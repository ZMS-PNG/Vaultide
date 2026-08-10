import type { CourseQualityAssessment } from '@/lib/generation/course-quality';
import type {
  ImageMapping,
  PdfImage,
  SceneOutline,
  UserRequirements,
} from '@/lib/types/generation';
import type { Scene, Stage } from '@/lib/types/stage';
import type { FrozenCourseGenerationPolicy } from './model-policy';

export type CourseGenerationJobStatus =
  | 'queued'
  | 'running'
  | 'verifying'
  | 'ready'
  | 'failed'
  | 'cancelled';

export type CourseGenerationPhase = 'content' | 'actions' | 'release' | 'completed' | 'failed';
export type CourseGenerationStepPhase = 'content' | 'actions' | 'release';
export type CourseGenerationStepStatus =
  | 'pending'
  | 'leased'
  | 'succeeded'
  | 'retryable'
  | 'failed'
  | 'cancelled';

export interface CourseGenerationJobInput {
  /** Durable planning run created before the first outline LLM call. */
  planningRunId?: string;
  stage: Stage;
  outlines: SceneOutline[];
  requirements: UserRequirements;
  sourceContext: string;
  /**
   * Verified learner state inherited from an immutable knowledge snapshot.
   * This adapts teaching and review, but is never canonical factual evidence.
   */
  learnerKnowledgeContext?: string;
  sourceMode: 'external' | 'obsidian' | 'hybrid';
  sourceReferences: Array<{
    kind: 'obsidian-source' | 'public-source' | 'uploaded-document' | 'learner-evidence';
    id: string;
    versionId?: string;
    locator?: string;
    contentHash?: string;
    authority?: 'primary' | 'authoritative' | 'general' | 'private-original';
    included: boolean;
  }>;
  pdfImages?: PdfImage[];
  imageMapping?: ImageMapping;
  agents?: Array<{
    id: string;
    name: string;
    role: string;
    persona?: string;
  }>;
  userProfile?: string;
  languageDirective?: string;
  baseUrl: string;
  generationPolicy?: FrozenCourseGenerationPolicy;
}

export interface CourseGenerationJobRecord {
  id: string;
  ownerId: string;
  sessionId: string;
  contextPackId: string;
  planningRunId?: string;
  classroomId: string;
  idempotencyKey: string;
  status: CourseGenerationJobStatus;
  currentPhase: CourseGenerationPhase;
  currentSceneOrder?: number;
  outlineCount: number;
  scenesGenerated: number;
  progress: number;
  input: CourseGenerationJobInput;
  qualitySummary?: CourseQualityAssessment;
  queueMessageId?: string;
  lastErrorCode?: string;
  lastErrorDetail?: string;
  createdAt: Date;
  updatedAt: Date;
  startedAt?: Date;
  completedAt?: Date;
}

export interface CourseGenerationStepRecord {
  id: string;
  ownerId: string;
  jobId: string;
  sceneOrder: number;
  phase: CourseGenerationStepPhase;
  status: CourseGenerationStepStatus;
  attemptCount: number;
  maxAttempts: number;
  inputHash: string;
  result?: Record<string, unknown>;
  quality?: CourseQualityAssessment;
  leaseToken?: string;
  leaseExpiresAt?: Date;
  lastErrorCode?: string;
  lastErrorDetail?: string;
  createdAt: Date;
  updatedAt: Date;
  startedAt?: Date;
  completedAt?: Date;
}

export interface CourseGenerationAttemptRecord {
  id: string;
  ownerId: string;
  jobId: string;
  stepId: string;
  attemptNo: number;
  status: 'running' | 'succeeded' | 'rejected' | 'failed';
  inputHash: string;
  qualityScore?: number;
  errorCode?: string;
  errorDetail?: string;
  startedAt: Date;
  completedAt?: Date;
}

export interface CourseReleaseRecord {
  id: string;
  ownerId: string;
  jobId: string;
  classroomId: string;
  releaseVersion: number;
  outlineCount: number;
  sceneCount: number;
  qualityScore: number;
  quality: CourseQualityAssessment;
  snapshotSha256: string;
  createdAt: Date;
}

export interface CourseGenerationJobView {
  id: string;
  classroomId: string;
  status: CourseGenerationJobStatus;
  phase: CourseGenerationPhase;
  progress: number;
  scenesGenerated: number;
  outlineCount: number;
  currentSceneOrder?: number;
  message: string;
  quality?: CourseQualityAssessment;
  release?: {
    classroomId: string;
    url: string;
    sceneCount: number;
    qualityScore: number;
  };
  error?: {
    code: string;
    detail: string;
    retryable: boolean;
  };
  updatedAt: string;
}

export interface SceneContentStepResult {
  content: Record<string, unknown>;
  effectiveOutline: SceneOutline;
  quality: CourseQualityAssessment;
}

export interface SceneActionsStepResult {
  scene: Scene;
  previousSpeeches: string[];
  quality: CourseQualityAssessment;
}
