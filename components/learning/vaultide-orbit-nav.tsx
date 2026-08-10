'use client';

import { motion, useReducedMotion } from 'motion/react';
import { ArchiveRestore, BookOpenCheck, CheckCircle2, Target } from 'lucide-react';
import { useRef, useState } from 'react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';

export type VaultideLearningStage = 'goal' | 'classroom' | 'writeback';

interface VaultideFloatingOrbitProps {
  readonly activeStage: VaultideLearningStage;
  readonly hasGoal: boolean;
  readonly classroomCount: number;
  readonly onStageChange: (stage: VaultideLearningStage) => void;
}

const STAGES: Array<{
  id: VaultideLearningStage;
  label: string;
  completedLabel: string;
  icon: typeof Target;
  left: string;
  top: string;
  activeClass: string;
}> = [
  {
    id: 'goal',
    label: '目标',
    completedLabel: '已切换到目标阶段',
    icon: Target,
    left: '50%',
    top: '19.75%',
    activeClass: 'ring-indigo-300 shadow-indigo-500/45',
  },
  {
    id: 'classroom',
    label: '课堂',
    completedLabel: '已切换到课堂阶段',
    icon: BookOpenCheck,
    left: '25%',
    top: '68.7%',
    activeClass: 'ring-violet-300 shadow-violet-500/45',
  },
  {
    id: 'writeback',
    label: '沉淀',
    completedLabel: '已打开知识沉淀预览',
    icon: ArchiveRestore,
    left: '75%',
    top: '68.7%',
    activeClass: 'ring-cyan-300 shadow-cyan-500/45',
  },
];

