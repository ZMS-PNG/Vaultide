export const LEARNING_VERIFICATION_UPDATED_EVENT = 'vaultide:learning-verification-updated';
export const LEARNING_VERIFICATION_SNAPSHOT_VERSION = 1 as const;

export const LEARNING_VERIFICATION_MINIMUMS = {
  masteryEstimate: 0.8,
  masteryConfidence: 0.5,
  evidenceCount: 3,
  transferScore: 0.8,
} as const;

export type LearningNextPhase =
  | 'preparing'
  | 'content-ready'
  | 'learning'
  | 'transfer-check'
  | 'verified';

export interface LearningNextActionInput {
  readonly coursePublished: boolean;
  /** Durable server gate: source-grounded evaluations and snapshot persistence passed. */
  readonly serverVerified: boolean;
  readonly totalScenes: number;
  readonly viewedSceneCount: number;
  readonly evidenceCount: number;
  readonly masteryEstimate: number | null;
  readonly masteryConfidence: number;
  readonly transferEvidencePassed: boolean;
}

export interface LearningNextAction {
  readonly phase: LearningNextPhase;
  readonly coursePublished: boolean;
  readonly allScenesViewed: boolean;
  readonly learningVerified: boolean;
  readonly canCreateDraft: boolean;
  readonly canPublishSynthesis: boolean;
  readonly canApproveWriteback: boolean;
  readonly statusLabel: string;
  readonly primaryActionLabel: string;
}

export interface LearningVerificationSnapshot {
  readonly version: typeof LEARNING_VERIFICATION_SNAPSHOT_VERSION;
  readonly phase: LearningNextPhase;
  readonly learningVerified: boolean;
  readonly viewedSceneCount: number;
  readonly totalScenes: number;
  readonly evidenceCount: number;
}

function nonNegativeInteger(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

export function deriveLearningNextAction(input: LearningNextActionInput): LearningNextAction {
  const totalScenes = nonNegativeInteger(input.totalScenes);
  const viewedSceneCount = Math.min(totalScenes, nonNegativeInteger(input.viewedSceneCount));
  const evidenceCount = nonNegativeInteger(input.evidenceCount);
  const allScenesViewed = totalScenes > 0 && viewedSceneCount === totalScenes;
  const learningVerified =
    input.coursePublished &&
    input.serverVerified &&
    allScenesViewed &&
    input.transferEvidencePassed &&
    evidenceCount >= LEARNING_VERIFICATION_MINIMUMS.evidenceCount &&
    input.masteryEstimate !== null &&
    input.masteryEstimate >= LEARNING_VERIFICATION_MINIMUMS.masteryEstimate &&
    input.masteryConfidence >= LEARNING_VERIFICATION_MINIMUMS.masteryConfidence;

  const phase: LearningNextPhase = !input.coursePublished
    ? 'preparing'
    : learningVerified
      ? 'verified'
      : allScenesViewed
        ? 'transfer-check'
        : viewedSceneCount > 0 || evidenceCount > 0
          ? 'learning'
          : 'content-ready';

  const copy: Record<
    LearningNextPhase,
    Pick<LearningNextAction, 'statusLabel' | 'primaryActionLabel'>
  > = {
    preparing: {
      statusLabel: '课程内容准备中',
      primaryActionLabel: '等待课程发布',
    },
    'content-ready': {
      statusLabel: '课程已发布，学习尚未验证',
      primaryActionLabel: '开始学习',
    },
    learning: {
      statusLabel: '学习进行中',
      primaryActionLabel: '继续学习并记录证据',
    },
    'transfer-check': {
      statusLabel: '内容已浏览，等待最终迁移检验',
      primaryActionLabel: '完成最终迁移检验',
    },
    verified: {
      statusLabel: '学习已验证',
      primaryActionLabel: '归纳并沉淀',
    },
  };

  return {
    phase,
    coursePublished: input.coursePublished,
    allScenesViewed,
    learningVerified,
    canCreateDraft: input.coursePublished,
    canPublishSynthesis: learningVerified,
    canApproveWriteback: learningVerified,
    ...copy[phase],
  };
}

export function learningVerificationStorageKey(classroomId: string): string {
  return `vaultide:learning-verification:v${LEARNING_VERIFICATION_SNAPSHOT_VERSION}:${classroomId}`;
}

export function learningVerificationSnapshot(
  action: LearningNextAction,
  input: Pick<LearningNextActionInput, 'viewedSceneCount' | 'totalScenes' | 'evidenceCount'>,
): LearningVerificationSnapshot {
  return {
    version: LEARNING_VERIFICATION_SNAPSHOT_VERSION,
    phase: action.phase,
    learningVerified: action.learningVerified,
    viewedSceneCount: nonNegativeInteger(input.viewedSceneCount),
    totalScenes: nonNegativeInteger(input.totalScenes),
    evidenceCount: nonNegativeInteger(input.evidenceCount),
  };
}

export function parseLearningVerificationSnapshot(
  serialized: string | null | undefined,
): LearningVerificationSnapshot | null {
  if (!serialized) return null;
  try {
    const value = JSON.parse(serialized) as Partial<LearningVerificationSnapshot>;
    if (
      value.version !== LEARNING_VERIFICATION_SNAPSHOT_VERSION ||
      !['preparing', 'content-ready', 'learning', 'transfer-check', 'verified'].includes(
        value.phase ?? '',
      ) ||
      typeof value.learningVerified !== 'boolean' ||
      typeof value.viewedSceneCount !== 'number' ||
      !Number.isInteger(value.viewedSceneCount) ||
      typeof value.totalScenes !== 'number' ||
      !Number.isInteger(value.totalScenes) ||
      typeof value.evidenceCount !== 'number' ||
      !Number.isInteger(value.evidenceCount)
    ) {
      return null;
    }
    return {
      version: LEARNING_VERIFICATION_SNAPSHOT_VERSION,
      phase: value.phase as LearningNextPhase,
      learningVerified: value.learningVerified,
      viewedSceneCount: Math.max(0, value.viewedSceneCount),
      totalScenes: Math.max(0, value.totalScenes),
      evidenceCount: Math.max(0, value.evidenceCount),
    };
  } catch {
    return null;
  }
}
