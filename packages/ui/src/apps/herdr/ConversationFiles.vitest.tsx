import { afterEach, beforeEach, expect, test } from 'bun:test';
import React, { act } from 'react';
import { EditorView } from '@codemirror/view';
import type { Root } from 'react-dom/client';
import { Window } from 'happy-dom';
import type { WorkspaceFileRequest } from '../../../../web/src/herdr/workspace-navigation';

let dom: Window;
let host: HTMLDivElement;
let root: Root;
let restore: () => void;
let renderPanel: (disabled?: boolean, paneId?: string) => Promise<void>;
let opened: WorkspaceFileRequest[];
let historyOnly: boolean;
let incidental: string[];
const target = { machine: 'local', paneId: 'w1:p1', identity: 'a'.repeat(64), expectedAgentSession: null };
const session = { id: 'ses_files', projectID: 'project_fixture', title: 'File navigation', location: { directory: '/fixture' }, time: { created: 1, updated: 2 }, cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } };
const capabilities = { prompt: true, events: true };
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
const waitForAction = async () => {
  for (let attempt = 0; attempt < 50 && !host.querySelector('[aria-label="Open current file"]'); attempt += 1) await settle();
  return host.querySelector<HTMLButtonElement>('[aria-label="Open current file"]');
};

beforeEach(async () => {
  dom = new Window({ url: 'https://fixture.example/' });
  const globals = { window: dom, document: dom.document, navigator: dom.navigator, localStorage: dom.localStorage,
    customElements: dom.customElements, CSSStyleSheet: dom.CSSStyleSheet, DocumentFragment: dom.DocumentFragment,
    HTMLStyleElement: dom.HTMLStyleElement, ShadowRoot: dom.ShadowRoot, getComputedStyle: dom.getComputedStyle.bind(dom),
    NodeList: dom.NodeList, NodeFilter: dom.NodeFilter, HTMLAnchorElement: dom.HTMLAnchorElement, HTMLButtonElement: dom.HTMLButtonElement,
    HTMLInputElement: dom.HTMLInputElement, HTMLTextAreaElement: dom.HTMLTextAreaElement, HTMLImageElement: dom.HTMLImageElement,
    HTMLTableElement: dom.HTMLTableElement, HTMLTableCellElement: dom.HTMLTableCellElement, HTMLTableRowElement: dom.HTMLTableRowElement,
    Document: dom.Document, CustomEvent: dom.CustomEvent, Event: dom.Event,
    Node: dom.Node, Text: dom.Text, SVGElement: dom.SVGElement, Element: dom.Element, HTMLElement: dom.HTMLElement,
    MutationObserver: dom.MutationObserver, ResizeObserver: dom.ResizeObserver, requestAnimationFrame: dom.requestAnimationFrame.bind(dom), cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom), IS_REACT_ACT_ENVIRONMENT: true };
  const descriptors = Object.getOwnPropertyDescriptors(globalThis);
  for (const [name, value] of Object.entries(globals)) Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  opened = []; historyOnly = false; incidental = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = Object.assign(async (input: string | URL | Request, options?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.pathname.endsWith('/history/list')) return Response.json({ protocol: 'opencode-v2', conversations: [], complete: true, failures: [], cursor: {} });
    if (url.pathname.endsWith('/resolve')) return Response.json({ protocol: 'opencode-v2', target, directory: '/fixture', nativeAccess: 'unavailable', session, capabilities });
    if (url.pathname.endsWith('/list')) return Response.json({ protocol: 'opencode-v2', target, sessions: historyOnly ? [] : [{ session, access: 'owned', capabilities }], complete: true, failures: [], cursor: {} });
    if (url.pathname.endsWith('/catalog')) return Response.json({ protocol: 'opencode-v2', target, models: [], agents: [], authoritative: true, completeness: 'complete' });
    if (url.pathname.endsWith('/read')) return Response.json({ protocol: 'opencode-v2', ...(historyOnly ? { history: { machine: 'local', sessionId: session.id, directory: '/fixture' } } : { target }), session, access: historyOnly ? 'read-only' : 'owned', capabilities, permissions: [], forms: [], activity: null,
      messages: { cursor: {}, data: [{ id: 'msg_file', type: 'assistant', agent: 'build', model: { providerID: 'fixture', id: 'fixture' }, time: { created: 2 }, content: [{ type: 'tool', id: 'tool_read', name: 'read', time: { created: 2, ran: 3, completed: 4 }, state: { status: 'completed', input: { path: '/fixture/nested/source.ts', offset: 9 }, content: [{ type: 'text', text: 'Actual file source' }] } }] }] } });
    if (url.pathname.endsWith('/events')) return new Response(new ReadableStream<Uint8Array>({ start(controller) {
      options?.signal?.addEventListener('abort', () => controller.close(), { once: true });
    } }), { headers: { 'Content-Type': 'application/x-ndjson' } });
    incidental.push(url.pathname); return Response.json({}, { status: 503 });
  }, originalFetch);
  restore = () => { globalThis.fetch = originalFetch; for (const name of Object.keys(globals)) { const descriptor = descriptors[name]; if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); } };
  const { createRoot } = await import('react-dom/client');
  const { ConversationPanel } = await import('../../../../web/src/herdr/ConversationPanel');
  const { HerdrTransport } = await import('../../../../web/src/herdr/transport');
  const { I18nProvider } = await import('@/lib/i18n');
  const transport = new HerdrTransport({ server: 'https://fixture.example', token: 'fixture' });
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  renderPanel = async (disabled = false, paneId = 'w1:p1') => { await act(async () => root.render(<I18nProvider><ConversationPanel transport={transport} machine="local" paneId={paneId} disabled={disabled} targetMetadata={{ workspaceId: 'w1', tabId: 'w1:t1', session: null }} onOpenFile={(request) => opened.push(request)} /></I18nProvider>)); };
});
afterEach(async () => { await act(async () => root?.unmount()); await dom.happyDOM.close(); try { expect(incidental).toEqual([]); } finally { restore(); } });

