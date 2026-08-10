'use client';

import { useEffect, useRef } from 'react';
import { useStageStore } from '@/lib/store';
import {
  createBrowserLearningEventId,
  recordClassroomLearningEvents,
} from '@/lib/learning/client/learning-events';
import { createLogger } from '@/lib/logger';

const log = createLogger('ClassroomActivityTracker');

interface ClassroomActivityTrackerProps {
  readonly classroomId: string;
}

export function ClassroomActivityTracker({ classroomId }: ClassroomActivityTrackerProps) {
  const currentSceneId = useStageStore.use.currentSceneId();
  const scenes = useStageStore.use.scenes();
  const lastRecordedSceneId = useRef<string | null>(null);

  useEffect(() => {
    if (!currentSceneId || lastRecordedSceneId.current === currentSceneId) return;
    const sceneIndex = scenes.findIndex((scene) => scene.id === currentSceneId);
    if (sceneIndex < 0) return;

    lastRecordedSceneId.current = currentSceneId;
    const storageKey = `openmaic:scene-viewed:${classroomId}:${currentSceneId}`;
    try {
      if (sessionStorage.getItem(storageKey)) return;
      sessionStorage.setItem(storageKey, new Date().toISOString());
    } catch {
      // Session storage can be disabled; the in-memory guard still avoids render duplicates.
    }

    const scene = scenes[sceneIndex];
    void recordClassroomLearningEvents(classroomId, [
      {
        eventType: 'sceneViewed',
        clientEventId: createBrowserLearningEventId('scene-viewed'),
        occurredAt: new Date().toISOString(),
        payload: {
          sceneId: scene.id,
          ...(scene.title ? { title: scene.title } : {}),
          sceneOrder: sceneIndex,
        },
      },
    ]).catch((error) => log.warn('Unable to record scene view:', error));
  }, [classroomId, currentSceneId, scenes]);

  return null;
}
