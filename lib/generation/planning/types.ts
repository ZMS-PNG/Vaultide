import type { CoursePlanningPreflight } from './preflight';
import type { LearningSourceReference } from '@/lib/learning/domain/learning-context-pack';
import type { ThinkingConfig } from '@/lib/types/provider';
import type { SceneOutline, UserRequirements } from '@/lib/types/generation';

export type CoursePlanningRunStatus =
  | 'frozen'
  | 'outlining'
  | 'ready'
  | 'failed'
  | 'consumed'
  | 'cancelled';

export type CourseWorkflowStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type CourseWorkflowPhase =
  | 'preflight'
  | 'research'
  | 'outline'
  | 'content'
  | 'actions'
  | 'release'
  | 'completed'
  | 'failed';

/**
 * The durable workflow may outlive the browser request.  Persist only the
 * non-secret model choice needed to reproduce the course; API keys and custom
 * base URLs must never enter the planning record.
 */
export interface CoursePlanningModelPreference {
  modelString: string;
  thinkingConfig?: ThinkingConfig;
}

export interface CoursePlanningInput {
  clientSessionId: string;
  requirements: UserRequirements;
  sourceMode: 'external' | 'obsidian' | 'hybrid';
  sourceReferences: LearningSourceReference[];
  documentText: string;
  researchText: string;
  sourceContextExpectedChars?: number;
  sourceBundleId?: string;
  projectId?: string;
  retrievalRunId?: string;
  generationModel?: CoursePlanningModelPreference;
}

export interface CoursePlanningRunRecord {
  id: string;
  ownerId: string;
  sessionId: string;
  contextPackId: string;
  idempotencyKey: string;
  status: CoursePlanningRunStatus;
  input: CoursePlanningInput;
  preflight: CoursePlanningPreflight;
  outlines?: SceneOutline[];
  languageDirective?: string;
  courseTitle?: string;
  taskEngineMode: boolean;
  attemptCount: number;
  maxAttempts: number;
  leaseToken?: string;
  leaseExpiresAt?: Date;
  lastErrorCode?: string;
  lastErrorDetail?: string;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
  workflowRunId?: string;
  workflowStatus: CourseWorkflowStatus;
  workflowPhase: CourseWorkflowPhase;
  workflowStartedAt?: Date;
  workflowCompletedAt?: Date;
}

export interface CoursePlanningRunView {
  id: string;
  status: CoursePlanningRunStatus;
  phase:
    | 'preflight'
    | 'research'
    | 'outline'
    | 'content'
    | 'actions'
    | 'release'
    | 'ready'
    | 'failed'
    | 'consumed';
  attemptCount: number;
  maxAttempts: number;
  preflight: CoursePlanningPreflight;
  input: CoursePlanningInput;
  outlines?: SceneOutline[];
  languageDirective?: string;
  courseTitle?: string;
  taskEngineMode: boolean;
  executionMode: 'workflow' | 'legacy';
  workflow?: {
    runId?: string;
    status: CourseWorkflowStatus;
    phase: CourseWorkflowPhase;
    startedAt?: string;
    completedAt?: string;
  };
  courseJob?: {
    id: string;
    classroomId: string;
    status: 'queued' | 'running' | 'verifying' | 'ready' | 'failed' | 'cancelled';
    phase: 'content' | 'actions' | 'release' | 'completed' | 'failed';
    progress: number;
    updatedAt: string;
  };
  error?: {
    code: string;
    detail: string;
    retryable: boolean;
  };
  updatedAt: string;
}

export interface CoursePlanningLease {
  run: CoursePlanningRunRecord;
  leaseToken?: string;
  reusedReadyResult: boolean;
}
