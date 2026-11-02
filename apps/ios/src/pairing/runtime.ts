import { createPairingApi } from './api';
import { secureStoreVault } from './secureStoreVault';
import { createPairingService } from './service';

const ALPHANUMERIC = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** A key fragment for the vault, not a secret: only the characters SecureStore keys allow. */
function newServerId(): string {
  let id = '';
  for (let i = 0; i < 16; i += 1) {
    id += ALPHANUMERIC[Math.floor(Math.random() * ALPHANUMERIC.length)];
  }
  return id;
}

export const pairingVault = secureStoreVault;

export const pairingService = createPairingService({
  api: createPairingApi(),
  vault: pairingVault,
  now: () => new Date(),
  newId: newServerId,
});
