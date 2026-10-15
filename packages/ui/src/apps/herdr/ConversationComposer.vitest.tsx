import { afterEach, beforeEach, expect, test } from 'bun:test';
import React, { act } from 'react';
import { EditorView } from '@codemirror/view';
import { Window } from 'happy-dom';
import type { CommandInfo } from '@/components/chat/CommandAutocompleteView';
import type { SkillInfo } from '@/components/chat/SkillAutocompleteView';
import type { Root } from 'react-dom/client';

let dom: Window;
let root: Root;
let host: HTMLDivElement;
let restore: () => void;
let render: () => Promise<void>;
let scope: string;
let hidden: boolean;
let writable: boolean;
let running: boolean;
let canQueue: boolean;
let pickerOpen: boolean;
let commandLoader: ((signal: AbortSignal) => Promise<CommandInfo[]>) | undefined;
let skillLoader: ((signal: AbortSignal) => Promise<SkillInfo[]>) | undefined;
let sends: number;
let queues: number;
let attachments: { name: string }[];
let requests: string[];
let frameObserver: (() => void) | undefined;
const drafts = new Map<string, string>();
const wait = async (ms = 450) => { for (let elapsed = 0; elapsed < ms; elapsed += 25) await act(async () => { await new Promise(resolve => setTimeout(resolve, Math.min(25, ms - elapsed))); }); };
const content = () => host.querySelector<HTMLElement>('.cm-content');
const view = () => { const node = content(); const found = node && EditorView.findFromDOM(node); if (!found) throw new Error('Missing original editor'); return found; };
const expand = async () => {
  const prompt = host.querySelector<HTMLButtonElement>('[data-composer-morph-prompt]');
  expect(prompt).not.toBeNull();
  // The editor must exist and receive focus before this click stack returns.
  await act(async () => { prompt?.click(); expect(document.activeElement).toBe(content()); });
};

beforeEach(async () => {
  dom = new Window({ url: 'https://composer.test/' });
  dom.innerWidth = 412; dom.innerHeight = 915;
  const globals = { window: dom, document: dom.document, navigator: dom.navigator, localStorage: dom.localStorage,
    Node: dom.Node, Text: dom.Text, NodeList: dom.NodeList, NodeFilter: dom.NodeFilter, Element: dom.Element,
    HTMLElement: dom.HTMLElement, HTMLButtonElement: dom.HTMLButtonElement, HTMLInputElement: dom.HTMLInputElement,
    HTMLTextAreaElement: dom.HTMLTextAreaElement, Document: dom.Document, DocumentFragment: dom.DocumentFragment,
    ShadowRoot: dom.ShadowRoot, Event: dom.Event, KeyboardEvent: dom.KeyboardEvent, CustomEvent: dom.CustomEvent,
    MutationObserver: dom.MutationObserver, ResizeObserver: dom.ResizeObserver,
    getComputedStyle: dom.getComputedStyle.bind(dom), requestAnimationFrame: dom.requestAnimationFrame.bind(dom),
    cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom), IS_REACT_ACT_ENVIRONMENT: true };
  const previous = Object.getOwnPropertyDescriptors(globalThis);
  for (const [name, value] of Object.entries(globals)) Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  const originalFetch = globalThis.fetch; requests = [];
  globalThis.fetch = Object.assign(async (input: RequestInfo | URL) => { requests.push(String(input)); throw new Error('The input must not initialize a runtime'); }, originalFetch);
  restore = () => { globalThis.fetch = originalFetch; for (const name of Object.keys(globals)) { const old = previous[name]; if (old) Object.defineProperty(globalThis, name, old); else Reflect.deleteProperty(globalThis, name); } };
  const { createRoot } = await import('react-dom/client');
  const { I18nProvider } = await import('@/lib/i18n');
  const { ConversationComposer } = await import('../../../../web/src/herdr/ConversationComposer');
  commandLoader = undefined; skillLoader = undefined; frameObserver = undefined;
  scope = 'server/local/pane/identity/session-a'; hidden = false; writable = true; running = false; canQueue = true; pickerOpen = false; sends = 0; queues = 0; attachments = [];
  drafts.clear(); drafts.set(scope, 'Unsent draft');
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  const paint = () => root.render(<I18nProvider><React.Profiler id="composer-frame" onRender={() => { frameObserver?.(); }}><section data-composer-bound><ConversationComposer key={scope}
    text={drafts.get(scope) ?? ''} onTextChange={(text) => { drafts.set(scope, text); paint(); }}
    attachmentFiles={attachments} onAttach={(files) => { attachments = files.map(file => ({ name: file.name })); }}
    onEditorFocus={() => {}} onEditorBlur={() => {}} writable={writable} hidden={hidden} isMobile pickerOpen={pickerOpen}
    loadCommands={commandLoader} loadSkills={skillLoader} ariaLabel="Prompt" isRunning={running} canSend={writable} canQueue={writable && canQueue} canAbort={false}
    onSend={() => { sends++; }} onQueue={() => { queues++; }} onAbort={() => {}}
    model={{ label: 'Actual model', onChoose: () => { pickerOpen = true; paint(); }, disabled: !writable }}
    agent={{ label: 'Actual agent', onChoose: () => {}, disabled: !writable }}
  ><div data-request-dock role="dialog">Actual permission</div></ConversationComposer></section></React.Profiler></I18nProvider>);
  render = () => act(async () => { paint(); });
  await render();
});
afterEach(async () => { await act(async () => root.unmount()); await dom.happyDOM.close(); try { expect(requests).toEqual([]); } finally { restore(); } });

