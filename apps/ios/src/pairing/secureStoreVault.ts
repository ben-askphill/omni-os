import * as SecureStore from 'expo-secure-store';

import { parseStoredServerIndex, serializeServerIndex } from './servers';
import { VaultError, type CredentialVault } from './vault';

const INDEX_KEY = 'omni.servers.index';
const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

// SecureStore keys may hold only alphanumerics, '.', '-' and '_'. Server ids are generated to fit.
const tokenKey = (id: string) => `omni.server.${id}.token`;

async function guarded<T>(operation: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw new VaultError(operation, error);
  }
}

export const secureStoreVault: CredentialVault = {
  loadIndex: () =>
    guarded('read', async () =>
      parseStoredServerIndex(await SecureStore.getItemAsync(INDEX_KEY, OPTIONS)),
    ),
  saveIndex: (index) =>
    guarded('write', () => SecureStore.setItemAsync(INDEX_KEY, serializeServerIndex(index), OPTIONS)),
  getToken: (id) => guarded('read', () => SecureStore.getItemAsync(tokenKey(id), OPTIONS)),
  setToken: (id, token) =>
    guarded('write', () => SecureStore.setItemAsync(tokenKey(id), token, OPTIONS)),
  deleteToken: (id) => guarded('delete', () => SecureStore.deleteItemAsync(tokenKey(id), OPTIONS)),
};
