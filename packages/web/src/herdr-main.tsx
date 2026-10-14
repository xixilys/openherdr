import React from 'react';
import { createRoot } from 'react-dom/client';
import { I18nProvider, initializeLocale } from '@/lib/i18n';
import { isCapacitorApp } from '@/lib/platform';
import '@openchamber/ui/index.css';
import '@openchamber/ui/styles/fonts';
import { HerdrApp } from './herdr/HerdrApp';
import { initializeConnections, takeInitialPairing, type Pairing } from './herdr/transport';

let initialPairing: Pairing | null = null;
let initialError: string | null = null;
try { initialPairing = takeInitialPairing(); }
catch { initialError = 'invalidPairing'; }
void initializeLocale();
const container = document.getElementById('root');
if (!container) throw new Error('Missing application root');
const reactRoot = createRoot(container);
function registerHerdrServiceWorker(): void {
  if (isCapacitorApp() || !window.isSecureContext || !['http:', 'https:'].includes(window.location.protocol) || !('serviceWorker' in navigator)) return;
  try {
    void navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).catch(() => undefined);
  } catch { return; }
}

async function mount() {
  try { await initializeConnections(); }
  catch { initialError = 'credentialStorage'; }
  reactRoot.render(<React.StrictMode><I18nProvider><HerdrApp initialPairing={initialPairing} initialError={initialError} /></I18nProvider></React.StrictMode>);
}
void mount();
if (document.readyState === 'complete') registerHerdrServiceWorker();
else window.addEventListener('load', registerHerdrServiceWorker, { once: true });
