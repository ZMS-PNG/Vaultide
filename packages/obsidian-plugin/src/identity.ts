export interface LocalIdentity {
  ownerId: string;
  deviceId: string;
  vaultBindingId: string;
}

function randomId(prefix: string): string {
  const value = globalThis.crypto.randomUUID().replaceAll('-', '');
  return `${prefix}_${value}`;
}

export function createLocalIdentity(): LocalIdentity {
  return {
    ownerId: randomId('own'),
    deviceId: randomId('dev'),
    vaultBindingId: randomId('vlt'),
  };
}

export function createEntityId(prefix: 'prj' | 'sou' | 'src' | 'snp'): string {
  return randomId(prefix);
}
