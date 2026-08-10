'use client';

import { LEARNING_PROTOCOL_VERSION } from '@openmaic/learning-protocol';
import {
  ArrowLeft,
  Check,
  CircleCheckBig,
  Clipboard,
  KeyRound,
  LoaderCircle,
  Server,
  ShieldCheck,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

interface PairingSession {
  id: string;
  code: string;
  expiresAt: string;
}

const PREVIEW_COMMAND = 'Preview active note as a SourceBundle';

export default function LearningPairingPage() {
  const router = useRouter();
  const [session, setSession] = useState<PairingSession | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedItem, setCopiedItem] = useState<'code' | 'server' | 'command' | null>(null);
  const [serverUrl, setServerUrl] = useState('');
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const originTimer = window.setTimeout(() => setServerUrl(window.location.origin), 0);
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => {
      window.clearTimeout(originTimer);
      window.clearInterval(timer);
    };
  }, []);

  const secondsRemaining = session
    ? Math.max(0, Math.ceil((Date.parse(session.expiresAt) - now) / 1_000))
    : 0;

  const createSession = async () => {
    setLoading(true);
    setError(null);
    setCopiedItem(null);
    try {
      const response = await fetch('/api/v1/pairing-sessions', {
        method: 'POST',
        headers: { 'X-MAIC-Protocol-Version': LEARNING_PROTOCOL_VERSION },
      });
      const body = (await response.json()) as PairingSession & {
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(body.error?.message || `请求失败（${response.status}）`);
      }
      setSession(body);
      setNow(Date.now());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法创建配对码。');
    } finally {
      setLoading(false);
    }
  };

  const copyCode = async () => {
    if (!session || secondsRemaining === 0) return;
    await navigator.clipboard.writeText(session.code);
    setCopiedItem('code');
  };

  const copyText = async (value: string, item: 'server' | 'command') => {
    await navigator.clipboard.writeText(value);
    setCopiedItem(item);
  };

  return (
    <main className="min-h-[100dvh] bg-slate-50 px-4 py-10 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <div className="mx-auto max-w-2xl">
        <button
          type="button"
          onClick={() => router.push('/')}
          className="mb-6 inline-flex items-center gap-2 text-sm text-slate-500 hover:text-slate-900 dark:hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" /> 返回知洄
        </button>

        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <header className="border-b border-slate-200 p-6 dark:border-slate-800">
            <div className="mb-3 flex items-center gap-2 text-sm font-medium text-violet-600 dark:text-violet-400">
              <KeyRound className="h-4 w-4" /> Obsidian 设备配对
            </div>
            <h1 className="text-2xl font-semibold">连接你的 Obsidian</h1>
            <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-400">
              在这里生成一次性配对码，再把它输入 Obsidian
              插件设置。配对码十分钟后失效，且只能使用一次。
            </p>
          </header>

          <div className="space-y-5 p-6">
            <div className="flex items-start gap-3 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
              <p>设备令牌只会保存在 Obsidian SecretStorage 中；本页不会保存或显示设备令牌。</p>
            </div>

            {error && (
              <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
                {error}
              </div>
            )}

            {session && (
              <div className="rounded-2xl border border-violet-200 bg-violet-50 p-6 text-center dark:border-violet-900 dark:bg-violet-950/30">
                <div className="text-xs font-medium uppercase tracking-[0.18em] text-violet-600 dark:text-violet-400">
                  一次性配对码
                </div>
                <div className="my-4 font-mono text-4xl font-semibold tracking-[0.28em]">
                  {session.code}
                </div>
                <div className="text-sm text-slate-600 dark:text-slate-400">
                  {secondsRemaining > 0
                    ? `剩余 ${Math.floor(secondsRemaining / 60)}:${String(secondsRemaining % 60).padStart(2, '0')}`
                    : '已失效，请重新生成'}
                </div>
                <button
                  type="button"
                  onClick={() => void copyCode()}
                  disabled={secondsRemaining === 0}
                  className="mt-4 inline-flex items-center gap-2 rounded-xl border border-violet-300 bg-white px-4 py-2 text-sm font-medium text-violet-700 transition hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-violet-800 dark:bg-slate-900 dark:text-violet-300 dark:hover:bg-violet-950"
                >
                  {copiedItem === 'code' ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <Clipboard className="h-4 w-4" />
                  )}
                  {copiedItem === 'code' ? '已复制' : '复制配对码'}
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={() => void createSession()}
              disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-violet-600 px-5 py-3 text-sm font-medium text-white transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading && <LoaderCircle className="h-4 w-4 animate-spin" />}
              {session ? '重新生成配对码' : '生成 10 分钟配对码'}
            </button>

            <ol className="list-decimal space-y-2 pl-5 text-sm leading-6 text-slate-600 dark:text-slate-400">
              <li>在 Obsidian 中打开“设置 → 知洄 Vaultide 连接器”。</li>
              <li>确认知洄服务地址是当前正式部署地址。</li>
              <li>输入上面的六位码并点击 Pair。</li>
            </ol>

            <div className="border-t border-slate-200 pt-5 dark:border-slate-800">
              <div className="flex items-start gap-3 rounded-xl bg-blue-50 p-4 dark:bg-blue-950/30">
                <CircleCheckBig className="mt-0.5 h-5 w-5 shrink-0 text-blue-600 dark:text-blue-300" />
                <div>
                  <h2 className="text-sm font-semibold text-blue-900 dark:text-blue-100">
                    已经配对成功？无需重复生成
                  </h2>
                  <p className="mt-1 text-xs leading-5 text-blue-800/80 dark:text-blue-200/80">
                    回到 Obsidian，打开一份笔记并执行下面的命令。随后在网页首页生成课堂。
                  </p>
                </div>
              </div>

              <div className="mt-3 space-y-2">
                <button
                  type="button"
                  onClick={() => void copyText(serverUrl, 'server')}
                  disabled={!serverUrl}
                  className="flex w-full items-center justify-between gap-3 rounded-xl border border-slate-200 px-3 py-2.5 text-left transition hover:border-violet-300 hover:bg-violet-50 disabled:opacity-50 dark:border-slate-700 dark:hover:border-violet-700 dark:hover:bg-violet-950/30"
                  aria-label="复制正式部署地址"
                >
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5 text-[11px] text-slate-500">
                      <Server className="h-3.5 w-3.5" /> 知洄服务地址
                    </span>
                    <code className="mt-1 block truncate text-xs text-slate-800 dark:text-slate-100">
                      {serverUrl || '正在读取…'}
                    </code>
                  </span>
                  {copiedItem === 'server' ? (
                    <Check className="h-4 w-4 shrink-0 text-emerald-500" />
                  ) : (
                    <Clipboard className="h-4 w-4 shrink-0 text-slate-400" />
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => void copyText(PREVIEW_COMMAND, 'command')}
                  className="flex w-full items-center justify-between gap-3 rounded-xl border border-slate-200 px-3 py-2.5 text-left transition hover:border-violet-300 hover:bg-violet-50 dark:border-slate-700 dark:hover:border-violet-700 dark:hover:bg-violet-950/30"
                  aria-label={`复制命令：${PREVIEW_COMMAND}`}
                >
                  <span className="min-w-0">
                    <span className="block text-[11px] text-slate-500">Obsidian 命令面板</span>
                    <code className="mt-1 block break-all text-xs text-slate-800 dark:text-slate-100">
                      {PREVIEW_COMMAND}
                    </code>
                  </span>
                  {copiedItem === 'command' ? (
                    <Check className="h-4 w-4 shrink-0 text-emerald-500" />
                  ) : (
                    <Clipboard className="h-4 w-4 shrink-0 text-slate-400" />
                  )}
                </button>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
