import { afterEach, beforeEach, expect, test } from 'bun:test';
import React, { act } from 'react';
import { Window } from 'happy-dom';
import { EditorView } from '@codemirror/view';
import { z } from 'zod';
import type { Root } from 'react-dom/client';
import { driverTargetSchema } from '@/lib/opencode/herdr-driver';
import { conversationDrafts, draftIdentity, type ConversationAttachment } from '../../../../web/src/herdr/conversation-state';
import type { PendingDelivery } from '../../../../web/src/herdr/transport';

const registryEnvelope = z.object({ request: z.object({ target: driverTargetSchema, sessionId: z.string(), kind: z.enum(['commands', 'skills']) }) });
const actionEnvelope = z.object({ requestId: z.string(), request: z.object({ target: driverTargetSchema, sessionId: z.string(), action: z.enum(['command', 'prompt']), input: z.object({
  command: z.string().optional(), arguments: z.string().optional(), text: z.string().optional(), delivery: z.enum(['queue', 'steer']),
  files: z.array(z.object({ uri: z.string(), name: z.string() })), skills: z.array(z.object({ id: z.string() })).optional(),
}) }) });
type RegistryRequest = z.infer<typeof registryEnvelope>['request'];
type ActionRequest = z.infer<typeof actionEnvelope>;
const server = 'https://native-slash.test';
let serial = 0;
let dom: Window;
let host: HTMLElement;
let root: Root;
let restore: () => void;
let render: (pane?: string, hidden?: boolean) => Promise<void>;
let activePane: string;
let hidden: boolean;
let pending: PendingDelivery | null;
let identity: string;
let readCount: number;
let commands: { name: string; description?: string }[];
let skills: { id: string; name: string; description?: string }[];
let registryRequests: { request: RegistryRequest; signal: AbortSignal | null | undefined }[];
let actions: ActionRequest[];
let incidental: string[];
let respondRegistry: (request: RegistryRequest, signal: AbortSignal | null | undefined) => Promise<Response>;
let respondAction: (request: ActionRequest) => Promise<Response>;
const sessionId = (pane = activePane) => `ses_slash_${serial}_${pane.replace(':', '_')}`;
const target = (pane = activePane) => ({ machine: 'local', paneId: pane, identity: pane === 'w1:p1' ? identity : 'b'.repeat(64), expectedAgentSession: null });
const draftKey = (pane = activePane) => draftIdentity(server, 'local', pane, sessionId(pane));
const caps = { prompt: true, commands: true, skills: true, events: true };
const wait = async (ms = 60) => { for (let elapsed = 0; elapsed < ms; elapsed += 20) await act(async () => { await new Promise(resolve => setTimeout(resolve, Math.min(20, ms - elapsed))); }); };
const until = async (condition: () => boolean) => { for (let attempt = 0; attempt < 80 && !condition(); attempt++) await wait(20); expect(condition()).toBe(true); };
const editor = () => { const node = host.querySelector<HTMLElement>('.cm-content'); const view = node && EditorView.findFromDOM(node); if (!view) throw new Error('Missing real composer editor'); return view; };
const setDraft = async (text: string, files: ConversationAttachment[] = []) => { await act(async () => conversationDrafts.update(draftKey(), () => ({ text, files }))); await wait(20); };
const clickSend = async () => { const button = host.querySelector<HTMLButtonElement>('[aria-label="Send message"]'); expect(Boolean(button)).toBe(true); await act(async () => button?.click()); };
const commandReply = (request: ActionRequest) => Response.json({ protocol: 'opencode-v2', target: request.request.target, sessionId: request.request.sessionId, action: 'command', result: null });
const promptReply = (request: ActionRequest) => Response.json({ protocol: 'opencode-v2', target: request.request.target, sessionId: request.request.sessionId, action: 'prompt', result: { id: 'msg_queued', sessionID: request.request.sessionId, type: 'user', time: { created: 20 }, delivery: request.request.input.delivery } });
const deferred = <T,>() => { let complete: (value: T) => void = () => {}; const promise = new Promise<T>(resolve => { complete = resolve; }); return { promise, resolve: (value: T) => complete(value) }; };
const file: ConversationAttachment = { id: 'attachment-owned', name: 'owned.txt', uri: 'data:text/plain;base64,b3duZWQ=', mimeType: 'text/plain' };

