import { Worker as NodeWorker } from 'node:worker_threads';
import type { MarkdownWorkerRequest, MarkdownWorkerResponse } from '@/components/chat/markdown/markdown-worker-protocol';

const NativeMessageEvent = globalThis.MessageEvent;
const workerEntry = new URL('../../../components/chat/markdown/markdown-shiki.worker.ts', import.meta.url);
const tsxApi = import.meta.resolve('tsx/esm/api');

/** Runs the real worker source with a controllable browser message boundary. */
export function createMarkdownWorkerFixture() {
  const workers = new Set<NodeWorker>();
  const failures: Error[] = [];
  const requests: MarkdownWorkerRequest[] = [];
  const pending = new Set<number>();
  const responses: Array<() => void> = [];
  let paused = false;

  class MarkdownHighlightWorker {
    onmessage: ((event: MessageEvent<MarkdownWorkerResponse>) => void) | null = null;
    onerror: ((error: Error) => void) | null = null;
    onmessageerror: (() => void) | null = null;
    private terminated = false;
    private requestIDs = new Set<number>();
    private worker = new NodeWorker(new URL(`data:text/javascript,${encodeURIComponent(`
      import { parentPort, workerData } from 'node:worker_threads';
      globalThis.postMessage = (data) => parentPort.postMessage(data);
      globalThis.self = { postMessage: globalThis.postMessage, onmessage: null };
      const queued = [];
      let ready = false;
      parentPort.on('message', (data) => {
        if (ready) globalThis.self.onmessage?.({ data });
        else queued.push(data);
      });
      const { tsImport } = await import(workerData.loader);
      await tsImport(workerData.entry, workerData.entry);
      ready = true;
      for (const data of queued) globalThis.self.onmessage?.({ data });
    `)}`), { workerData: { entry: workerEntry.href, loader: tsxApi } });

    constructor() {
      workers.add(this.worker);
      this.worker.on('message', (data: MarkdownWorkerResponse) => {
        const deliver = () => {
          pending.delete(data.id);
          this.requestIDs.delete(data.id);
          if (!this.terminated) this.onmessage?.(new NativeMessageEvent('message', { data }));
        };
        if (paused) responses.push(deliver);
        else deliver();
      });
      this.worker.on('error', error => { failures.push(error); this.onerror?.(error); });
    }
    postMessage(request: MarkdownWorkerRequest) {
      requests.push(request);
      if (request.type !== 'init') {
        pending.add(request.id);
        this.requestIDs.add(request.id);
      }
      this.worker.postMessage(request);
    }
    terminate() {
      this.terminated = true;
      for (const id of this.requestIDs) pending.delete(id);
      this.requestIDs.clear();
      workers.delete(this.worker);
      return this.worker.terminate();
    }
  }

  return {
    Worker: MarkdownHighlightWorker,
    failures,
    requests,
    get pendingRequests() { return pending.size; },
    get pendingResponses() { return responses.length; },
    pauseResponses: () => { paused = true; },
    releaseResponses: () => {
      paused = false;
      for (const deliver of responses.splice(0)) deliver();
    },
    close: async () => {
      await Promise.all([...workers].map(worker => worker.terminate()));
      workers.clear();
      pending.clear();
      responses.length = 0;
    },
  };
}
