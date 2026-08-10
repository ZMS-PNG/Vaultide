import type { SceneOutline } from '@/lib/types/generation';

export const STANDARD_COURSE_MIN_SCENES = 9;
export const STANDARD_COURSE_MAX_SCENES = 12;
// V3 uses evidence-density to choose the learning sequence, but every
// publishable classroom shares the durable job ledger's 9–12-scene envelope.
// Keeping a second 7–16 rule here allowed an otherwise accepted V3 plan to
// fail only when the database job was inserted.
export const V3_COURSE_MIN_ACTIVITIES = STANDARD_COURSE_MIN_SCENES;
export const V3_COURSE_MAX_ACTIVITIES = STANDARD_COURSE_MAX_SCENES;

export interface CompletedCourseSnapshotInput {
  outlines: readonly SceneOutline[];
  sceneOrders: readonly number[];
  /**
   * Kept for wire compatibility with older callers. Task-engine classrooms are
   * still classrooms and no longer bypass the standard release-size contract.
   */
  taskEngineMode?: boolean;
}

export function describeOutlineReleaseViolation(
  outlines: readonly SceneOutline[],
  _taskEngineMode = false,
): string | null {
  if (outlines.length === 0) {
    return 'The classroom has no scene outlines.';
  }

  if (
    outlines.length < STANDARD_COURSE_MIN_SCENES ||
    outlines.length > STANDARD_COURSE_MAX_SCENES
  ) {
    return `A standard classroom requires ${STANDARD_COURSE_MIN_SCENES}-${STANDARD_COURSE_MAX_SCENES} outlines; received ${outlines.length}.`;
  }

  const ids = outlines.map((outline) => outline.id?.trim()).filter(Boolean);
  if (ids.length !== outlines.length || new Set(ids).size !== ids.length) {
    return 'Every classroom outline must have a unique non-empty id.';
  }

  const sortedOrders = outlines.map((outline) => outline.order).sort((left, right) => left - right);
  if (sortedOrders.some((order, index) => !Number.isInteger(order) || order !== index + 1)) {
    return 'Classroom outline orders must form one complete sequence starting at 1.';
  }

  const titles = outlines.map((outline) => outline.title?.trim()).filter(Boolean);
  if (titles.length !== outlines.length) {
    return 'Every classroom outline must have a non-empty title.';
  }

  const normalizedTitles = titles.map((title) =>
    title.toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, ''),
  );
  if (new Set(normalizedTitles).size !== normalizedTitles.length) {
    return 'Every classroom outline must have a distinct title.';
  }

  return null;
}

/** V3 plans are sized from evidence density and target time, never a fixed page count. */
export function isV3OutlineSet(outlines: readonly SceneOutline[]): boolean {
  return outlines.length > 0 && outlines.every((outline) => outline.activity?.schemaVersion === 3);
}

function titleLeaksSourceMarkup(title: string): boolean {
  // A source URL and its label are valuable provenance, but raw Markdown in a
  // classroom heading forces learners to read implementation syntax instead of
  // the concept. Evidence labels remain required in descriptions/key points.
  return /https?:\/\/|!?\[[^\]]+\]\([^)]*\)/u.test(title);
}

export function describeV3OutlineReleaseViolation(outlines: readonly SceneOutline[]): string | null {
  if (outlines.length < V3_COURSE_MIN_ACTIVITIES || outlines.length > V3_COURSE_MAX_ACTIVITIES) {
    return `A V3 learning plan requires ${V3_COURSE_MIN_ACTIVITIES}-${V3_COURSE_MAX_ACTIVITIES} evidence-backed activities; received ${outlines.length}.`;
  }
  const ids = outlines.map((outline) => outline.id?.trim()).filter(Boolean);
  const slots = outlines.map((outline) => outline.activity?.slotId?.trim()).filter(Boolean);
  if (ids.length !== outlines.length || new Set(ids).size !== ids.length) {
    return 'Every V3 activity must have a unique non-empty scene id.';
  }
  if (slots.length !== outlines.length || new Set(slots).size !== slots.length) {
    return 'Every V3 activity must have a unique non-empty activity slot id.';
  }
  const orders = outlines.map((outline) => outline.order).sort((left, right) => left - right);
  if (orders.some((order, index) => !Number.isInteger(order) || order !== index + 1)) {
    return 'V3 activity orders must form one complete sequence starting at 1.';
  }
  for (const outline of outlines) {
    const activity = outline.activity;
    if (!outline.title?.trim() || !outline.description?.trim() || (outline.keyPoints?.length ?? 0) < 3) {
      return `V3 activity ${outline.order} is missing a learner-visible title, purpose, or evidence anchors.`;
    }
    if (titleLeaksSourceMarkup(outline.title)) {
      return `V3 activity ${outline.order} exposes raw source markup in its learner-facing title.`;
    }
    if (!activity || !activity.learnerAction || !activity.observableOutcome) {
      return `V3 activity ${outline.order} is missing its learner action or observable outcome.`;
    }
    if (activity.evidenceLabels.length === 0) {
      return `V3 activity ${outline.order} is missing frozen evidence labels.`;
    }
  }
  const finalActivity = outlines.at(-1)?.activity;
  if (finalActivity?.kind !== 'synthesis-transfer' || finalActivity.artifactRequired !== true) {
    return 'The final V3 activity must require synthesis, transfer, and a verifiable artifact.';
  }
  return null;
}

export function describeCompletedCourseSnapshotViolation({
  outlines,
  sceneOrders,
  taskEngineMode = false,
}: CompletedCourseSnapshotInput): string | null {
  const outlineViolation = isV3OutlineSet(outlines)
    ? describeV3OutlineReleaseViolation(outlines)
    : describeOutlineReleaseViolation(outlines, taskEngineMode);
  if (outlineViolation) return outlineViolation;

  const uniqueSceneOrders = new Set(sceneOrders);
  if (uniqueSceneOrders.size !== sceneOrders.length) {
    return 'A completed classroom cannot contain duplicate scene orders.';
  }

  const expectedOrders = new Set(outlines.map((outline) => outline.order));
  const missingOrders = [...expectedOrders].filter((order) => !uniqueSceneOrders.has(order));
  const unexpectedOrders = [...uniqueSceneOrders].filter((order) => !expectedOrders.has(order));
  if (
    missingOrders.length > 0 ||
    unexpectedOrders.length > 0 ||
    sceneOrders.length !== outlines.length
  ) {
    return [
      'A completed classroom requires exactly one durable scene per outline;',
      `missing orders: ${missingOrders.join(', ') || 'none'};`,
      `unexpected orders: ${unexpectedOrders.join(', ') || 'none'}.`,
    ].join(' ');
  }

  return null;
}