test('preview tap synchronously focuses the original editor; collapse and return retain draft and selection', async () => {
  expect(content()).toBeNull();
  await expand();
  const original = content(); const editor = view();
  await act(async () => editor.dispatch({ changes: { from: editor.state.doc.length, insert: '\nMore text' }, selection: { anchor: 3 } }));
  expect(drafts.get(scope)).toBe('Unsent draft\nMore text');
  expect(content()).toBe(original);
  expect(host.querySelector('form .cm-content')).toBe(original);
  expect(host.querySelector('form [data-request-dock]')).toBe(host.querySelector('[data-request-dock]'));
  await act(async () => original?.blur()); await wait();
  expect(content()).toBeNull();
  expect(host.querySelector('[data-mobile-composer-pill]')?.textContent).toContain('More text');
  await expand();
  expect(content()).toBe(original);
  expect(view().state.selection.main.anchor).toBe(3);
  expect(view().state.doc.toString()).toBe('Unsent draft\nMore text');
  await act(async () => content()?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
  await wait(); expect(content()).toBeNull();
});

test('mobile Enter and IME never send, external keyboard submit respects running and delivery locks', async () => {
  await expand();
  const key = async (options: KeyboardEventInit) => act(async () => { content()?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...options })); });
  await key({}); await key({ shiftKey: true }); await key({ ctrlKey: true, isComposing: true });
  expect(sends).toBe(0); expect(queues).toBe(0);
  await key({ ctrlKey: true }); expect(sends).toBe(1);
  running = true; await render(); await key({ metaKey: true }); expect(queues).toBe(1);
  canQueue = false; await render(); await key({ ctrlKey: true }); expect(queues).toBe(1);
  expect(host.querySelector('[aria-label="Send message"]')).toBeNull();
  writable = false; await render(); await key({ ctrlKey: true });
  expect(content()?.getAttribute('contenteditable')).toBe('false'); expect(sends).toBe(1); expect(queues).toBe(1);
});

test('picker holds the expanded editor and restores its focus, keyboard hide returns to the preview', async () => {
  await expand(); const original = content();
  await act(async () => host.querySelector<HTMLButtonElement>('[title="Actual model"]')?.click());
  await wait(); expect(pickerOpen).toBe(true); expect(content()).toBe(original);
  pickerOpen = false; await render(); await wait(220);
  expect(document.activeElement).toBe(original);
  await act(async () => window.dispatchEvent(new CustomEvent('oc:keyboard-intent', { detail: { open: false } })));
  await wait(); expect(content()).toBeNull();
  expect(drafts.get(scope)).toBe('Unsent draft');
});

