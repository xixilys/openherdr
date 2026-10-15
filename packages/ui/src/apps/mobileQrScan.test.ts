import { afterEach, describe, expect, mock, test } from 'bun:test';

import { encodePairingConnectionPayload, buildPairingConnectionPayload } from '@/lib/connectionPayload';

import { parseConnectionPayload, scanConnectionQr, scanQrText } from './mobileQrScan';

const hostEncPubJwk = { kty: 'EC', crv: 'P-256', x: 'eHhY', y: 'eVlZ' } as const;

describe('parseConnectionPayload', () => {
  test('parses bare http(s) URLs', () => {
    expect(parseConnectionPayload('https://oc.example')).toEqual({ url: 'https://oc.example' });
    expect(parseConnectionPayload('  http://192.168.1.10:2606 ')).toEqual({ url: 'http://192.168.1.10:2606' });
  });

  test('parses a v2 pairing link with direct + relay candidates', () => {
    const url = encodePairingConnectionPayload(buildPairingConnectionPayload({
      pairingId: 'pair_abc',
      secret: 'one-time',
      label: 'My Desktop',
      candidates: [
        { type: 'lan', url: 'http://192.168.1.20:4096', priority: 10 },
        { type: 'relay', relayUrl: 'wss://relay.example/ws', serverId: 'srv_1', hostEncPubJwk, priority: 30 },
      ],
    }));
    const payload = parseConnectionPayload(url);
    if (!payload || !('pairing' in payload)) throw new Error('expected a pairing payload');
    expect(payload.pairing.pairingId).toBe('pair_abc');
    expect(payload.pairing.secret).toBe('one-time');
    expect(payload.pairing.candidates.map((c) => c.type)).toEqual(['lan', 'relay']);
  });

  test('rejects non-connection and legacy/relay-offer payloads', () => {
    expect(parseConnectionPayload('')).toBeNull();
    expect(parseConnectionPayload('hello world')).toBeNull();
    expect(parseConnectionPayload('openchamber://connect')).toBeNull();
    expect(parseConnectionPayload('openchamber://session/abc')).toBeNull();
    // Legacy v1 direct links are no longer accepted.
    expect(parseConnectionPayload('openchamber://connect?v=1&server=http%3A%2F%2F192.168.1.10%3A2606&token=tok')).toBeNull();
    // Legacy relay-offer format (mode=relay + fragment) is no longer accepted.
    expect(parseConnectionPayload('openchamber://connect?v=1&mode=relay#offer=eyJ2IjoxfQ')).toBeNull();
  });
});

