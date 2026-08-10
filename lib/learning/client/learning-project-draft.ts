'use client';

import { isLearningProjectBrief, type LearningProjectBrief } from '../domain/learning-project-plan';

export const LEARNING_PROJECT_DRAFT_STORAGE_KEY = 'vaultide:learning-project:draft:v1';

export function learningProjectDraftStorageKey(scopeId?: string): string {
  const normalized = scopeId?.trim();
  return normalized
    ? `${LEARNING_PROJECT_DRAFT_STORAGE_KEY}:${encodeURIComponent(normalized)}`
    : LEARNING_PROJECT_DRAFT_STORAGE_KEY;
}

export function readLearningProjectDraft(scopeId?: string): LearningProjectBrief | null {
  try {
    const raw = window.localStorage.getItem(learningProjectDraftStorageKey(scopeId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isLearningProjectBrief(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeLearningProjectDraft(
  project: LearningProjectBrief,
  scopeId?: string,
): void {
  try {
    window.localStorage.setItem(
      learningProjectDraftStorageKey(scopeId),
      JSON.stringify(project),
    );
  } catch {
    // Private browsing can disable local persistence. The active page state still works.
  }
}