test('hide and owner replacement cannot focus or write into the next conversation', async () => {
  await expand(); const previous = view();
  hidden = true; await render(); await wait(); expect(content()).toBeNull();
  hidden = false; await render(); await expand(); expect(view()).toBe(previous);
  scope = 'server/ssh/pane/new-identity/session-b'; drafts.set(scope, 'Second owner'); await render();
  expect(content()).toBeNull(); await wait(); expect(document.activeElement).not.toBe(content());
  await expand(); expect(view()).not.toBe(previous); expect(view().state.doc.toString()).toBe('Second owner');
  expect(drafts.get('server/local/pane/identity/session-a')).toBe('Unsent draft');
});

test('native file picker cancellation preserves the draft and releases its expansion holder', async () => {
  await expand();
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Attach files"]')?.click());
  await wait(); expect(content()).not.toBeNull();
  await act(async () => host.querySelector('input[type="file"]')?.dispatchEvent(new Event('cancel', { bubbles: true })));
  await wait(); expect(content()).toBeNull(); expect(drafts.get(scope)).toBe('Unsent draft'); expect(attachments).toEqual([]);
});

test('tablet size keeps the real editor expanded without a software keyboard', async () => {
  dom.innerWidth = 900; dom.innerHeight = 1200;
  await act(async () => window.dispatchEvent(new Event('resize'))); await wait(80);
  expect(content()).not.toBeNull();
  await act(async () => { content()?.focus(); content()?.blur(); }); await wait();
  expect(content()).not.toBeNull();
});

test('Back closes a later overlay first, then blurs the composer without submitting', async () => {
  const { closeTopmostBackLayer, registerBackLayer } = await import('@/lib/mobileBackLayers');
  await expand();
  let closed = 0;
  const unregister = registerBackLayer(() => { closed++; });
  try {
    await act(async () => { expect(closeTopmostBackLayer()).toBe(true); });
    expect(closed).toBe(1); expect(content()).not.toBeNull();
  } finally { unregister(); }
  await act(async () => { expect(closeTopmostBackLayer()).toBe(true); }); await wait();
  expect(content()).toBeNull(); expect(sends).toBe(0); expect(queues).toBe(0);
});

test('a pending picker focus restore cannot focus a hidden conversation', async () => {
  await expand();
  await act(async () => host.querySelector<HTMLButtonElement>('[title="Actual model"]')?.click());
  pickerOpen = false; await render();
  hidden = true; await render();
  await wait();
  expect(content()).toBeNull();
  expect(document.activeElement?.closest('[data-herdr-composer]')).toBeNull();
  hidden = false; await render();
  expect(content()).toBeNull();
  expect(drafts.get(scope)).toBe('Unsent draft');
});

test('returning to an unlocked pill opens its own file picker once without expanding', async () => {
  await expand();
  hidden = true; writable = false; await render(); await wait();
  expect(content()).toBeNull();
  const pill = host.querySelector('[data-mobile-composer-pill]');
  const input = host.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error('Missing owned file input');
  let opens = 0;
  input.click = () => { opens++; };
  const attach = () => act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Attach files"]')?.click());
  await attach(); expect(opens).toBe(0);
  hidden = false; await render(); await attach(); expect(opens).toBe(0);
  hidden = true; writable = true; await render(); await attach(); expect(opens).toBe(0);
  hidden = false; await render();
  expect(host.querySelector('[data-mobile-composer-pill]')).toBe(pill);
  expect(content()).toBeNull();
  await attach();
  expect(opens).toBe(1);
  expect(host.querySelector('input[type="file"]')).toBe(input);
  expect(drafts.get(scope)).toBe('Unsent draft');
  expect(sends).toBe(0); expect(queues).toBe(0);
});

const nativeCommand = (name: string): CommandInfo => ({ id: `native:${name}`, name, source: 'opencode', description: `Native ${name}` });
const writeText = (text: string) => act(async () => { const editor = view(); editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: text }, selection: { anchor: text.length } }); });
const commandPopup = () => host.querySelector('[data-command-autocomplete]');
const candidateRows = () => [...(commandPopup()?.querySelectorAll<HTMLElement>('.cursor-pointer') ?? [])];
const composerKey = (key: string, modifiers: KeyboardEventInit = {}) => act(async () => { content()?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...modifiers })); });

