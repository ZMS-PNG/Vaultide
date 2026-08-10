'use client';

import {
  motion,
  useAnimationFrame,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
} from 'motion/react';
import { ArchiveRestore, BookOpenCheck, Circle, Target } from 'lucide-react';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { cn } from '@/lib/utils';

export type VaultideLivingStage = 'goal' | 'classroom' | 'writeback';

interface VaultideLivingLogoProps {
  readonly activeStage: VaultideLivingStage;
  readonly dragConstraints: RefObject<Element | null>;
  readonly onStageChange: (stage: VaultideLivingStage) => void;
  readonly onStatusChange: (status: string) => void;
}

const STAGES: Array<{
  id: VaultideLivingStage;
  label: string;
  icon: typeof Target;
  left: string;
  top: string;
}> = [
  { id: 'goal', label: '目标', icon: Target, left: '50%', top: '19.75%' },
  { id: 'classroom', label: '课堂', icon: BookOpenCheck, left: '25%', top: '68.7%' },
  { id: 'writeback', label: '沉淀', icon: ArchiveRestore, left: '75%', top: '68.7%' },
];

const STAGE_ORDER: VaultideLivingStage[] = ['goal', 'classroom', 'writeback'];

const STAGE_ROTATION: Record<VaultideLivingStage, number> = {
  goal: 0,
  classroom: 126.8,
  writeback: 233.2,
};

