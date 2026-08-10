import { NeonPairingRepository } from './adapters/neon/pairing-repository';
import { PairingService } from './application/pairing-service';
import { loadPairingConfig } from './config';
import { createPairingCrypto } from './security/pairing-crypto';

export function getPairingService(): PairingService {
  const config = loadPairingConfig();
  return new PairingService(new NeonPairingRepository(), createPairingCrypto(config.hmacSecret), {
    ownerId: config.ownerId,
    ownerDisplayName: config.ownerDisplayName,
  });
}
