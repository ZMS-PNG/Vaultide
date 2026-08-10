import { requestUrl } from 'obsidian';
import { normalizeServerUrl } from './server-url';

export type SiteAccessCodeVerification = 'valid' | 'invalid' | 'disabled';

function responseError(value: unknown, fallback: string): string {
  if (typeof value !== 'object' || value === null) return fallback;
  const error = (value as { error?: unknown }).error;
  if (typeof error === 'string' && error.length > 0) return error;
  if (typeof error !== 'object' || error === null) return fallback;
  const message = (error as { message?: unknown }).message;
  return typeof message === 'string' && message.length > 0 ? message : fallback;
}

export async function verifySiteAccessCode(options: {
  serverUrl: string;
  code: string;
}): Promise<SiteAccessCodeVerification> {
  const code = options.code.trim();
  if (code.length === 0 || code.length > 256) {
    throw new Error('访问码应为 1–256 个字符。');
  }
  const serverUrl = normalizeServerUrl(options.serverUrl);
  const status = await requestUrl({
    url: `${serverUrl}/api/access-code/status`,
    method: 'GET',
    throw: false,
  });
  if (status.status < 200 || status.status >= 300) {
    throw new Error(responseError(status.json, `访问码状态检查失败（HTTP ${status.status}）。`));
  }
  if (
    typeof status.json !== 'object' ||
    status.json === null ||
    typeof (status.json as { enabled?: unknown }).enabled !== 'boolean'
  ) {
    throw new Error('访问码状态响应无效。');
  }
  if (!(status.json as { enabled: boolean }).enabled) return 'disabled';

  const verification = await requestUrl({
    url: `${serverUrl}/api/access-code/verify`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
    throw: false,
  });
  if (verification.status === 401) return 'invalid';
  if (verification.status < 200 || verification.status >= 300) {
    throw new Error(
      responseError(verification.json, `访问码验证失败（HTTP ${verification.status}）。`),
    );
  }
  if (
    typeof verification.json !== 'object' ||
    verification.json === null ||
    (verification.json as { valid?: unknown }).valid !== true
  ) {
    throw new Error('访问码验证响应无效。');
  }
  return 'valid';
}