describe('scanConnectionQr on Android', () => {
  const originalWindow = globalThis.window;

  afterEach(() => {
    Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
  });

  test('uses the bundled startScan flow and cleans up after a result', async () => {
    const listeners = new Map<string, (event: { barcodes?: Array<{ rawValue?: string }> }) => void>();
    let removeCalls = 0;
    let stopCalls = 0;
    let scanCalls = 0;
    let startOptions: unknown;
    const remove = () => { removeCalls += 1; };
    const stopScan = async () => { stopCalls += 1; };
    const scan = async () => { scanCalls += 1; return { barcodes: [] }; };
    const startScan = async (options?: unknown) => {
      startOptions = options;
      listeners.get('barcodesScanned')?.({ barcodes: [{ rawValue: 'https://oc.example' }] });
    };
    const plugin = {
      requestPermissions: mock(async () => ({ camera: 'granted' })),
      scan,
      startScan,
      stopScan,
      addListener: mock((event: string, callback: (info: { barcodes?: Array<{ rawValue?: string }> }) => void) => {
        listeners.set(event, callback);
        return Promise.resolve({ remove });
      }),
    };
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { Capacitor: { getPlatform: () => 'android', Plugins: { BarcodeScanner: plugin } } },
    });

    expect(await scanConnectionQr()).toEqual({ status: 'ok', url: 'https://oc.example' });
    expect(startOptions).toEqual({ formats: ['QR_CODE'] });
    expect(scanCalls).toBe(0);
    expect(stopCalls).toBe(1);
    expect(removeCalls).toBe(2);
  });

  test('falls back to string parsing when the WebView URL parser rejects the link (old Android WebView)', async () => {
    // Old Android WebViews resolve openchamber://connect?... with hostname "" and
    // pathname "//connect", so the URL-based parse fails on an intact string. The test
    // runtime's URL parser handles the canonical form fine, so simulate the rejection
    // with a case variant the URL parser refuses while the string parser accepts.
    const url = encodePairingConnectionPayload(buildPairingConnectionPayload({
      pairingId: 'pair_abc',
      secret: 'one-time',
      candidates: [{ type: 'lan', url: 'http://192.168.1.20:4096', priority: 10 }],
    }));
    const mixedCase = url.replace('openchamber://connect', 'OpenChamber://CONNECT');
    const listeners = new Map<string, (event: { barcodes?: Array<{ rawValue?: string }> }) => void>();
    const plugin = {
      requestPermissions: mock(async () => ({ camera: 'granted' })),
      startScan: mock(async () => {
        listeners.get('barcodesScanned')?.({ barcodes: [{ rawValue: mixedCase }] });
      }),
      stopScan: mock(async () => undefined),
      addListener: mock((event: string, callback: (info: { barcodes?: Array<{ rawValue?: string }> }) => void) => {
        listeners.set(event, callback);
        return { remove: () => undefined };
      }),
    };
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { Capacitor: { getPlatform: () => 'android', Plugins: { BarcodeScanner: plugin } } },
    });

    const result = await scanConnectionQr();
    expect(result.status).toBe('pairing');
    if (result.status === 'pairing') {
      expect(result.pairing.pairingId).toBe('pair_abc');
      expect(result.pairing.candidates).toEqual([{ type: 'lan', url: 'http://192.168.1.20:4096', priority: 10 }]);
    }
  });

  test('stops scanning when the caller aborts', async () => {
    let stopCalls = 0;
    const stopScan = async () => { stopCalls += 1; };
    const plugin = {
      requestPermissions: mock(async () => ({ camera: 'granted' })),
      startScan: mock(async () => undefined),
      stopScan,
      addListener: mock(async () => ({ remove: mock(() => undefined) })),
    };
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { Capacitor: { getPlatform: () => 'android', Plugins: { BarcodeScanner: plugin } } },
    });
    const controller = new AbortController();
    const result = scanConnectionQr({ signal: controller.signal });
    await Promise.resolve();
    controller.abort();

    expect(await result).toEqual({ status: 'cancelled' });
    expect(stopCalls).toBe(1);
  });

  test('waits for listener setup to finish before cleaning up an aborted scan', async () => {
    let finishListenerSetup: (() => void) | undefined;
    let removeCalls = 0;
    let startCalls = 0;
    let stopCalls = 0;
    const listenerSetup = new Promise<void>((resolve) => { finishListenerSetup = resolve; });
    const remove = () => { removeCalls += 1; };
    const startScan = async () => { startCalls += 1; };
    const plugin = {
      requestPermissions: mock(async () => ({ camera: 'granted' })),
      startScan,
      stopScan: async () => { stopCalls += 1; },
      addListener: mock(async () => {
        await listenerSetup;
        return { remove };
      }),
    };
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { Capacitor: { getPlatform: () => 'android', Plugins: { BarcodeScanner: plugin } } },
    });
    const controller = new AbortController();
    const result = scanConnectionQr({ signal: controller.signal });
    await Promise.resolve();
    controller.abort();
    finishListenerSetup?.();

    expect(await result).toEqual({ status: 'cancelled' });
    expect(startCalls).toBe(0);
    expect(removeCalls).toBe(2);
    expect(stopCalls).toBe(1);
  });

  test('cleans up successful listener registration when the other listener fails', async () => {
    let removeCalls = 0;
    let startCalls = 0;
    let stopCalls = 0;
    const remove = () => { removeCalls += 1; };
    const plugin = {
      requestPermissions: mock(async () => ({ camera: 'granted' })),
      startScan: async () => { startCalls += 1; },
      stopScan: async () => { stopCalls += 1; },
      addListener: mock(async (event: string) => {
        if (event === 'scanError') throw new Error('listener setup failed');
        return { remove };
      }),
    };
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { Capacitor: { getPlatform: () => 'android', Plugins: { BarcodeScanner: plugin } } },
    });

    expect(await scanConnectionQr()).toEqual({ status: 'failed' });
    expect(startCalls).toBe(0);
    expect(removeCalls).toBe(1);
    expect(stopCalls).toBe(1);
  });
});


