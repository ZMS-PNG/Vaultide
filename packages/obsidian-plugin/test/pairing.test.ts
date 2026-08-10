import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requestUrlMock } = vi.hoisted(() => ({ requestUrlMock: vi.fn() }));
vi.mock('obsidian', () => ({ requestUrl: requestUrlMock }));

import {
  exchangePairingCode,
  normalizeServerUrl,
  refreshDeviceCredentials,
  revokeDeviceCredentials,
} from '../src/pairing';

const identity = {
  ownerId: 'own_local',
  deviceId: 'dev_019f830000007000800000000001',
  vaultBindingId: 'vlt_019f830000007000800000000001',
};

describe('pairing client', () => {
  beforeEach(() => requestUrlMock.mockReset());

  it('permits HTTPS and localhost development only', () => {
    expect(normalizeServerUrl('https://openmaic.example.com/')).toBe(
      'https://openmaic.example.com',
    );
    expect(normalizeServerUrl('http://localhost:3000/')).toBe('http://localhost:3000');
    expect(() => normalizeServerUrl('http://example.com')).toThrow('HTTPS');
  });

  it('exchanges a six-digit code without logging or persisting it', async () => {
    requestUrlMock.mockResolvedValue({
      status: 200,
      json: {
        accessToken: 'access-secret',
        refreshToken: 'refresh-secret',
        ownerId: 'own_server',
        expiresAt: '2026-07-21T01:00:00Z',
        scopes: ['sources:write'],
      },
    });
    const result = await exchangePairingCode({
      serverUrl: 'https://openmaic.example.com',
      code: '123456',
      identity,
      vaultName: 'Learning Vault',
      pluginVersion: '0.1.0',
    });
    expect(result.ownerId).toBe('own_server');
    expect(requestUrlMock).toHaveBeenCalledOnce();
    const request = requestUrlMock.mock.calls[0]?.[0] as { body: string; url: string };
    expect(request.url).toBe('https://openmaic.example.com/api/v1/pairing-sessions/exchange');
    expect(JSON.parse(request.body)).toMatchObject({
      code: '123456',
      deviceId: identity.deviceId,
      vaultBindingId: identity.vaultBindingId,
    });
  });

  it('rejects invalid codes before making a request', async () => {
    await expect(
      exchangePairingCode({
        serverUrl: 'https://openmaic.example.com',
        code: '123',
        identity,
        vaultName: 'Learning Vault',
        pluginVersion: '0.1.0',
      }),
    ).rejects.toThrow('6 digits');
    expect(requestUrlMock).not.toHaveBeenCalled();
  });

  it('rotates and revokes credentials through bearer-authenticated routes', async () => {
    requestUrlMock
      .mockResolvedValueOnce({
        status: 200,
        json: {
          accessToken: 'next-access',
          refreshToken: 'next-refresh',
          ownerId: 'own_server',
          expiresAt: '2026-07-21T01:15:00Z',
          scopes: ['sources:write'],
        },
      })
      .mockResolvedValueOnce({ status: 200, json: { revoked: true } });

    await expect(
      refreshDeviceCredentials({
        serverUrl: 'https://openmaic.example.com',
        refreshToken: 'old-refresh',
      }),
    ).resolves.toMatchObject({ refreshToken: 'next-refresh' });
    await revokeDeviceCredentials({
      serverUrl: 'https://openmaic.example.com',
      refreshToken: 'next-refresh',
    });

    const refreshRequest = requestUrlMock.mock.calls[0]?.[0] as {
      headers: { Authorization: string };
    };
    const revokeRequest = requestUrlMock.mock.calls[1]?.[0] as {
      headers: { Authorization: string };
    };
    expect(refreshRequest.headers.Authorization).toBe('Bearer old-refresh');
    expect(revokeRequest.headers.Authorization).toBe('Bearer next-refresh');
  });
});
