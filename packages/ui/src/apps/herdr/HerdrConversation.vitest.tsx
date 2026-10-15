import React, { act } from 'react';
import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';

test('Herdr chat preserves reading intent on resize and retires live presentation after a stream failure', async () => {
  const dom = new Window({ url: 'https://fixture.example' });
  dom.document.write('<!doctype html><html><body></body></html>');
  const globals = {
    window: dom, document: dom.document, navigator: dom.navigator,
    localStorage: dom.localStorage, sessionStorage: dom.sessionStorage,
    Node: dom.Node, Text: dom.Text, NodeList: dom.NodeList, NodeFilter: dom.NodeFilter, Element: dom.Element,
    HTMLElement: dom.HTMLElement, HTMLAnchorElement: dom.HTMLAnchorElement, HTMLButtonElement: dom.HTMLButtonElement,
    HTMLInputElement: dom.HTMLInputElement, HTMLTextAreaElement: dom.HTMLTextAreaElement,
    HTMLImageElement: dom.HTMLImageElement, HTMLTableElement: dom.HTMLTableElement,
    HTMLTableCellElement: dom.HTMLTableCellElement, HTMLTableRowElement: dom.HTMLTableRowElement,
    Document: dom.Document, DocumentFragment: dom.DocumentFragment, ShadowRoot: dom.ShadowRoot, Event: dom.Event,
    SVGElement: dom.SVGElement, MutationObserver: dom.MutationObserver, ResizeObserver: dom.ResizeObserver,
    customElements: dom.customElements, CSSStyleSheet: dom.CSSStyleSheet, CustomEvent: dom.CustomEvent,
    getComputedStyle: dom.getComputedStyle.bind(dom), requestAnimationFrame: dom.requestAnimationFrame.bind(dom),
    cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom), IS_REACT_ACT_ENVIRONMENT: true,
  };
  const descriptors = Object.getOwnPropertyDescriptors(globalThis);
  for (const [name, value] of Object.entries(globals)) Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  const savedFetch = globalThis.fetch;
  const target = { machine: 'local', paneId: 'w1:p1', identity: 'a'.repeat(64), expectedAgentSession: null };
  const session = { id: 'ses_fixture', projectID: 'project_fixture', title: 'Actual fixture title', location: { directory: '/fixture' }, time: { created: 100, updated: 200 }, cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } };
  const capabilities = { prompt: true, events: true, permissions: true, forms: true };
  const streams: { controller: ReadableStreamDefaultController<Uint8Array>; closed: boolean }[] = [];
  const incidental: string[] = [];
  let readCount = 0;
  let requests: 'none' | 'form' | 'both' = 'none';
  globalThis.fetch = Object.assign(async (input: string | URL | Request, options?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.pathname.endsWith('/history/list')) return Response.json({ protocol: 'opencode-v2', conversations: [], complete: true, failures: [], cursor: {} });
    if (url.pathname.endsWith('/resolve')) return Response.json({ protocol: 'opencode-v2', target, directory: '/fixture', nativeAccess: 'unavailable', session, capabilities });
    if (url.pathname.endsWith('/list')) return Response.json({ protocol: 'opencode-v2', target, sessions: [{ session, access: 'owned', capabilities }], complete: true, failures: [], cursor: {} });
    if (url.pathname.endsWith('/catalog')) return Response.json({ protocol: 'opencode-v2', target, models: [], agents: [], authoritative: true, completeness: 'complete' });
    if (url.pathname.endsWith('/read')) {
      readCount += 1;
      return Response.json({ protocol: 'opencode-v2', target, session, access: 'owned', capabilities,
        permissions: requests === 'both' ? [{ id: 'permission_fixture', sessionID: session.id, action: 'shell', resources: ['echo fixture'] }] : [],
        forms: requests !== 'none' ? [{ id: 'form_fixture', sessionID: session.id, title: 'Fixture question', fields: [{ type: 'string', key: 'answer', title: 'Fixture answer' }] }] : [],
        activity: { type: 'running' }, messages: { cursor: {}, data: [
        { id: 'msg_user', type: 'user', time: { created: 100 }, text: 'Keep this transcript while reconnecting.', files: [{ name: 'fixture.txt', mime: 'text/plain', data: btoa('INLINE_ATTACHMENT_CONTENT'), source: { type: 'inline' } }] },
        { id: 'msg_assistant', type: 'assistant', agent: 'build', model: { providerID: 'fixture', id: 'fixture' }, time: { created: 200 }, content: [{ type: 'tool', id: 'tool_shell', name: 'shell', time: { created: 200, ran: 201 }, state: { status: 'running', input: { command: 'echo CURRENT_TOOL_OUTPUT' }, metadata: { output: 'CURRENT_TOOL_OUTPUT' } } }, { type: 'reasoning', text: 'Current reasoning', time: { created: 202 } }, { type: 'text', text: 'Current **assistant** response.\n\nStill streaming' }] },
      ] } });
    }
    if (url.pathname.endsWith('/events')) return new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        const stream = { controller, closed: false }; streams.push(stream);
        controller.enqueue(new TextEncoder().encode(`${JSON.stringify({ protocol: 'opencode-v2', type: 'conversation.resync', target, sessionId: session.id })}\n`));
        options?.signal?.addEventListener('abort', () => { if (!stream.closed) { stream.closed = true; controller.close(); } }, { once: true });
      },
    }), { headers: { 'Content-Type': 'application/x-ndjson' } });
    incidental.push(url.pathname);
    return Response.json({ error: 'No legacy runtime exists in this fixture' }, { status: 503 });
  }, savedFetch);
  const { createRoot } = await import('react-dom/client');
  const { I18nProvider } = await import('@/lib/i18n');
  const { ConversationPanel } = await import('../../../../web/src/herdr/ConversationPanel');
  const { HerdrTransport } = await import('../../../../web/src/herdr/transport');
  const host = document.createElement('main'); document.body.appendChild(host);
  const root = createRoot(host);
  const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
  try {
    await act(async () => root.render(<I18nProvider><ConversationPanel transport={new HerdrTransport({ server: 'https://fixture.example', token: 'fixture' })} machine="local" paneId="w1:p1" targetMetadata={{ workspaceId: 'w1', tabId: 'w1:t1', session: null }} /></I18nProvider>));
    for (let attempt = 0; attempt < 20 && !host.querySelector('[data-streaming-reply]'); attempt += 1) await settle();
    assert(host.querySelector('[data-streaming-reply]'), `a fresh live assistant is marked streaming: ${host.textContent}`);
    assert(host.querySelector('[data-reasoning-block-id] .animate-busy-wave'), 'fresh reasoning displays live activity');
    const shell = [...host.querySelectorAll<HTMLElement>('[role="button"][aria-expanded]')].find((node) => node.textContent?.includes('Shell Command')); assert(shell);
    await act(async () => shell.click());
    assert(host.querySelector('.tool-output-surface pre')?.textContent?.includes('CURRENT_TOOL_OUTPUT'), 'the real tool adapter displays source-owned running output');
    const attachment = [...host.querySelectorAll<HTMLButtonElement>('button')].find((node) => node.textContent === 'fixture.txt'); assert(attachment);
    await act(async () => attachment.click());
    assert(document.querySelector('[role="dialog"] pre')?.textContent?.includes('INLINE_ATTACHMENT_CONTENT'), 'the message uses the source attachment preview');
    const closePreview = document.querySelector<HTMLButtonElement>('[role="dialog"] [data-slot="dialog-close"]'); assert(closePreview);
    await act(async () => closePreview.click());
    const timeline = host.querySelector<HTMLElement>('[data-message-id]')?.parentElement?.parentElement;
    const editor = host.querySelector('textarea');
    assert(timeline); assert(editor);
    let viewport = 500;
    Object.defineProperties(timeline, { scrollHeight: { configurable: true, get: () => 2000 }, clientHeight: { configurable: true, get: () => viewport } });
    await act(async () => { window.dispatchEvent(new CustomEvent('oc:keyboard-settled')); });
    timeline.scrollTop = 1500;
    await act(async () => { timeline.dispatchEvent(new Event('scroll', { bubbles: true })); });
    viewport = 300;
    await act(async () => { timeline.dispatchEvent(new Event('scroll', { bubbles: true })); });
    assert(timeline.scrollTop >= 1700, 'a viewport shrink preserves following at the end');
    timeline.scrollTop = 400;
    await act(async () => { timeline.dispatchEvent(new Event('scroll', { bubbles: true })); });
    viewport = 200;
    await act(async () => { window.dispatchEvent(new CustomEvent('oc:keyboard-settled')); });
    assert.equal(timeline.scrollTop, 400, 'keyboard settlement preserves a reader above the end');
    const latest = host.querySelector<HTMLButtonElement>('[aria-label="Scroll to bottom"]'); assert(latest);
    assert(latest.closest('.opacity-100'), 'the original latest-message action appears above the composer after scrolling up');
    await act(async () => latest.click());
    assert(timeline.scrollTop >= 1800, 'latest-message action resumes following at the end');
    const refreshRequests = async (next: typeof requests) => {
      requests = next;
      const before = readCount;
      const source = streams[streams.length - 1]; assert(source && !source.closed);
      await act(async () => source.controller.enqueue(new TextEncoder().encode(`${JSON.stringify({ protocol: 'opencode-v2', type: 'conversation.resync', target, sessionId: session.id })}\n`)));
      for (let attempt = 0; attempt < 50 && readCount === before; attempt += 1) await settle();
      await settle();
    };
    await refreshRequests('form');
    const answer = host.querySelector('[role="dialog"][aria-label="Fixture question"] textarea'); assert(answer instanceof HTMLTextAreaElement);
    const dockBody = answer.closest<HTMLElement>('[class~="max-h-[50vh]"]'); assert(dockBody);
    Object.defineProperty(host, 'getBoundingClientRect', { configurable: true, value: () => new dom.DOMRect(0, 50, 412, 500) });
    let dockBottom = 500;
    Object.defineProperty(dockBody, 'getBoundingClientRect', { configurable: true, value: () => new dom.DOMRect(0, dockBottom - 100, 412, 100) });
    await act(async () => window.dispatchEvent(new Event('resize')));
    assert.equal(dockBody.style.maxHeight, '', 'the normal CSS cap remains when enough space is available');
    dockBottom = 250;
    await act(async () => window.dispatchEvent(new CustomEvent('oc:keyboard-settled')));
    assert.equal(dockBody.style.maxHeight, '120px', 'keyboard settlement clamps the dock to the visible chat space');
    const setText = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set; assert(setText);
    await act(async () => { setText.call(answer, 'Answer in progress'); answer.dispatchEvent(new Event('input', { bubbles: true })); });
    await refreshRequests('both');
    assert(host.querySelector('[role="dialog"][aria-label="Permission required"]'), 'permissions are docked above the composer ahead of a form');
    assert(answer.closest('[hidden]'), 'the form stays mounted but hidden behind the permission');
    await refreshRequests('form');
    assert.equal(host.querySelector('[role="dialog"][aria-label="Fixture question"] textarea'), answer, 'permission changes preserve the exact form editor');
    assert.equal(answer.value, 'Answer in progress', 'permission priority preserves an unfinished form answer');
    assert.equal(answer.closest('[hidden]'), null, 'the form becomes visible after permission resolution');
    await refreshRequests('none');
    Object.defineProperty(editor, 'scrollHeight', { configurable: true, get: () => 1000 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 600 });
    await act(async () => { window.dispatchEvent(new Event('resize')); });
    assert.equal(editor.style.height, '180px', 'viewport changes update the editor height limit');
    const readsBeforeFailure = readCount;
    const source = streams[streams.length - 1]; assert(source);
    await act(async () => { source.closed = true; source.controller.error(new Error('Fixture stream disconnected')); });
    await settle();
    assert.equal(host.querySelector('[data-streaming-reply]'), null, 'disconnected assistant text stops streaming');
    assert.equal(host.querySelector('[data-reasoning-block-id] .animate-busy-wave'), null, 'disconnected reasoning stops animating');
    assert.equal(host.querySelectorAll('[data-message-id]').length, 2, 'stream failure retains the transcript');
    for (let attempt = 0; attempt < 160 && !host.querySelector('[data-streaming-reply]'); attempt += 1) await settle();
    assert(streams.length > 1 && readCount > readsBeforeFailure, 'reconnection obtains a new source and fresh snapshot');
    assert(host.querySelector('[data-streaming-reply]'), 'fresh connected state restores live presentation');
    assert.equal(host.querySelector('[role="alert"]'), null, 'recovery clears the stream error');
    assert.deepEqual(incidental, [], 'the integration never initializes a legacy runtime');
  } finally {
    await act(async () => root.unmount());
    await dom.happyDOM.close(); globalThis.fetch = savedFetch;
    for (const name of Object.keys(globals)) {
      const descriptor = descriptors[name];
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});
