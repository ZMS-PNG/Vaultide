'use client';

import { useEffect, useMemo, useState, Suspense, useRef, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'motion/react';
import { CheckCircle2, Sparkles, AlertCircle, AlertTriangle, ArrowLeft, Bot } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { OutlinesEditor } from '@/components/generation/outlines-editor';
import { cn } from '@/lib/utils';
import { useSettingsStore } from '@/lib/store/settings';
import { useAgentRegistry } from '@/lib/orchestration/registry/store';
import { getEnabledProvidersWithVoices } from '@/lib/audio/voice-resolver';
import { useVoxCPMVoiceProfiles } from '@/lib/audio/voxcpm-voices';
import { useI18n } from '@/lib/hooks/use-i18n';
import { isAbortError } from '@/lib/generation/generation-retry';
import {
  COURSE_JOB_ADVANCE_COOLDOWN_MS,
  COURSE_JOB_TRANSPORT_RECOVERY_DELAY_MS,
  isTransientCourseJobTransportError,
} from '@/lib/generation/orchestration/client-recovery';
import {
  loadImageMapping,
  loadDocumentBlob,
  cleanupOldImages,
  storeImages,
} from '@/lib/utils/image-storage';
import { getCurrentModelConfig } from '@/lib/utils/model-config';
import { MAX_VISION_IMAGES } from '@/lib/constants/generation';
import {
  MAX_DOCUMENT_BUNDLE_FILES,
  MAX_DOCUMENT_BUNDLE_TOTAL_SIZE_BYTES,
  buildDocumentBundle,
  type ParsedDocumentPart,
} from '@/lib/document/bundle';
import { buildVideoManifestFromOutlines } from '@/lib/media/video-manifest';
import { nanoid } from 'nanoid';
import type { GeneratedAgentConfig, Stage } from '@/lib/types/stage';
import type {
  SceneOutline,
  PdfImage,
  ImageMapping,
  SessionDocumentSource,
} from '@/lib/types/generation';
import { AgentRevealModal } from '@/components/agent/agent-reveal-modal';
import { createLogger } from '@/lib/logger';
import {
  type GenerationSessionState,
  ALL_STEPS,
  getActiveSteps,
  getGenerationStepText,
} from './types';
import { StepVisualizer } from './components/visualizers';
import { resolveTaskEngineModeFromOutlineDoneEvent } from './vocational-mode';
import { mergeCourseSourceContext } from '@/lib/generation/source-context';
import { describeOutlineReleaseViolation } from '@/lib/generation/outline-release-contract';
import type {
  CourseGenerationJobInput,
  CourseGenerationJobView,
} from '@/lib/generation/orchestration/types';
import type { CoursePlanningInput, CoursePlanningRunView } from '@/lib/generation/planning/types';
import { normalizeCourseSourceReferences } from '@/lib/generation/planning/source-reference-normalization';
import { upload } from '@vercel/blob/client';
import {
  clearGenerationRecoverySession,
  GENERATION_RECOVERY_STORAGE_KEY,
  loadGenerationRecoverySession,
  persistGenerationRecoverySession,
  recoverGenerationSourceContext,
} from './session-recovery';
import {
  externalEvidenceRequested,
  resolveExternalEvidenceMode,
  type ExternalEvidenceStatus,
} from '@/lib/generation/external-evidence-policy';
import { describeGenerationFailure } from './error-guidance';

const log = createLogger('GenerationPreview');
const OUTLINE_REVIEW_AUTO_CONTINUE_MS = 2500;
const MAX_OUTLINE_REQUEST_ATTEMPTS = 3;
const COURSE_INPUT_CONTENT_TYPE = 'application/vnd.vaultide.course-input+json';
const GENERATION_SESSION_CHANGED_EVENT = 'vaultide:generation-session-changed';

function subscribeGenerationSession(onStoreChange: () => void): () => void {
  window.addEventListener(GENERATION_SESSION_CHANGED_EVENT, onStoreChange);
  window.addEventListener('storage', onStoreChange);
  return () => {
    window.removeEventListener(GENERATION_SESSION_CHANGED_EVENT, onStoreChange);
    window.removeEventListener('storage', onStoreChange);
  };
}

function readGenerationSessionSnapshot(): string | null {
  const active = sessionStorage.getItem('generationSession');
  if (active) return `session:${active}`;
  const recovery = localStorage.getItem(GENERATION_RECOVERY_STORAGE_KEY);
  return recovery ? `recovery:${recovery}` : null;
}

function serverGenerationSessionSnapshot(): undefined {
  return undefined;
}

function announceGenerationSessionChange(): void {
  window.dispatchEvent(new Event(GENERATION_SESSION_CHANGED_EVENT));
}

interface BrowserCourseInputReference {
  pathname: string;
  sha256: string;
  byteSize: number;
}

function courseInputStorageKey(sessionId: string, classroomId: string): string {
  return `vaultide:course-input:${sessionId}:${classroomId}`;
}

async function sha256Hex(content: string): Promise<string> {
  const bytes = new TextEncoder().encode(content);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function stageCourseInput(
  input: CourseGenerationJobInput,
  sessionId: string,
  classroomId: string,
): Promise<BrowserCourseInputReference> {
  const storageKey = courseInputStorageKey(sessionId, classroomId);
  const previous = sessionStorage.getItem(storageKey);
  if (previous) {
    try {
      const parsed = JSON.parse(previous) as BrowserCourseInputReference;
      if (
        /^course-inputs\/cin_[a-f0-9]{32}\.json$/.test(parsed.pathname) &&
        /^[a-f0-9]{64}$/.test(parsed.sha256) &&
        Number.isInteger(parsed.byteSize) &&
        parsed.byteSize > 0
      ) {
        return parsed;
      }
    } catch {
      sessionStorage.removeItem(storageKey);
    }
  }

  const serialized = JSON.stringify(input);
  const byteSize = new TextEncoder().encode(serialized).byteLength;
  const sha256 = await sha256Hex(serialized);
  const uploadId = crypto.randomUUID().replaceAll('-', '');
  const pathname = `course-inputs/cin_${uploadId}.json`;
  const reference = { pathname, sha256, byteSize };
  // Persist identity before the network request. If the upload response is
  // lost after Blob storage accepted it, a refresh adopts the same input.
  sessionStorage.setItem(storageKey, JSON.stringify(reference));
  await upload(pathname, serialized, {
    access: 'private',
    handleUploadUrl: '/api/v1/course-inputs',
    contentType: COURSE_INPUT_CONTENT_TYPE,
    clientPayload: JSON.stringify(reference),
    multipart: byteSize > 4 * 1024 * 1024,
  });
  return reference;
}

type OutlineStreamResult = {
  outlines: SceneOutline[];
  languageDirective: string;
  courseTitle?: string;
  taskEngineMode: boolean;
};

class RetryableOutlineAttemptError extends Error {
  constructor(
    message: string,
    readonly repairFeedback: string,
    readonly reason: string,
  ) {
    super(message);
    this.name = 'RetryableOutlineAttemptError';
  }
}

type ParsedDocumentResponseImage = {
  id: string;
  src?: string;
  pageNumber?: number;
  description?: string;
  width?: number;
  height?: number;
};

function legacySourceFromSession(session: GenerationSessionState): SessionDocumentSource[] {
  if (session.documentSources?.length) return session.documentSources;
  if (!session.pdfStorageKey) return [];
  return [
    {
      id: 'source_1',
      name: session.pdfFileName || 'document.pdf',
      size: 0,
      mimeType: session.documentMimeType || 'application/pdf',
      order: 1,
      storageKey: session.pdfStorageKey,
      providerId: session.pdfProviderId,
    },
  ];
}

function validateDocumentSources(
  sources: SessionDocumentSource[],
  t: (key: string, values?: Record<string, unknown>) => string,
) {
  if (sources.length > MAX_DOCUMENT_BUNDLE_FILES) {
    throw new Error(t('upload.courseMaterialCountLimit', { n: MAX_DOCUMENT_BUNDLE_FILES }));
  }

  const totalSize = sources.reduce((sum, source) => sum + source.size, 0);
  if (totalSize > MAX_DOCUMENT_BUNDLE_TOTAL_SIZE_BYTES) {
    throw new Error(
      t('upload.courseMaterialTotalSizeLimit', {
        n: Math.floor(MAX_DOCUMENT_BUNDLE_TOTAL_SIZE_BYTES / 1024 / 1024),
      }),
    );
  }
}

function buildCourseSourceReferences(
  session: GenerationSessionState,
): CourseGenerationJobInput['sourceReferences'] {
  return normalizeCourseSourceReferences([
    ...(session.retrievalCitations ?? []).map((citation) => ({
      kind: 'obsidian-source' as const,
      id: citation.sourceId,
      versionId: citation.sourceVersionId,
      locator: citation.relativePath,
      contentHash: citation.contentHash,
      authority: 'private-original' as const,
      included: true,
    })),
    ...(session.researchSources ?? []).map((source) => ({
      kind: 'public-source' as const,
      id: source.citationId || source.url,
      locator: source.url,
      authority:
        source.authority === 'primary'
          ? ('primary' as const)
          : source.authority === 'authoritative'
            ? ('authoritative' as const)
            : ('general' as const),
      included: true,
    })),
    ...(session.documentSources ?? []).map((source) => ({
      kind: 'uploaded-document' as const,
      id: source.id,
      locator: source.name,
      authority: 'private-original' as const,
      included: true,
    })),
  ]);
}

function GenerationPreviewContent() {
  const router = useRouter();
  const { t } = useI18n();
  const hasStartedRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const outlineReviewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const outlineReviewResolveRef = useRef<((outlines: SceneOutline[]) => void) | null>(null);
  // Sticky flag: true once the user signals review intent (either by clicking the
  // streaming card mid-stream, or by restoring a session that was already in review).
  // Combined with `reviewOutlineEnabled` to decide whether the post-stream timer fires.
  const outlineReviewIntentRef = useRef(false);
  const { profiles: voxcpmProfiles } = useVoxCPMVoiceProfiles();

  const sessionSnapshot = useSyncExternalStore(
    subscribeGenerationSession,
    readGenerationSessionSnapshot,
    serverGenerationSessionSnapshot,
  );
  const sessionLoaded = sessionSnapshot !== undefined;
  const session = useMemo(() => {
    if (!sessionSnapshot) return null;
    try {
      if (sessionSnapshot.startsWith('recovery:')) {
        return loadGenerationRecoverySession(localStorage);
      }
      const parsed = JSON.parse(sessionSnapshot.slice('session:'.length)) as GenerationSessionState;
      if (!parsed.previewPhase) {
        parsed.previewPhase = parsed.sceneOutlines?.length ? 'outline-ready' : 'preparing';
      }
      parsed.taskEngineMode = parsed.taskEngineMode === true;
      return parsed;
    } catch (sessionError) {
      log.error('Failed to parse generation session:', sessionError);
      return null;
    }
  }, [sessionSnapshot]);
  const [error, setError] = useState<string | null>(null);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [isComplete] = useState(false);
  const [generationRestartNonce, setGenerationRestartNonce] = useState(0);
  const [statusMessage, setStatusMessage] = useState('');
  const [streamingOutlines, setStreamingOutlines] = useState<SceneOutline[] | null>(null);
  const [isOutlineStreaming, setIsOutlineStreaming] = useState(false);
  const [truncationWarnings, setTruncationWarnings] = useState<string[]>([]);
  const [webSearchSources, setWebSearchSources] = useState<Array<{ title: string; url: string }>>(
    [],
  );
  const [showAgentReveal, setShowAgentReveal] = useState(false);
  const [isConfirmingOutlines, setIsConfirmingOutlines] = useState(false);
  const [generatedAgents, setGeneratedAgents] = useState<
    Array<{
      id: string;
      name: string;
      role: string;
      persona: string;
      avatar: string;
      color: string;
      priority: number;
    }>
  >([]);
  const reviewOutlineEnabled = useSettingsStore((s) => s.reviewOutlineEnabled);
  const setReviewOutlineEnabled = useSettingsStore((s) => s.setReviewOutlineEnabled);

  // Compute active steps based on session state
  const activeSteps = getActiveSteps(session);
  const isOutlineReady = session?.previewPhase === 'outline-ready';
  const isReviewingOutlines = session?.previewPhase === 'review';

  const persistSession = (nextSession: GenerationSessionState) => {
    sessionStorage.setItem('generationSession', JSON.stringify(nextSession));
    persistGenerationRecoverySession(localStorage, nextSession);
    announceGenerationSessionChange();
  };

  const clearOutlineReviewTimer = () => {
    if (outlineReviewTimerRef.current) {
      clearTimeout(outlineReviewTimerRef.current);
      outlineReviewTimerRef.current = null;
    }
  };

  const waitForOutlineReviewChoice = (
    outlines: SceneOutline[],
    shouldReview: boolean,
    signal: AbortSignal,
  ): Promise<SceneOutline[]> =>
    new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(new DOMException('Aborted', 'AbortError'));
        return;
      }
      outlineReviewResolveRef.current = resolve;
      // Reject on abort so navigating away (`goBackToHome`) or unmounting
      // settles this promise instead of leaking the awaiting startGeneration
      // closure. The catch at the bottom of startGeneration already swallows
      // AbortError silently.
      const onAbort = () => {
        clearOutlineReviewTimer();
        outlineReviewResolveRef.current = null;
        reject(new DOMException('Aborted', 'AbortError'));
      };
      signal.addEventListener('abort', onAbort, { once: true });
      if (!shouldReview) {
        outlineReviewTimerRef.current = setTimeout(() => {
          outlineReviewTimerRef.current = null;
          outlineReviewResolveRef.current = null;
          signal.removeEventListener('abort', onAbort);
          resolve(outlines);
        }, OUTLINE_REVIEW_AUTO_CONTINUE_MS);
      }
    });

  // Clean up old browser-only media without driving React state from an
  // effect. The session itself is an external store, so hydration and local
  // updates share one stable source of truth.
  useEffect(() => {
    cleanupOldImages(24).catch((e) => log.error(e));
  }, []);

  useEffect(() => {
    if (session?.previewPhase === 'review' && !session.sceneOutlines?.length) {
      outlineReviewIntentRef.current = true;
    }
  }, [session?.previewPhase, session?.sceneOutlines?.length]);

  // Abort all in-flight requests on unmount
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
      clearOutlineReviewTimer();
    };
  }, []);

  // Get API credentials from localStorage
  const getApiHeaders = () => {
    const modelConfig = getCurrentModelConfig();
    const settings = useSettingsStore.getState();
    const imageProviderConfig = settings.imageProvidersConfig?.[settings.imageProviderId];
    const videoProviderConfig = settings.videoProvidersConfig?.[settings.videoProviderId];
    return {
      'Content-Type': 'application/json',
      'x-model': modelConfig.modelString,
      'x-api-key': modelConfig.apiKey,
      'x-base-url': modelConfig.baseUrl,
      'x-provider-type': modelConfig.providerType || '',
      // Image generation provider
      'x-image-provider': settings.imageProviderId || '',
      'x-image-model': settings.imageModelId || '',
      'x-image-api-key': imageProviderConfig?.apiKey || '',
      'x-image-base-url': imageProviderConfig?.baseUrl || '',
      // Video generation provider
      'x-video-provider': settings.videoProviderId || '',
      'x-video-model': settings.videoModelId || '',
      'x-video-api-key': videoProviderConfig?.apiKey || '',
      'x-video-base-url': videoProviderConfig?.baseUrl || '',
      // Media generation toggles
      'x-image-generation-enabled': String(settings.imageGenerationEnabled ?? false),
      'x-video-generation-enabled': String(settings.videoGenerationEnabled ?? false),
    };
  };

  const withThinkingConfig = <T extends Record<string, unknown>>(body: T) => {
    const { thinkingConfig } = getCurrentModelConfig();
    return thinkingConfig ? { ...body, thinkingConfig } : body;
  };

  const waitForAbortableDelay = (milliseconds: number, signal: AbortSignal) =>
    new Promise<void>((resolve, reject) => {
      if (signal.aborted) {
        reject(new DOMException('Aborted', 'AbortError'));
        return;
      }
      const timer = window.setTimeout(() => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      }, milliseconds);
      const onAbort = () => {
        window.clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      };
      signal.addEventListener('abort', onAbort, { once: true });
    });

  const readCourseJob = async (jobId: string, signal: AbortSignal) => {
    const response = await fetch(`/api/v1/course-jobs/${encodeURIComponent(jobId)}`, {
      cache: 'no-store',
      signal,
    });
    const body = (await response.json().catch(() => ({}))) as {
      success?: boolean;
      job?: CourseGenerationJobView;
      error?: string;
    };
    if (!response.ok || !body.success || !body.job) {
      throw new Error(body.error || `Unable to read course job (${response.status}).`);
    }
    return body.job;
  };

  const readCoursePlan = async (planningRunId: string, signal: AbortSignal) => {
    const response = await fetch(`/api/v1/course-plans/${encodeURIComponent(planningRunId)}`, {
      cache: 'no-store',
      signal,
    });
    const body = (await response.json().catch(() => ({}))) as {
      success?: boolean;
      planningRun?: CoursePlanningRunView;
      error?: string;
      details?: string;
    };
    if (!response.ok || !body.success || !body.planningRun) {
      throw new Error(
        body.details || body.error || `Unable to read course plan (${response.status}).`,
      );
    }
    return body.planningRun;
  };

  const resumeFailedCoursePlan = async (planningRunId: string, signal: AbortSignal) => {
    const response = await fetch(`/api/v1/course-plans/${encodeURIComponent(planningRunId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      signal,
    });
    const body = (await response.json().catch(() => ({}))) as {
      success?: boolean;
      planningRun?: CoursePlanningRunView;
      error?: string;
      details?: string;
    };
    if (!response.ok || !body.success || !body.planningRun) {
      throw new Error(
        body.details || body.error || `Unable to resume course plan (${response.status}).`,
      );
    }
    return body.planningRun;
  };

  const createCoursePlan = async (
    generationSession: GenerationSessionState,
    signal: AbortSignal,
  ) => {
    const modelConfig = getCurrentModelConfig();
    const sourceMode =
      generationSession.requirements.learningProject?.sourceMode ??
      (generationSession.sourceBundleId ? 'obsidian' : 'external');
    const planningInput: CoursePlanningInput = {
      clientSessionId: generationSession.sessionId,
      requirements: generationSession.requirements,
      sourceMode,
      sourceReferences: buildCourseSourceReferences(generationSession),
      documentText: generationSession.pdfText || '',
      researchText: generationSession.researchContext || '',
      ...(generationSession.sourceContextCharCount
        ? { sourceContextExpectedChars: generationSession.sourceContextCharCount }
        : {}),
      ...(generationSession.sourceBundleId
        ? { sourceBundleId: generationSession.sourceBundleId }
        : {}),
      ...(generationSession.projectId ? { projectId: generationSession.projectId } : {}),
      ...(generationSession.retrievalRunId
        ? { retrievalRunId: generationSession.retrievalRunId }
        : {}),
      // A durable workflow cannot safely retain a browser API key or arbitrary
      // base URL.  It only needs the selected model identity; server-managed
      // credentials are resolved again when the immutable job policy is frozen.
      ...(modelConfig.modelString?.trim()
        ? {
            generationModel: {
              modelString: modelConfig.modelString.trim(),
              ...(modelConfig.thinkingConfig
                ? { thinkingConfig: modelConfig.thinkingConfig }
                : {}),
            },
          }
        : {}),
    };
    const response = await fetch('/api/v1/course-plans', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(planningInput),
      signal,
    });
    const body = (await response.json().catch(() => ({}))) as {
      success?: boolean;
      planningRun?: CoursePlanningRunView;
      error?: string;
      details?: string;
    };
    if (!response.ok || !body.success || !body.planningRun) {
      throw new Error(
        body.details || body.error || `Unable to create course plan (${response.status}).`,
      );
    }
    return body.planningRun;
  };

  const advanceCourseJob = async (jobId: string, signal: AbortSignal) => {
    const response = await fetch(`/api/v1/course-jobs/${encodeURIComponent(jobId)}/advance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      signal,
    });
    const body = (await response.json().catch(() => ({}))) as {
      success?: boolean;
      job?: CourseGenerationJobView;
      error?: string;
      details?: string;
    };
    if (!response.ok || !body.success || !body.job) {
      throw new Error(
        body.details || body.error || `Unable to advance course job (${response.status}).`,
      );
    }
    return body.job;
  };

  const resumeFailedCourseJob = async (jobId: string, signal: AbortSignal) => {
    const response = await fetch(`/api/v1/course-jobs/${encodeURIComponent(jobId)}/advance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ retryFailed: true }),
      signal,
    });
    const body = (await response.json().catch(() => ({}))) as {
      success?: boolean;
      job?: CourseGenerationJobView;
      queueMode?: 'qstash' | 'client-resume';
      error?: string;
      details?: string;
    };
    if (!response.ok || !body.success || !body.job) {
      throw new Error(
        body.details || body.error || `Unable to resume course job (${response.status}).`,
      );
    }
    return {
      job: body.job,
      queueMode: body.queueMode ?? 'client-resume',
    };
  };

  const monitorCourseJob = async (
    generationSession: GenerationSessionState,
    jobId: string,
    queueMode: 'workflow' | 'qstash' | 'client-resume',
    signal: AbortSignal,
  ) => {
    let current = generationSession;
    let mode = queueMode;
    let advanceCooldownUntil = 0;
    for (;;) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      let job: CourseGenerationJobView;
      try {
        job = await readCourseJob(jobId, signal);
      } catch (error) {
        if (isAbortError(error)) throw error;
        if (!isTransientCourseJobTransportError(error)) throw error;
        log.warn(
          '[GenerationPreview] Course job status connection was interrupted; retrying from the durable checkpoint.',
          error,
        );
        setStatusMessage('连接暂时中断，正在重新读取已保存的课堂进度…');
        await waitForAbortableDelay(COURSE_JOB_TRANSPORT_RECOVERY_DELAY_MS, signal);
        continue;
      }
      const stepId =
        job.phase === 'actions' ? 'actions' : job.phase === 'release' ? 'actions' : 'slide-content';
      const stepIndex = getActiveSteps(current).findIndex((step) => step.id === stepId);
      if (stepIndex >= 0) setCurrentStepIndex(stepIndex);
      setStatusMessage(job.message);
      current = {
        ...current,
        courseJobId: job.id,
        courseClassroomId: job.classroomId,
        courseQueueMode: mode,
        courseJobProgress: job.progress,
        courseJobUpdatedAt: job.updatedAt,
        previewPhase: job.phase === 'release' ? 'verifying-release' : 'durable-generating',
      };
      persistSession(current);

      if (job.status === 'ready' && job.release) {
        sessionStorage.removeItem('generationSession');
        clearGenerationRecoverySession(localStorage);
        announceGenerationSessionChange();
        router.push(`/classroom/${encodeURIComponent(job.release.classroomId)}`);
        return;
      }
      if (job.status === 'failed' || job.status === 'cancelled') {
        throw new Error(job.error?.detail || '课程未通过质量发布闸门。');
      }

      const lastProgressAge = Date.now() - Date.parse(job.updatedAt);
      const shouldUseAuthenticatedResume =
        (mode === 'client-resume' ||
          !Number.isFinite(lastProgressAge) ||
          lastProgressAge > 7 * 60_000) &&
        Date.now() >= advanceCooldownUntil;
      if (shouldUseAuthenticatedResume) {
        try {
          job = await advanceCourseJob(jobId, signal);
          advanceCooldownUntil = 0;
        } catch (error) {
          if (isAbortError(error)) throw error;
          if (!isTransientCourseJobTransportError(error)) throw error;
          // The server can continue after an Obsidian/Electron webview drops a
          // long fetch. Observe the durable ledger before attempting another
          // mutation so the same active lease is not hammered by duplicate
          // advance requests.
          advanceCooldownUntil = Date.now() + COURSE_JOB_ADVANCE_COOLDOWN_MS;
          log.warn(
            '[GenerationPreview] Course step connection was interrupted; switching to durable read recovery.',
            error,
          );
          setStatusMessage('生成仍在服务器继续，正在从持久化进度恢复连接…');
          await waitForAbortableDelay(COURSE_JOB_TRANSPORT_RECOVERY_DELAY_MS, signal);
          continue;
        }
        if (mode === 'qstash' && lastProgressAge > 7 * 60_000) {
          // QStash remains the preferred owner. This one-step, lease-protected
          // recovery prevents a queue configuration incident from stranding a
          // personal learning session while the page is open.
          mode = 'client-resume';
        }
        if (job.status === 'ready' && job.release) {
          sessionStorage.removeItem('generationSession');
          clearGenerationRecoverySession(localStorage);
          announceGenerationSessionChange();
          router.push(`/classroom/${encodeURIComponent(job.release.classroomId)}`);
          return;
        }
        if (job.status === 'failed' || job.status === 'cancelled') {
          throw new Error(job.error?.detail || '课程未通过质量发布闸门。');
        }
        await waitForAbortableDelay(350, signal);
        continue;
      }
      await waitForAbortableDelay(COURSE_JOB_TRANSPORT_RECOVERY_DELAY_MS, signal);
    }
  };

  const monitorCoursePlan = async (
    generationSession: GenerationSessionState,
    planningRunId: string,
    signal: AbortSignal,
  ) => {
    let current = generationSession;
    const phaseMessages: Record<CoursePlanningRunView['phase'], string> = {
      preflight: '正在后台审查学习目标与已选资料；可以关闭页面，进度不会丢失。',
      research: '正在后台检索并冻结权威外部证据；可以关闭页面，任务会继续。',
      outline: '正在后台构建并验证 9–12 个高质量课堂场景。',
      content: '大纲已通过，正在后台逐页生成可学习内容。',
      actions: '正在后台补全讲解、反馈与课堂交互。',
      release: '全部页面已生成，正在执行完整性与质量发布验证。',
      ready: '课堂已通过质量门，正在打开。',
      failed: '后台课堂生成未通过质量门。',
      consumed: '课堂任务已建立，正在恢复生成进度。',
    };

    for (;;) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      let plan: CoursePlanningRunView;
      try {
        plan = await readCoursePlan(planningRunId, signal);
      } catch (error) {
        if (isAbortError(error)) throw error;
        if (!isTransientCourseJobTransportError(error)) throw error;
        setStatusMessage('连接暂时中断，后台任务仍在继续；正在恢复持久化进度…');
        await waitForAbortableDelay(COURSE_JOB_TRANSPORT_RECOVERY_DELAY_MS, signal);
        continue;
      }

      const stepId =
        plan.phase === 'research'
          ? 'web-search'
          : plan.phase === 'outline' || plan.phase === 'preflight'
            ? 'outline'
            : plan.phase === 'content'
              ? 'slide-content'
              : 'actions';
      const stepIndex = getActiveSteps(current).findIndex((step) => step.id === stepId);
      if (stepIndex >= 0) setCurrentStepIndex(stepIndex);
      setStatusMessage(phaseMessages[plan.phase]);

      current = {
        ...current,
        coursePlanId: plan.id,
        requirements: plan.input.requirements,
        pdfText: plan.input.documentText,
        researchContext: plan.input.researchText,
        sourceContextCharCount:
          plan.input.sourceContextExpectedChars ?? current.sourceContextCharCount,
        ...(plan.outlines?.length
          ? {
              sceneOutlines: plan.outlines,
              languageDirective: plan.languageDirective,
              courseTitle: plan.courseTitle,
              taskEngineMode: plan.taskEngineMode,
            }
          : {}),
        ...(plan.courseJob
          ? {
              courseJobId: plan.courseJob.id,
              courseClassroomId: plan.courseJob.classroomId,
              courseQueueMode: 'workflow' as const,
              courseJobProgress: plan.courseJob.progress,
              courseJobUpdatedAt: plan.courseJob.updatedAt,
              previewPhase:
                plan.courseJob.phase === 'release'
                  ? ('verifying-release' as const)
                  : ('durable-generating' as const),
            }
          : { previewPhase: 'preparing' as const }),
      };
      persistSession(current);

      if (plan.courseJob) {
        await monitorCourseJob(current, plan.courseJob.id, 'workflow', signal);
        return;
      }
      if (plan.error || plan.phase === 'failed') {
        throw new Error(plan.error?.detail || '后台课程工作流未能完成。');
      }
      await waitForAbortableDelay(2_500, signal);
    }
  };

  // Auto-start generation when session is loaded
  useEffect(() => {
    if (!session || hasStartedRef.current) return;
    const needsOutlines = !session.sceneOutlines || session.sceneOutlines.length === 0;
    const phase = session.previewPhase;
    const shouldAutoStart =
      !phase ||
      phase === 'preparing' ||
      phase === 'generating-content' ||
      phase === 'durable-generating' ||
      phase === 'verifying-release' ||
      // Refresh during early-review: editor is shown but outlines weren't persisted,
      // so kick off SSE again — the editor will receive streaming outlines.
      (phase === 'review' && needsOutlines);
    if (shouldAutoStart) {
      hasStartedRef.current = true;
      startGeneration();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, generationRestartNonce]);

  // Main generation flow
  const startGeneration = async (sessionOverride?: GenerationSessionState) => {
    const generationSession = sessionOverride ?? session;
    if (!generationSession) return;

    // Create AbortController for this generation run
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const signal = controller.signal;

    // Use a local mutable copy so we can update it after document extraction
    let currentSession = generationSession;

    setError(null);
    setCurrentStepIndex(0);

    try {
      if (currentSession.courseJobId) {
        await monitorCourseJob(
          currentSession,
          currentSession.courseJobId,
          currentSession.courseQueueMode ?? 'client-resume',
          signal,
        );
        return;
      }

      // A planning run is created before the first outline model call. On a
      // refresh, it is the source of truth for the reviewed evidence, goal,
      // and any completed outline — no local cache reconstruction is needed.
      let coursePlan: CoursePlanningRunView | undefined;
      if (currentSession.coursePlanId) {
        setStatusMessage('正在恢复已冻结的学习资料与规划进度…');
        coursePlan = await readCoursePlan(currentSession.coursePlanId, signal);
        if (coursePlan.error && !coursePlan.error.retryable) {
          throw new Error(coursePlan.error.detail);
        }
        currentSession = {
          ...currentSession,
          requirements: coursePlan.input.requirements,
          pdfText: coursePlan.input.documentText,
          researchContext: coursePlan.input.researchText,
          sourceContextCharCount:
            coursePlan.input.sourceContextExpectedChars ?? currentSession.sourceContextCharCount,
          ...(coursePlan.outlines?.length
            ? {
                sceneOutlines: coursePlan.outlines,
                languageDirective: coursePlan.languageDirective,
                courseTitle: coursePlan.courseTitle,
                taskEngineMode: coursePlan.taskEngineMode,
                previewPhase:
                  currentSession.previewPhase === 'review'
                    ? ('review' as const)
                    : ('generating-content' as const),
              }
            : {}),
        };
        persistSession(currentSession);
        if (coursePlan.executionMode === 'workflow') {
          await monitorCoursePlan(currentSession, coursePlan.id, signal);
          return;
        }
      }

      const sourceRecovery = recoverGenerationSourceContext(sessionStorage, currentSession);
      if (sourceRecovery.recovered) {
        currentSession = sourceRecovery.session;
        persistSession(currentSession);
        log.info(
          `[GenerationPreview] Restored reviewed project context (${sourceRecovery.actualChars}/${sourceRecovery.expectedChars} substantive characters).`,
        );
      } else if (sourceRecovery.missingExpectedContext) {
        throw new Error(
          '已审查的项目资料没有完整进入课堂生成。请返回来源审查页重新确认来源；系统不会用残缺资料生成低质量课堂。',
        );
      }

      // Compute active steps for this session (recomputed after session mutations)
      let activeSteps = getActiveSteps(currentSession);

      // Determine if we need the document analysis step
      const documentSources = legacySourceFromSession(currentSession);
      const hasPdfToAnalyze = !coursePlan && documentSources.length > 0 && !currentSession.pdfText;
      // If no document to analyze, skip to the next available step
      if (!hasPdfToAnalyze) {
        const firstNonPdfIdx = activeSteps.findIndex((s) => s.id !== 'pdf-analysis');
        setCurrentStepIndex(Math.max(0, firstNonPdfIdx));
      }

      // Step 0: Extract uploaded course material if needed
      if (hasPdfToAnalyze) {
        log.debug('=== Generation Preview: Extracting course material bundle ===');
        validateDocumentSources(documentSources, t);
        const sortedDocumentSources = [...documentSources].sort((a, b) => a.order - b.order);
        const parsedParts = await Promise.all(
          sortedDocumentSources.map(async (source): Promise<ParsedDocumentPart> => {
            const documentBlob = await loadDocumentBlob(source.storageKey);
            if (!documentBlob) {
              throw new Error(t('generation.courseMaterialLoadFailed'));
            }

            if (!(documentBlob instanceof Blob) || documentBlob.size === 0) {
              log.error('Invalid course material blob:', {
                source: source.name,
                type: typeof documentBlob,
                size: documentBlob instanceof Blob ? documentBlob.size : 'N/A',
              });
              throw new Error(t('generation.courseMaterialLoadFailed'));
            }

            const documentFile = new File([documentBlob], source.name || 'document.pdf', {
              type: source.mimeType || documentBlob.type || 'application/pdf',
            });

            const parseFormData = new FormData();
            parseFormData.append('file', documentFile);

            const providerId = source.providerId || currentSession.pdfProviderId;
            const legacySourceConfig = (
              source as SessionDocumentSource & {
                providerConfig?: {
                  apiKey?: string;
                  baseUrl?: string;
                  accessKeyId?: string;
                  accessKeySecret?: string;
                };
              }
            ).providerConfig;
            const providerConfig = currentSession.pdfProviderConfig || legacySourceConfig;
            if (providerId) parseFormData.append('providerId', providerId);
            if (providerConfig?.apiKey?.trim()) {
              parseFormData.append('apiKey', providerConfig.apiKey);
            }
            if (providerConfig?.baseUrl?.trim()) {
              parseFormData.append('baseUrl', providerConfig.baseUrl);
            }
            // AliDocMind uses AK/SK instead of a single apiKey.
            if (providerConfig?.accessKeyId?.trim()) {
              parseFormData.append('accessKeyId', providerConfig.accessKeyId);
            }
            if (providerConfig?.accessKeySecret?.trim()) {
              parseFormData.append('accessKeySecret', providerConfig.accessKeySecret);
            }

            const parseResponse = await fetch('/api/extract-document', {
              method: 'POST',
              body: parseFormData,
              signal,
            });

            if (!parseResponse.ok) {
              const errorData = await parseResponse.json();
              throw new Error(errorData.error || t('generation.courseMaterialParseFailed'));
            }

            const parseResult = await parseResponse.json();
            if (!parseResult.success || !parseResult.data) {
              throw new Error(t('generation.courseMaterialParseFailed'));
            }

            const rawImages = parseResult.data.metadata?.pdfImages;
            const images = rawImages
              ? rawImages.map((img: ParsedDocumentResponseImage) => ({
                  id: img.id,
                  src: img.src || '',
                  pageNumber: img.pageNumber ?? 1,
                  description: img.description,
                  width: img.width,
                  height: img.height,
                }))
              : ((parseResult.data.images as string[] | undefined) ?? []).map((src, i) => ({
                  id: `img_${i + 1}`,
                  src,
                  pageNumber: 1,
                }));

            return {
              source: {
                id: source.id,
                name: source.name,
                size: source.size,
                lastModified: source.lastModified,
                mimeType: source.mimeType,
                order: source.order,
                providerId,
              },
              text: parseResult.data.text as string,
              rawTextLength: (parseResult.data.text as string).length,
              pageCount: parseResult.data.metadata?.pageCount,
              images,
            };
          }),
        );

        const bundle = buildDocumentBundle(parsedParts);
        const imageStorageIds = await storeImages(bundle.images);

        const pdfImages: PdfImage[] = bundle.images.map((img, i) => ({
          id: img.id,
          src: '',
          pageNumber: img.pageNumber,
          description: img.description,
          width: img.width,
          height: img.height,
          originalId: img.originalId,
          sourceDocumentId: img.sourceDocumentId,
          sourceDocumentName: img.sourceDocumentName,
          sourceDocumentOrder: img.sourceDocumentOrder,
          visionPriority: img.visionPriority,
          storageId: imageStorageIds[i],
        }));

        // Update session with extracted document data
        const updatedSession = {
          ...currentSession,
          documentSources,
          pdfText: bundle.text,
          pdfImages,
          imageStorageIds,
          pdfStorageKey: undefined, // Clear so we don't re-parse
        };
        persistSession(updatedSession);

        // Truncation warnings
        const warnings: string[] = [];
        if (bundle.totalRawTextLength > bundle.textContentBudget) {
          warnings.push(t('generation.textTruncated', { n: bundle.textContentBudget }));
        }
        if (bundle.totalImageCount > MAX_VISION_IMAGES) {
          warnings.push(
            t('generation.imageTruncated', {
              total: bundle.totalImageCount,
              max: MAX_VISION_IMAGES,
            }),
          );
        }
        if (warnings.length > 0) {
          setTruncationWarnings(warnings);
        }

        // Reassign local reference for subsequent steps
        currentSession = updatedSession;
        activeSteps = getActiveSteps(currentSession);
      }

      // Workflow 2.0 freezes the source set before any external research or
      // model call, then owns research, outline, generation and release in the
      // background. The legacy path remains only for local/self-hosted setups
      // where no Workflow World is available.
      if (!coursePlan) {
        setStatusMessage('正在冻结本次资料并启动后台课堂工作流…');
        coursePlan = await createCoursePlan(currentSession, signal);
        currentSession = {
          ...currentSession,
          coursePlanId: coursePlan.id,
          previewPhase: 'preparing',
        };
        persistSession(currentSession);
        if (coursePlan.executionMode === 'workflow') {
          await monitorCoursePlan(currentSession, coursePlan.id, signal);
          return;
        }
        if (
          externalEvidenceRequested(currentSession.requirements) &&
          !currentSession.researchContext?.trim()
        ) {
          coursePlan = undefined;
          currentSession = { ...currentSession, coursePlanId: undefined };
          persistSession(currentSession);
        }
      }

      // Step: Web Search (if enabled)
      const webSearchStepIdx = activeSteps.findIndex((s) => s.id === 'web-search');
      const externalEvidenceMode = resolveExternalEvidenceMode(currentSession.requirements);
      if (
        !coursePlan &&
        externalEvidenceRequested(currentSession.requirements) &&
        webSearchStepIdx >= 0
      ) {
        setCurrentStepIndex(webSearchStepIdx);
        setWebSearchSources([]);

        const wsSettings = useSettingsStore.getState();
        const wsProviderId = wsSettings.webSearchProviderId;
        const wsConfig = wsSettings.webSearchProvidersConfig?.[wsProviderId];
        const res = await fetch('/api/web-search', {
          method: 'POST',
          headers: getApiHeaders(),
          body: JSON.stringify(
            withThinkingConfig({
              query: currentSession.requirements.requirement,
              pdfText: currentSession.pdfText || undefined,
              providerId: wsProviderId,
              apiKey: wsConfig?.apiKey || undefined,
              baseUrl: wsProviderId === 'searxng' ? undefined : wsConfig?.baseUrl || undefined,
              baiduSubSources: wsProviderId === 'baidu' ? wsSettings.baiduSubSources : undefined,
              sourcePolicy: 'prefer-primary',
              externalEvidenceMode,
            }),
          ),
          signal,
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({ error: 'Web search failed' }));
          const details =
            typeof data.details === 'string' && data.details.trim() ? ` ${data.details}` : '';
          throw new Error(`${data.error || t('generation.webSearchFailed')}${details}`.trim());
        }

        const searchData = await res.json();
        if (searchData.degraded) {
          setTruncationWarnings((current) => {
            const warning =
              typeof searchData.warning === 'string' && searchData.warning.trim()
                ? searchData.warning.trim()
                : t('generation.webSearchDegraded');
            return current.includes(warning) ? current : [...current, warning];
          });
        }
        const sources = (searchData.sources || []).map(
          (s: {
            citationId?: string;
            title: string;
            url: string;
            domain?: string;
            authority?: 'primary' | 'authoritative' | 'general';
            score?: number;
          }) => ({
            citationId: s.citationId,
            title: s.title,
            url: s.url,
            domain: s.domain,
            authority: s.authority,
            score: s.score,
          }),
        );
        setWebSearchSources(sources);

        const externalEvidenceStatus: ExternalEvidenceStatus = searchData.degraded
          ? 'unavailable'
          : 'ready';
        const updatedSessionWithSearch: GenerationSessionState = {
          ...currentSession,
          requirements: {
            ...currentSession.requirements,
            externalEvidenceMode,
            externalEvidenceStatus,
            ...(searchData.degraded && typeof searchData.warning === 'string'
              ? { externalEvidenceWarning: searchData.warning }
              : {}),
          },
          researchContext: searchData.context || '',
          researchSources: sources,
          researchProvenance: searchData.provenance,
          externalEvidenceMode,
          externalEvidenceStatus,
          ...(searchData.degraded && typeof searchData.warning === 'string'
            ? { externalEvidenceWarning: searchData.warning }
            : {}),
        };
        persistSession(updatedSessionWithSearch);
        currentSession = updatedSessionWithSearch;
        activeSteps = getActiveSteps(currentSession);
      }

      if (!coursePlan) {
        setStatusMessage('正在执行生成前检查并冻结本次资料…');
        coursePlan = await createCoursePlan(currentSession, signal);
        currentSession = {
          ...currentSession,
          coursePlanId: coursePlan.id,
          ...(coursePlan.outlines?.length
            ? {
                sceneOutlines: coursePlan.outlines,
                languageDirective: coursePlan.languageDirective,
                courseTitle: coursePlan.courseTitle,
                taskEngineMode: coursePlan.taskEngineMode,
                previewPhase: 'generating-content' as const,
              }
            : {}),
        };
        persistSession(currentSession);
      }

      // Load imageMapping early (needed for both outline and scene generation)
      let imageMapping: ImageMapping = {};
      if (currentSession.imageStorageIds && currentSession.imageStorageIds.length > 0) {
        log.debug('Loading images from IndexedDB');
        imageMapping = await loadImageMapping(currentSession.imageStorageIds);
      } else if (
        currentSession.imageMapping &&
        Object.keys(currentSession.imageMapping).length > 0
      ) {
        log.debug('Using imageMapping from session (old format)');
        imageMapping = currentSession.imageMapping;
      }

      // Create stage client-side
      const stageId = nanoid(10);
      const stage: Stage = {
        id: stageId,
        name: extractTopicFromRequirement(currentSession.requirements.requirement),
        description: '',
        style: 'professional',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        interactiveMode: !!currentSession.requirements.interactiveMode,
        taskEngineMode: currentSession.taskEngineMode === true,
        learningContext: {
          sourceBundleId: currentSession.sourceBundleId,
          projectId: currentSession.projectId,
          projectName: currentSession.projectName,
          projectRevision: currentSession.projectRevision,
          retrievalRunId: currentSession.retrievalRunId,
          retrievalStrategy: currentSession.retrievalStrategy,
          retrievedSourceCount: currentSession.retrievedSourceCount,
          retrievedChunkCount: currentSession.retrievedChunkCount,
          retrievalMatchQuality: currentSession.retrievalMatchQuality,
          retrievalUnavailableSourceCount: currentSession.retrievalUnavailableSourceCount,
          projectCoverageState: currentSession.projectCoverageState,
          retrievalCitations: currentSession.retrievalCitations,
          goal: currentSession.requirements.requirement,
          learningProject: currentSession.requirements.learningProject
            ? {
                id: currentSession.requirements.learningProject.id,
                sourceMode: currentSession.requirements.learningProject.sourceMode,
                outcome: currentSession.requirements.learningProject.outcome,
                priorKnowledge: currentSession.requirements.learningProject.priorKnowledge,
                knownContext: currentSession.requirements.learningProject.knownContext,
                successCriteria: currentSession.requirements.learningProject.successCriteria,
                evidencePolicy: currentSession.requirements.learningProject.evidencePolicy,
                createdAt: currentSession.requirements.learningProject.createdAt,
                updatedAt: currentSession.requirements.learningProject.updatedAt,
              }
            : undefined,
          webSearchEnabled: externalEvidenceRequested(currentSession.requirements),
          externalEvidenceMode,
          externalEvidenceStatus:
            currentSession.externalEvidenceStatus ??
            (externalEvidenceMode === 'off' ? 'not-requested' : undefined),
          externalEvidenceWarning: currentSession.externalEvidenceWarning,
          researchRunId: currentSession.researchProvenance?.researchRunId,
          researchProviderId: currentSession.researchProvenance?.providerId,
          researchFetchedAt: currentSession.researchProvenance?.fetchedAt,
          researchSourcePolicy: currentSession.researchProvenance?.sourcePolicy,
          researchSources: currentSession.researchSources,
        },
      };

      // ── Generate outlines first (infers languageDirective) ──
      let outlines = currentSession.sceneOutlines;
      let languageDirective = currentSession.languageDirective;
      let courseTitle = currentSession.courseTitle;

      const outlineStepIdx = activeSteps.findIndex((s) => s.id === 'outline');
      setCurrentStepIndex(outlineStepIdx >= 0 ? outlineStepIdx : 0);
      if (!outlines || outlines.length === 0) {
        log.debug('=== Generating outlines (SSE) ===');
        setStreamingOutlines([]);
        setIsOutlineStreaming(true);

        let outlineResult: OutlineStreamResult | undefined;
        let outlineAttempt = Math.max(1, currentSession.outlineAttempt ?? 1);
        let outlineRepairFeedback = currentSession.outlineRepairFeedback ?? '';

        for (; outlineAttempt <= MAX_OUTLINE_REQUEST_ATTEMPTS && !outlineResult; outlineAttempt++) {
          setStreamingOutlines([]);
          if (outlineAttempt > 1) {
            setStatusMessage(
              `${t('generation.outlineRetrying')} (${outlineAttempt}/${MAX_OUTLINE_REQUEST_ATTEMPTS})`,
            );
          }
          try {
            outlineResult = await new Promise<OutlineStreamResult>((resolve, reject) => {
              const collected: SceneOutline[] = [];
              let directive: string | undefined;
              let title: string | undefined;
              let settled = false;

              fetch('/api/generate/scene-outlines-stream', {
                method: 'POST',
                headers: getApiHeaders(),
                body: JSON.stringify(
                  withThinkingConfig({
                    planningRunId: currentSession.coursePlanId,
                    requirements: currentSession.requirements,
                    pdfText: currentSession.pdfText,
                    sourceContextExpectedChars: currentSession.sourceContextCharCount,
                    pdfImages: currentSession.pdfImages,
                    imageMapping,
                    researchContext: currentSession.researchContext,
                    outlineAttemptMode: 'single',
                    outlineRepairFeedback: outlineRepairFeedback || undefined,
                  }),
                ),
                signal,
              })
                .then((res) => {
                  if (!res.ok) {
                    return res.json().then((d) => {
                      const detail =
                        typeof d.details === 'string' && d.details.trim() ? ` ${d.details}` : '';
                      reject(
                        new Error(
                          `${d.error || t('generation.outlineGenerateFailed')}${detail}`.trim(),
                        ),
                      );
                    });
                  }

                  const reader = res.body?.getReader();
                  if (!reader) {
                    reject(new Error(t('generation.streamNotReadable')));
                    return;
                  }

                  const decoder = new TextDecoder();
                  let sseBuffer = '';

                  const pump = (): Promise<void> =>
                    reader.read().then(({ done, value }) => {
                      if (value) {
                        sseBuffer += decoder.decode(value, { stream: !done });
                        const lines = sseBuffer.split('\n');
                        sseBuffer = lines.pop() || '';

                        for (const line of lines) {
                          if (!line.startsWith('data: ')) continue;
                          try {
                            const evt = JSON.parse(line.slice(6));
                            if (evt.type === 'languageDirective') {
                              directive = evt.data;
                            } else if (evt.type === 'courseTitle') {
                              title = evt.data;
                            } else if (evt.type === 'outline') {
                              collected.push(evt.data);
                              setStreamingOutlines([...collected]);
                            } else if (evt.type === 'retry') {
                              collected.length = 0;
                              // Drop any directive/title latched from the failed
                              // attempt — the server resets these per attempt, so a
                              // succeeding attempt that omits them must fall back, not
                              // inherit the previous attempt's stale values.
                              directive = undefined;
                              title = undefined;
                              setStreamingOutlines([]);
                              setStatusMessage(t('generation.outlineRetrying'));
                            } else if (evt.type === 'done') {
                              directive = evt.languageDirective || directive;
                              const taskEngineMode = resolveTaskEngineModeFromOutlineDoneEvent(evt);
                              const completedOutlines = evt.outlines || collected;
                              const releaseViolation = describeOutlineReleaseViolation(
                                completedOutlines,
                                taskEngineMode,
                              );
                              if (releaseViolation) {
                                settled = true;
                                reject(
                                  new RetryableOutlineAttemptError(
                                    releaseViolation,
                                    `${releaseViolation} Return a complete 9-12 scene course with distinct instructional jobs.`,
                                    'release-contract',
                                  ),
                                );
                                return;
                              }
                              settled = true;
                              resolve({
                                outlines: completedOutlines,
                                languageDirective:
                                  directive ||
                                  'Teach in the language that matches the user requirement.',
                                courseTitle: evt.courseTitle || title,
                                taskEngineMode,
                              });
                              return;
                            } else if (evt.type === 'error') {
                              settled = true;
                              reject(
                                evt.retryable
                                  ? new RetryableOutlineAttemptError(
                                      evt.error || t('generation.outlineGenerateFailed'),
                                      evt.repairFeedback || evt.error || '',
                                      evt.reason || 'unknown',
                                    )
                                  : new Error(evt.error),
                              );
                              return;
                            }
                          } catch (e) {
                            log.error('Failed to parse outline SSE:', line, e);
                          }
                        }
                      }
                      if (done && !settled) {
                        reject(
                          new RetryableOutlineAttemptError(
                            t('generation.outlineEmptyResponse'),
                            'The previous stream ended before its completion event. Regenerate the complete outline; do not continue from a partial scene list.',
                            'stream-interrupted',
                          ),
                        );
                        return;
                      }
                      if (done) {
                        if (collected.length > 0) {
                          resolve({
                            outlines: collected,
                            languageDirective:
                              directive ||
                              'Teach in the language that matches the user requirement.',
                            // Carry any title latched from a streaming `courseTitle`
                            // event here too — symmetric with languageDirective — so
                            // a stream that ends without an explicit `done` event
                            // does not silently drop a valid inferred title.
                            courseTitle: title,
                            taskEngineMode: false,
                          });
                        } else {
                          reject(new Error(t('generation.outlineEmptyResponse')));
                        }
                        return;
                      }
                      return pump();
                    });

                  pump().catch(reject);
                })
                .catch(reject);
            });
          } catch (outlineError) {
            if (
              !(outlineError instanceof RetryableOutlineAttemptError) ||
              outlineAttempt >= MAX_OUTLINE_REQUEST_ATTEMPTS
            ) {
              throw outlineError;
            }

            outlineRepairFeedback = outlineError.repairFeedback;
            const retrySession: GenerationSessionState = {
              ...currentSession,
              outlineAttempt: outlineAttempt + 1,
              outlineRepairFeedback,
              sceneOutlines: null,
              previewPhase: 'preparing',
            };
            persistSession(retrySession);
            currentSession = retrySession;
            setStreamingOutlines([]);
            log.warn(
              `[GenerationPreview] Outline attempt ${outlineAttempt}/${MAX_OUTLINE_REQUEST_ATTEMPTS} requires a fresh request (${outlineError.reason}): ${outlineError.message}`,
            );
          }
        }

        if (!outlineResult) {
          throw new Error(t('generation.outlineGenerateFailed'));
        }

        outlines = outlineResult.outlines;
        languageDirective = outlineResult.languageDirective;
        courseTitle = outlineResult.courseTitle;
        const effectiveTaskEngineMode = outlineResult.taskEngineMode;
        setIsOutlineStreaming(false);

        // Mid-stream review intent (sticky ref) overrides the auto-continue timer.
        const userOpenedReviewEarly = outlineReviewIntentRef.current;
        const shouldReviewOutlines =
          useSettingsStore.getState().reviewOutlineEnabled || userOpenedReviewEarly;
        const updatedSession: GenerationSessionState = {
          ...currentSession,
          sceneOutlines: outlines,
          languageDirective,
          courseTitle,
          taskEngineMode: effectiveTaskEngineMode,
          outlineAttempt: undefined,
          outlineRepairFeedback: undefined,
          previewPhase: shouldReviewOutlines ? 'review' : 'outline-ready',
        };
        persistSession(updatedSession);
        currentSession = updatedSession;
        setStreamingOutlines(outlines);

        setStatusMessage(shouldReviewOutlines ? '' : t('generation.reviewOutlineAutoContinue'));
        setIsConfirmingOutlines(false);
        outlines = await waitForOutlineReviewChoice(outlines, shouldReviewOutlines, signal);
        clearOutlineReviewTimer();
        currentSession = {
          ...currentSession,
          sceneOutlines: outlines,
          taskEngineMode: effectiveTaskEngineMode,
          previewPhase: 'generating-content',
        };
        persistSession(currentSession);

        // User has committed to course generation (either by confirming the
        // outline review or by letting the auto-continue timer fire). Now it's
        // safe to wipe the homepage draft cache; before this point, "back to
        // requirements" must restore the user's original input.
        try {
          localStorage.removeItem('requirementDraft');
        } catch {
          /* ignore */
        }
      }

      // Move to next step
      setStatusMessage('');
      if (!outlines || outlines.length === 0) {
        throw new Error(t('generation.outlineEmptyResponse'));
      }
      stage.taskEngineMode = currentSession.taskEngineMode === true;

      // Store languageDirective on the stage
      if (languageDirective) {
        stage.languageDirective = languageDirective;
      }

      // Adopt the LLM-inferred course title as the stage name when available,
      // replacing the raw-requirement placeholder set at stage creation time.
      if (courseTitle) {
        stage.name = courseTitle;
      }

      // ── Agent generation (after outlines — uses languageDirective + outlines) ──
      const settings = useSettingsStore.getState();
      let agents: Array<{
        id: string;
        name: string;
        role: string;
        persona?: string;
      }> = [];

      if (settings.agentMode === 'auto') {
        const agentStepIdx = activeSteps.findIndex((s) => s.id === 'agent-generation');
        if (agentStepIdx >= 0) setCurrentStepIndex(agentStepIdx);

        try {
          const allAvatars = [
            {
              path: '/avatars/teacher.png',
              desc: 'Male teacher with glasses, holding a book, green background',
            },
            {
              path: '/avatars/teacher-2.png',
              desc: 'Female teacher with long dark hair, blue traditional outfit, gentle expression',
            },
            {
              path: '/avatars/assist.png',
              desc: 'Young female assistant with glasses, pink background, friendly smile',
            },
            {
              path: '/avatars/assist-2.png',
              desc: 'Young female in orange top and purple overalls, cheerful and approachable',
            },
            {
              path: '/avatars/clown.png',
              desc: 'Energetic girl with glasses pointing up, green shirt, lively and fun',
            },
            {
              path: '/avatars/clown-2.png',
              desc: 'Playful girl with curly hair doing rock gesture, blue shirt, humorous vibe',
            },
            {
              path: '/avatars/curious.png',
              desc: 'Surprised boy with glasses, hand on cheek, curious expression',
            },
            {
              path: '/avatars/curious-2.png',
              desc: 'Boy with backpack holding a book and question mark bubble, inquisitive',
            },
            {
              path: '/avatars/note-taker.png',
              desc: 'Studious boy with glasses, blue shirt, calm and organized',
            },
            {
              path: '/avatars/note-taker-2.png',
              desc: 'Active boy with yellow backpack waving, blue outfit, enthusiastic learner',
            },
            {
              path: '/avatars/thinker.png',
              desc: 'Thoughtful girl with hand on chin, purple background, contemplative',
            },
            {
              path: '/avatars/thinker-2.png',
              desc: 'Girl reading a book intently, long dark hair, intellectual and focused',
            },
          ];

          const getAvailableVoicesForGeneration = () => {
            const providers = getEnabledProvidersWithVoices(
              settings.ttsProvidersConfig,
              voxcpmProfiles,
            );
            return providers.flatMap((p) =>
              p.voices.map((v) => ({
                providerId: p.providerId,
                voiceId: v.id,
                voiceName: v.name,
                voiceLanguage: v.language,
              })),
            );
          };

          const agentResp = await fetch('/api/generate/agent-profiles', {
            method: 'POST',
            headers: getApiHeaders(),
            body: JSON.stringify(
              withThinkingConfig({
                stageInfo: { name: stage.name, description: stage.description },
                sceneOutlines: outlines.map((o) => ({
                  title: o.title,
                  description: o.description,
                })),
                languageDirective,
                availableAvatars: allAvatars.map((a) => a.path),
                avatarDescriptions: allAvatars.map((a) => ({ path: a.path, desc: a.desc })),
                availableVoices: getAvailableVoicesForGeneration(),
              }),
            ),
            signal,
          });

          if (!agentResp.ok) throw new Error('Agent generation failed');
          const agentData = await agentResp.json();
          if (!agentData.success) throw new Error(agentData.error || 'Agent generation failed');

          // Embed the roster (including its voice binding) on the stage — it
          // persists with the stage document via saveToStorage below — and
          // mirror it into the in-memory registry. The agent-profile LLM has
          // already bound each agent's voice (from availableVoices); the
          // fallback for an invalid/unavailable voice is applied later at the
          // live TTS call.
          const generatedConfigs = agentData.agents as GeneratedAgentConfig[];
          stage.generatedAgentConfigs = generatedConfigs;
          const { applyGeneratedAgentsToRegistry } =
            await import('@/lib/orchestration/registry/store');
          const savedIds = applyGeneratedAgentsToRegistry(stage.id, generatedConfigs);
          settings.setSelectedAgentIds(savedIds);
          // Stage-derived, not a user choice — must not carry across classrooms.
          settings.setAgentSelectionIsUserSet(false);
          stage.agentIds = savedIds;

          // Agent cards are an optional explanation surface. They must never
          // hold the durable classroom pipeline hostage while the learner is
          // away from the tab or chooses not to reveal every card.
          setGeneratedAgents(agentData.agents);
          setShowAgentReveal(true);

          agents = savedIds
            .map((id) => useAgentRegistry.getState().getAgent(id))
            .filter(Boolean)
            .map((a) => ({
              id: a!.id,
              name: a!.name,
              role: a!.role,
              persona: a!.persona,
            }));
        } catch (err: unknown) {
          log.warn('[Generation] Agent generation failed, falling back to presets:', err);
          const registry = useAgentRegistry.getState();
          const fallbackIds = settings.selectedAgentIds.filter((id) => {
            const a = registry.getAgent(id);
            return a && !a.isGenerated;
          });
          agents = fallbackIds
            .map((id) => registry.getAgent(id))
            .filter(Boolean)
            .map((a) => ({
              id: a!.id,
              name: a!.name,
              role: a!.role,
              persona: a!.persona,
            }));
          stage.agentIds = fallbackIds;
        }
      } else {
        // Preset mode — use selected agents (include persona)
        // Filter out stale generated agent IDs that may linger in settings
        const registry = useAgentRegistry.getState();
        const presetAgentIds = settings.selectedAgentIds.filter((id) => {
          const a = registry.getAgent(id);
          return a && !a.isGenerated;
        });
        agents = presetAgentIds
          .map((id) => registry.getAgent(id))
          .filter(Boolean)
          .map((a) => ({
            id: a!.id,
            name: a!.name,
            role: a!.role,
            persona: a!.persona,
          }));
        stage.agentIds = presetAgentIds;
      }

      // Move to scene generation step
      setStatusMessage('');
      if (!outlines || outlines.length === 0) {
        throw new Error(t('generation.outlineEmptyResponse'));
      }

      // Generation, validation, and publication are separate durable phases.
      // From this point the browser only observes or safely advances one leased
      // step; it never publishes a partial classroom.
      stage.videoManifest = buildVideoManifestFromOutlines(outlines);
      const durableContentStepIdx = activeSteps.findIndex((s) => s.id === 'slide-content');
      if (durableContentStepIdx >= 0) setCurrentStepIndex(durableContentStepIdx);
      const durableSourceContext = mergeCourseSourceContext(
        currentSession.pdfText,
        currentSession.researchContext,
      );
      if (!durableSourceContext.trim()) {
        throw new Error('没有可冻结的课程证据，无法进入高质量生成。');
      }
      const durableUserProfile =
        currentSession.requirements.userNickname || currentSession.requirements.userBio
          ? `Student: ${currentSession.requirements.userNickname || 'Unknown'}${
              currentSession.requirements.userBio ? ` — ${currentSession.requirements.userBio}` : ''
            }`
          : undefined;
      const durableSourceMode =
        currentSession.requirements.learningProject?.sourceMode ??
        (currentSession.sourceBundleId ? 'obsidian' : 'external');
      const durableSourceReferences = buildCourseSourceReferences(currentSession);
      const durableImages = currentSession.pdfImages?.map((image) => ({
        ...image,
        src: imageMapping[image.id] ?? image.src,
      }));
      const jobInput: CourseGenerationJobInput = {
        planningRunId: currentSession.coursePlanId,
        stage,
        outlines,
        requirements: currentSession.requirements,
        sourceContext: durableSourceContext,
        sourceMode: durableSourceMode,
        sourceReferences: durableSourceReferences,
        ...(durableImages?.length ? { pdfImages: durableImages } : {}),
        ...(Object.keys(imageMapping).length ? { imageMapping } : {}),
        ...(stage.generatedAgentConfigs?.length
          ? {
              agents: stage.generatedAgentConfigs.map((agent) => ({
                id: agent.id,
                name: agent.name,
                role: agent.role,
                persona: agent.persona,
              })),
            }
          : agents.length
            ? { agents }
            : {}),
        ...(durableUserProfile ? { userProfile: durableUserProfile } : {}),
        ...(languageDirective ? { languageDirective } : {}),
        // Replaced by the trusted request origin in the API handler.
        baseUrl: window.location.origin,
      };
      setStatusMessage('正在冻结并持久化本次课程资料…');
      const inputRef = await stageCourseInput(jobInput, currentSession.sessionId, stage.id);
      setStatusMessage('正在创建可恢复的课程任务…');
      const durableResponse = await fetch('/api/v1/course-jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inputRef,
          idempotencyKey: `course:${currentSession.sessionId}:${stage.id}`,
        }),
        signal,
      });
      const durableBody = (await durableResponse.json().catch(() => ({}))) as {
        success?: boolean;
        job?: CourseGenerationJobView;
        queueMode?: 'qstash' | 'client-resume';
        error?: string;
        details?: string;
      };
      if (!durableResponse.ok || !durableBody.success || !durableBody.job) {
        throw new Error(durableBody.details || durableBody.error || '持久化课程任务创建失败。');
      }
      const durableSession: GenerationSessionState = {
        ...currentSession,
        courseJobId: durableBody.job.id,
        courseClassroomId: durableBody.job.classroomId,
        courseQueueMode: durableBody.queueMode ?? 'client-resume',
        courseJobProgress: durableBody.job.progress,
        courseJobUpdatedAt: durableBody.job.updatedAt,
        previewPhase: 'durable-generating',
      };
      persistSession(durableSession);
      await monitorCourseJob(
        durableSession,
        durableBody.job.id,
        durableBody.queueMode ?? 'client-resume',
        signal,
      );
      return;
    } catch (err) {
      setIsOutlineStreaming(false);
      // AbortError is expected when navigating away — don't show as error
      if (isAbortError(err)) {
        log.info('[GenerationPreview] Generation aborted');
        // A browser reload or embedded-webview reconnect can abort the client
        // response after the server has already accepted the idempotent plan.
        // Restart the same session instead of leaving a static “starting” UI;
        // the stable request key resolves to the frozen plan, not a duplicate.
        if (abortControllerRef.current === controller) {
          hasStartedRef.current = false;
          setStatusMessage('连接已恢复，正在读取已冻结的课堂进度…');
          window.setTimeout(() => {
            if (abortControllerRef.current === controller && sessionStorage.getItem('generationSession')) {
              setGenerationRestartNonce((value) => value + 1);
            }
          }, 300);
        }
        return;
      }
      // Preserve the expensive generation input and the last repair
      // checkpoint. Refresh or the explicit retry action can resume it.
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const extractTopicFromRequirement = (requirement: string): string => {
    const trimmed = requirement.trim();
    if (trimmed.length <= 500) {
      return trimmed;
    }
    return trimmed.substring(0, 500).trim() + '...';
  };

  const goBackToHome = () => {
    abortControllerRef.current?.abort();
    clearOutlineReviewTimer();
    outlineReviewIntentRef.current = false;
    sessionStorage.removeItem('generationSession');
    clearGenerationRecoverySession(localStorage);
    announceGenerationSessionChange();
    router.push('/');
  };

  const retryGeneration = async () => {
    if (!session) return;
    if (session.courseJobId) {
      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;
      setError(null);
      setStatusMessage('正在保留已通过页面，并从失败场景继续修复…');
      try {
        const resumed = await resumeFailedCourseJob(session.courseJobId, controller.signal);
        const retrySession: GenerationSessionState = {
          ...session,
          courseQueueMode: resumed.queueMode,
          courseJobProgress: resumed.job.progress,
          courseJobUpdatedAt: resumed.job.updatedAt,
          previewPhase: 'durable-generating',
        };
        persistSession(retrySession);
        await monitorCourseJob(
          retrySession,
          session.courseJobId,
          resumed.queueMode,
          controller.signal,
        );
      } catch (retryError) {
        if (isAbortError(retryError)) return;
        setError(retryError instanceof Error ? retryError.message : String(retryError));
      }
      return;
    }
    if (session.coursePlanId) {
      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;
      setError(null);
      setStatusMessage('正在从已冻结资料与持久化检查点恢复课程工作流…');
      try {
        const resumedPlan = await resumeFailedCoursePlan(session.coursePlanId, controller.signal);
        const retrySession: GenerationSessionState = {
          ...session,
          requirements: resumedPlan.input.requirements,
          pdfText: resumedPlan.input.documentText,
          researchContext: resumedPlan.input.researchText,
          sourceContextCharCount:
            resumedPlan.input.sourceContextExpectedChars ?? session.sourceContextCharCount,
          ...(resumedPlan.outlines?.length
            ? {
                sceneOutlines: resumedPlan.outlines,
                languageDirective: resumedPlan.languageDirective,
                courseTitle: resumedPlan.courseTitle,
                taskEngineMode: resumedPlan.taskEngineMode,
              }
            : {}),
          previewPhase: 'preparing',
        };
        persistSession(retrySession);
        await monitorCoursePlan(retrySession, resumedPlan.id, controller.signal);
      } catch (retryError) {
        if (isAbortError(retryError)) return;
        setError(retryError instanceof Error ? retryError.message : String(retryError));
      }
      return;
    }
    const canReuseReviewedOutlines = Boolean(session.sceneOutlines?.length);
    const retrySession: GenerationSessionState = {
      ...session,
      courseJobId: undefined,
      courseClassroomId: undefined,
      courseQueueMode: undefined,
      courseJobProgress: undefined,
      courseJobUpdatedAt: undefined,
      sceneOutlines: canReuseReviewedOutlines ? session.sceneOutlines : null,
      outlineAttempt: canReuseReviewedOutlines ? undefined : 1,
      outlineRepairFeedback: undefined,
      previewPhase: canReuseReviewedOutlines ? 'generating-content' : 'preparing',
    };
    persistSession(retrySession);
    setStatusMessage(
      canReuseReviewedOutlines
        ? '正在保留已审查来源与大纲，直接重新创建持久化课堂任务…'
        : '正在重新生成课堂大纲…',
    );
    hasStartedRef.current = true;
    void startGeneration(retrySession);
  };

  // Triggered when the user clicks the streaming outline card mid-stream.
  // SSE keeps running; only the surface morph + intent flag change.
  const handleExpandStreamingOutline = () => {
    if (!session) return;
    clearOutlineReviewTimer();
    setStatusMessage('');
    outlineReviewIntentRef.current = true;
    persistSession({
      ...session,
      previewPhase: 'review',
    });
  };

  // Inverse of expand. Mid-stream: shrink back to the streaming preview card so
  // the user can keep watching while SSE fills in the rest. Post-stream: shrink
  // back to the small card too, then re-arm the 2.5s auto-continue timer — same
  // pacing as the no-review path so the user has a beat to see the card before
  // the page advances. Jumping straight to content gen feels too abrupt.
  const handleCollapseEditor = () => {
    if (!session) return;
    if (isOutlineStreaming) {
      // Intentionally drop the review-intent flag: collapsing mid-stream is the
      // user saying "actually, never mind". When SSE finishes, the no-early-open
      // path runs and the standard `reviewOutlineEnabled` / auto-continue rules
      // decide what happens next. There is no parked promise to settle yet —
      // the promise is created only after SSE completes (see line 583).
      outlineReviewIntentRef.current = false;
      persistSession({ ...session, previewPhase: 'preparing' });
      setStatusMessage('');
      return;
    }
    const collapsedOutlines = session.sceneOutlines ?? streamingOutlines;
    if (!collapsedOutlines || collapsedOutlines.length === 0) return;
    outlineReviewIntentRef.current = false;
    persistSession({
      ...session,
      sceneOutlines: collapsedOutlines,
      previewPhase: 'outline-ready',
    });
    setStatusMessage(t('generation.reviewOutlineAutoContinue'));

    // Re-arm the auto-continue timer. The SSE-completion flow is parked inside
    // `waitForOutlineReviewChoice` (because `shouldReview` was true when the
    // user opened the editor) — fire its resolve via a fresh timeout to match
    // the no-review path's pacing.
    clearOutlineReviewTimer();
    outlineReviewTimerRef.current = setTimeout(() => {
      outlineReviewTimerRef.current = null;
      const resolve = outlineReviewResolveRef.current;
      outlineReviewResolveRef.current = null;
      if (resolve) {
        resolve(collapsedOutlines);
        return;
      }
      // No parked promise (e.g. session was restored from a refresh into
      // 'review' state). Drive the transition ourselves.
      const confirmedSession: GenerationSessionState = {
        ...session,
        sceneOutlines: collapsedOutlines,
        previewPhase: 'generating-content',
      };
      persistSession(confirmedSession);
      hasStartedRef.current = true;
      void startGeneration(confirmedSession);
    }, OUTLINE_REVIEW_AUTO_CONTINUE_MS);
  };

  const handleOutlinesChange = (outlines: SceneOutline[]) => {
    if (!session) return;
    // Streaming SSE owns `streamingOutlines` while it's running; ignore editor
    // changes until the stream completes (the editor is read-only in that state
    // anyway, but guard defensively against any racy event).
    if (isOutlineStreaming) return;
    persistSession({
      ...session,
      sceneOutlines: outlines,
      previewPhase: 'review',
    });
  };

  const handleConfirmOutlines = () => {
    const finalOutlines = session?.sceneOutlines ?? streamingOutlines;
    if (!finalOutlines || finalOutlines.length === 0) return;
    setIsConfirmingOutlines(true);
    clearOutlineReviewTimer();
    outlineReviewIntentRef.current = false;

    if (outlineReviewResolveRef.current) {
      const resolve = outlineReviewResolveRef.current;
      outlineReviewResolveRef.current = null;
      resolve(finalOutlines);
      return;
    }

    // Fallback: no parked promise (session restored mid-review). The button's
    // loading state was set above to give the click immediate feedback, but the
    // editor is about to unmount anyway as we drive the next phase ourselves.
    // Reset the flag so the state doesn't linger if `startGeneration` later
    // re-renders the editor for any reason.
    setIsConfirmingOutlines(false);
    const confirmedSession: GenerationSessionState = {
      ...(session as GenerationSessionState),
      sceneOutlines: finalOutlines,
      previewPhase: 'generating-content',
    };
    persistSession(confirmedSession);
    hasStartedRef.current = true;
    void startGeneration(confirmedSession);
  };

  // Still loading session from sessionStorage
  if (!sessionLoaded) {
    return (
      <div className="min-h-[100dvh] w-full bg-gradient-to-b from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900 flex items-center justify-center p-4">
        <div className="text-center text-muted-foreground">
          <div className="size-8 border-2 border-current border-t-transparent rounded-full animate-spin mx-auto" />
        </div>
      </div>
    );
  }

  // No session found
  if (!session) {
    return (
      <div className="min-h-[100dvh] w-full bg-gradient-to-b from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900 flex items-center justify-center p-4">
        <Card className="p-8 max-w-md w-full">
          <div className="text-center space-y-4">
            <AlertCircle className="size-12 text-muted-foreground mx-auto" />
            <h2 className="text-xl font-semibold">{t('generation.sessionNotFound')}</h2>
            <p className="text-sm text-muted-foreground">{t('generation.sessionNotFoundDesc')}</p>
            <Button onClick={() => router.push('/')} className="w-full">
              <ArrowLeft className="size-4 mr-2" />
              {t('generation.backToHome')}
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  const activeStep =
    activeSteps.length > 0
      ? activeSteps[Math.min(currentStepIndex, activeSteps.length - 1)]
      : ALL_STEPS[0];
  const activeStepText = getGenerationStepText(activeStep, session);
  const failureGuidance = error ? describeGenerationFailure(error) : null;

  if (isReviewingOutlines) {
    const outlineStepIndex = Math.max(
      0,
      activeSteps.findIndex((step) => step.id === 'outline'),
    );
    // Editor source-of-truth: prefer the persisted final list; fall back to the
    // live streaming buffer so the editor can render mid-stream after expansion.
    const editorOutlines = session.sceneOutlines ?? streamingOutlines ?? [];

    return (
      <div className="min-h-[100dvh] w-full bg-gradient-to-b from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900 flex flex-col items-center p-4 relative overflow-hidden">
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="absolute top-4 left-4 z-20"
        >
          <Button variant="ghost" size="sm" onClick={goBackToHome} disabled={isConfirmingOutlines}>
            <ArrowLeft className="size-4 mr-2" />
            {t('generation.backToHome')}
          </Button>
        </motion.div>

        <div className="z-10 w-full max-w-3xl pt-16 pb-8">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-6"
          >
            <div className="flex justify-center gap-2">
              {activeSteps.map((step, idx) => (
                <div
                  key={step.id}
                  className={cn(
                    'h-1.5 rounded-full transition-all duration-500',
                    idx < outlineStepIndex
                      ? 'w-1.5 bg-blue-500/30'
                      : idx === outlineStepIndex
                        ? 'w-8 bg-blue-500'
                        : 'w-1.5 bg-muted/50',
                  )}
                />
              ))}
            </div>

            <div className="max-w-2xl space-y-2 text-center mx-auto">
              <h2 className="text-2xl font-bold tracking-tight">
                {t('generation.reviewOutlineTitle')}
              </h2>
              <p className="text-muted-foreground text-sm md:text-base">
                {isOutlineStreaming
                  ? t('generation.reviewOutlineStreamingDesc')
                  : t('generation.reviewOutlineDesc')}
              </p>
            </div>

            {error && (
              <div className="mx-auto max-w-2xl rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-left text-sm text-red-700 dark:text-red-200">
                <p className="font-semibold">{failureGuidance?.title}</p>
                <p className="mt-1 text-red-700/80 dark:text-red-200/80">
                  {failureGuidance?.recovery}
                </p>
              </div>
            )}

            <OutlinesEditor
              outlines={editorOutlines}
              onChange={handleOutlinesChange}
              onConfirm={handleConfirmOutlines}
              onBack={goBackToHome}
              alwaysReview={reviewOutlineEnabled}
              onAlwaysReviewChange={setReviewOutlineEnabled}
              isLoading={isConfirmingOutlines}
              isStreaming={isOutlineStreaming}
              onCollapse={handleCollapseEditor}
            />
          </motion.div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] w-full bg-gradient-to-b from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900 flex flex-col items-center justify-center p-4 relative overflow-hidden text-center">
      {/* Background Decor */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none z-0">
        <div
          className="absolute top-0 left-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl animate-pulse"
          style={{ animationDuration: '4s' }}
        />
        <div
          className="absolute bottom-0 right-1/4 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl animate-pulse"
          style={{ animationDuration: '6s' }}
        />
      </div>

      {/* Back button */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="absolute top-4 left-4 z-20"
      >
        <Button variant="ghost" size="sm" onClick={goBackToHome}>
          <ArrowLeft className="size-4 mr-2" />
          {t('generation.backToHome')}
        </Button>
      </motion.div>

      <div className="z-10 w-full max-w-lg space-y-8 flex flex-col items-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="w-full"
        >
          <Card className="relative overflow-hidden border-muted/40 shadow-2xl bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl min-h-[400px] flex flex-col items-center justify-center p-8 md:p-12">
            {/* Progress Dots */}
            <div className="absolute top-6 left-0 right-0 flex justify-center gap-2">
              {activeSteps.map((step, idx) => (
                <div
                  key={step.id}
                  className={cn(
                    'h-1.5 rounded-full transition-all duration-500',
                    idx < currentStepIndex
                      ? 'w-1.5 bg-blue-500/30'
                      : idx === currentStepIndex
                        ? 'w-8 bg-blue-500'
                        : 'w-1.5 bg-muted/50',
                  )}
                />
              ))}
            </div>

            {/* Central Content */}
            <div className="flex-1 flex flex-col items-center justify-center w-full space-y-8 mt-4">
              {/* Icon / Visualizer Container */}
              <div className="relative size-48 flex items-center justify-center">
                <AnimatePresence mode="popLayout">
                  {error ? (
                    <motion.div
                      key="error"
                      initial={{ scale: 0.5, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      className="size-32 rounded-full bg-red-500/10 flex items-center justify-center border-2 border-red-500/20"
                    >
                      <AlertCircle className="size-16 text-red-500" />
                    </motion.div>
                  ) : isComplete ? (
                    <motion.div
                      key="complete"
                      initial={{ scale: 0.5, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      className="size-32 rounded-full bg-green-500/10 flex items-center justify-center border-2 border-green-500/20"
                    >
                      <CheckCircle2 className="size-16 text-green-500" />
                    </motion.div>
                  ) : (
                    <motion.div
                      key={activeStep.id}
                      initial={{ scale: 0.8, opacity: 0, filter: 'blur(10px)' }}
                      animate={{ scale: 1, opacity: 1, filter: 'blur(0px)' }}
                      exit={{ scale: 1.2, opacity: 0, filter: 'blur(10px)' }}
                      transition={{ duration: 0.4 }}
                      className="absolute inset-0 flex items-center justify-center"
                    >
                      <StepVisualizer
                        stepId={activeStep.id}
                        outlines={session.sceneOutlines ?? streamingOutlines}
                        webSearchSources={webSearchSources}
                        onExpandOutline={
                          activeStep.id === 'outline' ? handleExpandStreamingOutline : undefined
                        }
                      />
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Text Content */}
              <div className="space-y-3 max-w-sm mx-auto">
                <AnimatePresence mode="wait">
                  <motion.div
                    key={error ? 'error' : isComplete ? 'done' : activeStep.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="space-y-2"
                  >
                    <h2 className="text-2xl font-bold tracking-tight">
                      {error
                        ? failureGuidance?.title
                        : isComplete
                          ? t('generation.generationComplete')
                          : t(activeStepText.title, activeStepText.titleValues)}
                    </h2>
                    <p className="text-muted-foreground text-base">
                      {error
                        ? failureGuidance?.summary
                        : isComplete
                          ? t('generation.classroomReady')
                          : statusMessage || t(activeStepText.description)}
                    </p>
                    {failureGuidance && (
                      <p className="mx-auto max-w-sm text-sm font-medium text-slate-700 dark:text-slate-200">
                        {failureGuidance.recovery}
                      </p>
                    )}
                    {session.courseJobId && !error && (
                      <div className="mx-auto mt-4 w-full max-w-xs space-y-2 text-left">
                        <div className="h-2 overflow-hidden rounded-full bg-slate-200/80 dark:bg-slate-800">
                          <motion.div
                            className="h-full rounded-full bg-gradient-to-r from-violet-600 via-blue-500 to-cyan-400"
                            initial={false}
                            animate={{ width: `${Math.max(2, session.courseJobProgress ?? 0)}%` }}
                            transition={{ duration: 0.45, ease: 'easeOut' }}
                          />
                        </div>
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span>
                            {session.previewPhase === 'verifying-release'
                              ? '整课质量验证与正式发布'
                              : '逐场景生成与质量验证'}
                          </span>
                          <span>{Math.round(session.courseJobProgress ?? 0)}%</span>
                        </div>
                        <p className="text-center text-[11px] leading-5 text-muted-foreground/80">
                          页面关闭后任务仍可恢复；课堂只会在全部场景通过后开放。
                        </p>
                      </div>
                    )}
                    {error && (
                      <Button type="button" onClick={retryGeneration} className="mt-4">
                        {session.courseJobId ? '从失败场景继续修复' : t('generation.retryScene')}
                      </Button>
                    )}
                  </motion.div>
                </AnimatePresence>

                {/* Truncation warning indicator */}
                <AnimatePresence>
                  {truncationWarnings.length > 0 && !error && !isComplete && (
                    <motion.div
                      initial={{ opacity: 0, scale: 0 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0 }}
                      transition={{
                        type: 'spring',
                        stiffness: 500,
                        damping: 30,
                      }}
                      className="flex justify-center"
                    >
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <motion.button
                            type="button"
                            animate={{
                              boxShadow: [
                                '0 0 0 0 rgba(251, 191, 36, 0), 0 0 0 0 rgba(251, 191, 36, 0)',
                                '0 0 16px 4px rgba(251, 191, 36, 0.12), 0 0 4px 1px rgba(251, 191, 36, 0.08)',
                                '0 0 0 0 rgba(251, 191, 36, 0), 0 0 0 0 rgba(251, 191, 36, 0)',
                              ],
                            }}
                            transition={{
                              duration: 3,
                              repeat: Infinity,
                              ease: 'easeInOut',
                            }}
                            className="relative size-7 rounded-full flex items-center justify-center cursor-default
                                       bg-gradient-to-br from-amber-400/15 to-orange-400/10
                                       border border-amber-400/25 hover:border-amber-400/40
                                       hover:from-amber-400/20 hover:to-orange-400/15
                                       transition-colors duration-300
                                       focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/30"
                          >
                            <AlertTriangle
                              className="size-3.5 text-amber-500 dark:text-amber-400"
                              strokeWidth={2.5}
                            />
                          </motion.button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" sideOffset={6}>
                          <div className="space-y-1 py-0.5">
                            {truncationWarnings.map((w, i) => (
                              <p key={i} className="text-xs leading-relaxed">
                                {w}
                              </p>
                            ))}
                          </div>
                        </TooltipContent>
                      </Tooltip>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </Card>
        </motion.div>

        {/* Footer Action */}
        <div className="h-16 flex items-center justify-center w-full">
          <AnimatePresence>
            {error ? (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex w-full max-w-sm flex-col gap-2 sm:flex-row"
              >
                {failureGuidance?.canResume && (
                  <Button size="lg" className="h-12 flex-1" onClick={() => void retryGeneration()}>
                    从已保存进度继续
                  </Button>
                )}
                <Button size="lg" variant="outline" className="h-12 flex-1" onClick={goBackToHome}>
                  返回调整资料
                </Button>
              </motion.div>
            ) : isOutlineReady ? null : !isComplete ? (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex items-center gap-3 text-sm text-muted-foreground/50 font-medium uppercase tracking-widest"
              >
                <Sparkles className="size-3 animate-pulse" />
                {t('generation.aiWorking')}
                {generatedAgents.length > 0 && !showAgentReveal && (
                  <button
                    onClick={() => setShowAgentReveal(true)}
                    className="ml-2 flex items-center gap-1.5 rounded-full border border-purple-300/30 bg-purple-500/10 px-3 py-1 text-xs font-medium normal-case tracking-normal text-purple-400 transition-colors hover:bg-purple-500/20 hover:text-purple-300"
                  >
                    <Bot className="size-3" />
                    {t('generation.viewAgents')}
                  </button>
                )}
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      </div>

      {/* Agent Reveal Modal */}
      <AgentRevealModal
        agents={generatedAgents}
        open={showAgentReveal}
        onClose={() => setShowAgentReveal(false)}
        onAllRevealed={() => setShowAgentReveal(false)}
      />
    </div>
  );
}

export default function GenerationPreviewPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-[100dvh] w-full bg-gradient-to-b from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900 flex items-center justify-center">
          <div className="animate-pulse space-y-4 text-center">
            <div className="h-8 w-48 bg-muted rounded mx-auto" />
            <div className="h-4 w-64 bg-muted rounded mx-auto" />
          </div>
        </div>
      }
    >
      <GenerationPreviewContent />
    </Suspense>
  );
}
