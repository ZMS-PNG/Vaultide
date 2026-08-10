'use client';

import {
  AnimatePresence,
  animate,
  motion,
  useDragControls,
  useMotionValue,
  useReducedMotion,
} from 'motion/react';
import {
  ArrowRight,
  BookOpenCheck,
  DatabaseZap,
  Eye,
  GripVertical,
  Target,
  type LucideIcon,
} from 'lucide-react';
import Image from 'next/image';
import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';
import type { ObsidianBridgeState } from '@/lib/learning/domain/learning-session';
import { cn } from '@/lib/utils';

export type VaultideDockStage = 'goal' | 'classroom' | 'writeback';

export interface VaultideDockStageDetail {
  readonly copy?: string;
  readonly badge?: number | string;
}

interface VaultideMagneticDockProps {
  readonly activeStage: VaultideDockStage;
  readonly bridgeState?: ObsidianBridgeState;
  readonly defaultExpanded?: boolean;
  readonly dragConstraints: RefObject<Element | null>;
  readonly onPrepareWriteback: () => void;
  readonly onStageChange: (stage: VaultideDockStage) => void;
  readonly onStatusChange: (status: string) => void;
  readonly stageDetails?: Partial<Record<VaultideDockStage, VaultideDockStageDetail>>;
}

const STAGES: Array<{
  id: VaultideDockStage;
  title: string;
  copy: string;
  icon: LucideIcon;
  color: string;
  y: number;
}> = [
  {
    id: 'goal',
    title: '定义目标',
    copy: '明确学习成果',
    icon: Target,
    color: '#8b5cf6',
    y: 68,
  },
  {
    id: 'classroom',
    title: '进入课堂',
    copy: '开始专注学习',
    icon: BookOpenCheck,
    color: '#3b82f6',
    y: 176,
  },
  {
    id: 'writeback',
    title: '写回 Obsidian',
    copy: '沉淀到知识库',
    icon: DatabaseZap,
    color: '#06b6d4',
    y: 284,
  },
];

