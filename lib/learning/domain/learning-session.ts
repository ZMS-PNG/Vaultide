export type LearningSessionStage = 'goal' | 'classroom' | 'writeback';

export type LearningSessionPhase =
  | 'goal-empty'
  | 'goal-ready'
  | 'generating'
  | 'classroom-active'
  | 'writeback-pending'
  | 'writeback-queued'
  | 'review-due';

export type ObsidianBridgeState = 'unknown' | 'online' | 'attention' | 'offline' | 'syncing';

export interface HomeLearningOverview {
  readonly hasGoal: boolean;
  readonly classroomCount: number;
  readonly dueReviewCount?: number;
  readonly pendingWritebackCount?: number;
}

export function deriveHomeLearningPhase({
  hasGoal,
  classroomCount,
  dueReviewCount = 0,
  pendingWritebackCount = 0,
}: HomeLearningOverview): LearningSessionPhase {
  if (pendingWritebackCount > 0) return 'writeback-pending';
  if (!hasGoal) return 'goal-empty';
  if (dueReviewCount > 0) return 'review-due';
  if (classroomCount > 0) return 'review-due';
  return 'goal-ready';
}

export function learningSessionStage(phase: LearningSessionPhase): LearningSessionStage {
  if (phase === 'goal-empty') return 'goal';
  if (phase === 'writeback-pending' || phase === 'writeback-queued') return 'writeback';
  return 'classroom';
}

export function learningSessionStatusLabel(phase: LearningSessionPhase): string {
  const labels: Record<LearningSessionPhase, string> = {
    'goal-empty': '等待定义学习目标',
    'goal-ready': '目标已就绪 · 等待进入课堂',
    generating: '正在构建学习课堂',
    'classroom-active': '课堂学习进行中',
    'writeback-pending': '学习成果等待沉淀',
    'writeback-queued': '已发送到 Obsidian 安全队列',
    'review-due': '已有课堂可继续学习',
  };
  return labels[phase];
}