test('native commands load only on a typed slash opening and retain original keyboard selection and insertion', async () => {
  let loads = 0;
  commandLoader = async () => { loads++; return [nativeCommand('zeta'), nativeCommand('alpha')]; };
  await render(); await expand(); expect(loads).toBe(0);
  await writeText('/'); await wait(40);
  expect(loads).toBe(1);
  expect(candidateRows().map(row => row.querySelector('.typography-ui-label')?.textContent)).toEqual(['/alpha', '/zeta']);
  expect(commandPopup()?.classList.contains('max-w-[450px]')).toBe(true);
  await composerKey('n', { ctrlKey: true });
  expect(candidateRows()[1]?.classList.contains('bg-interactive-selection')).toBe(true);
  await composerKey('p', { ctrlKey: true });
  expect(candidateRows()[0]?.classList.contains('bg-interactive-selection')).toBe(true);
  await composerKey('ArrowUp');
  await composerKey('Tab'); await wait(25);
  expect(view().state.doc.toString()).toBe('/zeta ');
  expect(document.activeElement).toBe(content()); expect(sends).toBe(0); expect(queues).toBe(0);
  expect(commandPopup()).toBeNull();
  await writeText('/'); await wait(40); expect(loads).toBe(2);
  await composerKey('Enter', { isComposing: true });
  expect(sends).toBe(0); expect(queues).toBe(0);
  expect(view().state.doc.toString()).not.toBe('/alpha ');
  expect(view().state.doc.toString()).not.toBe('/zeta ');
  await writeText('/'); await wait(40);
  await composerKey('ArrowDown'); await composerKey('Enter'); await wait(25);
  expect(view().state.doc.toString()).toBe('/zeta ');
  expect(sends).toBe(0); expect(loads).toBe(3);
});

test('Back dismisses native candidates before the keyboard; overlay handoff preserves the slash draft', async () => {
  const { closeTopmostBackLayer } = await import('@/lib/mobileBackLayers');
  let loads = 0;
  commandLoader = async () => { loads++; return [nativeCommand('verify')]; };
  await render(); await expand(); await writeText('/ver'); await wait(40);
  await act(async () => { expect(closeTopmostBackLayer()).toBe(true); }); await wait(25);
  expect(commandPopup()).toBeNull(); expect(document.activeElement).toBe(content());
  expect(view().state.doc.toString()).toBe('/ver');
  await writeText('/verify'); await wait(40); expect(loads).toBe(2);
  await act(async () => host.querySelector<HTMLButtonElement>('[title="Actual model"]')?.click());
  expect(pickerOpen).toBe(true); await wait(25); expect(commandPopup()).toBeNull();
  pickerOpen = false; await render(); await wait();
  expect(document.activeElement).toBe(content()); expect(view().state.doc.toString()).toBe('/verify');
  expect(loads).toBe(2); expect(sends).toBe(0);
});

test('registry errors are explicit and never render a successful empty command list', async () => {
  let loads = 0;
  commandLoader = async () => { loads++; if (loads === 1) throw new Error('Native registry unavailable'); return []; };
  await render(); await expand(); await writeText('/'); await wait(40);
  expect(commandPopup()?.querySelector('[role="alert"]')?.textContent).toBe('Native registry unavailable');
  expect(commandPopup()?.textContent).not.toContain('No commands found');
  await composerKey('Enter', { ctrlKey: true }); expect(sends).toBe(0);
  await composerKey('Escape'); await wait(25);
  await writeText('/other'); await wait(40);
  expect(loads).toBe(2); expect(commandPopup()?.textContent).toContain('No commands found');
  expect(commandPopup()?.querySelector('[role="alert"]')).toBeNull();
  await composerKey('Enter', { ctrlKey: true }); expect(sends).toBe(0);
  expect(drafts.get(scope)).toBe('/other'); expect(sends).toBe(0);
});

test('a changed source cancels pending candidates and cannot publish their old command names', async () => {
  let reply: (items: CommandInfo[]) => void = () => {};
  const signals: AbortSignal[] = [];
  commandLoader = (next) => { signals.push(next); return new Promise(resolve => { reply = resolve; }); };
  await render(); await expand(); await writeText('/'); await wait(25);
  expect(commandPopup()?.querySelector('[role="status"]')).not.toBeNull();
  await composerKey('Enter', { ctrlKey: true }); expect(sends).toBe(0); expect(queues).toBe(0);
  scope = 'server/ssh/pane/changed-source/session-b'; drafts.set(scope, 'Other owner'); await render();
  expect(signals[0]?.aborted).toBe(true);
  await act(async () => reply([nativeCommand('stale-only')])); await wait(25);
  expect(commandPopup()).toBeNull(); expect(drafts.get(scope)).toBe('Other owner');
  await expand(); expect(view().state.doc.toString()).toBe('Other owner');
});

