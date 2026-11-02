import * as SecureStore from 'expo-secure-store';

const KEY = 'omni.push.primerSeen';

/** Whether the explanation sheet was shown. A flag, not a secret, kept next to the pairing records. */
export const primerStore = {
  async seen(): Promise<boolean> {
    try {
      return (await SecureStore.getItemAsync(KEY)) === '1';
    } catch {
      // An unreadable store must not make the sheet reappear on every launch.
      return true;
    }
  },
  async markSeen(): Promise<void> {
    await SecureStore.setItemAsync(KEY, '1').catch(() => undefined);
  },
};
