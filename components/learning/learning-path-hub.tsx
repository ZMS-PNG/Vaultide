'use client';

import {
  ArrowRight,
  BookOpenText,
  Check,
  Clipboard,
  DatabaseZap,
  Globe2,
  PlugZap,
  ShieldCheck,
  Sparkles,
  Target,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { writeLearningProjectDraft } from '@/lib/learning/client/learning-project-draft';
import {
  updateLearningProjectBrief,
  type LearningOutcomeKind,
  type LearningProjectBrief,
  type LearningSourceMode,
  type PriorKnowledgeLevel,
} from '@/lib/learning/domain/learning-project-plan';
import { PRODUCT_BRAND } from '@/lib/product-brand';
import { cn } from '@/lib/utils';

const PREVIEW_COMMAND = PRODUCT_BRAND.previewCommand;
const WRITEBACK_COMMAND = PRODUCT_BRAND.writebackCommand;

const SOURCE_PATHS: Array<{
  id: LearningSourceMode;
  title: string;
  shortTitle: string;
  description: string;
  icon: typeof Globe2;
  accent: string;
}> = [
  {
    id: 'external',
    title: '学习外部新知识',
    shortTitle: '外部探索',
    description: '检索论文、技术、GitHub 与权威网页，并保留可追溯证据。',
    icon: Globe2,
    accent: 'bg-blue-50 text-blue-600 dark:bg-blue-950/45 dark:text-blue-300',
  },
  {
    id: 'obsidian',
    title: '学习 Obsidian 内容',
    shortTitle: '知识库',
    description: '从一份笔记或整个项目出发，把学习进度写入独立伴随笔记。',
    icon: BookOpenText,
    accent: 'bg-violet-50 text-violet-600 dark:bg-violet-950/45 dark:text-violet-300',
  },
  {
    id: 'hybrid',
    title: '内部知识 + 外部补充',
    shortTitle: '混合补全',
    description: '先发现个人知识库缺口，再定向补充外部权威证据。',
    icon: DatabaseZap,
    accent: 'bg-cyan-50 text-cyan-700 dark:bg-cyan-950/45 dark:text-cyan-300',
  },
];

const OUTCOME_OPTIONS: Array<{
  value: LearningOutcomeKind;
  label: string;
  description: string;
}> = [
  { value: 'understand', label: '理解', description: '能够解释' },
  { value: 'compare', label: '判断', description: '能够比较' },
  { value: 'apply', label: '应用', description: '解决问题' },
  { value: 'build', label: '产出', description: '完成并验证' },
];

const PRIOR_OPTIONS: Array<{ value: PriorKnowledgeLevel; label: string }> = [
  { value: 'new', label: '第一次学习' },
  { value: 'basic', label: '知道一点' },
  { value: 'working', label: '有实践经验' },
  { value: 'advanced', label: '已有深入基础' },
];

interface LearningPathHubProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly goal: string;
  readonly project: LearningProjectBrief;
  readonly hasUsableProvider: boolean;
  readonly onProjectChange: (project: LearningProjectBrief) => void;
  readonly onExternalLearning: () => void;
  readonly onConfigureProvider: () => void;
}

function CopyCommand({ command }: { readonly command: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(command).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1_800);
        });
      }}
      className="flex w-full items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-left transition hover:border-violet-300 hover:bg-violet-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 dark:border-slate-700 dark:bg-slate-800/70 dark:hover:border-violet-700 dark:hover:bg-violet-950/30"
      aria-label={`复制命令：${command}`}
    >
      <code className="min-w-0 break-all text-xs text-slate-700 dark:text-slate-200">
        {command}
      </code>
      {copied ? (
        <Check className="h-4 w-4 shrink-0 text-emerald-500" />
      ) : (
        <Clipboard className="h-4 w-4 shrink-0 text-slate-400" />
      )}
    </button>
  );
}

