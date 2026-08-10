'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  deriveHomeLearningPhase,
  learningSessionStatusLabel,
  type LearningSessionPhase,
  type ObsidianBridgeState,
} from '@/lib/learning/domain/learning-session';

interface HomeOverviewInput {
  readonly hasGoal: boolean;
  readonly classroomCount: number;
  readonly projectId?: string;
  readonly dueReviewCount?: number;
}

interface BridgeSummaryInput {
  readonly state: ObsidianBridgeState;
  readonly pendingWritebacks: number;
  readonly attentionCount: number;
}

interface LearningSessionState {
  phase: LearningSessionPhase;
  projectId?: string;
  classroomId?: string;
  pendingWritebacks: number;
  dueReviews: number;
  attentionCount: number;
  bridgeState: ObsidianBridgeState;
  lastStatus: string;
  updatedAt: string;
  syncHomeOverview: (input: HomeOverviewInput) => void;
  beginGeneration: (projectId: string) => void;
  enterClassroom: (classroomId: string) => void;
  markWritebackPending: (count?: number) => void;
  markWritebackQueued: () => void;
  markReviewDue: (count: number) => void;
  setBridgeSummary: (input: BridgeSummaryInput) => void;
  setStatus: (status: string) => void;
}

function now(): string {
  return new Date().toISOString();
}

export const useLearningSessionStore = create<LearningSessionState>()(
  persist(
    (set) => ({
      phase: 'goal-empty',
      pendingWritebacks: 0,
      dueReviews: 0,
      attentionCount: 0,
      bridgeState: 'unknown',
      lastStatus: learningSessionStatusLabel('goal-empty'),
      updatedAt: now(),

      syncHomeOverview: ({ hasGoal, classroomCount, projectId, dueReviewCount = 0 }) =>
        set((current) => {
          const phase = deriveHomeLearningPhase({
            hasGoal,
            classroomCount,
            dueReviewCount,
            pendingWritebackCount: current.pendingWritebacks,
          });
          return {
            phase,
            projectId: projectId ?? current.projectId,
            dueReviews: dueReviewCount,
            lastStatus: learningSessionStatusLabel(phase),
            updatedAt: now(),
          };
        }),

      beginGeneration: (projectId) =>
        set({
          phase: 'generating',
          projectId,
          lastStatus: learningSessionStatusLabel('generating'),
          updatedAt: now(),
        }),

      enterClassroom: (classroomId) =>
        set((current) => {
          const sameClassroom = current.classroomId === classroomId;
          const phase =
            sameClassroom && current.pendingWritebacks > 0
              ? 'writeback-pending'
              : 'classroom-active';
          return {
            phase,
            classroomId,
            pendingWritebacks: sameClassroom ? current.pendingWritebacks : 0,
            lastStatus: learningSessionStatusLabel(phase),
            updatedAt: now(),
          };
        }),

      markWritebackPending: (count = 1) =>
        set({
          phase: 'writeback-pending',
          pendingWritebacks: Math.max(1, Math.trunc(count)),
          lastStatus: learningSessionStatusLabel('writeback-pending'),
          updatedAt: now(),
        }),

      markWritebackQueued: () =>
        set({
          phase: 'writeback-queued',
          pendingWritebacks: 0,
          bridgeState: 'syncing',
          lastStatus: learningSessionStatusLabel('writeback-queued'),
          updatedAt: now(),
        }),

      markReviewDue: (count) =>
        set({
          phase: count > 0 ? 'review-due' : 'goal-ready',
          dueReviews: Math.max(0, Math.trunc(count)),
          lastStatus: learningSessionStatusLabel(count > 0 ? 'review-due' : 'goal-ready'),
          updatedAt: now(),
        }),

      setBridgeSummary: ({ state, pendingWritebacks, attentionCount }) =>
        set((current) => {
          const normalizedPending = Math.max(0, Math.trunc(pendingWritebacks));
          const phase =
            normalizedPending > 0 && current.phase !== 'generating'
              ? 'writeback-pending'
              : current.phase;
          return {
            phase,
            bridgeState: state,
            pendingWritebacks: normalizedPending,
            attentionCount: Math.max(0, Math.trunc(attentionCount)),
            lastStatus:
              normalizedPending > 0
                ? learningSessionStatusLabel('writeback-pending')
                : current.lastStatus,
            updatedAt: now(),
          };
        }),

      setStatus: (lastStatus) => set({ lastStatus, updatedAt: now() }),
    }),
    {
      name: 'vaultide:learning-session:v1',
      partialize: (state) => ({
        phase: state.phase,
        projectId: state.projectId,
        classroomId: state.classroomId,
        pendingWritebacks: state.pendingWritebacks,
        dueReviews: state.dueReviews,
        attentionCount: state.attentionCount,
        bridgeState: state.bridgeState,
        lastStatus: state.lastStatus,
        updatedAt: state.updatedAt,
      }),
    },
  ),
);