export function VaultideFloatingOrbit({
  activeStage,
  hasGoal,
  classroomCount,
  onStageChange,
}: VaultideFloatingOrbitProps) {
  const boundaryRef = useRef<HTMLDivElement>(null);
  const draggedRef = useRef(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [spinKey, setSpinKey] = useState(0);
  const [lastStatus, setLastStatus] = useState('已打开知识洄流控制器');
  const shouldReduceMotion = useReducedMotion();

  const runOrbit = () => {
    if (!shouldReduceMotion) {
      setSpinKey((current) => current + 1);
    }
  };

  const activateLogo = () => {
    if (draggedRef.current) return;
    runOrbit();
    setLastStatus('已刷新知识洄流状态');
    setStatusOpen(true);
  };

  const activateStage = (stage: (typeof STAGES)[number]) => {
    runOrbit();
    setLastStatus(stage.completedLabel);
    setStatusOpen(false);
    onStageChange(stage.id);
  };

  const outerRotation = spinKey * 360;
  const innerRotation = spinKey * 360;

  return (
    <div
      ref={boundaryRef}
      className="pointer-events-none fixed inset-3 z-[75] hidden md:block"
      aria-hidden={false}
    >
      <Popover open={statusOpen} onOpenChange={setStatusOpen}>
        <motion.aside
          drag
          dragConstraints={boundaryRef}
          dragElastic={0.08}
          dragMomentum={false}
          onDragStart={() => {
            draggedRef.current = true;
            setStatusOpen(false);
          }}
          onDragEnd={() => {
            window.setTimeout(() => {
              draggedRef.current = false;
            }, 120);
          }}
          role="region"
          aria-label="可拖动的知洄学习控制器"
          title="拖动外环移动；点击中心查看状态"
          className="pointer-events-auto absolute left-3 top-3 h-[124px] w-[124px] touch-none select-none rounded-full border border-white/90 bg-white/76 p-1.5 shadow-[0_18px_55px_rgba(79,70,229,0.2)] backdrop-blur-xl dark:border-slate-700/80 dark:bg-slate-900/78"
          style={{ cursor: 'grab' }}
          whileDrag={{
            cursor: 'grabbing',
            scale: shouldReduceMotion ? 1 : 1.035,
            boxShadow: '0 24px 70px rgba(79, 70, 229, 0.28)',
          }}
        >
          <div className="relative h-full w-full">
            <motion.div
              className="absolute inset-0"
              animate={shouldReduceMotion ? undefined : { rotate: outerRotation }}
              transition={{ duration: 1.08, ease: [0.2, 0.82, 0.22, 1] }}
            >
              <img
                src="/brand/vaultide-orbit-outer.png"
                alt=""
                draggable={false}
                className="pointer-events-none h-full w-full object-contain drop-shadow-[0_8px_18px_rgba(59,130,246,0.18)]"
              />

              {STAGES.map((stage) => {
                const Icon = stage.icon;
                const active = activeStage === stage.id;

                return (
                  <button
                    key={stage.id}
                    type="button"
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      activateStage(stage);
                    }}
                    aria-label={`切换到${stage.label}阶段`}
                    aria-current={active ? 'step' : undefined}
                    title={stage.label}
                    className="absolute z-30 flex h-8 w-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-violet-500"
                    style={{ left: stage.left, top: stage.top }}
                  >
                    <motion.span
                      animate={shouldReduceMotion ? undefined : { rotate: -outerRotation }}
                      transition={{ duration: 1.08, ease: [0.2, 0.82, 0.22, 1] }}
                      className={cn(
                        'flex h-[17px] w-[17px] items-center justify-center rounded-full text-white transition',
                        active &&
                          `ring-2 ring-offset-1 ring-offset-white/90 shadow-[0_0_14px_rgba(79,70,229,0.48)] ${stage.activeClass}`,
                      )}
                    >
                      <Icon className="h-[9px] w-[9px] stroke-[2.5]" aria-hidden="true" />
                    </motion.span>
                  </button>
                );
              })}
            </motion.div>

            <motion.img
              src="/brand/vaultide-orbit-inner.png"
              alt=""
              draggable={false}
              className="pointer-events-none absolute inset-0 h-full w-full object-contain"
              animate={shouldReduceMotion ? undefined : { rotate: innerRotation }}
              transition={{
                delay: 0.16,
                duration: 0.92,
                ease: [0.2, 0.82, 0.22, 1],
              }}
            />

            <PopoverTrigger asChild>
              <button
                type="button"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={activateLogo}
                aria-label="查看知识洄流状态"
                className="absolute left-1/2 top-1/2 z-20 h-12 w-12 -translate-x-1/2 -translate-y-1/2 rounded-full outline-none transition focus-visible:ring-4 focus-visible:ring-violet-200 dark:focus-visible:ring-violet-900"
              >
                <span className="sr-only">查看知识洄流状态</span>
              </button>
            </PopoverTrigger>
          </div>
        </motion.aside>

        <PopoverContent
          side="left"
          align="center"
          sideOffset={14}
          collisionPadding={16}
          className="w-[292px] rounded-2xl border-violet-100 bg-white/96 p-3.5 shadow-2xl shadow-violet-900/10 backdrop-blur-xl dark:border-violet-900 dark:bg-slate-900/96"
        >
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-violet-50 text-violet-600 dark:bg-violet-950 dark:text-violet-300">
              <CheckCircle2 className="h-4 w-4" />
            </span>
            <div>
              <p className="text-xs font-semibold text-slate-900 dark:text-white">{lastStatus}</p>
              <p className="mt-0.5 text-[10px] text-slate-500">目标 → 课堂 → Obsidian</p>
            </div>
          </div>

          <div className="mt-3 space-y-2">
            <StatusLine
              done={hasGoal}
              label={hasGoal ? '已保存学习目标' : '等待定义学习目标'}
            />
            <StatusLine
              done={classroomCount > 0}
              label={
                classroomCount > 0
                  ? `已连接 ${classroomCount} 个课堂`
                  : '等待生成或打开课堂'
              }
            />
            <StatusLine done={classroomCount > 0} label="沉淀仍需在 Obsidian 中确认" />
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function StatusLine({ done, label }: { readonly done: boolean; readonly label: string }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-slate-100 px-3 py-2 text-xs text-slate-600 dark:border-slate-800 dark:text-slate-300">
      <CheckCircle2
        className={cn('h-3.5 w-3.5', done ? 'text-emerald-500' : 'text-slate-300')}
      />
      <span>{label}</span>
    </div>
  );
}