describe('scanQrText lifecycle', () => {
  const originalWindow = globalThis.window;
  afterEach(() => {
    Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
  });
  function install(plugin: { scan?: () => Promise<{ barcodes: Array<{ rawValue?: string; displayValue?: string }> }>; startScan?: () => Promise<void>; stopScan?: () => Promise<void>; requestPermissions?: () => Promise<{ camera: string }>; addListener?: (event: string) => { remove: () => void } }, platform = 'android') {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { Capacitor: { getPlatform: () => platform, Plugins: { BarcodeScanner: plugin } } },
    });
  }
  test('returns unsupported when the native plugin is absent', async () => {
    install({});
    expect(await scanQrText()).toEqual({ status: 'unsupported' });
  });
  test('does not request permission when already aborted', async () => {
    let permissionCalls = 0;
    const requestPermissions = async () => { permissionCalls++; return { camera: 'granted' }; };
    install({ requestPermissions, scan: async () => ({ barcodes: [] }) }, 'ios');
    const controller = new AbortController();
    controller.abort();
    expect(await scanQrText({ signal: controller.signal })).toEqual({ status: 'cancelled' });
    expect(permissionCalls).toBe(0);
  });
  test('cancellation during permission suppresses both denial and scan', async () => {
    const controller = new AbortController();
    let scanCalls = 0;
    const scan = async () => { scanCalls++; return { barcodes: [] }; };
    install({ requestPermissions: async () => {
      controller.abort();
      return { camera: 'denied' };
    }, scan }, 'ios');
    expect(await scanQrText({ signal: controller.signal })).toEqual({ status: 'cancelled' });
    expect(scanCalls).toBe(0);
  });
  test('reports permission denial without opening the scanner', async () => {
    let scanCalls = 0;
    const scan = async () => { scanCalls++; return { barcodes: [] }; };
    install({ requestPermissions: async () => ({ camera: 'denied' }), scan }, 'ios');
    expect(await scanQrText()).toEqual({ status: 'permission-denied' });
    expect(scanCalls).toBe(0);
  });
  test('returns raw text without applying the OpenChamber parser', async () => {
    install({ scan: async () => ({ barcodes: [{ displayValue: '  openherdr://connect#pairing=test  ' }] }) }, 'ios');
    expect(await scanQrText()).toEqual({ status: 'ok', rawValue: 'openherdr://connect#pairing=test' });
    expect(await scanConnectionQr()).toEqual({ status: 'invalid' });
  });
  test('suppresses late iOS results and failures after abort', async () => {
    for (const reject of [false, true]) {
      const controller = new AbortController();
      install({ scan: async () => {
        controller.abort();
        if (reject) throw new Error('dismissed');
        return { barcodes: [{ rawValue: 'https://stale.example' }] };
      } }, 'ios');
      expect(await scanQrText({ signal: controller.signal })).toEqual({ status: 'cancelled' });
    }
  });
  test('stops again after a late Android start completes and removes listeners', async () => {
    const controller = new AbortController();
    let completeStart = () => {};
    let notifyStart = () => {};
    const started = new Promise<void>((resolve) => { notifyStart = resolve; });
    let stopCalls = 0;
    let removeCalls = 0;
    const stopScan = async () => { stopCalls++; };
    const remove = () => { removeCalls++; };
    install({ startScan: () => {
      notifyStart();
      return new Promise<void>((resolve) => { completeStart = resolve; });
    }, stopScan, addListener: () => ({ remove }) });
    const result = scanQrText({ signal: controller.signal });
    await started;
    controller.abort();
    // Let cancellation run while the native camera start is still unresolved.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(stopCalls).toBe(1);
    expect(removeCalls).toBe(2);
    completeStart();
    expect(await result).toEqual({ status: 'cancelled' });
    expect(stopCalls).toBe(2);
  });
  test('suppresses Android results cancelled while native cleanup is pending', async () => {
    const controller = new AbortController();
    const listeners = new Map<string, (info: { barcodes?: Array<{ rawValue: string }> }) => void>();
    const plugin = {
      startScan: async () => {
        listeners.get('barcodesScanned')?.({ barcodes: [{ rawValue: 'https://stale.example' }] });
      },
      stopScan: async () => { controller.abort(); },
      addListener: (event: string, callback: (info: { barcodes?: Array<{ rawValue: string }> }) => void) => {
        listeners.set(event, callback);
        return { remove: () => undefined };
      },
    };
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { Capacitor: { getPlatform: () => 'android', Plugins: { BarcodeScanner: plugin } } },
    });
    expect(await scanQrText({ signal: controller.signal })).toEqual({ status: 'cancelled' });
  });
  test('cleans up a synchronous Android listener registration failure', async () => {
    let stopCalls = 0;
    let removeCalls = 0;
    let startCalls = 0;
    const stopScan = async () => { stopCalls++; };
    const remove = () => { removeCalls++; };
    const startScan = async () => { startCalls++; };
    install({ startScan, stopScan, addListener: (event: string) => {
      if (event === 'scanError') throw new Error('listener failed');
      return { remove };
    } });
    expect(await scanQrText()).toEqual({ status: 'failed' });
    expect(removeCalls).toBe(1);
    expect(stopCalls).toBe(1);
    expect(startCalls).toBe(0);
  });
});
