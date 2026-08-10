'use client';

import { useEffect } from 'react';

const DOM_RECOVERY_PREFIX = 'vaultide:dom-recovery:';

export function isRecoverableDomMutationError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as { name?: unknown; message?: unknown };
  if (candidate.name !== 'NotFoundError' || typeof candidate.message !== 'string') return false;
  return (
    candidate.message.includes("Failed to execute 'insertBefore'") ||
    candidate.message.includes("Failed to execute 'removeChild'")
  );
}

/**
 * Browser translators and some extensions can move React-owned text nodes.
 * Prevent a broken screen by reloading once after the exact DOM integrity
 * failure. RootLayout also opts the app out of external translation because
 * Vaultide already owns locale switching.
 */
export function DomIntegrityGuard() {
  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      const error =
        event.error ??
        ({
          name: 'NotFoundError',
          message: event.message,
        } satisfies { name: string; message: string });
      if (!isRecoverableDomMutationError(error)) return;

      const recoveryKey = `${DOM_RECOVERY_PREFIX}${window.location.pathname}`;
      try {
        if (window.sessionStorage.getItem(recoveryKey) === '1') return;
        window.sessionStorage.setItem(recoveryKey, '1');
      } catch {
        // Without sessionStorage we cannot guarantee that a reload will not loop.
        return;
      }

      document.documentElement.lang ||= 'zh-CN';
      document.documentElement.setAttribute('translate', 'no');
      window.setTimeout(() => window.location.reload(), 0);
    };

    window.addEventListener('error', handleError, true);
    return () => window.removeEventListener('error', handleError, true);
  }, []);

  return null;
}
