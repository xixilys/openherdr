import { afterEach, beforeEach, expect, test } from 'bun:test';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Window } from 'happy-dom';
import type { ToolPart } from '@openchamber/ui/lib/opencode/model';
import { getDefaultTheme } from '@openchamber/ui/lib/theme/themes';
import { TOOL_OUTPUT_MAX_CHARS } from '@openchamber/ui/components/chat/message/toolOutputText';

let dom: Window;
let host: HTMLDivElement;
let root: Root;
let restore: () => void;
let requests: string[];
let ConversationTool: typeof import('../../../../web/src/herdr/ConversationTool')['ConversationTool'];
let I18nProvider: typeof import('@openchamber/ui/lib/i18n')['I18nProvider'];
const base = { id: 'prt_tool', sessionID: 'ses_tool', messageID: 'msg_tool', callID: 'call_tool', type: 'tool' as const };
const theme = getDefaultTheme(true);

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
  requests = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = Object.assign(async (input: string | URL | Request) => { requests.push(String(input)); return Response.json({}, { status: 503 }); }, originalFetch);
  restore = () => { globalThis.fetch = originalFetch; for (const name of Object.keys(globals)) { const descriptor = descriptors[name]; if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); } };
  ({ ConversationTool } = await import('../../../../web/src/herdr/ConversationTool'));
  ({ I18nProvider } = await import('@openchamber/ui/lib/i18n'));
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root?.unmount()); await dom.happyDOM.close(); try { expect(requests).toEqual([]); } finally { restore(); } });
const render = async (part: ToolPart, live = true, attachments?: React.ReactNode, onOpenFile?: (path: string, line?: number) => void) => {
  await act(async () => root.render(<I18nProvider><ConversationTool part={part} live={live} theme={theme} directory="/fixture" attachments={attachments} onOpenFile={onOpenFile} /></I18nProvider>));
};
const expand = async () => { const row = host.querySelector<HTMLElement>('[role="button"]'); if (!row) throw new Error('Missing tool summary'); await act(async () => row.click()); };

test('real running shell metadata appends and rewrites before the final result replaces it', async () => {
  const shell = (output: string): ToolPart => ({ ...base, tool: 'shell', state: { status: 'running', input: { command: 'printf source' }, metadata: { output }, time: { start: Date.now() } } });
  await render(shell('Starting'));
  expect(host.querySelector('pre')).toBeNull();
  await expand();
  expect(host.textContent).toContain('printf source');
  expect(host.textContent).toContain('Starting');
  const output = Array.from(host.querySelectorAll('.tool-output-surface pre')).find((element) => element.textContent === 'Starting');
  const node = output?.firstChild;
  await render(shell('Starting\nNext'));
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 120)); });
  expect(output?.textContent).toBe('Starting\nNext');
  expect(output?.firstChild).toBe(node);
  await render(shell('Rewritten'));
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 120)); });
  expect(output?.textContent).toBe('Rewritten');
  await render({ ...base, tool: 'shell', state: { status: 'completed', input: { command: 'printf source' }, metadata: { output: 'stale metadata' }, output: '\u001b[32mFinal\u001b[0m', time: { start: 1, end: 2 } } }, false, <span>Actual attachment slot</span>);
  expect(host.querySelector('code')?.textContent).toBe('Final');
  expect(host.textContent).not.toContain('stale metadata');
  expect(host.textContent).toContain('Actual attachment slot');
});

test('failed tools keep partial terminal output and the actual error, bounded before rendering', async () => {
  await render({ ...base, tool: 'shell', state: { status: 'error', input: { command: 'fail' }, output: 'partial\r\u001b[2Klatest', error: 'actual failure ' + 'x'.repeat(TOOL_OUTPUT_MAX_CHARS + 30), time: { start: 1, end: 2 } } }, false);
  await expand();
  expect(host.querySelector('code')?.textContent).toBe('latest');
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('actual failure');
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('output truncated');
  expect(host.querySelector('[role="alert"]')?.textContent?.length).toBeLessThan(TOOL_OUTPUT_MAX_CHARS + 300);
});

test('multi-file source patches render independently and switch diff layout without invented file actions', async () => {
  await render({ ...base, tool: 'patch', state: { status: 'completed', input: {}, output: '', metadata: { files: [
    { file: '/fixture/a.ts', patch: '--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-before\n+after' },
    { file: '/fixture/b.ts', patch: 'malformed patch retained' },
  ] }, time: { start: 1, end: 2 } } }, false);
  await expand();
  expect(host.textContent).toContain('a.ts'); expect(host.textContent).toContain('b.ts');
  expect(host.textContent).toContain('malformed patch retained');
  expect(host.querySelector('[aria-label="Open file diff"]')).toBeNull();
  const toggle = host.querySelector<HTMLButtonElement>('[aria-label="Switch to side-by-side view"]');
  expect(toggle).not.toBeNull();
  await act(async () => toggle?.click());
  expect(host.querySelector('[aria-label="Switch to unified view"]')).not.toBeNull();
});