export function VaultideMagneticDock({
  activeStage,
  bridgeState = 'unknown',
  defaultExpanded = true,
  dragConstraints,
  onPrepareWriteback,
  onStageChange,
  onStatusChange,
  stageDetails,
}: VaultideMagneticDockProps) {
  const shouldReduceMotion = useReducedMotion();
  const dragControls = useDragControls();
  const rootRef = useRef<HTMLDivElement>(null);
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prepareTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [dragging, setDragging] = useState(false);
  const [side, setSide] = useState<'left' | 'right'>('right');
  const [preparing, setPreparing] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);

  useEffect(
    () => () => {
      if (clickTimer.current) clearTimeout(clickTimer.current);
      if (prepareTimer.current) clearTimeout(prepareTimer.current);
    },
    [],
  );

  useEffect(() => {
    const anchorToViewport = () => {
      const parentRect = dragConstraints.current?.getBoundingClientRect();
      const dockRect = rootRef.current?.getBoundingClientRect();
      if (!parentRect || !dockRect) return;

      const targetLeft =
        side === 'left' ? parentRect.left + 12 : parentRect.right - dockRect.width - 12;
      const targetTop = Math.max(
        parentRect.top + 12,
        Math.min(dockRect.top, parentRect.bottom - dockRect.height - 12),
      );

      x.set(x.get() + targetLeft - dockRect.left);
      y.set(y.get() + targetTop - dockRect.top);
    };

    const handleResize = () => window.requestAnimationFrame(anchorToViewport);
    const initialFrame = window.requestAnimationFrame(anchorToViewport);
    window.addEventListener('resize', handleResize);
    return () => {
      window.cancelAnimationFrame(initialFrame);
      window.removeEventListener('resize', handleResize);
    };
  }, [dragConstraints, side, x, y]);

  const toggleExpanded = () => {
    const next = !expanded;
    setExpanded(next);
    onStatusChange(next ? '磁吸坞已展开' : '磁吸坞已收起');
  };

  const handleLogoClick = () => {
    if (clickTimer.current) clearTimeout(clickTimer.current);

    clickTimer.current = setTimeout(() => {
      clickTimer.current = null;
      setStatusOpen((current) => {
        const next = !current;
        if (next) setExpanded(false);
        onStatusChange(next ? '已打开知识回流中心' : '已收起知识回流中心');
        return next;
      });
    }, 230);
  };

  const prepareWriteback = () => {
    if (clickTimer.current) {
      clearTimeout(clickTimer.current);
      clickTimer.current = null;
    }
    if (prepareTimer.current) clearTimeout(prepareTimer.current);

    setPreparing(true);
    setExpanded(true);
    setStatusOpen(false);
    onStatusChange('正在准备安全沉淀…');

    const finish = () => {
      setPreparing(false);
      onPrepareWriteback();
    };

    if (shouldReduceMotion) {
      finish();
      return;
    }

    prepareTimer.current = setTimeout(finish, 560);
  };

  const handleLogoDoubleClick = () => {
    prepareWriteback();
  };

  const startDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    dragControls.start(event);
  };

  const selectStage = (stage: VaultideDockStage) => {
    setStatusOpen(false);
    onStageChange(stage);
    onStatusChange(
      stage === 'goal'
        ? '已打开学习目标'
        : stage === 'classroom'
          ? '已打开课堂与复习'
          : '已打开知识沉淀中心',
    );
    if (stage === 'writeback') {
      setExpanded(true);
    }
  };

  const selectRailStage = (stage: VaultideDockStage) => {
    if (stage === activeStage) {
      toggleExpanded();
      return;
    }
    selectStage(stage);
  };

  const bridgeLabel =
    bridgeState === 'online'
      ? 'Obsidian 已连接'
      : bridgeState === 'attention'
        ? '有内容等待处理'
        : bridgeState === 'offline'
          ? 'Obsidian 暂不可用'
          : bridgeState === 'syncing'
            ? '正在等待 Obsidian 同步'
            : '正在检查 Obsidian';
  const activeStageTitle = STAGES.find((stage) => stage.id === activeStage)?.title ?? '学习目标';

  return (
    <motion.div
      ref={rootRef}
      drag
      dragControls={dragControls}
      dragListener={false}
      dragConstraints={dragConstraints}
      dragElastic={0.08}
      dragMomentum={false}
      style={{ x, y }}
      onDragStart={() => {
        setDragging(true);
        setExpanded(false);
        setStatusOpen(false);
        onStatusChange('正在移动磁吸坞…');
      }}
      onDragEnd={() => {
        const parentRect = dragConstraints.current?.getBoundingClientRect();
        const dockRect = rootRef.current?.getBoundingClientRect();

        if (parentRect && dockRect) {
          const nextSide =
            dockRect.left + dockRect.width / 2 < parentRect.left + parentRect.width / 2
              ? 'left'
              : 'right';
          const targetLeft =
            nextSide === 'left' ? parentRect.left + 12 : parentRect.right - dockRect.width - 12;
          const nextX = x.get() + targetLeft - dockRect.left;

          setSide(nextSide);
          animate(x, nextX, {
            type: 'spring',
            stiffness: 430,
            damping: 34,
            mass: 0.72,
          });
          onStatusChange(nextSide === 'left' ? '已吸附左侧边缘' : '已吸附右侧边缘');
        }

        window.setTimeout(() => setDragging(false), 0);
      }}
      whileDrag={shouldReduceMotion ? undefined : { scale: 0.985 }}
      className="pointer-events-auto absolute right-3 top-[22%] z-40 h-[352px] w-[56px] touch-none select-none"
      role="region"
      aria-label="可拖拽的知洄磁吸边缘坞"
    >
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, scale: 0.97, x: side === 'right' ? 18 : -18 }}
            animate={{ opacity: 1, scale: 1, x: 0 }}
            exit={{ opacity: 0, scale: 0.98, x: side === 'right' ? 14 : -14 }}
            transition={{ type: 'spring', stiffness: 390, damping: 31 }}
            className={cn(
              'absolute top-0 h-full w-[232px]',
              side === 'right' ? 'right-[52px]' : 'left-[52px]',
            )}
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 232 352"
              className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
            >
              <g transform={side === 'right' ? undefined : 'translate(232 0) scale(-1 1)'}>
                <path
                  d="M190 68 C221 68 213 176 232 176"
                  fill="none"
                  stroke="#8b5cf6"
                  strokeOpacity="0.86"
                  strokeWidth="2"
                />
                <path
                  d="M190 176 H232"
                  fill="none"
                  stroke="#3b82f6"
                  strokeOpacity="0.86"
                  strokeWidth="2"
                />
                <path
                  d="M190 284 C221 284 213 176 232 176"
                  fill="none"
                  stroke="#06b6d4"
                  strokeOpacity="0.86"
                  strokeWidth="2"
                />
              </g>
            </svg>

            {STAGES.map((stage, index) => {
              const Icon = stage.icon;
              const active = stage.id === activeStage;
              const detail = stageDetails?.[stage.id];

              return (
                <motion.div
                  key={stage.id}
                  initial={{ opacity: 0, x: side === 'right' ? 28 : -28 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{
                    delay: shouldReduceMotion ? 0 : index * 0.055,
                    type: 'spring',
                    stiffness: 420,
                    damping: 33,
                  }}
                  className="absolute left-0 right-0 h-16 -translate-y-1/2"
                  style={{ top: stage.y }}
                >
                  <button
                    type="button"
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={() => selectStage(stage.id)}
                    aria-current={active ? 'step' : undefined}
                    className={cn(
                      'absolute top-0 flex h-16 w-[190px] items-center gap-3 rounded-[24px] border px-3.5 text-left text-white outline-none transition focus-visible:ring-2 focus-visible:ring-cyan-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-100',
                      side === 'right' ? 'left-0' : 'right-0',
                      active
                        ? 'border-white/16 bg-[#222530] shadow-[0_15px_34px_rgba(15,23,42,0.28)]'
                        : 'border-white/8 bg-[#292c36] shadow-[0_11px_26px_rgba(15,23,42,0.2)] hover:bg-[#242731]',
                    )}
                  >
                    <span
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-950/35"
                      style={{ color: stage.color }}
                    >
                      <Icon className="h-5 w-5 stroke-[1.9]" aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{stage.title}</span>
                      <span className="mt-0.5 block truncate text-[11px] text-slate-300">
                        {detail?.copy ?? stage.copy}
                      </span>
                    </span>
                    {detail?.badge !== undefined && detail.badge !== 0 && (
                      <span
                        className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1 text-[10px] font-semibold text-white"
                        style={{ backgroundColor: stage.color }}
                        aria-label={`${detail.badge} 项`}
                      >
                        {detail.badge}
                      </span>
                    )}
                    <span
                      className={cn(
                        'absolute top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full border-2 border-[#292c36]',
                        side === 'right' ? '-right-1' : '-left-1',
                      )}
                      style={{ backgroundColor: stage.color }}
                    />
                  </button>
                </motion.div>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {statusOpen && (
          <motion.section
            aria-label="知识回流中心"
            initial={{ opacity: 0, scale: 0.96, x: side === 'right' ? 14 : -14 }}
            animate={{ opacity: 1, scale: 1, x: 0 }}
            exit={{ opacity: 0, scale: 0.97, x: side === 'right' ? 10 : -10 }}
            transition={{ type: 'spring', stiffness: 420, damping: 32 }}
            className={cn(
              'absolute bottom-0 w-[268px] rounded-[24px] border border-slate-200/85 bg-white/96 p-3.5 text-slate-900 shadow-[0_20px_55px_rgba(15,23,42,0.22)] backdrop-blur-2xl dark:border-slate-700 dark:bg-slate-900/96 dark:text-white',
              side === 'right' ? 'right-[52px]' : 'left-[52px]',
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-violet-600 dark:text-violet-300">
                  Knowledge return
                </p>
                <h2 className="mt-1 text-sm font-semibold">知识回流中心</h2>
              </div>
              <span
                className={cn(
                  'mt-1 h-2.5 w-2.5 shrink-0 rounded-full',
                  bridgeState === 'online' && 'bg-emerald-400',
                  bridgeState === 'attention' && 'bg-amber-400',
                  bridgeState === 'offline' && 'bg-rose-500',
                  bridgeState === 'syncing' && 'animate-pulse bg-cyan-400',
                  bridgeState === 'unknown' && 'bg-slate-400',
                )}
              />
            </div>
            <div className="mt-3 space-y-2 rounded-2xl bg-slate-50 p-3 text-[11px] dark:bg-slate-950/65">
              <div className="flex items-center justify-between gap-3">
                <span className="text-slate-500">连接状态</span>
                <span className="font-medium">{bridgeLabel}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-slate-500">当前阶段</span>
                <span className="font-medium">{activeStageTitle}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-slate-500">待沉淀</span>
                <span className="max-w-[150px] truncate font-medium">
                  {stageDetails?.writeback?.copy ?? '暂无待沉淀内容'}
                </span>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  setStatusOpen(false);
                  selectStage('writeback');
                }}
                className="inline-flex h-9 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-2.5 text-[11px] font-semibold transition hover:border-violet-300 hover:text-violet-700 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-violet-700 dark:hover:text-violet-200"
              >
                回流中心 <ArrowRight className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={prepareWriteback}
                className="inline-flex h-9 items-center justify-center gap-1.5 rounded-xl bg-slate-950 px-2.5 text-[11px] font-semibold text-white transition hover:bg-violet-700 dark:bg-white dark:text-slate-950 dark:hover:bg-violet-200"
              >
                <Eye className="h-3.5 w-3.5" /> 安全预览
              </button>
            </div>
            <p className="mt-2 text-center text-[9px] text-slate-400">
              双击下方徽标可直接生成沉淀预览
            </p>
          </motion.section>
        )}
      </AnimatePresence>

      <div
        className={cn(
          'relative h-full w-full overflow-hidden rounded-[25px] border border-white/10 bg-[#242731] text-white shadow-[0_20px_44px_rgba(15,23,42,0.32)] outline-none transition focus-visible:ring-2 focus-visible:ring-cyan-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-100',
          preparing && 'shadow-[0_20px_48px_rgba(6,182,212,0.28)]',
        )}
      >
        <button
          type="button"
          onPointerDown={startDrag}
          aria-label="拖动知洄磁吸坞"
          title="按住拖动，可吸附到屏幕左右两侧"
          className={cn(
            'absolute left-1/2 top-2 z-20 flex h-8 w-10 -translate-x-1/2 items-center justify-center rounded-xl text-slate-500 outline-none transition hover:bg-white/5 hover:text-slate-300 focus-visible:ring-2 focus-visible:ring-cyan-300',
            dragging ? 'cursor-grabbing' : 'cursor-grab',
          )}
        >
          <GripVertical className="h-4 w-4" aria-hidden="true" />
        </button>

        <span
          className={cn(
            'absolute left-1/2 top-14 h-[238px] w-[3px] -translate-x-1/2 rounded-full bg-gradient-to-b from-violet-500 via-blue-500 to-cyan-400 transition',
            preparing && 'animate-pulse shadow-[0_0_18px_rgba(34,211,238,0.72)]',
          )}
        />

        {STAGES.map((stage) => {
          const active = stage.id === activeStage;
          return (
            <button
              key={stage.id}
              type="button"
              aria-label={`${active ? '当前阶段：' : '切换到'}${stage.title}`}
              aria-current={active ? 'step' : undefined}
              title={active ? `${stage.title} · 点击展开` : `切换到${stage.title}`}
              onClick={() => selectRailStage(stage.id)}
              className="group absolute left-1/2 z-10 flex h-11 w-11 -translate-x-1/2 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
              style={{ top: stage.y - 22 }}
            >
              <span
                className={cn(
                  'rounded-full transition-all duration-200',
                  active
                    ? 'h-[18px] w-[18px] border-2 border-[#242731] bg-slate-900 shadow-[0_0_0_2px_rgba(255,255,255,0.78)]'
                    : 'h-2 w-2 border border-white/50 bg-slate-700 group-hover:h-3 group-hover:w-3',
                )}
                style={active ? { borderColor: '#242731' } : { backgroundColor: stage.color }}
              >
                {active && (
                  <span
                    className="absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full"
                    style={{ backgroundColor: stage.color }}
                  />
                )}
              </span>
            </button>
          );
        })}

        <motion.span
          aria-hidden="true"
          className="pointer-events-none absolute left-1/2 h-[26px] w-[26px] -translate-x-1/2 rounded-full border border-white/12"
          animate={{
            top: STAGES.find((stage) => stage.id === activeStage)?.y ?? STAGES[0].y,
            borderColor: STAGES.find((stage) => stage.id === activeStage)?.color ?? '#8b5cf6',
          }}
          transition={
            shouldReduceMotion
              ? { duration: 0 }
              : { type: 'spring', stiffness: 440, damping: 32, mass: 0.7 }
          }
          style={{ marginTop: -13 }}
        />

        <button
          type="button"
          aria-label={`知识回流中心：${bridgeLabel}`}
          aria-expanded={statusOpen}
          title="单击查看回流状态 · 双击生成安全沉淀预览"
          onClick={handleLogoClick}
          onDoubleClick={handleLogoDoubleClick}
          className="absolute bottom-3 left-1/2 z-20 flex h-10 w-10 -translate-x-1/2 items-center justify-center rounded-full bg-slate-950/55 outline-none transition hover:scale-105 hover:bg-slate-950/80 focus-visible:ring-2 focus-visible:ring-cyan-300"
        >
          <Image
            src="/brand/vaultide-mark.png"
            alt="知洄"
            draggable={false}
            width={28}
            height={28}
            className="h-7 w-7 object-contain"
          />
          <span
            className={cn(
              'absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-[#242731]',
              bridgeState === 'online' && 'bg-emerald-400',
              bridgeState === 'attention' && 'bg-amber-400',
              bridgeState === 'offline' && 'bg-rose-500',
              bridgeState === 'syncing' && 'animate-pulse bg-cyan-400',
              bridgeState === 'unknown' && 'bg-slate-500',
            )}
            title={
              bridgeState === 'online'
                ? 'Obsidian 连接正常'
                : bridgeState === 'attention'
                  ? 'Obsidian 有待处理内容'
                  : bridgeState === 'offline'
                    ? 'Obsidian 状态暂不可用'
                    : bridgeState === 'syncing'
                      ? '正在等待 Obsidian 同步'
                      : '正在检查 Obsidian 状态'
            }
          />
        </button>
      </div>
    </motion.div>
  );
}