test('the first layout of each command opening shows loading before passive registry effects', async () => {
  const gate = () => { let resolve: (items: CommandInfo[]) => void = () => {}; const promise = new Promise<CommandInfo[]>(done => { resolve = done; }); return { promise, resolve: (items: CommandInfo[]) => resolve(items) }; };
  let pending = gate();
  commandLoader = () => pending.promise;
  await render(); await expand();
  let frames: string[] = [];
  frameObserver = () => { const popup = commandPopup(); if (popup) frames.push(popup.textContent ?? ''); };
  await writeText('/');
  expect(frames.length).toBeGreaterThan(0);
  expect(frames[0]).toContain('Loading...');
  expect(frames[0]).not.toContain('No commands found');
  await act(async () => pending.resolve([nativeCommand('old-name')]));
  await wait(25);
  await composerKey('Escape'); await wait(25);
  pending = gate(); frames = [];
  await writeText('/old');
  expect(frames.length).toBeGreaterThan(0);
  expect(frames[0]).toContain('Loading...');
  expect(frames[0]).not.toContain('/old-name');
  await act(async () => pending.resolve([]));
  await wait(25);
});

const skillPopup = () => host.querySelector('[data-skill-autocomplete]');
const skillRows = () => [...(skillPopup()?.querySelectorAll<HTMLElement>('.cursor-pointer') ?? [])];
const nativeSkill = (name: string): SkillInfo => ({ id: `native-folder:${name}`, name, description: `Native ${name}` });

test('skill queries filter one native read per opening and retain keyboard/IME selection behavior', async () => {
  let loads = 0;
  skillLoader = async () => { loads++; return [nativeSkill('zeta'), nativeSkill('alpha')]; };
  await render(); await expand(); expect(loads).toBe(0);
  await writeText('$'); await wait(40); expect(loads).toBe(1);
  expect(skillRows().map(row => row.querySelector('.font-semibold')?.textContent)).toEqual(['alpha', 'zeta']);
  expect(skillRows().every(row => row.querySelectorAll('span').length === 1)).toBe(true);
  expect(skillPopup()?.classList.contains('max-w-[450px]')).toBe(true);
  await writeText('$al'); await wait(25); expect(loads).toBe(1);
  expect(skillRows().map(row => row.querySelector('.font-semibold')?.textContent)).toEqual(['alpha']);
  await writeText('$'); await wait(25);
  await composerKey('n', { ctrlKey: true }); expect(skillRows()[1]?.classList.contains('bg-interactive-selection')).toBe(true);
  await composerKey('p', { ctrlKey: true }); expect(skillRows()[0]?.classList.contains('bg-interactive-selection')).toBe(true);
  await composerKey('ArrowUp'); await composerKey('Tab'); await wait(25);
  expect(view().state.doc.toString()).toBe('$zeta '); expect(document.activeElement).toBe(content());
  expect(skillPopup()).toBeNull(); expect(sends).toBe(0); expect(queues).toBe(0);
  await writeText('$'); await wait(40); expect(loads).toBe(2);
  await composerKey('Enter', { isComposing: true }); expect(sends).toBe(0); expect(queues).toBe(0);
  expect(view().state.doc.toString()).not.toBe('$alpha ');
  await writeText('$'); await wait(40);
  await composerKey('ArrowDown'); await composerKey('Enter'); await wait(25);
  expect(view().state.doc.toString()).toBe('$zeta '); expect(sends).toBe(0);
});

