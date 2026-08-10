import type { ApiErrorCode } from '@openmaic/learning-protocol';
import type { DeviceScope } from '../domain/pairing';
import type { DeviceTokenPrincipal, RotatedDeviceToken } from '../domain/device-token';
import type { DeviceTokenRepository } from '../ports/device-token-repository';
import type { PairingCrypto } from '../security/pairing-crypto';
import { digestOpaqueCredential } from '../security/pairing-crypto';

const ACCESS_TOKEN_TTL_MS = 15 * 60 * 1000;
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const ACCESS_TOKEN = /^maic_at_[A-Za-z0-9_-]{43}$/;
const REFRESH_TOKEN = /^maic_rt_[A-Za-z0-9_-]{43}$/;

export class DeviceTokenServiceError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'DeviceTokenServiceError';
  }
}

export class DeviceTokenService {
  constructor(
    private readonly repository: DeviceTokenRepository,
    private readonly crypto: PairingCrypto,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async authenticateAccess(
    token: string,
    requiredScope?: DeviceScope,
  ): Promise<DeviceTokenPrincipal> {
    if (!ACCESS_TOKEN.test(token)) throw this.invalidToken();
    const principal = await this.repository.authenticateAccessToken(
      digestOpaqueCredential(token),
      this.now(),
    );
    if (!principal) throw this.invalidToken();
    if (requiredScope && !principal.scopes.includes(requiredScope)) {
      throw new DeviceTokenServiceError('scope_denied', 403, 'Device scope is not permitted.');
    }
    return principal;
  }

  async refresh(token: string): Promise<RotatedDeviceToken> {
    if (!REFRESH_TOKEN.test(token)) throw this.invalidToken();
    const now = this.now();
    const access = this.crypto.createCredential('maic_at');
    const refresh = this.crypto.createCredential('maic_rt');
    const accessTokenExpiresAt = new Date(now.getTime() + ACCESS_TOKEN_TTL_MS);
    const principal = await this.repository.rotateRefreshToken({
      refreshTokenDigest: digestOpaqueCredential(token),
      accessTokenDigest: access.digest,
      accessTokenExpiresAt,
      nextRefreshTokenDigest: refresh.digest,
      nextRefreshTokenExpiresAt: new Date(now.getTime() + REFRESH_TOKEN_TTL_MS),
      now,
    });
    if (!principal) throw this.invalidToken();
    return {
      ...principal,
      accessToken: access.plaintext,
      refreshToken: refresh.plaintext,
      expiresAt: accessTokenExpiresAt.toISOString(),
    };
  }

  async revoke(token: string): Promise<DeviceTokenPrincipal> {
    if (!REFRESH_TOKEN.test(token)) throw this.invalidToken();
    const principal = await this.repository.revokeRefreshToken(
      digestOpaqueCredential(token),
      this.now(),
      'device-disconnect',
    );
    if (!principal) throw this.invalidToken();
    return principal;
  }

  private invalidToken(): DeviceTokenServiceError {
    return new DeviceTokenServiceError('token_invalid', 401, 'Device credential is invalid.');
  }
}