export function LearningPathHub({
  open,
  onOpenChange,
  goal,
  project,
  hasUsableProvider,
  onProjectChange,
  onExternalLearning,
  onConfigureProvider,
}: LearningPathHubProps) {
  const [obsidianGuideOpen, setObsidianGuideOpen] = useState(false);
  const goalReady = goal.trim().length > 0;
  const activePath = SOURCE_PATHS.find((path) => path.id === project.sourceMode) ?? SOURCE_PATHS[0];

  const updateProject = (patch: Partial<Omit<LearningProjectBrief, 'id' | 'createdAt'>>) => {
    onProjectChange(updateLearningProjectBrief(project, patch));
  };

  const prepareLearning = () => {
    const next = updateLearningProjectBrief(project, { goal: goal.trim() });
    onProjectChange(next);
    writeLearningProjectDraft(next);
    onOpenChange(false);

    if (next.sourceMode === 'external') {
      if (!hasUsableProvider) {
        onConfigureProvider();
        return;
      }
      onExternalLearning();
      return;
    }

    window.setTimeout(() => setObsidianGuideOpen(true), 120);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[92dvh] max-w-4xl gap-0 overflow-hidden rounded-3xl border border-white/80 bg-white/95 p-0 shadow-2xl shadow-violet-950/15 backdrop-blur-xl dark:border-slate-800 dark:bg-slate-950/95">
          <DialogHeader className="border-b border-slate-100 px-6 pb-5 pt-6 pr-14 dark:border-slate-800">
            <div className="mb-1 flex items-center gap-2 text-xs font-semibold text-violet-600 dark:text-violet-300">
              <Sparkles className="h-4 w-4" />
              学习路径
            </div>
            <DialogTitle className="text-2xl font-semibold tracking-tight">
              这次从哪里开始学习？
            </DialogTitle>
            <DialogDescription className="max-w-2xl leading-6">
              只需选择一次。知洄会让同一学习目标贯穿证据、课堂、沉淀与复习。
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 overflow-y-auto px-6 py-5">
            <div className="grid gap-3 md:grid-cols-3" aria-label="学习来源">
              {SOURCE_PATHS.map((path) => {
                const Icon = path.icon;
                const active = project.sourceMode === path.id;
                return (
                  <button
                    key={path.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => updateProject({ sourceMode: path.id })}
                    className={cn(
                      'group relative min-h-36 rounded-2xl border p-4 text-left transition',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2',
                      active
                        ? 'border-violet-400 bg-violet-50/70 shadow-[0_12px_30px_rgba(124,58,237,0.09)] dark:border-violet-700 dark:bg-violet-950/30'
                        : 'border-slate-200 bg-slate-50/55 hover:-translate-y-0.5 hover:border-violet-200 hover:bg-white hover:shadow-lg dark:border-slate-800 dark:bg-slate-900/55 dark:hover:border-violet-900 dark:hover:bg-slate-900',
                    )}
                  >
                    <span className={cn('inline-flex rounded-xl p-2.5', path.accent)}>
                      <Icon className="h-5 w-5" />
                    </span>
                    <span className="mt-4 block text-sm font-semibold text-slate-900 dark:text-white">
                      {path.title}
                    </span>
                    <span className="mt-1.5 block text-xs leading-5 text-slate-500 dark:text-slate-400">
                      {path.description}
                    </span>
                    {active && (
                      <span className="absolute right-3 top-3 inline-flex h-6 w-6 items-center justify-center rounded-full bg-violet-600 text-white shadow-sm">
                        <Check className="h-3.5 w-3.5" />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)]">
              <div className="space-y-5">
                <fieldset>
                  <legend className="mb-2.5 flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-200">
                    <Target className="h-4 w-4 text-violet-500" />
                    学完后要做到
                  </legend>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {OUTCOME_OPTIONS.map((option) => {
                      const active = project.outcome === option.value;
                      return (
                        <button
                          key={option.value}
                          type="button"
                          aria-pressed={active}
                          onClick={() => updateProject({ outcome: option.value })}
                          className={cn(
                            'rounded-xl border px-3 py-2.5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400',
                            active
                              ? 'border-violet-400 bg-violet-50 text-violet-800 dark:border-violet-700 dark:bg-violet-950/40 dark:text-violet-200'
                              : 'border-slate-200 hover:border-violet-200 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-900',
                          )}
                        >
                          <span className="block text-xs font-semibold">{option.label}</span>
                          <span className="mt-0.5 block text-[10px] text-slate-500">
                            {option.description}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </fieldset>

                <fieldset>
                  <legend className="mb-2.5 flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-200">
                    <Sparkles className="h-4 w-4 text-violet-500" />
                    当前基础
                  </legend>
                  <div className="flex flex-wrap gap-2">
                    {PRIOR_OPTIONS.map((option) => {
                      const active = project.priorKnowledge === option.value;
                      return (
                        <button
                          key={option.value}
                          type="button"
                          aria-pressed={active}
                          onClick={() => updateProject({ priorKnowledge: option.value })}
                          className={cn(
                            'min-h-9 rounded-full border px-3.5 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400',
                            active
                              ? 'border-violet-500 bg-violet-600 text-white'
                              : 'border-slate-200 bg-white text-slate-600 hover:border-violet-300 hover:text-violet-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300',
                          )}
                        >
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                </fieldset>

                <fieldset>
                  <legend className="mb-2.5 flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-200">
                    <ShieldCheck className="h-4 w-4 text-violet-500" />
                    证据策略
                  </legend>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {[
                      {
                        value: 'primary-first' as const,
                        title: '原始与权威来源优先',
                        description: '适合论文、科研、技术与事实核验',
                      },
                      {
                        value: 'balanced' as const,
                        title: '平衡多类来源',
                        description: '兼顾原始材料、教程与解释性内容',
                      },
                    ].map((option) => {
                      const active = project.evidencePolicy === option.value;
                      return (
                        <button
                          key={option.value}
                          type="button"
                          aria-pressed={active}
                          onClick={() => updateProject({ evidencePolicy: option.value })}
                          className={cn(
                            'rounded-xl border px-3 py-2.5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400',
                            active
                              ? 'border-violet-400 bg-violet-50 dark:border-violet-700 dark:bg-violet-950/35'
                              : 'border-slate-200 hover:border-violet-200 dark:border-slate-800',
                          )}
                        >
                          <span className="flex items-center gap-2 text-xs font-semibold">
                            <span
                              className={cn(
                                'h-2 w-2 rounded-full',
                                active ? 'bg-violet-500' : 'bg-slate-300 dark:bg-slate-700',
                              )}
                            />
                            {option.title}
                          </span>
                          <span className="mt-1 block pl-4 text-[10px] text-slate-500">
                            {option.description}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </fieldset>

                <label className="block">
                  <span className="mb-2 block text-xs font-semibold text-slate-700 dark:text-slate-200">
                    我已经知道什么 / 最卡在哪里
                  </span>
                  <textarea
                    value={project.knownContext ?? ''}
                    onChange={(event) => updateProject({ knownContext: event.target.value })}
                    rows={3}
                    maxLength={1_000}
                    placeholder="可选，例如：知道基本术语，但不清楚方案之间的取舍。"
                    className="min-h-24 w-full resize-none rounded-2xl border border-slate-200 bg-slate-50/60 px-4 py-3 text-xs leading-5 outline-none transition placeholder:text-slate-400 focus:border-violet-400 focus:bg-white focus:ring-4 focus:ring-violet-100 dark:border-slate-800 dark:bg-slate-900 dark:focus:ring-violet-950"
                  />
                </label>
              </div>

              <aside className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-900/60">
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-violet-600 dark:text-violet-300">
                  本次路径
                </p>
                <h3 className="mt-2 text-base font-semibold">{activePath.shortTitle}</h3>
                <p className="mt-1 text-xs leading-5 text-slate-500">{activePath.description}</p>

                <div className="my-4 h-px bg-slate-200 dark:bg-slate-800" />

                <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                  可验证的完成标准
                </p>
                <ul className="mt-3 space-y-2.5 text-xs leading-5 text-slate-600 dark:text-slate-300">
                  {project.successCriteria.map((criterion) => (
                    <li key={criterion} className="flex gap-2">
                      <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
                      <span>{criterion}</span>
                    </li>
                  ))}
                </ul>

                <div className="mt-5 rounded-xl bg-white p-3 text-[11px] leading-5 text-slate-500 shadow-sm dark:bg-slate-950">
                  原始笔记始终只读。学习进度、课堂摘要和复习证据会进入独立伴随笔记。
                </div>
              </aside>
            </div>
          </div>

          <div className="flex flex-col gap-3 border-t border-slate-100 bg-white/95 px-6 py-4 dark:border-slate-800 dark:bg-slate-950/95 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="truncate text-xs font-medium text-slate-700 dark:text-slate-200">
                当前目标：{goalReady ? goal : '尚未填写'}
              </p>
              {!goalReady && (
                <p className="mt-1 text-[10px] text-amber-700 dark:text-amber-300">
                  请先关闭弹窗，在首页填写学习目标。
                </p>
              )}
            </div>
            <button
              type="button"
              disabled={!goalReady}
              onClick={prepareLearning}
              className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-violet-600 px-5 text-sm font-semibold text-white shadow-lg shadow-violet-600/20 transition hover:-translate-y-0.5 hover:bg-violet-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none dark:disabled:bg-slate-700"
            >
              {project.sourceMode === 'external'
                ? hasUsableProvider
                  ? '开始学习'
                  : '配置模型后开始'
                : project.sourceMode === 'hybrid'
                  ? '选择项目并学习'
                  : '选择资料并学习'}
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={obsidianGuideOpen} onOpenChange={setObsidianGuideOpen}>
        <DialogContent className="max-h-[90dvh] max-w-xl overflow-y-auto rounded-3xl">
          <DialogHeader>
            <div className="mb-1 flex items-center gap-2 text-sm font-medium text-violet-600 dark:text-violet-400">
              <PlugZap className="h-4 w-4" /> {activePath.title}
            </div>
            <DialogTitle className="text-xl">从 Obsidian 选择笔记或项目</DialogTitle>
            <DialogDescription className="leading-6">
              Obsidian 负责选择和授权资料；课堂仍在网页观看，学习结果写入独立伴随笔记。
            </DialogDescription>
          </DialogHeader>

          <ol className="space-y-3">
            <GuideStep index={1} title="在 Obsidian 选择一份笔记或整个项目文件夹">
              <p className="mb-2 text-xs leading-5 text-slate-500">
                单篇笔记执行预览命令；项目文件夹使用知洄侧栏中的“学习这个项目”。
              </p>
              <CopyCommand command={PREVIEW_COMMAND} />
            </GuideStep>
            <GuideStep index={2} title="核对范围、证据覆盖和学习目标">
              <p className="text-xs leading-5 text-slate-500">
                网页会恢复当前学习项目；混合模式还会根据知识缺口补充外部权威来源。
              </p>
            </GuideStep>
            <GuideStep index={3} title="完成主动练习后再批准沉淀">
              <p className="mb-2 text-xs leading-5 text-slate-500">
                原笔记保持不变；课堂摘要、问题、掌握证据和下一次复习写入伴随笔记。
              </p>
              <CopyCommand command={WRITEBACK_COMMAND} />
            </GuideStep>
          </ol>
        </DialogContent>
      </Dialog>
    </>
  );
}

function GuideStep({
  index,
  title,
  children,
}: {
  readonly index: number;
  readonly title: string;
  readonly children: ReactNode;
}) {
  return (
    <li className="grid grid-cols-[28px_1fr] gap-3 rounded-2xl border border-slate-200 p-3 dark:border-slate-700">
      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-violet-100 text-xs font-semibold text-violet-700 dark:bg-violet-950 dark:text-violet-300">
        {index}
      </span>
      <div>
        <p className="text-sm font-medium">{title}</p>
        <div className="mt-1">{children}</div>
      </div>
    </li>
  );
}
