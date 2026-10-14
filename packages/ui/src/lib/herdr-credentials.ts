import { Capacitor } from '@capacitor/core';
import { KeychainAccess, SecureStorage } from '@aparajita/capacitor-secure-storage';
import { z } from 'zod';

const vaultKey = 'openherdr.connections.v1';

export type HerdrNativeVault = {
  read: () => Promise<string | null>;
  write: (value: string) => Promise<void>;
};

export function getHerdrNativeVault(): HerdrNativeVault | null {
  if (!Capacitor.isNativePlatform()) {
    if (globalThis.location?.protocol === 'capacitor:') throw new Error('credentialStorage');
    return null;
  }
  return {
    async read() {
      return z.string().nullable().parse(await SecureStorage.get(vaultKey, false, false));
    },
    async write(value) {
      await SecureStorage.set(vaultKey, value, false, false, KeychainAccess.whenUnlockedThisDeviceOnly);
    },
  };
}
