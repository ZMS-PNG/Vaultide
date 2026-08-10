import type { GenerationSessionState } from './types';
import { projectRetrievalStorageKey } from '@/lib/learning/client/project-retrieval-cache';

export const GENERATION_RECOVERY_STORAGE_KEY = 'vaultide:generation-recovery:v1';

const RECOVERY_SCHEMA_VERSION = 1;
const RECOVERY_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const COURSE_JOB_ID = /^cgj_[a-f0-9]{32}$/;
const COURSE_PLAN_ID = /^cpl_[a-f0-9]{32}$/;

interface StoredGenerationRecovery {
  schemaVersion: typeof RECOVERY_SCHEMA_VERSION;
  savedAt: string;
  session: GenerationSessionState;
}

interface StoredProjectRetrievalContext {
  goal?: unknown;
  savedAt?: unknown;
  retrieval?: {
    retrievalId?: unknown;
    context?: unknown;
    project?: {
      projectId?: unknown;
      projectRevision?: unknown;
    };
    metrics?: {
      contextCharCount?: unknown;
    };
  };
}

export interface GenerationSourceRecoveryResult {
  session: GenerationSessionState;
  recovered: boolean;
  expectedChars: number;
  actualChars: number;
  missingExpectedContext: boolean;
}

function sourceChars(value: unknown): number {
  return String(value ?? '')
    .replace(/\s+/gu, ' ')
    .trim().length;
}

function expectedProjectSourceChars(session: GenerationSessionState): number {
  const recorded =
    typeof session.sourceContextCharCount === 'number' &&
    Number.isFinite(session.sourceContextCharCount)
      ? Math.max(0, Math.floor(session.sourceContextCharCount))
      : 0;
  const cited = (session.retrievalCitations ?? []).reduce(
    (total, citation) =>
      total + (Number.isFinite(citation.excerptChars) ? Math.max(0, citation.excerptChars) : 0),
    0,
  );
  return Math.max(recorded, cited);
}

/**
 * Rehydrate a reviewed project source set from the tab-scoped retrieval cache
 * when a refresh or failed attempt left generationSession with a truncated
 * source body. Exact retrieval/project/revision checks prevent stale material
 * from being mixed into a newer project.
 */
export function recoverGenerationSourceContext(
  storage: Storage,
  session: GenerationSessionState,
): GenerationSourceRecoveryResult {
  const actualChars = sourceChars(session.pdfText);
  const expectedChars = expectedProjectSourceChars(session);
  const expectsProjectContext =
    typeof session.retrievalRunId === 'string' &&
    session.retrievalRunId.length > 0 &&
    expectedChars >= 1_200;

  if (!expectsProjectContext || actualChars >= 1_200) {
    return {
      session,
      recovered: false,
      expectedChars,
      actualChars,
      missingExpectedContext: expectsProjectContext && actualChars < 1_200,
    };
  }

  if (!session.sourceBundleId) {
    return {
      session,
      recovered: false,
      expectedChars,
      actualChars,
      missingExpectedContext: true,
    };
  }

  try {
    const raw = storage.getItem(projectRetrievalStorageKey(session.sourceBundleId));
    if (!raw) throw new Error('Project retrieval cache is unavailable.');
    const stored = JSON.parse(raw) as StoredProjectRetrievalContext;
    const retrieval = stored.retrieval;
    const context = typeof retrieval?.context === 'string' ? retrieval.context : '';
    const cachedChars = sourceChars(context);
    const cachedMetric =
      typeof retrieval?.metrics?.contextCharCount === 'number' &&
      Number.isFinite(retrieval.metrics.contextCharCount)
        ? Math.max(0, Math.floor(retrieval.metrics.contextCharCount))
        : 0;
    const sameGoal =
      typeof stored.goal !== 'string' ||
      stored.goal.trim() === session.requirements.requirement.trim();
    const sameRetrieval = retrieval?.retrievalId === session.retrievalRunId;
    const sameProject = !session.projectId || retrieval?.project?.projectId === session.projectId;
    const sameRevision =
      session.projectRevision === undefined ||
      retrieval?.project?.projectRevision === session.projectRevision;
    const cacheIsComplete =
      cachedChars >= 1_200 &&
      (cachedMetric === 0 || context.length >= Math.floor(cachedMetric * 0.95));

    if (!sameGoal || !sameRetrieval || !sameProject || !sameRevision || !cacheIsComplete) {
      throw new Error('Project retrieval cache does not match the reviewed source set.');
    }

    const recoveredSession: GenerationSessionState = {
      ...session,
      pdfText: context,
      sourceContextCharCount: Math.max(context.length, cachedMetric, expectedChars),
    };
    return {
      session: recoveredSession,
      recovered: true,
      expectedChars: Math.max(expectedChars, cachedMetric),
      actualChars: sourceChars(context),
      missingExpectedContext: false,
    };
  } catch {
    return {
      session,
      recovered: false,
      expectedChars,
      actualChars,
      missingExpectedContext: true,
    };
  }
}