test('skill selection replaces only the token before the caret and preserves multiline tail text', async () => {
  skillLoader = async () => [nativeSkill('My_Audit')];
  await render(); await expand();
  const before = 'First line\nReview $My tail text\nLast line';
  const cursor = before.indexOf(' tail');
  await act(async () => view().dispatch({ changes: { from: 0, to: view().state.doc.length, insert: before }, selection: { anchor: cursor } }));
  await wait(40);
  await act(async () => skillRows()[0]?.click());
  const after = 'First line\nReview $My_Audit  tail text\nLast line';
  expect(view().state.doc.toString()).toBe(after); expect(drafts.get(scope)).toBe(after);
  expect(view().state.selection.main.anchor).toBe(before.indexOf('$') + 'My_Audit'.length + 2);
  expect(document.activeElement).toBe(content()); expect(skillPopup()).toBeNull(); expect(sends).toBe(0);
});

test('slash candidates retain priority and skill candidates close before Back or model handoff', async () => {
  const { closeTopmostBackLayer } = await import('@/lib/mobileBackLayers');
  let loads = 0;
  commandLoader = async () => [nativeCommand('verify')];
  skillLoader = async () => { loads++; return [nativeSkill('audit')]; };
  await render(); await expand(); await writeText('/ver'); await wait(40);
  expect(commandPopup()).not.toBeNull(); expect(skillPopup()).toBeNull(); expect(loads).toBe(0);
  await writeText('/verify $au'); await wait(40);
  expect(commandPopup()).toBeNull(); expect(skillPopup()).not.toBeNull(); expect(loads).toBe(1);
  await act(async () => { expect(closeTopmostBackLayer()).toBe(true); }); await wait(25);
  expect(skillPopup()).toBeNull(); expect(document.activeElement).toBe(content());
  await writeText('/verify $audit'); await wait(40); expect(loads).toBe(2);
  await act(async () => host.querySelector<HTMLButtonElement>('[title="Actual model"]')?.click()); await wait(25);
  expect(pickerOpen).toBe(true); expect(skillPopup()).toBeNull();
  pickerOpen = false; await render(); await wait();
  expect(view().state.doc.toString()).toBe('/verify $audit'); expect(document.activeElement).toBe(content()); expect(loads).toBe(2);
});

test('failed skill reads remain errors and a new opening starts with loading in its first frame', async () => {
  let loads = 0;
  skillLoader = async () => { loads++; if (loads === 1) throw new Error('Native skills unavailable'); return []; };
  await render(); await expand();
  const frames: string[] = [];
  frameObserver = () => { const popup = skillPopup(); if (popup) frames.push(popup.textContent ?? ''); };
  await writeText('$'); await wait(40);
  expect(frames[0]).toContain('Loading...'); expect(frames[0]).not.toContain('No skills found');
  expect(skillPopup()?.querySelector('[role="alert"]')?.textContent).toBe('Native skills unavailable');
  expect(skillPopup()?.textContent).not.toContain('No skills found');
  await composerKey('Enter', { ctrlKey: true }); expect(sends).toBe(0);
  await composerKey('Escape'); await wait(25);
  frames.length = 0;
  await writeText('$other'); await wait(40);
  expect(frames[0]).toContain('Loading...'); expect(frames[0]).not.toContain('Native skills unavailable');
  expect(skillPopup()?.textContent).toContain('No skills found'); expect(loads).toBe(2);
  expect(drafts.get(scope)).toBe('$other');
});

test('hidden and replaced skill owners abort pending reads without publishing their candidates', async () => {
  let reply: (items: SkillInfo[]) => void = () => {};
  const signals: AbortSignal[] = [];
  skillLoader = signal => { signals.push(signal); return new Promise(resolve => { reply = resolve; }); };
  await render(); await expand(); await writeText('$'); await wait(25);
  const first = reply;
  hidden = true; await render(); expect(signals[0]?.aborted).toBe(true);
  await act(async () => first([nativeSkill('hidden-only')])); await wait();
  expect(skillPopup()).toBeNull();
  hidden = false; await render(); await expand(); await writeText('$new'); await wait(25);
  const second = reply;
  scope = 'new-native-skills-owner'; drafts.set(scope, 'New owner'); await render();
  expect(signals[1]?.aborted).toBe(true);
  await act(async () => second([nativeSkill('old-owner-only')])); await wait(25);
  expect(skillPopup()).toBeNull(); await expand(); expect(view().state.doc.toString()).toBe('New owner');
  expect(sends).toBe(0); expect(queues).toBe(0);
});