beforeEach(async () => {
  serial++; dom = new Window({ url: server }); dom.innerWidth = 412; dom.innerHeight = 915;
  const globals = { window: dom, document: dom.document, navigator: dom.navigator, localStorage: dom.localStorage, sessionStorage: dom.sessionStorage,
    Node: dom.Node, Text: dom.Text, NodeList: dom.NodeList, NodeFilter: dom.NodeFilter, Element: dom.Element,
    HTMLElement: dom.HTMLElement, HTMLAnchorElement: dom.HTMLAnchorElement, HTMLButtonElement: dom.HTMLButtonElement,
    HTMLInputElement: dom.HTMLInputElement, HTMLTextAreaElement: dom.HTMLTextAreaElement, HTMLImageElement: dom.HTMLImageElement,
    HTMLTableElement: dom.HTMLTableElement, HTMLTableCellElement: dom.HTMLTableCellElement, HTMLTableRowElement: dom.HTMLTableRowElement,
    Document: dom.Document, DocumentFragment: dom.DocumentFragment, ShadowRoot: dom.ShadowRoot, Event: dom.Event,
    KeyboardEvent: dom.KeyboardEvent, CustomEvent: dom.CustomEvent, SVGElement: dom.SVGElement, customElements: dom.customElements,
    CSSStyleSheet: dom.CSSStyleSheet, MutationObserver: dom.MutationObserver, ResizeObserver: dom.ResizeObserver,
    getComputedStyle: dom.getComputedStyle.bind(dom), requestAnimationFrame: dom.requestAnimationFrame.bind(dom),
    cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom), IS_REACT_ACT_ENVIRONMENT: true };
  const previous = Object.getOwnPropertyDescriptors(globalThis);
  for (const [name, value] of Object.entries(globals)) Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  const locks = new Map<string, Promise<void>>();
  Object.defineProperty(dom.navigator, 'locks', { value: { request<T>(name: string, callback: () => Promise<T>) { const next = (locks.get(name) ?? Promise.resolve()).then(callback); locks.set(name, next.then(() => undefined, () => undefined)); return next; } }, configurable: true });
  activePane = 'w1:p1'; hidden = false; pending = null; identity = 'a'.repeat(64); readCount = 0; commands = []; skills = []; registryRequests = []; actions = []; incidental = [];
  respondRegistry = async request => Response.json({ protocol: 'opencode-v2', target: request.target, sessionId: request.sessionId, kind: request.kind, ...(request.kind === 'commands' ? { commands } : { skills }) });
  respondAction = async request => request.request.action === 'command' ? commandReply(request) : promptReply(request);
  const savedFetch = globalThis.fetch;
  globalThis.fetch = Object.assign(async (input: RequestInfo | URL, options?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.pathname.endsWith('/registry')) {
      const body = registryEnvelope.parse(JSON.parse(String(options?.body)));
      registryRequests.push({ request: body.request, signal: options?.signal }); return respondRegistry(body.request, options?.signal);
    }
    if (url.pathname.endsWith('/act')) { const body = actionEnvelope.parse(JSON.parse(String(options?.body))); actions.push(body); return respondAction(body); }
    if (url.pathname.endsWith('/history/list')) return Response.json({ protocol: 'opencode-v2', conversations: [], complete: true, failures: [], cursor: {} });
    if (!['resolve', 'list', 'catalog', 'read', 'events'].some(route => url.pathname.endsWith(`/${route}`))) { incidental.push(url.pathname); return Response.json({ error: 'Unexpected legacy initialization' }, { status: 503 }); }
    const request = z.object({ request: z.object({ target: z.object({ paneId: z.string() }).optional(), sessionId: z.string().optional() }) }).parse(JSON.parse(String(options?.body)));
    const pane = request.request.target?.paneId ?? activePane;
    const source = target(pane);
    const session = { id: sessionId(pane), projectID: 'fixture', title: `Native ${pane}`, location: { directory: '/fixture' }, time: { created: 1, updated: 2 }, cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } };
    if (url.pathname.endsWith('/resolve')) return Response.json({ protocol: 'opencode-v2', target: source, directory: '/fixture', nativeAccess: 'unavailable', session, capabilities: caps });
    if (url.pathname.endsWith('/list')) return Response.json({ protocol: 'opencode-v2', target: source, sessions: [{ session, access: 'owned', capabilities: caps }], complete: true, failures: [], cursor: {} });
    if (url.pathname.endsWith('/catalog')) return Response.json({ protocol: 'opencode-v2', target: source, models: [], agents: [], authoritative: true, completeness: 'complete' });
    if (url.pathname.endsWith('/read')) { readCount++; return Response.json({ protocol: 'opencode-v2', target: source, session, access: 'owned', capabilities: caps, permissions: [], forms: [], activity: null, messages: { cursor: {}, data: [] } }); }
    if (url.pathname.endsWith('/events')) {
      let closed = false;
      return new Response(new ReadableStream<Uint8Array>({ start(controller) {
        controller.enqueue(new TextEncoder().encode(`${JSON.stringify({ protocol: 'opencode-v2', type: 'conversation.resync', target: source, sessionId: session.id })}\n`));
        options?.signal?.addEventListener('abort', () => { if (!closed) { closed = true; controller.close(); } }, { once: true });
      }, cancel() { closed = true; } }), { headers: { 'Content-Type': 'application/x-ndjson' } });
    }
    incidental.push(url.pathname); return Response.json({ error: 'Unexpected legacy initialization' }, { status: 503 });
  }, savedFetch);
  restore = () => { globalThis.fetch = savedFetch; for (const name of Object.keys(globals)) { const old = previous[name]; if (old) Object.defineProperty(globalThis, name, old); else Reflect.deleteProperty(globalThis, name); } };
  const { createRoot } = await import('react-dom/client');
  const { I18nProvider } = await import('@/lib/i18n');
  const { ConversationPanel } = await import('../../../../web/src/herdr/ConversationPanel');
  const { HerdrTransport } = await import('../../../../web/src/herdr/transport');
  const transport = new HerdrTransport({ server, token: 'fixture-only' });
  host = document.createElement('main'); document.body.append(host); root = createRoot(host);
  const paint = () => root.render(<I18nProvider><ConversationPanel transport={transport} machine="local" paneId={activePane} disabled={hidden} mutationBlocked={!!pending}
    targetMetadata={{ workspaceId: 'w1', tabId: 'w1:t1', session: 'native-fixture' }} onPendingDelivery={value => { pending = value; paint(); }} /></I18nProvider>);
  render = async (pane = activePane, hide = false) => { activePane = pane; hidden = hide; await act(async () => { paint(); }); };
  await render(); await until(() => !!host.querySelector('.cm-content'));
});
afterEach(async () => { await act(async () => root?.unmount()); await dom.happyDOM.close(); try { expect(incidental).toEqual([]); } finally { restore(); } });

