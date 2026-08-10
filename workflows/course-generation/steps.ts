import { NextRequest } from 'next/server';
import { FatalError, RetryableError } from 'workflow';
import { POST as runWebSearch } from '@/lib/server/api-routes/web-search/handler';
import { POST as runOutlineGeneration } from '@/lib/server/api-routes/generate/scene-outlines-stream/handler';
import { externalEvidenceRequested, resolveExternalEvidenceMode } from '@/lib/generation/external-evidence-policy';
import { getCoursePlanningService } from '@/lib/generation/planning/service';
import { getCourseGenerationService } from '@/lib/generation/orchestration/service';
import { processCourseGenerationStep } from '@/lib/generation/orchestration/worker';
import type {
  CoursePlanningModelPreference,
  CoursePlanningRunRecord,
  CoursePlanningRunView,
} from '@/lib/generation/planning/types';
import type { CourseGenerationJobInput } from '@/lib/generation/orchestration/types';
import type { LearningSourceReference } from '@/lib/learning/domain/learning-context-pack';
import type { WebSearchProvenance, WebSearchSource } from '@/lib/types/web-search';
import type { Stage } from '@/lib/types/stage';

interface ApiErrorPayload {
  success?: boolean;
  errorCode?: string;
  error?: string;
  details?: string;
}

interface WebSearchPayload {
  success?: boolean;
  context?: string;
  sources?: WebSearchSource[];
  provenance?: WebSearchProvenance;
  degraded?: boolean;
  warning?: string;
  warningCode?: string;
  errorCode?: string;
  error?: string;
  details?: string;
}

interface OutlineEvent {
  type?: string;
  error?: string;
  retryable?: boolean;
  reason?: string;
  outlines?: unknown[];
}

export interface PreparedCoursePlan {
  planningRunId: string;
  phase: CoursePlanningRunView['phase'];
  sourceCount: number;
  sourceChars: number;
}

export interface CourseWorkflowJobState {
  jobId: string;
  classroomId: string;
  status: 'queued' | 'running' | 'verifying' | 'ready' | 'failed' | 'cancelled';
  phase: 'content' | 'actions' | 'release' | 'completed' | 'failed';
  progress: number;
  errorCode?: string;
  errorDetail?: string;
}

function boundedOrigin(baseUrl: string): string {
  const parsed = new URL(baseUrl);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new FatalError('course_workflow_invalid_base_url');
  }
  return parsed.origin;
}

function apiErrorMessage(payload: ApiErrorPayload, fallback: string): string {
  return [payload.errorCode, payload.error, payload.details].filter(Boolean).join(': ') || fallback;
}

function workflowRequest(
  baseUrl: string,
  pathname: string,
  body: Record<string, unknown>,
  modelPreference?: CoursePlanningModelPreference,
): NextRequest {
  // The browser credential must never be persisted or replayed by a durable
  // workflow. The already-frozen model *identity* and thinking preference are
  // safe to carry forward, however. Without them, a later workflow step can
  // lose the user's selected server model when DEFAULT_MODEL is intentionally
  // unset, turning an otherwise valid search/outline operation into a retry.
  const payload = {
    ...body,
    ...(modelPreference?.thinkingConfig ? { thinkingConfig: modelPreference.thinkingConfig } : {}),
  };
  return new NextRequest(new URL(pathname, boundedOrigin(baseUrl)), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(modelPreference?.modelString ? { 'x-model': modelPreference.modelString } : {}),
    },
    body: JSON.stringify(payload),
  });
}

function searchReference(source: WebSearchSource, index: number): LearningSourceReference {
  return {
    kind: 'public-source',
    id: source.citationId?.trim() || `S${index + 1}`,
    locator: source.url,
    authority:
      source.authority === 'primary' || source.authority === 'authoritative'
        ? source.authority
        : 'general',
    included: true,
    reason: 'Authoritative external evidence frozen by the durable course workflow.',
  };
}

