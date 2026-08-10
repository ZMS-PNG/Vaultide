import { ScanLine, Search, Bot, FileText, LayoutPanelLeft, Clapperboard } from 'lucide-react';
import { useSettingsStore } from '@/lib/store/settings';
import type {
  SceneOutline,
  UserRequirements,
  PdfImage,
  ImageMapping,
  SessionDocumentSource,
} from '@/lib/types/generation';
import type { StageResearchSource } from '@openmaic/dsl';
import type { WebSearchProvenance } from '@/lib/types/web-search';
import type {
  ExternalEvidenceMode,
  ExternalEvidenceStatus,
} from '@/lib/generation/external-evidence-policy';
import { externalEvidenceRequested } from '@/lib/generation/external-evidence-policy';

// Session state stored in sessionStorage
export interface GenerationSessionState {
  sessionId: string;
  /** Private SourceBundle that launched this learning session, when present. */
  sourceBundleId?: string;
  /** Durable project context resolved from the validated upload sidecar. */
  projectId?: string;
  projectName?: string;
  projectRevision?: number;
  /** Durable goal-directed project retrieval that selected the learning excerpts. */
  retrievalRunId?: string;
  retrievalStrategy?: string;
  retrievedSourceCount?: number;
  retrievedChunkCount?: number;
  retrievalMatchQuality?: 'strong' | 'weak';
  retrievalUnavailableSourceCount?: number;
  projectCoverageState?: 'authorized-index-complete' | 'authorized-index-partial';
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
  requirements: UserRequirements;
  pdfText: string;
  /**
   * Raw character count recorded when the reviewed source set is launched.
   * Used only as an integrity invariant; the source body remains private.
   */
  sourceContextCharCount?: number;
  documentSources?: SessionDocumentSource[];
  pdfImages?: PdfImage[];
  imageStorageIds?: string[];
  imageMapping?: ImageMapping;
  sceneOutlines?: SceneOutline[] | null;
  currentStep: 'generating' | 'complete';
  previewPhase?:
    | 'preparing'
    | 'outline-ready'
    | 'review'
    | 'generating-content'
    | 'durable-generating'
    | 'verifying-release';
  /** Server-owned planning record created before the first outline LLM call. */
  coursePlanId?: string;
  /** Server-owned durable generation job. Refresh resumes this job instead of creating another. */
  courseJobId?: string;
  courseClassroomId?: string;
  courseQueueMode?: 'workflow' | 'qstash' | 'client-resume';
  courseJobProgress?: number;
  courseJobUpdatedAt?: string;
  // PDF deferred parsing fields
  pdfStorageKey?: string;
  pdfFileName?: string;
  documentMimeType?: string;
  pdfProviderId?: string;
  pdfProviderConfig?: {
    apiKey?: string;
    baseUrl?: string;
    accessKeyId?: string;
    accessKeySecret?: string;
  };
  // Web search context
  researchContext?: string;
  researchSources?: StageResearchSource[];
  researchProvenance?: WebSearchProvenance;
  externalEvidenceMode?: ExternalEvidenceMode;
  externalEvidenceStatus?: ExternalEvidenceStatus;
  externalEvidenceWarning?: string;
  // Language directive inferred from outline generation
  languageDirective?: string;
  // Concise course title inferred from outline generation (used as the stage name)
  courseTitle?: string;
  // Server-effective vocational mode from the outline generation done event.
  taskEngineMode?: boolean;
  /** Next cross-request outline attempt (1-based), persisted across refresh. */
  outlineAttempt?: number;
  /** Server quality/parse feedback carried into the next independent request. */
  outlineRepairFeedback?: string;
}

export type GenerationStep = {
  id: string;
  title: string;
  description: string;
  icon: React.ElementType;
  type: 'analysis' | 'writing' | 'visual';
};

const MEDIA_EXTENSIONS = new Set(['mp4', 'mkv', 'avi', 'mov', 'wmv', 'mp3', 'wav', 'aac', 'm4a']);

/** True when the uploaded material is audio/video (extraction is transcription). */
function isMediaMaterial(session: GenerationSessionState | null): boolean {
  const mimeType = session?.documentMimeType;
  if (mimeType && (mimeType.startsWith('video/') || mimeType.startsWith('audio/'))) return true;
  const extension = session?.pdfFileName?.split('.').pop()?.trim().toLowerCase();
  return !!extension && MEDIA_EXTENSIONS.has(extension);
}

export function getGenerationStepText(
  step: GenerationStep,
  session: GenerationSessionState | null,
) {
  if (step.id === 'pdf-analysis') {
    // Audio/video use a dedicated string ("Analyzing audio/video") — the
    // generic document copy ("Analyzing documents") would misdescribe them.
    if (isMediaMaterial(session)) {
      return {
        title: 'generation.analyzingMediaMaterial',
        titleValues: undefined,
        description: 'generation.analyzingCourseMaterialDesc',
      };
    }
    return {
      title: 'generation.analyzingCourseMaterial',
      titleValues: undefined,
      description: 'generation.analyzingCourseMaterialDesc',
    };
  }
  return {
    title: step.title,
    titleValues: undefined,
    description: step.description,
  };
}

export const ALL_STEPS: GenerationStep[] = [
  {
    id: 'pdf-analysis',
    title: 'generation.analyzingCourseMaterial',
    description: 'generation.analyzingCourseMaterialDesc',
    icon: ScanLine,
    type: 'analysis',
  },
  {
    id: 'web-search',
    title: 'generation.webSearching',
    description: 'generation.webSearchingDesc',
    icon: Search,
    type: 'analysis',
  },
  {
    id: 'outline',
    title: 'generation.generatingOutlines',
    description: 'generation.generatingOutlinesDesc',
    icon: FileText,
    type: 'writing',
  },
  {
    id: 'agent-generation',
    title: 'generation.agentGeneration',
    description: 'generation.agentGenerationDesc',
    icon: Bot,
    type: 'writing',
  },
  {
    id: 'slide-content',
    title: 'generation.generatingSlideContent',
    description: 'generation.generatingSlideContentDesc',
    icon: LayoutPanelLeft,
    type: 'visual',
  },
  {
    id: 'actions',
    title: 'generation.generatingActions',
    description: 'generation.generatingActionsDesc',
    icon: Clapperboard,
    type: 'visual',
  },
];

export const getActiveSteps = (session: GenerationSessionState | null) => {
  return ALL_STEPS.filter((step) => {
    if (step.id === 'pdf-analysis') {
      return Boolean(
        session?.pdfStorageKey ||
        ((session?.documentSources?.length ?? 0) > 0 && !session?.pdfText),
      );
    }
    if (step.id === 'web-search')
      return session ? externalEvidenceRequested(session.requirements) : false;
    if (step.id === 'agent-generation') return useSettingsStore.getState().agentMode === 'auto';
    return true;
  });
};
