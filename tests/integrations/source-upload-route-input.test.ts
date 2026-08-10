import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { OPTIONS, POST } from '@/lib/server/api-routes/v1/source-uploads/handler';
import { readHandleUploadBody } from '@/lib/learning/http/source-upload-body';

describe('private Blob control-route input boundary', () => {
  it('accepts only known small Blob control events', async () => {
    const body = { type: 'blob.generate-client-token', payload: {} };
    await expect(
      readHandleUploadBody(
        new NextRequest('http://localhost/api/v1/source-uploads', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
      ),
    ).resolves.toEqual(body);

    await expect(
      readHandleUploadBody(
        new NextRequest('http://localhost/api/v1/source-uploads', {
          method: 'POST',
          body: JSON.stringify({ type: 'attacker-event' }),
        }),
      ),
    ).rejects.toThrow('invalid_event_type');
  });

  it('rejects an oversized body before JSON parsing', async () => {
    await expect(
      readHandleUploadBody(
        new NextRequest('http://localhost/api/v1/source-uploads', {
          method: 'POST',
          headers: { 'Content-Length': String(65 * 1024) },
          body: '{}',
        }),
      ),
    ).rejects.toThrow('body_too_large');
  });

  it('allows only the Obsidian app origin to preflight authenticated uploads', () => {
    const response = OPTIONS(
      new NextRequest('http://localhost/api/v1/source-uploads', {
        method: 'OPTIONS',
        headers: {
          Origin: 'app://obsidian.md',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'authorization,content-type,x-maic-protocol-version',
        },
      }),
    );
    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('app://obsidian.md');
    expect(response.headers.get('Access-Control-Allow-Methods')).toBe('POST, OPTIONS');
    expect(response.headers.get('Access-Control-Allow-Headers')).toBe(
      'Authorization, Content-Type, X-MAIC-Protocol-Version',
    );
    expect(response.headers.get('Access-Control-Max-Age')).toBe('600');

    const untrusted = OPTIONS(
      new NextRequest('http://localhost/api/v1/source-uploads', {
        method: 'OPTIONS',
        headers: { Origin: 'https://attacker.example' },
      }),
    );
    expect(untrusted.status).toBe(403);
    expect(untrusted.headers.has('Access-Control-Allow-Origin')).toBe(false);
  });

  it('adds Obsidian CORS headers to rejected POST responses', async () => {
    const response = await POST(
      new NextRequest('http://localhost/api/v1/source-uploads', {
        method: 'POST',
        headers: {
          Origin: 'app://obsidian.md',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ type: 'attacker-event' }),
      }),
    );
    expect(response.status).toBe(400);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('app://obsidian.md');
  });
});
