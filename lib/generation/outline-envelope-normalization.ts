import type { SceneOutline } from '@/lib/types/generation';

export interface NormalizedOutlineEnvelope {
  outlines: SceneOutline[];
  languageDirective?: string;
  courseTitle?: string;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isSceneRecord(value: Record<string, unknown>): boolean {
  return (
    ['slide', 'quiz', 'interactive', 'pbl'].includes(String(value.type)) ||
    ['title', 'sceneTitle', 'name', 'description', 'keyPoints', 'key_points'].some(
      (key) => value[key] !== undefined,
    )
  );
}

/**
 * Unwraps model envelopes before an item can be mistaken for a scene.
 *
 * Some providers occasionally emit a flat array whose first item is itself a
 * `{ courseTitle, languageDirective, outlines: [...] }` envelope. Treating
 * that wrapper as scene 1 hides its nested scenes and produces an artificial
 * `Scene 1: <entire requirement>` page. Strings and other envelope metadata
 * inside a recovered array are ignored.
 */
export function normalizeOutlineEnvelope(value: unknown): NormalizedOutlineEnvelope | null {
  const outlines: SceneOutline[] = [];
  let languageDirective: string | undefined;
  let courseTitle: string | undefined;

  const visit = (current: unknown): void => {
    if (Array.isArray(current)) {
      current.forEach(visit);
      return;
    }

    const currentRecord = record(current);
    if (!currentRecord) return;

    if (!languageDirective && typeof currentRecord.languageDirective === 'string') {
      const candidate = currentRecord.languageDirective.trim();
      if (candidate) languageDirective = candidate;
    }
    if (!courseTitle && typeof currentRecord.courseTitle === 'string') {
      const candidate = currentRecord.courseTitle.trim();
      if (candidate) courseTitle = candidate.slice(0, 120);
    }

    const nested = Array.isArray(currentRecord.outlines)
      ? currentRecord.outlines
      : Array.isArray(currentRecord.scenes)
        ? currentRecord.scenes
        : null;
    if (nested) {
      visit(nested);
      return;
    }

    if (isSceneRecord(currentRecord)) outlines.push(currentRecord as unknown as SceneOutline);
  };

  visit(value);
  if (outlines.length === 0) return null;
  return {
    outlines,
    ...(languageDirective ? { languageDirective } : {}),
    ...(courseTitle ? { courseTitle } : {}),
  };
}
