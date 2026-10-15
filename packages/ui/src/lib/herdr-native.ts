import { useCallback, useEffect, useRef } from 'react';
import { isCapacitorMobileApp, useNativeAndroidBackButton, useNativeMobileChrome, useNativeMobileLifecycle } from '@/apps/mobileNativeChrome';

let nativeActive = true;

export function isHerdrForeground(): boolean {
  return !document.hidden && nativeActive;
}

type PairingUrlSource = {
  addListener: (name: 'appUrlOpen', listener: (event: { url: string }) => void) => Promise<{ remove: () => Promise<void> }>;
  getLaunchUrl: () => Promise<{ url: string } | undefined>;
};

/** A warm link supersedes the cold-launch URL, including while it is loading. */
export function listenForHerdrPairingUrls(app: PairingUrlSource, onUrl: (url: string) => void): () => void {
  let disposed = false;
  let receivedEvent = false;
  let removeListener: (() => Promise<void>) | null = null;
  void app.addListener('appUrlOpen', ({ url }) => {
    receivedEvent = true;
    if (!disposed) onUrl(url);
  }).then(async listener => {
    if (disposed) { await listener.remove(); return; }
    removeListener = () => listener.remove();
    const launch = await app.getLaunchUrl();
    if (!disposed && !receivedEvent && launch?.url) onUrl(launch.url);
  }).catch(() => undefined);
  return () => { disposed = true; void removeListener?.().catch(() => undefined); };
}

export function useHerdrNative(onBack: () => boolean, onPairingUrl: (url: string) => void): void {
  const pairingHandler = useRef(onPairingUrl);
  pairingHandler.current = onPairingUrl;
  useNativeMobileChrome();
  useNativeAndroidBackButton(onBack);
  const resume = useCallback(() => {
    nativeActive = true;
    window.dispatchEvent(new Event('openherdr:resume'));
  }, []);
  useNativeMobileLifecycle(resume);
  useEffect(() => {
    if (!isCapacitorMobileApp()) return;
    let disposed = false;
    const cleanup: Array<() => void> = [];
    void import('@capacitor/app').then(async ({ App }) => {
      if (disposed) return;
      const state = await App.addListener('appStateChange', ({ isActive }) => {
        if (disposed) return;
        nativeActive = isActive;
        if (!isActive) window.dispatchEvent(new Event('openherdr:pause'));
      });
      if (disposed) { void state.remove(); return; }
      cleanup.push(() => void state.remove());
      cleanup.push(listenForHerdrPairingUrls(App, url => pairingHandler.current(url)));
    }).catch(() => undefined);
    return () => { disposed = true; nativeActive = true; cleanup.forEach(remove => remove()); };
  }, []);
}
