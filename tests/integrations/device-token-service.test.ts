import { describe, expect, it, vi } from 'vitest';
import { DeviceTokenService } from '@/lib/learning/application/device-token-service';
import type { DeviceTokenPrincipal } from '@/lib/learning/domain/device-token';
import type {
  DeviceTokenRepository,
  RotateDeviceTokenClaim,
} from '@/lib/learning/ports/device-token-repository';
import type { PairingCrypto } from '@/lib/learning/security/pairing-crypto';
import { digestOpaqueCredential } from '@/lib/learning/security/pairing-crypto';

const NOW = new Date('2026-07-21T12:00:00.000Z');
const ACCESS = `maic_at_${'a'.repeat(43)}`;
const REFRESH = `maic_rt_${'r'.repeat(43)}`;
const NEXT_ACCESS = `maic_at_${'b'.repeat(43)}`;
const NEXT_REFRESH = `maic_rt_${'s'.repeat(43)}`;
const principal: DeviceTokenPrincipal = {
  ownerId: `own_${'c'.repeat(32)}`,
  deviceId: `dev_${'d'.repeat(32)}`,
  vaultBindingId: `vlt_${'e'.repeat(32)}`,
  scopes: ['sources:write', 'device:self'],
};

function repository(): DeviceTokenRepository & {
  authenticateAccessToken: ReturnType<typeof vi.fn>;
  rotateRefreshToken: ReturnType<typeof vi.fn>;
  revokeRefreshToken: ReturnType<typeof vi.fn>;
} {
  return {
    authenticateAccessToken: vi.fn().mockResolvedValue(principal),
    rotateRefreshToken: vi.fn().mockResolvedValue(principal),
    revokeRefreshToken: vi.fn().mockResolvedValue(principal),
  };
}

function tokenCrypto(): PairingCrypto {
  return {
    createCode: () => '123456',
    createId: (prefix) => `${prefix}_${'f'.repeat(32)}`,
    digestCode: () => '1'.repeat(64),
    digestRateKey: () => '2'.repeat(64),
    createCredential: (prefix) => {
      const plaintext = prefix === 'maic_at' ? NEXT_ACCESS : NEXT_REFRESH;
      return { plaintext, digest: digestOpaqueCredential(plaintext) };
    },
  };
}

describe('DeviceTokenService', () => {
  it('authenticates an access token and enforces scopes', async () => {
    const store = repository();
    const service = new DeviceTokenService(store, tokenCrypto(), () => NOW);

    await expect(service.authenticateAccess(ACCESS, 'sources:write')).resolves.toEqual(principal);
    expect(store.authenticateAccessToken).toHaveBeenCalledWith(digestOpaqueCredential(ACCESS), NOW);
    await expect(service.authenticateAccess(ACCESS, 'events:append')).rejects.toMatchObject({
      code: 'scope_denied',
      status: 403,
    });
  });

  it('rotates both credentials without persisting plaintext', async () => {
    const store = repository();
    const service = new DeviceTokenService(store, tokenCrypto(), () => NOW);

    const result = await service.refresh(REFRESH);

    expect(result).toMatchObject({ accessToken: NEXT_ACCESS, refreshToken: NEXT_REFRESH });
    const claim = store.rotateRefreshToken.mock.calls[0][0] as RotateDeviceTokenClaim;
    expect(claim.refreshTokenDigest).toBe(digestOpaqueCredential(REFRESH));
    expect(JSON.stringify(claim)).not.toContain(REFRESH);
    expect(JSON.stringify(claim)).not.toContain(NEXT_ACCESS);
    expect(JSON.stringify(claim)).not.toContain(NEXT_REFRESH);
  });

  it('revokes by refresh-token digest and rejects malformed credentials', async () => {
    const store = repository();
    const service = new DeviceTokenService(store, tokenCrypto(), () => NOW);

    await expect(service.revoke(REFRESH)).resolves.toEqual(principal);
    expect(store.revokeRefreshToken).toHaveBeenCalledWith(
      digestOpaqueCredential(REFRESH),
      NOW,
      'device-disconnect',
    );
    await expect(service.refresh('bad')).rejects.toMatchObject({ code: 'token_invalid' });
  });
});
