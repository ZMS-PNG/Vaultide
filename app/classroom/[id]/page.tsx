'use client';

import { Stage } from '@/components/stage';
import { ThemeProvider } from '@/lib/hooks/use-theme';
import { useStageStore } from '@/lib/store';
import { useSettingsStore } from '@/lib/store/settings';
import { claimStageSceneLoadToken, isCurrentStageSceneLoadToken } from '@/lib/store/stage';
import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { useMediaGenerationStore } from '@/lib/store/media-generation';
import { useWhiteboardHistoryStore } from '@/lib/store/whiteboard-history';
import { createLogger } from '@/lib/logger';
import { MediaStageProvider } from '@/lib/contexts/media-stage-context';
import { generateMediaForOutlines } from '@/lib/media/media-orchestrator';
import { useAgentRegistry } from '@/lib/orchestration/registry/store';
import {
  applyClassroomStageAndScenes,
  defaultClassroomLoadDeps,
  runClassroomLoad,
} from '@/lib/classroom/load-classroom';
import { ObsidianWriteback } from '@/components/learning/obsidian-writeback';
import { ClassroomActivityTracker } from '@/components/learning/classroom-activity-tracker';
import {
  ClassroomCompletionPanel,
  type ClassroomCompletionSnapshot,
} from '@/components/learning/classroom-completion-panel';
import { ProjectLearningPanel } from '@/components/learning/project-learning-panel';
import { ProjectSourcesPanel } from '@/components/learning/project-sources-panel';
import { ClassroomLearningDriver } from '@/components/learning/classroom-learning-driver';
import { useLearningSessionStore } from '@/lib/store/learning-session';

const log = createLogger('Classroom');

