import { useCallback, useEffect } from 'react';
import { isCapacitorMobileApp, useNativeAndroidBackButton, useNativeMobileChrome, useNativeMobileLifecycle } from '@/apps/mobileNativeChrome';

let nativeActive = true;

export function isHerdrForeground(): boolean {
  return !document.hidden && nativeActive;
}

export function useHerdrNative(onBack: () => boolean, onPairingUrl: (url: string) => void): void {
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
      const urls = await App.addListener('appUrlOpen', ({ url }) => { if (!disposed) onPairingUrl(url); });
      if (disposed) { void urls.remove(); return; }
      cleanup.push(() => void urls.remove());
      const launch = await App.getLaunchUrl();
      if (!disposed && launch?.url) onPairingUrl(launch.url);
    }).catch(() => undefined);
    return () => { disposed = true; nativeActive = true; cleanup.forEach(remove => remove()); };
  }, [onPairingUrl]);
}
