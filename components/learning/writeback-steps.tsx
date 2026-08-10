'use client';

import { Check, Clipboard } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';

export const OBSIDIAN_WRITEBACK_COMMAND = 'Check and apply Vaultide writebacks';

export function WritebackSteps({ currentStep }: { readonly currentStep: 1 | 2 | 3 }) {
  const steps = [
    { title: '生成并预览', description: '网页检查内容与目标路径' },
    { title: '网页批准', description: '加入受控回写队列' },
    { title: 'Obsidian 确认', description: '命令面板中最后确认' },
  ] as const;

  return (
    <ol
      className="mb-5 grid gap-2 sm:grid-cols-3"
      aria-label={`回写流程，当前第 ${currentStep} 步`}
    >
      {steps.map((step, index) => {
        const number = (index + 1) as 1 | 2 | 3;
        const active = number === currentStep;
        const completed = number < currentStep;
        return (
          <li
            key={step.title}
            className={cn(
              'rounded-xl border px-3 py-2.5',
              active
                ? 'border-violet-300 bg-violet-50 dark:border-violet-700 dark:bg-violet-950/30'
                : completed
                  ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/25'
                  : 'border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/50',
            )}
          >
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  'flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold',
                  active
                    ? 'bg-violet-600 text-white'
                    : completed
                      ? 'bg-emerald-500 text-white'
                      : 'bg-slate-200 text-slate-500 dark:bg-slate-700 dark:text-slate-300',
                )}
              >
                {completed ? <Check className="h-3 w-3" /> : number}
              </span>
              <span className="text-xs font-medium">{step.title}</span>
            </div>
            <p className="mt-1 pl-7 text-[11px] leading-4 text-slate-500">{step.description}</p>
          </li>
        );
      })}
    </ol>
  );
}

export function CopyWritebackCommand() {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(OBSIDIAN_WRITEBACK_COMMAND).then(() => setCopied(true));
      }}
      className="mx-auto mt-4 flex w-full max-w-xl items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-left transition hover:border-violet-300 hover:bg-violet-50 dark:border-slate-700 dark:bg-slate-800 dark:hover:border-violet-700 dark:hover:bg-violet-950/30"
      aria-label={`复制 Obsidian 命令：${OBSIDIAN_WRITEBACK_COMMAND}`}
    >
      <span>
        <span className="block text-[11px] text-slate-500">在 Obsidian 命令面板执行</span>
        <code className="mt-1 block break-all text-xs text-slate-800 dark:text-slate-100">
          {OBSIDIAN_WRITEBACK_COMMAND}
        </code>
      </span>
      {copied ? (
        <Check className="h-4 w-4 shrink-0 text-emerald-500" />
      ) : (
        <Clipboard className="h-4 w-4 shrink-0 text-slate-400" />
      )}
    </button>
  );
}