export default function ClassroomDetailPage() {
  const params = useParams();
  const classroomId = params?.id as string;

  const { loadFromStorage } = useStageStore();
  const enterClassroom = useLearningSessionStore((state) => state.enterClassroom);
  const markWritebackPending = useLearningSessionStore((state) => state.markWritebackPending);
  const markWritebackQueued = useLearningSessionStore((state) => state.markWritebackQueued);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadClassroom = useCallback(
    async (isEffectCurrent: () => boolean = () => true) => {
      const loadToken = claimStageSceneLoadToken();
      const isCurrent = () => isEffectCurrent() && isCurrentStageSceneLoadToken(loadToken);

      await runClassroomLoad({
        classroomId,
        loadToken,
        isCurrent,
        loadFromStorage,
        getCurrentStage: () => useStageStore.getState().stage,
        getCurrentOutlines: () => useStageStore.getState().outlines,
        fetchClassroom: defaultClassroomLoadDeps.fetchClassroom,
        applyFallbackScenes: (args) =>
          defaultClassroomLoadDeps.applyFallbackScenes({
            ...args,
            isCurrent,
            applyStageAndScenes: applyClassroomStageAndScenes,
          }),
        loadRestoredMediaTasks: defaultClassroomLoadDeps.loadRestoredMediaTasks,
        applyRestoredMediaTasks: defaultClassroomLoadDeps.applyRestoredMediaTasks,
        discardRestoredMediaTasks: defaultClassroomLoadDeps.discardRestoredMediaTasks,
        loadLegacyAgentFallbacks: defaultClassroomLoadDeps.loadLegacyAgentFallbacks,
        commitMigratedAgentConfigs: defaultClassroomLoadDeps.commitMigratedAgentConfigs,
        applyGeneratedAgents: defaultClassroomLoadDeps.applyGeneratedAgents,
        getSettings: () => useSettingsStore.getState(),
        getAgent: (id) => useAgentRegistry.getState().getAgent(id),
        restoreAgentSelection: defaultClassroomLoadDeps.restoreAgentSelection,
        setError,
        setLoading,
        log,
      });
      if (!isCurrent()) return;
      const loaded = useStageStore.getState();
      const plannedOrders = new Set(loaded.outlines.map((outline) => outline.order));
      const materializedOrders = new Set(loaded.scenes.map((scene) => scene.order));
      const releasedCourse =
        loaded.generationComplete &&
        loaded.outlines.length >= 9 &&
        loaded.outlines.length <= 12 &&
        loaded.scenes.length === loaded.outlines.length &&
        plannedOrders.size === loaded.outlines.length &&
        materializedOrders.size === loaded.outlines.length &&
        [...plannedOrders].every((order) => materializedOrders.has(order));
      const durableCourse = Boolean(loaded.stage?.learningContext?.generationJobId);
      if ((durableCourse || loaded.outlines.length >= 9) && !releasedCourse) {
        setError(
          '该课堂是未通过正式发布闸门的旧版不完整快照。请回到生成页恢复任务，课堂不会再在此页面继续生成。',
        );
      }
    },
    [classroomId, loadFromStorage],
  );

  useEffect(() => {
    // Reset loading state on course switch to unmount Stage during transition,
    // preventing stale data from syncing back to the new course
    /* eslint-disable react-hooks/set-state-in-effect -- Course switch must hide stale Stage before async load */
    setLoading(true);
    setError(null);
    /* eslint-enable react-hooks/set-state-in-effect */
    // Clear previous classroom's media tasks to prevent cross-classroom contamination.
    // Placeholder IDs (gen_img_1, gen_vid_1) are NOT globally unique across stages,
    // so stale tasks from a previous classroom would shadow the new one's.
    const mediaStore = useMediaGenerationStore.getState();
    mediaStore.revokeObjectUrls();
    useMediaGenerationStore.setState({ tasks: {} });

    // Clear whiteboard history to prevent snapshots from a previous course leaking in.
    useWhiteboardHistoryStore.getState().clearHistory();

    let cancelled = false;
    void loadClassroom(() => !cancelled);

    return () => {
      cancelled = true;
    };
  }, [classroomId, loadClassroom]);

  // Optional media may continue after release, but lesson structure and
  // narration are immutable here. The classroom is a learning surface, never
  // a hidden course-generation worker.
  useEffect(() => {
    if (loading || error) return;
    const current = useStageStore.getState();
    if (!current.generationComplete || !current.stage || current.outlines.length === 0) return;
    const sceneOrders = new Set(current.scenes.map((scene) => scene.order));
    const materializedOutlines = current.outlines.filter((outline) =>
      sceneOrders.has(outline.order),
    );
    void generateMediaForOutlines(materializedOutlines, current.stage.id).catch((mediaError) => {
      log.warn('[Classroom] Optional media resume failed:', mediaError);
    });
  }, [loading, error, classroomId]);

  useEffect(() => {
    if (loading || error) return;
    enterClassroom(classroomId);
  }, [classroomId, enterClassroom, error, loading]);

  const handleCompletionChange = useCallback(
    ({ complete }: ClassroomCompletionSnapshot) => {
      if (complete) markWritebackPending(1);
    },
    [markWritebackPending],
  );

  return (
    <ThemeProvider>
      <MediaStageProvider value={classroomId}>
        <div className="h-screen flex flex-col overflow-hidden pb-[5.25rem] sm:pb-[5.75rem]">
          {loading ? (
            <div className="flex-1 flex items-center justify-center bg-gray-50 dark:bg-gray-900">
              <div className="text-center text-muted-foreground">
                <p>Loading classroom...</p>
              </div>
            </div>
          ) : error ? (
            <div className="flex-1 flex items-center justify-center bg-gray-50 dark:bg-gray-900">
              <div className="text-center">
                <p className="text-destructive mb-4">Error: {error}</p>
                <button
                  onClick={() => {
                    setError(null);
                    setLoading(true);
                    loadClassroom();
                  }}
                  className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
                >
                  Retry
                </button>
              </div>
            </div>
          ) : (
            <>
              <ClassroomActivityTracker classroomId={classroomId} />
              <Stage />
              <ClassroomCompletionPanel
                classroomId={classroomId}
                showLauncher={false}
                onCompletionChange={handleCompletionChange}
              />
              <ProjectLearningPanel />
              <ProjectSourcesPanel />
              <ObsidianWriteback
                classroomId={classroomId}
                showLauncher={false}
                onWritebackPending={markWritebackPending}
                onWritebackQueued={markWritebackQueued}
              />
              <ClassroomLearningDriver classroomId={classroomId} />
            </>
          )}
        </div>
      </MediaStageProvider>
    </ThemeProvider>
  );
}
