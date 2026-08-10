'use client';

import {
  ArrowLeft,
  Check,
  CheckCircle2,
  DatabaseZap,
  MousePointer2,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import Link from 'next/link';
import Image from 'next/image';
import { AnimatePresence, motion } from 'motion/react';
import { useRef, useState } from 'react';
import {
  VaultideMagneticDock,
  type VaultideDockStage,
} from '@/components/learning/vaultide-magnetic-dock';
import { cn } from '@/lib/utils';

const STAGES: Array<{ id: VaultideDockStage; label: string; copy: string }> = [
  { id: 'goal', label: '目标', copy: '明确学完后能够做什么' },
  { id: 'classroom', label: '课堂', copy: '进入来源与专注学习阶段' },
  { id: 'writeback', label: '沉淀', copy: '选择需要写回 Obsidian 的成果' },
];

export default function LogoPreviewPage() {
  const constraintsRef = useRef<HTMLDivElement>(null);
  const [activeStage, setActiveStage] = useState<VaultideDockStage>('goal');
  const [status, setStatus] = useState('磁吸坞已展开 · 当前目标');
  const [resetKey, setResetKey] = useState(0);
  const [writebackReady, setWritebackReady] = useState(false);

  const resetDock = () => {
    setResetKey((current) => current + 1);
    setWritebackReady(false);
    setStatus('已重置磁吸坞位置');
  };

  return (
    <main className="min-h-dvh overflow-x-hidden bg-[#f3f6fb] px-4 py-5 text-slate-900 md:px-7 md:py-7">
      <header className="mx-auto flex w-full max-w-[1380px] items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white bg-white/75 text-slate-500 shadow-sm backdrop-blur transition hover:text-violet-600"
            aria-label="返回首页"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-violet-600">
              <Sparkles className="h-3.5 w-3.5" />
              Interaction prototype
            </div>
            <h1 className="mt-1 text-xl font-semibold tracking-tight md:text-2xl">
              磁吸边缘坞 · 真实交互预览
            </h1>
          </div>
        </div>
        <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700">
          不影响正式首页
        </span>
      </header>

      <div className="mx-auto mt-5 grid w-full max-w-[1380px] gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section
          ref={constraintsRef}
          className="relative min-h-[650px] overflow-hidden rounded-[34px] border border-white/90 bg-[radial-gradient(circle_at_40%_16%,rgba(219,234,254,0.94),transparent_36%),radial-gradient(circle_at_72%_68%,rgba(237,233,254,0.82),transparent_34%),linear-gradient(180deg,#f8fafc_0%,#eef2f7_100%)] shadow-[0_28px_90px_rgba(71,85,105,0.12)]"
        >
          <div className="pointer-events-none absolute inset-x-0 top-8 flex justify-center">
            <div className="text-center">
              <Image
                src="/brand/vaultide-logo-compact.png"
                alt="知洄 Vaultide"
                width={444}
                height={132}
                priority
                className="mx-auto h-auto w-[222px]"
              />
              <p className="mt-3 text-sm text-slate-400">让每次学习，流回你的知识库</p>
            </div>
          </div>

          <div className="pointer-events-none absolute inset-x-8 bottom-8 h-[230px] rounded-[28px] border border-white/90 bg-white/68 shadow-[0_20px_55px_rgba(71,85,105,0.08)] backdrop-blur-xl">
            <div className="flex items-center justify-between border-b border-slate-100/80 px-6 py-4">
              <span className="text-xs font-medium text-slate-500">01 · 定义学完后能够做什么</span>
              <span className="rounded-full bg-violet-50 px-3 py-1 text-[11px] font-medium text-violet-600">
                来源 · 外部探索
              </span>
            </div>
            <div className="px-6 py-5 text-sm leading-7 text-slate-300">
              输入你想学习的任何内容，例如：
              <br />
              「从零学 Python，30 分钟写出第一个程序」
            </div>
          </div>

          <AnimatePresence mode="wait">
            <motion.div
              key={status}
              initial={{ opacity: 0, y: -8, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.98 }}
              className="absolute right-5 top-5 z-30 flex items-center gap-2 rounded-full border border-white/90 bg-white/78 px-3 py-2 text-xs font-medium text-slate-600 shadow-lg shadow-slate-900/5 backdrop-blur-xl"
            >
              <CheckCircle2 className="h-3.5 w-3.5 text-cyan-500" />
              {status}
            </motion.div>
          </AnimatePresence>

          <VaultideMagneticDock
            key={resetKey}
            activeStage={activeStage}
            dragConstraints={constraintsRef}
            onStageChange={setActiveStage}
            onStatusChange={setStatus}
            onPrepareWriteback={() => {
              setWritebackReady(true);
              setStatus('已准备沉淀 · 等待确认');
            }}
          />

          <div className="absolute bottom-5 left-5 z-30 flex items-center gap-2 rounded-full bg-slate-950/80 px-3 py-2 text-[11px] text-white/85 backdrop-blur">
            <MousePointer2 className="h-3.5 w-3.5" />
            单击展开 · 拖动换边 · 双击准备沉淀
          </div>

          <AnimatePresence>
            {writebackReady && (
              <motion.div
                initial={{ opacity: 0, y: 24, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 18, scale: 0.985 }}
                transition={{ type: 'spring', stiffness: 380, damping: 31 }}
                className="fixed bottom-5 left-1/2 z-50 flex w-[min(1040px,calc(100%-40px))] -translate-x-1/2 items-center gap-4 rounded-[24px] border border-white bg-white/92 px-4 py-3.5 shadow-[0_24px_60px_rgba(15,23,42,0.18)] backdrop-blur-xl"
                role="dialog"
                aria-label="准备写回 Obsidian"
              >
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-600 to-cyan-500 text-white shadow-lg shadow-violet-500/20">
                  <DatabaseZap className="h-5 w-5" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">准备写回 Obsidian</p>
                  <p className="mt-1 truncate text-xs text-slate-500">
                    双击只进入确认，不会直接执行 · 3 条待写回内容
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setWritebackReady(false);
                    setStatus('已取消本次沉淀');
                  }}
                  className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-slate-200 px-3.5 text-xs font-medium text-slate-600 transition hover:border-slate-300"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                  取消
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setWritebackReady(false);
                    setStatus('已确认 · 等待 Obsidian 设备批准');
                  }}
                  className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-slate-950 px-4 text-xs font-semibold text-white transition hover:bg-violet-700"
                >
                  <Check className="h-3.5 w-3.5" aria-hidden="true" />
                  确认写回
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </section>

        <aside className="rounded-[30px] border border-white bg-white/82 p-5 shadow-[0_24px_70px_rgba(71,85,105,0.11)] backdrop-blur-xl">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-violet-600">
            Real behavior
          </p>
          <h2 className="mt-2 text-lg font-semibold">磁吸边缘坞</h2>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            它不再伪装成 Logo，而是一个随时可收起、可换边的学习控制器。
          </p>

          <div className="mt-5 space-y-2.5">
            {[
              ['单击展开', '三个模块按顺序磁吸展开或收回'],
              ['拖动换边', '松手后自动吸附最近的画布边缘'],
              ['双击预备', '只打开安全沉淀确认，不直接写回'],
              ['状态清晰', '当前位置与模块高亮同步反馈'],
            ].map(([title, copy]) => (
              <div key={title} className="rounded-2xl bg-slate-50 px-3.5 py-3">
                <div className="text-sm font-medium">{title}</div>
                <div className="mt-1 text-xs leading-5 text-slate-500">{copy}</div>
              </div>
            ))}
          </div>

          <div className="mt-6">
            <p className="text-xs font-medium text-slate-500">当前阶段</p>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {STAGES.map((stage) => (
                <button
                  key={stage.id}
                  type="button"
                  onClick={() => {
                    setActiveStage(stage.id);
                    setStatus(`已进入${stage.label}阶段`);
                  }}
                  className={cn(
                    'rounded-xl border px-2 py-2.5 text-xs font-medium transition',
                    activeStage === stage.id
                      ? 'border-violet-300 bg-violet-50 text-violet-700'
                      : 'border-slate-200 bg-white text-slate-500 hover:border-violet-200',
                  )}
                >
                  {stage.label}
                </button>
              ))}
            </div>
            <p className="mt-2 min-h-10 text-xs leading-5 text-slate-400">
              {STAGES.find((stage) => stage.id === activeStage)?.copy}
            </p>
          </div>

          <div className="mt-5 flex items-center gap-2 rounded-2xl bg-emerald-50 px-3.5 py-3 text-xs text-emerald-700">
            <ShieldCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
            双击永远先确认，不会自动写入
          </div>

          <button
            type="button"
            onClick={resetDock}
            className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-950 px-4 py-3 text-sm font-medium text-white transition hover:bg-violet-700"
          >
            <RotateCcw className="h-4 w-4" />
            重置磁吸坞
          </button>
        </aside>
      </div>
    </main>
  );
}