test('bootstrap and ordinary prompts never query native registries', async () => {
  expect(registryRequests).toHaveLength(0);
  await setDraft('Ordinary prompt', [file]); await clickSend(); await until(() => actions.length === 1);
  expect(actions[0]?.request).toMatchObject({ action: 'prompt', input: { text: 'Ordinary prompt', files: [{ uri: file.uri, name: file.name }], delivery: 'queue' } });
  expect(registryRequests).toHaveLength(0);
  await until(() => conversationDrafts.get(draftKey()).text === '');
});

test('a native command keeps original arguments, files and delivery and accepts a null action result', async () => {
  commands = [{ name: 'verify' }]; skills = [{ id: 'same-name-skill', name: 'verify' }];
  await setDraft('/verify  alpha\nnext ', [file]); const reads = readCount;
  await clickSend(); await until(() => actions.length === 1 && conversationDrafts.get(draftKey()).text === '');
  expect(registryRequests.map(item => item.request.kind)).toEqual(['commands']);
  expect(actions[0]?.request).toEqual({ target: target(), sessionId: sessionId(), action: 'command', input: { command: 'verify', arguments: ' alpha\nnext ', files: [{ uri: file.uri, name: file.name }], delivery: 'queue' } });
  expect(host.textContent).not.toContain('Prompt queued');
  expect(host.querySelector('[data-message-id]')).toBeNull();
  await until(() => readCount > reads);
});

