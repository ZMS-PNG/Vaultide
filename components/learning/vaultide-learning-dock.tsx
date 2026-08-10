'use client';

import { useRef } from 'react';
import { toast } from 'sonner';
import type {
  LearningSessionStage,
  ObsidianBridgeState,
} from '@/lib/learning/domain/learning-session';
import {
  VaultideMagneticDock,
  type VaultideDockStageDetail,
} from '@/components/learning/vaultide-magnetic-dock';

interface VaultideLearningDockProps {
  readonly activeStage: LearningSessionStage;
  readonly attentionCount?: number;
  readonly bridgeState: ObsidianBridgeState;
  readonly classroomCount: number;
  readonly classroomCopy?: string;
  readonly defaultExpanded?: boolean;
  readonly goalCopy: string;
  readonly hasGoal: boolean;
  readonly onPrepareWriteback: () => void;
  readonly onStageChange: (stage: LearningSessionStage) => void;
  readonly pendingWritebacks: number;
  readonly writebackCopy?: string;
}

export function VaultideLearningDock({
  activeStage,
  attentionCount = 0,
  bridgeState,
  classroomCount,
  classroomCopy,
  defaultExpanded = false,
  goalCopy,
  hasGoal,
  onPrepareWriteback,
  onStageChange,
  pendingWritebacks,
  writebackCopy,
}: VaultideLearningDockProps) {
  const constraintsRef = useRef<HTMLDivElement>(null);
  const stageDetails: Partial<Record<LearningSessionStage, VaultideDockStageDetail>> = {
    goal: {
      copy: goalCopy,
      ...(!hasGoal ? { badge: 1 } : {}),
    },
    classroom: {
      copy:
        classroomCopy ?? (classroomCount > 0 ? `${classroomCount} 个课堂可继续` : '等待创建课堂'),
      ...(attentionCount > 0 ? { badge: Math.min(attentionCount, 9) } : {}),
    },
    writeback: {
      copy:
        writebackCopy ??
        (pendingWritebacks > 0 ? `${pendingWritebacks} 条等待确认` : '暂无待沉淀内容'),
      ...(pendingWritebacks > 0 ? { badge: Math.min(pendingWritebacks, 9) } : {}),
    },
  };

  return (
    <div
      ref={constraintsRef}
      className="pointer-events-none fixed inset-3 z-[68] hidden md:block"
      aria-hidden={false}
    >
      <VaultideMagneticDock
        activeStage={activeStage}
        bridgeState={bridgeState}
        defaultExpanded={defaultExpanded}
        dragConstraints={constraintsRef}
        stageDetails={stageDetails}
        onStageChange={onStageChange}
        onPrepareWriteback={() => {
          if (pendingWritebacks === 0) {
            toast.message('暂无已生成的沉淀草稿，将先打开沉淀中心。');
          }
          onPrepareWriteback();
        }}
        onStatusChange={(status) => toast.message(status)}
      />
    </div>
  );
}
