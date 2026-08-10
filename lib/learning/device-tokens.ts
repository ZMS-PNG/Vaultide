import { NeonDeviceTokenRepository } from './adapters/neon/device-token-repository';
import { DeviceTokenService } from './application/device-token-service';
import { loadPairingConfig } from './config';
import { createPairingCrypto } from './security/pairing-crypto';

export function getDeviceTokenService(): DeviceTokenService {
  const config = loadPairingConfig();
  return new DeviceTokenService(
    new NeonDeviceTokenRepository(),
    createPairingCrypto(config.hmacSecret),
  );
}