function mergeReferences(
  existing: readonly LearningSourceReference[],
  sources: readonly WebSearchSource[],
): LearningSourceReference[] {
  const merged = new Map<string, LearningSourceReference>();
  for (const reference of existing) {
    merged.set(`${reference.kind}:${reference.locator ?? reference.id}`, { ...reference });
  }
  sources.forEach((source, index) => {
    const reference = searchReference(source, index);
    merged.set(`${reference.kind}:${reference.locator ?? reference.id}`, reference);
  });
  return [...merged.values()];
}

function retryableSearchStatus(status: number, errorCode?: string): boolean {
  return (
    status === 408 ||
    status === 409 ||
    status === 429 ||
    status >= 500 ||
    errorCode === 'RATE_LIMITED' ||
    errorCode === 'UPSTREAM_ERROR' ||
    errorCode === 'INTERNAL_ERROR'
  );
}

export async function prepareCoursePlanningStep(
  planningRunId: string,
  baseUrl: string,
): Promise<PreparedCoursePlan> {
  'use step';

  const planning = getCoursePlanningService();
  const run = await planning.find(planningRunId);
  if (!run) throw new FatalError('course_planning_run_not_found');

  if ((run.status === 'ready' || run.status === 'consumed') && run.outlines?.length) {
    return {
      planningRunId,
      phase: 'outline',
      sourceCount: run.input.sourceReferences.filter((reference) => reference.included).length,
      sourceChars: run.preflight.metrics.suppliedChars,
    };
  }

  const mode = resolveExternalEvidenceMode(run.input.requirements);
  const needsResearch =
    externalEvidenceRequested(run.input.requirements) &&
    (run.input.requirements.externalEvidenceStatus !== 'ready' || !run.input.researchText.trim());

  if (!needsResearch) {
    if (!run.preflight.ready) {
      throw new FatalError(
        run.preflight.issues.find((issue) => issue.severity === 'blocker')?.detail ||
          'course_source_preflight_failed',
      );
    }
    await planning.updateWorkflowPhase(planningRunId, 'outline', 'running');
    return {
      planningRunId,
      phase: 'outline',
      sourceCount: run.input.sourceReferences.filter((reference) => reference.included).length,
      sourceChars: run.preflight.metrics.suppliedChars,
    };
  }

  await planning.updateWorkflowPhase(planningRunId, 'research', 'running');
  const response = await runWebSearch(
    workflowRequest(baseUrl, '/api/web-search', {
      query: run.input.requirements.requirement,
      pdfText: run.input.documentText,
      // Let the server select its configured provider chain. Pinning every
      // durable workflow to Tavily made a healthy alternate provider unusable.
      sourcePolicy:
        run.input.requirements.learningProject?.evidencePolicy === 'balanced'
          ? 'balanced'
          : 'prefer-primary',
      externalEvidenceMode: mode,
    }, run.input.generationModel),
  );
  const payload = (await response.json().catch(() => ({}))) as WebSearchPayload;
  if (!response.ok || payload.success !== true) {
    const detail = apiErrorMessage(payload, `external_research_failed_${response.status}`);
    if (retryableSearchStatus(response.status, payload.errorCode)) {
      throw new RetryableError(detail, {
        retryAfter: response.status === 429 ? '30s' : '10s',
      });
    }
    throw new FatalError(detail);
  }

  const sources = Array.isArray(payload.sources) ? payload.sources : [];
  const researchText = typeof payload.context === 'string' ? payload.context.trim() : '';
  if (mode === 'required' && (sources.length === 0 || researchText.length < 1_200)) {
    throw new FatalError('required_external_evidence_did_not_return_a_deep_source_set');
  }

  const warning = payload.warning?.trim();
  const requirements = {
    ...run.input.requirements,
    externalEvidenceMode: mode,
    externalEvidenceStatus: sources.length > 0 ? ('ready' as const) : ('unavailable' as const),
    ...(warning ? { externalEvidenceWarning: warning } : {}),
  };
  const updated = await planning.completeResearch({
    planningRunId,
    requirements,
    researchText,
    sourceReferences: mergeReferences(run.input.sourceReferences, sources),
  });
  await planning.updateWorkflowPhase(planningRunId, 'outline', 'running');
  return {
    planningRunId,
    phase: 'outline',
    sourceCount: updated.input.sourceReferences.filter((reference) => reference.included).length,
    sourceChars: updated.preflight.metrics.suppliedChars,
  };
}