/**
 * Keep only the metadata required to reconnect to a server-owned course job.
 * Source documents, extracted text, provider credentials, and media blobs stay
 * out of persistent browser storage.
 */
export function buildGenerationRecoverySession(
  session: GenerationSessionState,
): GenerationSessionState | null {
  const validJobId = Boolean(session.courseJobId && COURSE_JOB_ID.test(session.courseJobId));
  const validPlanId = Boolean(session.coursePlanId && COURSE_PLAN_ID.test(session.coursePlanId));
  if (!validJobId && !validPlanId) return null;

  return {
    sessionId: session.sessionId,
    sourceBundleId: session.sourceBundleId,
    projectId: session.projectId,
    projectName: session.projectName,
    projectRevision: session.projectRevision,
    retrievalRunId: session.retrievalRunId,
    retrievalStrategy: session.retrievalStrategy,
    retrievedSourceCount: session.retrievedSourceCount,
    retrievedChunkCount: session.retrievedChunkCount,
    retrievalMatchQuality: session.retrievalMatchQuality,
    retrievalUnavailableSourceCount: session.retrievalUnavailableSourceCount,
    projectCoverageState: session.projectCoverageState,
    retrievalCitations: session.retrievalCitations,
    requirements: session.requirements,
    pdfText: '',
    sourceContextCharCount: session.sourceContextCharCount,
    sceneOutlines: session.sceneOutlines,
    currentStep: 'generating',
    previewPhase:
      validJobId
        ? session.previewPhase === 'verifying-release'
          ? 'verifying-release'
          : 'durable-generating'
        : session.sceneOutlines?.length
          ? 'generating-content'
          : 'preparing',
    coursePlanId: session.coursePlanId,
    courseJobId: session.courseJobId,
    courseClassroomId: session.courseClassroomId,
    courseQueueMode: session.courseQueueMode,
    courseJobProgress: session.courseJobProgress,
    courseJobUpdatedAt: session.courseJobUpdatedAt,
    languageDirective: session.languageDirective,
    courseTitle: session.courseTitle,
    taskEngineMode: session.taskEngineMode,
  };
}

export function persistGenerationRecoverySession(
  storage: Storage,
  session: GenerationSessionState,
  now = new Date(),
): void {
  const recoverySession = buildGenerationRecoverySession(session);
  if (!recoverySession) return;

  const stored: StoredGenerationRecovery = {
    schemaVersion: RECOVERY_SCHEMA_VERSION,
    savedAt: now.toISOString(),
    session: recoverySession,
  };
  storage.setItem(GENERATION_RECOVERY_STORAGE_KEY, JSON.stringify(stored));
}

export function loadGenerationRecoverySession(
  storage: Storage,
  now = new Date(),
): GenerationSessionState | null {
  const raw = storage.getItem(GENERATION_RECOVERY_STORAGE_KEY);
  if (!raw) return null;

  try {
    const stored = JSON.parse(raw) as Partial<StoredGenerationRecovery>;
    const savedAt = Date.parse(stored.savedAt ?? '');
    const recovered = stored.session;
    if (
      stored.schemaVersion !== RECOVERY_SCHEMA_VERSION ||
      !Number.isFinite(savedAt) ||
      now.getTime() - savedAt > RECOVERY_MAX_AGE_MS ||
      !recovered ||
      typeof recovered.sessionId !== 'string' ||
      recovered.sessionId.length === 0 ||
      !recovered.requirements ||
      typeof recovered.requirements !== 'object' ||
      ((!recovered.courseJobId || !COURSE_JOB_ID.test(recovered.courseJobId)) &&
        (!recovered.coursePlanId || !COURSE_PLAN_ID.test(recovered.coursePlanId)))
    ) {
      throw new Error('Invalid durable generation recovery record.');
    }
    return {
      ...recovered,
      pdfText: '',
      currentStep: 'generating',
      previewPhase: recovered.courseJobId
        ? recovered.previewPhase === 'verifying-release'
          ? 'verifying-release'
          : 'durable-generating'
        : recovered.sceneOutlines?.length
          ? 'generating-content'
          : 'preparing',
    };
  } catch {
    storage.removeItem(GENERATION_RECOVERY_STORAGE_KEY);
    return null;
  }
}

export function clearGenerationRecoverySession(storage: Storage): void {
  storage.removeItem(GENERATION_RECOVERY_STORAGE_KEY);
}