test('a slash skill attaches its real id to one prompt with unchanged text and files', async () => {
  skills = [{ id: '/actual/native/skill-folder', name: 'special' }];
  const text = '/special  typed arguments\nand body';
  await setDraft(text, [file]); await clickSend(); await until(() => actions.length === 1);
  expect(registryRequests.map(item => item.request.kind)).toEqual(['commands', 'skills']);
  expect(actions[0]?.request).toMatchObject({ action: 'prompt', input: { text, files: [{ uri: file.uri, name: file.name }], skills: [{ id: '/actual/native/skill-folder' }], delivery: 'queue' } });
  await until(() => conversationDrafts.get(draftKey()).text === '');
});

test('successful no-match in both registries sends one plain prompt', async () => {
  await setDraft('/unknown argument'); await clickSend(); await until(() => actions.length === 1);
  expect(registryRequests.map(item => item.request.kind)).toEqual(['commands', 'skills']);
  expect(actions[0]?.request.input).toEqual({ text: '/unknown argument', files: [], delivery: 'queue' });
});

for (const failedKind of ['commands', 'skills'] as const) test(`a failed ${failedKind} lookup preserves the draft and does not dispatch`, async () => {
  respondRegistry = async request => request.kind === failedKind
    ? Response.json({ error: { code: 'native_registry_unavailable', message: `${failedKind} unavailable` } }, { status: 503 })
    : Response.json({ protocol: 'opencode-v2', target: request.target, sessionId: request.sessionId, kind: 'commands', commands: [] });
  await setDraft('/unknown argument', [file]); await clickSend(); await until(() => !!host.querySelector('[role="alert"]'));
  expect(actions).toHaveLength(0); expect(conversationDrafts.get(draftKey())).toMatchObject({ text: '/unknown argument', files: [file] });
  expect(host.querySelector('[role="alert"]')?.textContent).toContain(`${failedKind} unavailable`);
});

test('new typing during classification cancels that captured revision before any dispatch', async () => {
  const response = deferred<Response>();
  respondRegistry = async () => response.promise;
  await setDraft('/verify old'); await clickSend(); await until(() => registryRequests.length === 1);
  await act(async () => editor().dispatch({ changes: { from: 0, to: editor().state.doc.length, insert: 'New typing' } }));
  expect(registryRequests[0]?.signal?.aborted).toBe(true);
  await act(async () => response.resolve(Response.json({ protocol: 'opencode-v2', target: target(), sessionId: sessionId(), kind: 'commands', commands: [{ name: 'verify' }] })));
  await wait(); expect(actions).toHaveLength(0); expect(conversationDrafts.get(draftKey()).text).toBe('New typing');
});

test('switching panes cancels stale classification and retains the new conversation draft', async () => {
  const response = deferred<Response>(); const oldTarget = target(); const oldSession = sessionId();
  respondRegistry = async () => response.promise;
  await setDraft('/verify old'); await clickSend(); await until(() => registryRequests.length === 1);
  await render('w1:p2'); await until(() => !!host.querySelector('.cm-content'));
  await setDraft('Second conversation');
  expect(registryRequests[0]?.signal?.aborted).toBe(true);
  await act(async () => response.resolve(Response.json({ protocol: 'opencode-v2', target: oldTarget, sessionId: oldSession, kind: 'commands', commands: [{ name: 'verify' }] })));
  await wait(); expect(actions).toHaveLength(0); expect(conversationDrafts.get(draftKey()).text).toBe('Second conversation');
});

test('a changed identity in the same pane cancels old registry work', async () => {
  const response = deferred<Response>(); const oldTarget = target();
  respondRegistry = async () => response.promise;
  await setDraft('/verify old'); await clickSend(); await until(() => registryRequests.length === 1);
  identity = 'c'.repeat(64);
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Try again"]')?.click());
  await wait(120);
  expect(registryRequests[0]?.signal?.aborted).toBe(true);
  await act(async () => response.resolve(Response.json({ protocol: 'opencode-v2', target: oldTarget, sessionId: sessionId(), kind: 'commands', commands: [{ name: 'verify' }] })));
  await wait(); expect(actions).toHaveLength(0); expect(conversationDrafts.get(draftKey()).text).toBe('/verify old');
});