export function VaultideLivingLogo({
  activeStage,
  dragConstraints,
  onStageChange,
  onStatusChange,
}: VaultideLivingLogoProps) {
  const shouldReduceMotion = useReducedMotion();
  const [dragging, setDragging] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [pulseKey, setPulseKey] = useState(0);
  const [ceremonyStage, setCeremonyStage] = useState<VaultideLivingStage | null>(null);
  const baseRotation = useRef(STAGE_ROTATION[activeStage]);
  const previousStage = useRef(activeStage);
  const centerClickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ceremonyTimers = useRef<Array<ReturnType<typeof setTimeout>>>([]);

  const outerTarget = useMotionValue(STAGE_ROTATION[activeStage]);
  const outerRotation = useSpring(outerTarget, {
    stiffness: 76,
    damping: 17,
    mass: 0.85,
  });
  const counterRotation = useTransform(outerRotation, (value) => -value);

  useEffect(
    () => () => {
      if (centerClickTimer.current) {
        clearTimeout(centerClickTimer.current);
      }
      ceremonyTimers.current.forEach((timer) => clearTimeout(timer));
    },
    [],
  );

  useEffect(() => {
    if (previousStage.current === activeStage) {
      return;
    }
    previousStage.current = activeStage;

    const targetWithinCycle = STAGE_ROTATION[activeStage];
    const currentCycle = Math.floor(baseRotation.current / 360) * 360;
    let nextRotation = currentCycle + targetWithinCycle;

    if (nextRotation <= baseRotation.current + 1) {
      nextRotation += 360;
    }

    baseRotation.current = nextRotation;
    setPulseKey((current) => current + 1);

    if (shouldReduceMotion) {
      outerTarget.jump(nextRotation);
      outerRotation.jump(nextRotation);
      return;
    }

    outerTarget.set(nextRotation);
  }, [activeStage, outerRotation, outerTarget, shouldReduceMotion]);

  useAnimationFrame((time) => {
    if (shouldReduceMotion || dragging || hovered) return;
    const tidalDrift = Math.sin(time / 2100) * 1.6 + Math.sin(time / 5100) * 0.7;
    outerTarget.set(baseRotation.current + tidalDrift);
  });

  const selectStage = (stage: VaultideLivingStage) => {
    const stageLabel = STAGES.find((item) => item.id === stage)?.label ?? '学习';

    if (stage === activeStage) {
      baseRotation.current += 360;
      setPulseKey((current) => current + 1);
      if (shouldReduceMotion) {
        outerTarget.jump(baseRotation.current);
        outerRotation.jump(baseRotation.current);
      } else {
        outerTarget.set(baseRotation.current);
      }
    } else {
      onStageChange(stage);
    }

    onStatusChange(`已进入${stageLabel}阶段`);
  };

  const selectNextStage = () => {
    const currentIndex = STAGE_ORDER.indexOf(activeStage);
    const nextStage = STAGE_ORDER[(currentIndex + 1) % STAGE_ORDER.length];
    selectStage(nextStage);
  };

  const prepareWriteback = () => {
    ceremonyTimers.current.forEach((timer) => clearTimeout(timer));
    ceremonyTimers.current = [];
    setPulseKey((current) => current + 1);
    onStatusChange('正在汇集学习成果…');

    if (shouldReduceMotion) {
      setCeremonyStage('writeback');
      onStatusChange('已准备沉淀 · 等待确认');
      ceremonyTimers.current = [setTimeout(() => setCeremonyStage(null), 600)];
      return;
    }

    baseRotation.current += 360;
    outerTarget.set(baseRotation.current);
    setCeremonyStage('goal');

    ceremonyTimers.current = [
      setTimeout(() => setCeremonyStage('classroom'), 180),
      setTimeout(() => setCeremonyStage('writeback'), 360),
      setTimeout(() => {
        setCeremonyStage(null);
        onStatusChange('已准备沉淀 · 等待确认');
      }, 820),
    ];
  };

  const handleCenterClick = () => {
    if (centerClickTimer.current) {
      clearTimeout(centerClickTimer.current);
    }

    centerClickTimer.current = setTimeout(() => {
      centerClickTimer.current = null;
      selectNextStage();
    }, 240);
  };

  const handleCenterDoubleClick = () => {
    if (centerClickTimer.current) {
      clearTimeout(centerClickTimer.current);
      centerClickTimer.current = null;
    }
    prepareWriteback();
  };

  return (
    <motion.div
      drag
      dragConstraints={dragConstraints}
      dragElastic={0.16}
      dragMomentum={!shouldReduceMotion}
      dragTransition={{
        bounceStiffness: 240,
        bounceDamping: 24,
        power: 0.2,
        timeConstant: 260,
      }}
      onDragStart={() => {
        setDragging(true);
        onStatusChange('正在拖动 · 松手后会弹性停靠');
      }}
      onDragEnd={() => {
        setDragging(false);
        onStatusChange('已停靠 · 位置仍可继续调整');
      }}
      className="absolute left-[38%] top-[27%] z-20 h-[188px] w-[188px] touch-none select-none"
      style={{ cursor: dragging ? 'grabbing' : 'grab' }}
      whileDrag={shouldReduceMotion ? undefined : { scale: 0.965 }}
      aria-label="可拖动的知洄生命标识"
      role="region"
    >
      <div
        className="relative h-full w-full"
        onPointerEnter={() => {
          const currentAngle = outerRotation.get();
          outerTarget.jump(currentAngle);
          outerRotation.jump(currentAngle);
          setHovered(true);
        }}
        onPointerLeave={() => {
          setHovered(false);
        }}
      >
        <motion.div
          className="pointer-events-none absolute inset-[17%] rounded-full"
          animate={{
            opacity: hovered ? 0.5 : 0.22,
            scale: hovered ? 1.1 : 0.92,
            filter: hovered ? 'blur(18px)' : 'blur(24px)',
          }}
          transition={{ duration: 0.45 }}
          style={{
            background:
              'radial-gradient(circle, rgba(99,102,241,0.26) 0%, rgba(34,211,238,0.12) 44%, rgba(255,255,255,0) 72%)',
          }}
        />

        <Circle
          aria-hidden="true"
          className={cn(
            'pointer-events-none absolute left-1/2 top-1/2 h-[118px] w-[118px] -translate-x-1/2 -translate-y-1/2 stroke-[0.65] transition-colors duration-300',
            ceremonyStage ? 'text-cyan-400/45' : 'text-indigo-400/20',
          )}
        />

        <motion.div className="absolute inset-0" style={{ rotate: outerRotation }}>
          <img
            src="/brand/vaultide-orbit-outer.png"
            alt=""
            draggable={false}
            className="pointer-events-none h-full w-full object-contain transition-[filter] duration-300"
            style={{
              filter: hovered
                ? 'drop-shadow(0 9px 16px rgba(79,70,229,0.26)) saturate(1.08)'
                : 'drop-shadow(0 7px 13px rgba(79,70,229,0.17)) saturate(1)',
            }}
          />

          {STAGES.map((stage) => {
            const Icon = stage.icon;
            const active = activeStage === stage.id;
            const highlighted = ceremonyStage ? ceremonyStage === stage.id : active;

            return (
              <button
                key={stage.id}
                type="button"
                aria-label={`进入${stage.label}阶段`}
                aria-current={active ? 'step' : undefined}
                title={stage.label}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  selectStage(stage.id);
                }}
                className="group/node absolute z-30 flex h-10 w-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-2"
                style={{ left: stage.left, top: stage.top }}
              >
                <motion.span
                  className={cn(
                    'flex h-[22px] w-[22px] items-center justify-center rounded-full text-white transition',
                    highlighted
                      ? 'bg-white/16 ring-2 ring-white/90 shadow-[0_0_18px_rgba(79,70,229,0.5)]'
                      : 'bg-white/0',
                  )}
                  style={{ rotate: counterRotation }}
                  animate={{
                    scale: hovered || highlighted ? 1 : 0.82,
                    opacity: hovered || highlighted ? 1 : 0.38,
                  }}
                  whileHover={{ scale: 1.18 }}
                  whileTap={{ scale: 0.86 }}
                >
                  <Icon className="h-3 w-3 stroke-[2.4]" aria-hidden="true" />
                </motion.span>
              </button>
            );
          })}
        </motion.div>

        <img
          src="/brand/vaultide-orbit-inner.png"
          alt=""
          draggable={false}
          className="pointer-events-none absolute inset-0 h-full w-full object-contain transition-[filter] duration-300"
          style={{
            filter: hovered
              ? 'drop-shadow(0 8px 14px rgba(14,165,233,0.22))'
              : 'drop-shadow(0 5px 10px rgba(14,165,233,0.13))',
          }}
        />

        <div className="absolute left-1/2 top-1/2 z-40 h-[72px] w-[72px] -translate-x-1/2 -translate-y-1/2">
          <button
            type="button"
            aria-label="单击切换阶段，双击准备沉淀"
            title="单击切换阶段 · 双击准备沉淀"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={handleCenterClick}
            onDoubleClick={handleCenterDoubleClick}
            className="h-full w-full rounded-full outline-none focus-visible:ring-4 focus-visible:ring-cyan-200/70"
          >
            <span className="sr-only">单击切换阶段，双击准备沉淀</span>
          </button>
        </div>

        {pulseKey > 0 && !shouldReduceMotion && (
          <div className="pointer-events-none absolute left-1/2 top-1/2 h-[66px] w-[66px] -translate-x-1/2 -translate-y-1/2">
            <motion.span
              key={pulseKey}
              className="absolute inset-0 rounded-full border border-cyan-300/70"
              initial={{ opacity: 0.82, scale: 0.7 }}
              animate={{ opacity: 0, scale: 2.1 }}
              transition={{ duration: 0.9, ease: 'easeOut' }}
            />
          </div>
        )}
      </div>
    </motion.div>
  );
}
