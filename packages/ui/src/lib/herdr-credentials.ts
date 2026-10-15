import { Capacitor } from '@capacitor/core';
import { KeychainAccess, SecureStorage } from '@aparajita/capacitor-secure-storage';
import { z } from 'zod';

type VaultScope = 'connections' | { pendingServer: string };

export type HerdrNativeVault = {
  read: () => Promise<string | null>;
  write: (value: string) => Promise<void>;
};

export function getHerdrNativeVault(scope: VaultScope = 'connections'): HerdrNativeVault | null {
  if (!Capacitor.isNativePlatform()) {
    if (globalThis.location?.protocol === 'capacitor:') throw new Error('credentialStorage');
    return null;
  }
  const vaultKey = scope === 'connections' ? 'openherdr.connections.v1' : `openherdr.pending.v1:${scope.pendingServer}`;
  return {
    async read() {
      return z.string().nullable().parse(await SecureStorage.get(vaultKey, false, false));
    },
    async write(value) {
      await SecureStorage.set(vaultKey, value, false, false, KeychainAccess.whenUnlockedThisDeviceOnly);
    },
  };
}