prepareCoursePlanningStep.maxRetries = 2;

function parseOutlineEvents(text: string): OutlineEvent[] {
  const events: OutlineEvent[] = [];
  for (const line of text.split(/\r?\n/u)) {
    if (!line.startsWith('data:')) continue;
    const raw = line.slice(5).trim();
    if (!raw) continue;
    try {
      events.push(JSON.parse(raw) as OutlineEvent);
    } catch {
      // Heartbeats and incomplete transport fragments are ignored. The final
      // persisted planning state remains the source of truth.
    }
  }
  return events;
}

export async function generateCourseOutlineStep(
  planningRunId: string,
  baseUrl: string,
): Promise<{ planningRunId: string; outlineCount: number }> {
  'use step';

  const planning = getCoursePlanningService();
  const current = await planning.find(planningRunId);
  if (!current) throw new FatalError('course_planning_run_not_found');
  if ((current.status === 'ready' || current.status === 'consumed') && current.outlines?.length) {
    return { planningRunId, outlineCount: current.outlines.length };
  }

  await planning.updateWorkflowPhase(planningRunId, 'outline', 'running');
  const response = await runOutlineGeneration(
    workflowRequest(baseUrl, '/api/generate/scene-outlines-stream', {
      planningRunId,
      outlineAttemptMode: 'single',
      enforceQualityContract: true,
      outlineRepairFeedback: current.lastErrorDetail,
    }, current.input.generationModel),
  );
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as ApiErrorPayload;
    const detail = apiErrorMessage(payload, `outline_generation_failed_${response.status}`);
    if (response.status === 408 || response.status === 409 || response.status === 429 || response.status >= 500) {
      throw new RetryableError(detail, { retryAfter: response.status === 429 ? '30s' : '5s' });
    }
    throw new FatalError(detail);
  }

  const events = parseOutlineEvents(await response.text());
  const errorEvent = [...events].reverse().find((event) => event.type === 'error');
  const doneEvent = [...events].reverse().find((event) => event.type === 'done');
  const persisted = await planning.find(planningRunId);
  if (doneEvent && persisted?.outlines?.length) {
    return { planningRunId, outlineCount: persisted.outlines.length };
  }
  const detail =
    errorEvent?.error || persisted?.lastErrorDetail || 'outline_generation_did_not_persist_a_result';
  if (persisted && persisted.attemptCount >= persisted.maxAttempts) {
    throw new FatalError(detail);
  }
  throw new Error(detail);
}

generateCourseOutlineStep.maxRetries = 2;

function stageForPlan(run: CoursePlanningRunRecord): Stage {
  const now = Date.now();
  const name = (run.courseTitle || run.input.requirements.requirement).trim().slice(0, 120);
  const externalEvidenceMode = resolveExternalEvidenceMode(run.input.requirements);
  return {
    id: `course_${run.id.slice(4)}`,
    name: name || '知洄学习课堂',
    description: '由知洄后台持久化工作流生成并通过发布质量门。',
    style: 'professional',
    createdAt: now,
    updatedAt: now,
    languageDirective: run.languageDirective,
    interactiveMode: run.input.requirements.interactiveMode === true,
    taskEngineMode: run.taskEngineMode,
    learningContext: {
      learningSessionId: run.sessionId,
      contextPackId: run.contextPackId,
      sourceBundleId: run.input.sourceBundleId,
      projectId: run.input.projectId,
      retrievalRunId: run.input.retrievalRunId,
      goal: run.input.requirements.requirement,
      learningProject: run.input.requirements.learningProject,
      webSearchEnabled: externalEvidenceRequested(run.input.requirements),
      externalEvidenceMode,
      externalEvidenceStatus:
        run.input.requirements.externalEvidenceStatus ??
        (externalEvidenceMode === 'off' ? 'not-requested' : undefined),
      externalEvidenceWarning: run.input.requirements.externalEvidenceWarning,
    },
  };
}