test('a bound tool file action captures its verified host and survives closing the workspace', async () => {
  await renderPanel();
  const action = await waitForAction(); expect(action).not.toBeNull();
  const editor = host.querySelector<HTMLElement>('.cm-content'); expect(editor).not.toBeNull();
  const editorView = editor ? EditorView.findFromDOM(editor) : null;
  if (!editorView) throw new Error('Missing original composer editor');
  await act(async () => editorView.dispatch({ changes: { from: 0, insert: 'Unsent conversation draft' } }));
  const timeline = host.querySelector<HTMLElement>('[data-message-id]')?.parentElement?.parentElement;
  if (!timeline) throw new Error('Missing timeline');
  Object.defineProperties(timeline, { scrollHeight: { configurable: true, value: 2000 }, clientHeight: { configurable: true, value: 500 } });
  await act(async () => window.dispatchEvent(new CustomEvent('oc:keyboard-settled')));
  timeline.scrollTop = 250;
  await act(async () => timeline.dispatchEvent(new Event('scroll', { bubbles: true })));
  expect(host.querySelector('[aria-label="Scroll to bottom"]')?.closest('.opacity-100')).not.toBeNull();
  await act(async () => action?.click()); await settle();
  expect(opened).toHaveLength(1);
  expect(opened[0]).toMatchObject({ server: 'https://fixture.example', machine: 'local', paneId: 'w1:p1', paneIdentity: target.identity, sessionId: session.id, root: '/fixture', path: 'nested/source.ts', line: 9 });
  await renderPanel(true); await renderPanel(false); await settle();
  expect(host.querySelector('.cm-content')).toBe(editor);
  expect(editorView.state.doc.toString()).toBe('Unsent conversation draft');
  expect(host.querySelector<HTMLElement>('[data-message-id]')?.parentElement?.parentElement).toBe(timeline);
  expect(timeline.scrollTop).toBe(250);
});

test('a hidden conversation cannot initiate another file transfer', async () => {
  await renderPanel(); expect(await waitForAction()).not.toBeNull();
  await renderPanel(true);
  expect(host.querySelector('[aria-label="Open current file"]')).toBeNull();
  expect(opened).toEqual([]);
});

test('unbound history keeps its tool result without borrowing the active pane for files', async () => {
  historyOnly = true;
  await renderPanel();
  for (let attempt = 0; attempt < 50 && !host.querySelector('[data-message-id]'); attempt += 1) await settle();
  expect(host.querySelector('[data-message-id]')).not.toBeNull();
  expect(host.querySelector('[aria-label="Open current file"]')).toBeNull();
  expect(opened).toEqual([]);
});
