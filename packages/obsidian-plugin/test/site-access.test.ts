import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requestUrlMock } = vi.hoisted(() => ({ requestUrlMock: vi.fn() }));
vi.mock('obsidian', () => ({ requestUrl: requestUrlMock }));

import { verifySiteAccessCode } from '../src/site-access';

describe('website access-code client', () => {
  beforeEach(() => requestUrlMock.mockReset());

  it('validates a stored code without putting it in a URL or authorization header', async () => {
    requestUrlMock
      .mockResolvedValueOnce({
        status: 200,
        json: { success: true, enabled: true, authenticated: false },
      })
      .mockResolvedValueOnce({
        status: 200,
        json: { success: true, valid: true },
      });

    await expect(
      verifySiteAccessCode({
        serverUrl: 'https://openmaic.example.com',
        code: 'personal-access-code',
      }),
    ).resolves.toBe('valid');

    const statusRequest = requestUrlMock.mock.calls[0]?.[0] as {
      url: string;
      body?: string;
    };
    const verifyRequest = requestUrlMock.mock.calls[1]?.[0] as {
      url: string;
      body: string;
      headers: Record<string, string>;
    };
    expect(statusRequest.url).toBe('https://openmaic.example.com/api/access-code/status');
    expect(statusRequest.body).toBeUndefined();
    expect(verifyRequest.url).toBe('https://openmaic.example.com/api/access-code/verify');
    expect(verifyRequest.url).not.toContain('personal-access-code');
    expect(verifyRequest.headers.Authorization).toBeUndefined();
    expect(JSON.parse(verifyRequest.body)).toEqual({ code: 'personal-access-code' });
  });

  it('does not transmit the stored code when the deployment has access control disabled', async () => {
    requestUrlMock.mockResolvedValue({
      status: 200,
      json: { success: true, enabled: false, authenticated: false },
    });

    await expect(
      verifySiteAccessCode({
        serverUrl: 'https://openmaic.example.com',
        code: 'local-only-secret',
      }),
    ).resolves.toBe('disabled');
    expect(requestUrlMock).toHaveBeenCalledOnce();
    expect(JSON.stringify(requestUrlMock.mock.calls[0])).not.toContain('local-only-secret');
  });

  it('reports an invalid stored code without exposing the server value', async () => {
    requestUrlMock
      .mockResolvedValueOnce({
        status: 200,
        json: { success: true, enabled: true, authenticated: false },
      })
      .mockResolvedValueOnce({
        status: 401,
        json: { success: false, error: 'Invalid access code' },
      });

    await expect(
      verifySiteAccessCode({
        serverUrl: 'https://openmaic.example.com',
        code: 'old-code',
      }),
    ).resolves.toBe('invalid');
  });

  it('rejects an empty code before making a network request', async () => {
    await expect(
      verifySiteAccessCode({
        serverUrl: 'https://openmaic.example.com',
        code: '   ',
      }),
    ).rejects.toThrow('1–256');
    expect(requestUrlMock).not.toHaveBeenCalled();
  });
});