export async function createCourseJobStep(
  planningRunId: string,
  baseUrl: string,
): Promise<CourseWorkflowJobState> {
  'use step';

  const planning = getCoursePlanningService();
  const existing = await planning.view(planningRunId);
  if (existing?.courseJob) {
    return {
      jobId: existing.courseJob.id,
      classroomId: existing.courseJob.classroomId,
      status: existing.courseJob.status,
      phase: existing.courseJob.phase,
      progress: existing.courseJob.progress,
      ...(existing.error
        ? { errorCode: existing.error.code, errorDetail: existing.error.detail }
        : {}),
    };
  }

  const run = await planning.find(planningRunId);
  if (!run || run.status !== 'ready' || !run.outlines?.length) {
    throw new FatalError(`course_planning_run_not_ready:${run?.status ?? 'missing'}`);
  }
  const context = await planning.compileContext(run);
  const jobInput: CourseGenerationJobInput = {
    planningRunId,
    stage: stageForPlan(run),
    outlines: run.outlines,
    requirements: run.input.requirements,
    sourceContext: context.sourceText,
    ...(context.learnerKnowledgeText
      ? { learnerKnowledgeContext: context.learnerKnowledgeText }
      : {}),
    sourceMode: run.input.sourceMode,
    sourceReferences: run.input.sourceReferences,
    languageDirective: run.languageDirective,
    baseUrl: boundedOrigin(baseUrl),
  };
  const created = await getCourseGenerationService().create({
    jobInput,
    idempotencyKey: `course:${planningRunId}:workflow-v2`,
  });
  await planning.updateWorkflowPhase(planningRunId, 'content', 'running');
  return {
    jobId: created.job.id,
    classroomId: created.job.classroomId,
    status: created.job.status,
    phase: created.job.currentPhase,
    progress: created.job.progress,
  };
}

createCourseJobStep.maxRetries = 2;

export async function advanceCourseJobStep(
  planningRunId: string,
  jobId: string,
): Promise<CourseWorkflowJobState & { outcome: 'advanced' | 'ready' | 'failed' | 'idle' }> {
  'use step';

  const result = await processCourseGenerationStep(jobId);
  const service = getCourseGenerationService();
  const job = await service.find(jobId);
  if (!job) throw new FatalError('course_generation_job_not_found');
  const planning = getCoursePlanningService();
  const workflowPhase =
    job.status === 'ready'
      ? 'completed'
      : job.status === 'failed' || job.status === 'cancelled'
        ? 'failed'
        : job.currentPhase;
  await planning.updateWorkflowPhase(
    planningRunId,
    workflowPhase,
    job.status === 'ready'
      ? 'completed'
      : job.status === 'failed' || job.status === 'cancelled'
        ? 'failed'
        : 'running',
  );
  return {
    jobId: job.id,
    classroomId: job.classroomId,
    status: job.status,
    phase: job.currentPhase,
    progress: job.progress,
    outcome: result.outcome,
    ...(job.lastErrorCode ? { errorCode: job.lastErrorCode } : {}),
    ...(job.lastErrorDetail ? { errorDetail: job.lastErrorDetail } : {}),
  };
}

advanceCourseJobStep.maxRetries = 2;

export async function failCourseWorkflowStep(
  planningRunId: string,
  errorCode: string,
  errorDetail: string,
): Promise<void> {
  'use step';
  await getCoursePlanningService().failWorkflow({
    planningRunId,
    errorCode,
    errorDetail,
  });
}

failCourseWorkflowStep.maxRetries = 4;
