import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { ResearchSourceHealth } from '@/lib/learning/domain/source-quality';

const MAX_REDIRECTS = 4;
const REQUEST_TIMEOUT_MS = 8_000;

class UnsafeResearchSourceError extends Error {}

function privateIpv4(address: string): boolean {
  const octets = address.split('.').map(Number);
  if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value))) return true;
  const [a, b] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function privateAddress(address: string): boolean {
  const kind = isIP(address);
  if (kind === 4) return privateIpv4(address);
  if (kind !== 6) return true;
  const normalized = address.toLowerCase().split('%')[0] ?? '';
  if (
    normalized === '::' ||
    normalized === '::1' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe8') ||
    normalized.startsWith('fe9') ||
    normalized.startsWith('fea') ||
    normalized.startsWith('feb')
  ) {
    return true;
  }
  const mapped = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  return mapped ? privateIpv4(mapped) : false;
}

async function assertPublicUrl(value: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new UnsafeResearchSourceError('invalid_url');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new UnsafeResearchSourceError('unsupported_protocol');
  }
  if (url.username || url.password) throw new UnsafeResearchSourceError('embedded_credentials');
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  if (
    !hostname ||
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal')
  ) {
    throw new UnsafeResearchSourceError('private_hostname');
  }
  if (isIP(hostname)) {
    if (privateAddress(hostname)) throw new UnsafeResearchSourceError('private_address');
    return url;
  }
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some((entry) => privateAddress(entry.address))) {
    throw new UnsafeResearchSourceError('private_resolution');
  }
  return url;
}

async function request(url: URL, method: 'HEAD' | 'GET'): Promise<Response> {
  return fetch(url, {
    method,
    redirect: 'manual',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: {
      Accept: 'text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.5',
      'User-Agent': 'Vaultide-Source-Health/0.8 (+https://github.com/THU-MAIC/OpenMAIC)',
      ...(method === 'GET' ? { Range: 'bytes=0-1023' } : {}),
    },
  });
}

async function verifyOne(source: ResearchSourceHealth): Promise<ResearchSourceHealth> {
  const checkedAt = new Date().toISOString();
  try {
    const original = await assertPublicUrl(source.url);
    let current = original;
    let redirected = false;
    let response: Response | undefined;
    for (let index = 0; index <= MAX_REDIRECTS; index += 1) {
      response = await request(current, 'HEAD');
      if (response.status === 405 || response.status === 501) {
        response = await request(current, 'GET');
      }
      if (response.status < 300 || response.status >= 400) break;
      const location = response.headers.get('location');
      if (!location) break;
      if (index === MAX_REDIRECTS) throw new Error('too_many_redirects');
      current = await assertPublicUrl(new URL(location, current).toString());
      redirected = true;
    }
    if (!response) throw new Error('no_response');
    const status = response.status;
    const reachable =
      (status >= 200 && status < 400) ||
      status === 401 ||
      status === 403 ||
      status === 405 ||
      status === 429;
    return {
      ...source,
      availability: reachable ? (redirected ? 'redirected' : 'available') : 'unreachable',
      checkedAt,
      httpStatus: status,
      finalUrl: current.toString(),
      ...(!reachable ? { errorKind: `http_${status}` } : {}),
    };
  } catch (error) {
    const unsafe = error instanceof UnsafeResearchSourceError;
    const message =
      error instanceof Error
        ? error.name === 'TimeoutError'
          ? 'timeout'
          : error.message
        : 'network_error';
    return {
      ...source,
      availability: unsafe ? 'unsafe' : 'unreachable',
      checkedAt,
      errorKind: message.slice(0, 160),
    };
  }
}

export async function verifyResearchSources(
  sources: readonly ResearchSourceHealth[],
): Promise<ResearchSourceHealth[]> {
  return Promise.all(sources.slice(0, 20).map((source) => verifyOne(source)));
}