test('generic JSON and unknown subtask data retain source content without a source controller', async () => {
  await render({ ...base, tool: 'mcp.custom', state: { status: 'completed', input: {}, output: '{"name":"source JSON","value":42}', time: { start: 1, end: 2 } } }, false);
  await expand();
  expect(host.textContent).toContain('source JSON');
  await render({ ...base, tool: 'subagent', state: { status: 'completed', input: { description: 'source task' }, output: '<unrecognized>keep raw task result</unrecognized>', metadata: { sessionID: 'ses_child' }, time: { start: 1, end: 2 } } }, false);
  expect(host.textContent).toContain('<unrecognized>keep raw task result</unrecognized>');
  expect(host.querySelector('[aria-label="Stop subagent"]')).toBeNull();
});


test('subtask Markdown uses the explicit host context without bootstrapping source APIs', async () => {
  const { MarkdownPresentationContext } = await import('@openchamber/ui/components/chat/MarkdownPresentationContext');
  const part: ToolPart = { ...base, tool: 'subagent', state: { status: 'completed', input: {}, output: '**Actual task result**', time: { start: 1, end: 2 } } };
  const source = { directory: '/fixture', runtimeKey: 'https://fixture.example', isVSCode: false, theme, themeMode: 'dark' as const, fileReferences: false, inlineImages: false, ownOrigins: ['https://fixture.example'], openExternalLink: () => undefined };
  await act(async () => root.render(<I18nProvider><MarkdownPresentationContext.Provider value={source}><ConversationTool part={part} live={false} directory="/fixture" /></MarkdownPresentationContext.Provider></I18nProvider>));
  await expand();
  for (let attempt = 0; attempt < 50 && !host.querySelector('strong'); attempt += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
  expect(host.querySelector('strong')?.textContent).toBe('Actual task result');
});

test('a caller without a theme uses a pure default and bounds large final shell output', async () => {
  const output = 'Source output\n' + 'x'.repeat(TOOL_OUTPUT_MAX_CHARS + 500);
  const part: ToolPart = { ...base, tool: 'shell', state: { status: 'completed', input: {}, output, time: { start: 1, end: 2 } } };
  await act(async () => root.render(<I18nProvider><ConversationTool part={part} live={false} directory="/fixture" /></I18nProvider>));
  await expand();
  expect(host.querySelector('code')?.textContent).toContain('Source output');
  expect(host.querySelector('code')?.textContent).toContain('output truncated');
  expect(host.querySelector('code')?.textContent?.length).toBeLessThan(output.length);
});

test('current-file actions use each source patch path and actual changed line', async () => {
  const opened: { path: string; line?: number }[] = [];
  const onOpen = (path: string, line?: number) => { opened.push({ path, line }); };
  await render({ ...base, tool: 'patch', state: { status: 'completed', input: {}, output: '', metadata: { files: [
    { file: '/fixture/a.ts', patch: '--- a/a.ts\n+++ b/a.ts\n@@ -7 +7 @@\n-before\n+after' },
    { file: '/fixture/nested/b.ts', patch: 'malformed source patch retained' },
    { file: '/other/private.ts', patch: 'outside source patch retained' },
  ] }, time: { start: 1, end: 2 } } }, false, undefined, onOpen);
  const headerAction = host.querySelector<HTMLButtonElement>('[aria-label="Open current file"]');
  expect(headerAction).not.toBeNull();
  await act(async () => headerAction?.click());
  expect(host.querySelector('pre')).toBeNull();
  expect(opened).toEqual([{ path: 'a.ts', line: 7 }]);
  await expand();
  const actions = host.querySelectorAll<HTMLButtonElement>('[aria-label="Open current file"]');
  expect(actions).toHaveLength(3);
  await act(async () => actions[2]?.click());
  expect(opened.at(-1)).toEqual({ path: 'nested/b.ts', line: undefined });
});

test('read actions retain a real offset and unavailable sources expose no action', async () => {
  const opened: { path: string; line?: number }[] = [];
  const part: ToolPart = { ...base, tool: 'read', state: { status: 'completed', input: { path: '/fixture/a.ts', offset: 4 }, output: 'source text', time: { start: 1, end: 2 } } };
  await render(part, false, undefined, (path, line) => { opened.push({ path, line }); });
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Open current file"]')?.click());
  expect(opened).toEqual([{ path: 'a.ts', line: 4 }]);
  await render(part, false);
  expect(host.querySelector('[aria-label="Open current file"]')).toBeNull();
  await render({ ...part, state: { ...part.state, input: { path: '/outside/a.ts' } } }, false, undefined, () => { throw new Error('Outside path must not be actionable'); });
  expect(host.querySelector('[aria-label="Open current file"]')).toBeNull();
});
