export function normalizeServerUrl(value: string): string {
  const parsed = new URL(value.trim());
  const local = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  if (parsed.protocol !== 'https:' && !(local && parsed.protocol === 'http:')) {
    throw new Error('Server URL must use HTTPS. HTTP is allowed only for localhost development.');
  }
  if (parsed.username || parsed.password)
    throw new Error('Server URL must not contain credentials.');
  parsed.pathname = '';
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString().replace(/\/$/, '');
}
