import { describe, expect, it } from 'vitest';
import {
  GENERATION_RECOVERY_STORAGE_KEY,
  buildGenerationRecoverySession,
  loadGenerationRecoverySession,
  persistGenerationRecoverySession,
  recoverGenerationSourceContext,
} from '@/app/generation-preview/session-recovery';
import { projectRetrievalStorageKey } from '@/lib/learning/client/project-retrieval-cache';
import { assessSourceReadiness } from '@/lib/generation/course-quality';
import type { GenerationSessionState } from '@/app/generation-preview/types';

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}

function activeSession(): GenerationSessionState {
  return {
    sessionId: 'session-1',
    projectId: 'project-1',
    projectName: '微信小程序',
    requirements: {
      requirement: '在 45 分钟内理解项目架构，并能解释关键状态迁移。',
    },
    pdfText: 'private source text',
    documentSources: [
      {
        id: 'doc-1',
        name: 'private.md',
        storageKey: 'private-storage-key',
        mimeType: 'text/markdown',
        size: 123,
        order: 0,
      },
    ],
    pdfProviderConfig: { apiKey: 'must-not-persist' },
    currentStep: 'generating',
    previewPhase: 'durable-generating',
    courseJobId: 'cgj_2a356069d5304a03b5be451f0d03dd0c',
    courseClassroomId: 'classroom-1',
    courseQueueMode: 'client-resume',
    courseJobProgress: 61,
  };
}

describe('durable generation session recovery', () => {
  it('persists only the metadata needed to reconnect to the server job', () => {
    const storage = memoryStorage();
    persistGenerationRecoverySession(storage, activeSession(), new Date('2026-07-29T12:00:00Z'));

    const raw = storage.getItem(GENERATION_RECOVERY_STORAGE_KEY);
    expect(raw).toBeTruthy();
    expect(raw).not.toContain('private source text');
    expect(raw).not.toContain('private-storage-key');
    expect(raw).not.toContain('must-not-persist');

    const recovered = loadGenerationRecoverySession(storage, new Date('2026-07-29T12:05:00Z'));
    expect(recovered).toMatchObject({
      sessionId: 'session-1',
      projectId: 'project-1',
      courseJobId: 'cgj_2a356069d5304a03b5be451f0d03dd0c',
      courseJobProgress: 61,
      previewPhase: 'durable-generating',
      pdfText: '',
    });
  });

  it('does not create a recovery record before a durable job exists', () => {
    const session = activeSession();
    delete session.courseJobId;
    expect(buildGenerationRecoverySession(session)).toBeNull();
  });

  it('recovers a frozen planning run before a durable job exists', () => {
    const storage = memoryStorage();
    const session = activeSession();
    delete session.courseJobId;
    session.coursePlanId = 'cpl_2a356069d5304a03b5be451f0d03dd0c';
    session.previewPhase = 'preparing';

    persistGenerationRecoverySession(storage, session, new Date('2026-07-29T12:00:00Z'));
    const recovered = loadGenerationRecoverySession(storage, new Date('2026-07-29T12:05:00Z'));

    expect(recovered).toMatchObject({
      coursePlanId: 'cpl_2a356069d5304a03b5be451f0d03dd0c',
      previewPhase: 'preparing',
      pdfText: '',
    });
    expect(storage.getItem(GENERATION_RECOVERY_STORAGE_KEY)).not.toContain('private source text');
  });

  it('removes expired or malformed recovery records', () => {
    const storage = memoryStorage();
    persistGenerationRecoverySession(storage, activeSession(), new Date('2026-06-01T00:00:00Z'));

    expect(loadGenerationRecoverySession(storage, new Date('2026-07-29T00:00:00Z'))).toBeNull();
    expect(storage.getItem(GENERATION_RECOVERY_STORAGE_KEY)).toBeNull();
  });
});

describe('reviewed project source recovery', () => {
  it('restores a 39k reviewed SourceBundle before outline generation', () => {
    const storage = memoryStorage();
    const context =
      `--- [V1] README.md ---\n${'可审计的项目架构、数据流、边界与验收证据。'.repeat(2_000)}`.slice(
        0,
        39_163,
      );
    const session: GenerationSessionState = {
      sessionId: 'session-source-1',
      sourceBundleId: 'bundle-1',
      projectId: 'project-1',
      projectRevision: 7,
      retrievalRunId: 'retrieval-1',
      sourceContextCharCount: context.length,
      retrievalCitations: [
        {
          citationId: 'V1',
          sourceId: 'source-1',
          sourceVersionId: 'version-1',
          chunkId: 'chunk-1',
          relativePath: 'README.md',
          headingPath: [],
          excerptChars: context.length - 24,
          contentHash: 'hash-1',
        },
      ],
      requirements: {
        requirement: '理解项目架构与数据流',
        webSearch: true,
      },
      pdfText: 'truncated',
      currentStep: 'generating',
      previewPhase: 'preparing',
    };
    storage.setItem(
      projectRetrievalStorageKey('bundle-1'),
      JSON.stringify({
        goal: session.requirements.requirement,
        savedAt: Date.now(),
        retrieval: {
          retrievalId: 'retrieval-1',
          context,
          project: { projectId: 'project-1', projectRevision: 7 },
          metrics: { contextCharCount: context.length },
        },
      }),
    );

    const recovered = recoverGenerationSourceContext(storage, session);

    expect(recovered.recovered).toBe(true);
    expect(recovered.missingExpectedContext).toBe(false);
    expect(recovered.session.pdfText).toHaveLength(39_163);
    expect(
      assessSourceReadiness({
        pdfText: recovered.session.pdfText,
        webSearchEnabled: true,
      }).passed,
    ).toBe(true);
  });

  it('refuses to mix a cached retrieval from another project revision', () => {
    const storage = memoryStorage();
    const session: GenerationSessionState = {
      sessionId: 'session-source-2',
      sourceBundleId: 'bundle-2',
      projectId: 'project-2',
      projectRevision: 8,
      retrievalRunId: 'retrieval-2',
      sourceContextCharCount: 39_000,
      requirements: { requirement: '理解项目架构' },
      pdfText: 'truncated',
      currentStep: 'generating',
      previewPhase: 'preparing',
    };
    storage.setItem(
      projectRetrievalStorageKey('bundle-2'),
      JSON.stringify({
        goal: session.requirements.requirement,
        retrieval: {
          retrievalId: 'retrieval-2',
          context: '完整资料'.repeat(10_000),
          project: { projectId: 'project-2', projectRevision: 7 },
          metrics: { contextCharCount: 40_000 },
        },
      }),
    );

    const recovered = recoverGenerationSourceContext(storage, session);

    expect(recovered.recovered).toBe(false);
    expect(recovered.missingExpectedContext).toBe(true);
    expect(recovered.session.pdfText).toBe('truncated');
  });
});