test('a null command completion acknowledges only the captured draft revision', async () => {
  commands = [{ name: 'verify' }]; const response = deferred<Response>();
  respondAction = async () => response.promise;
  await setDraft('/verify original', [file]); await clickSend(); await until(() => actions.length === 1);
  const newerFile = { ...file, id: 'newer-attachment', name: 'newer.txt', uri: 'data:text/plain;base64,bmV3' };
  await setDraft('Edited while awaiting the receipt', [newerFile]);
  await act(async () => response.resolve(commandReply(actions[0]))); await wait();
  expect(actions).toHaveLength(1); expect(conversationDrafts.get(draftKey())).toMatchObject({ text: 'Edited while awaiting the receipt', files: [newerFile] });
});

test('unknown command delivery keeps the draft locked and never repeats the mutation', async () => {
  commands = [{ name: 'verify' }]; respondAction = async () => { throw new Error('Disconnected after dispatch'); };
  await setDraft('/verify once', [file]); await clickSend(); await until(() => pending !== null);
  const reads = registryRequests.length;
  await act(async () => host.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  await wait(); expect(actions).toHaveLength(1); expect(registryRequests).toHaveLength(reads);
  expect(pending?.method).toBe('conversation.command'); expect(conversationDrafts.get(draftKey())).toMatchObject({ text: '/verify once', files: [file] });
});

test('submit refreshes a native command list used by the picker before classifying', async () => {
  commands = [{ name: 'verify' }];
  await act(async () => editor().dispatch({ changes: { from: 0, to: editor().state.doc.length, insert: '/ver' } }));
  await until(() => !!host.querySelector('[data-command-autocomplete] .cursor-pointer'));
  expect(registryRequests.map(item => item.request.kind)).toEqual(['commands']);
  await act(async () => host.querySelector<HTMLElement>('[data-command-autocomplete] .cursor-pointer')?.click());
  expect(editor().state.doc.toString()).toBe('/verify ');
  commands = [];
  await clickSend(); await until(() => actions.length === 1);
  expect(registryRequests.map(item => item.request.kind)).toEqual(['commands', 'commands', 'skills']);
  expect(actions[0]?.request).toMatchObject({ action: 'prompt', input: { text: '/verify ', delivery: 'queue', files: [] } });
});

test('a registry reply for another identity cannot classify a slash prompt', async () => {
  respondRegistry = async request => Response.json({ protocol: 'opencode-v2', target: { ...request.target, identity: 'wrong-source' }, sessionId: request.sessionId, kind: 'commands', commands: [{ name: 'verify' }] });
  await setDraft('/verify argument'); await clickSend(); await until(() => !!host.querySelector('[role="alert"]'));
  expect(actions).toHaveLength(0); expect(registryRequests).toHaveLength(1);
  expect(conversationDrafts.get(draftKey()).text).toBe('/verify argument');
});

test('two fast submit gestures share one classification and produce one dispatch', async () => {
  const response = deferred<Response>();
  respondRegistry = async () => response.promise;
  await setDraft('/verify once');
  const button = host.querySelector<HTMLButtonElement>('[aria-label="Send message"]');
  await act(async () => { button?.click(); button?.click(); }); await until(() => registryRequests.length === 1);
  await act(async () => response.resolve(Response.json({ protocol: 'opencode-v2', target: target(), sessionId: sessionId(), kind: 'commands', commands: [{ name: 'verify' }] })));
  await until(() => actions.length === 1); await wait();
  expect(registryRequests).toHaveLength(1); expect(actions).toHaveLength(1);
});

for (const text of [' /verify argument', '/verify\targument', '/verify\nargument']) test(`original literal parsing retains ${JSON.stringify(text)}`, async () => {
  commands = [{ name: 'verify' }];
  await setDraft(text); await clickSend(); await until(() => actions.length === 1);
  expect(actions[0]?.request).toMatchObject({ action: 'prompt', input: { text, files: [], delivery: 'queue' } });
  expect(registryRequests.map(item => item.request.kind)).toEqual(text.startsWith('/') ? ['commands', 'skills'] : []);
});
