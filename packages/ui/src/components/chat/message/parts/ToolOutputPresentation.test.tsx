import { afterEach, beforeEach, expect, test } from 'bun:test';
import { plugin } from 'bun';
import { pathToFileURL } from 'node:url';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Window } from 'happy-dom';
import { getDefaultTheme } from '@/lib/theme/themes';
import { getMarkdownSyntaxVars } from '../../markdown/markdownSyntaxVars';
import { getToolOutput } from './toolOutput';
import { getDiffPatchEntries } from './toolDiffUtils';
import { TOOL_DIFF_PREVIEW_MAX_CHARS } from './toolDiffPreview';

plugin({ name: 'pure-tool-worker-url', setup(build) {
    build.onLoad({ filter: /markdown-shiki\.worker\.ts\?worker&url$/ }, ({ path }) => ({
        contents: `export default ${JSON.stringify(pathToFileURL(path.split('?')[0]).href)};`, loader: 'js',
    }));
} });

let dom: Window;
let root: Root;
let host: HTMLDivElement;
let requests: string[];
let restore: () => void;
let views: typeof import('./ToolOutputPresentation');
let I18nProvider: typeof import('@/lib/i18n')['I18nProvider'];

beforeEach(async () => {
    dom = new Window({ url: 'https://fixture.example/' });
    const globals = { window: dom, document: dom.document, navigator: dom.navigator, localStorage: dom.localStorage,
        SVGElement: dom.SVGElement, Node: dom.Node, Text: dom.Text, Element: dom.Element, HTMLElement: dom.HTMLElement, MutationObserver: dom.MutationObserver,
        ResizeObserver: dom.ResizeObserver, requestAnimationFrame: dom.requestAnimationFrame.bind(dom), cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom), IS_REACT_ACT_ENVIRONMENT: true };
    const descriptors = Object.getOwnPropertyDescriptors(globalThis);
    for (const [name, value] of Object.entries(globals)) Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
    requests = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = Object.assign(async (input: string | URL | Request) => { requests.push(String(input)); return Response.json({}, { status: 503 }); }, originalFetch);
    restore = () => {
        globalThis.fetch = originalFetch;
        for (const name of Object.keys(globals)) {
            const descriptor = descriptors[name];
            if (descriptor) Object.defineProperty(globalThis, name, descriptor);
            else Reflect.deleteProperty(globalThis, name);
        }
    };
    views = await import('./ToolOutputPresentation');
    ({ I18nProvider } = await import('@/lib/i18n'));
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => {
    await act(async () => root.unmount());
    await dom.happyDOM.close();
    try { expect(requests).toEqual([]); } finally { restore(); }
});

test('running snapshots append and replace a stable text node before the final normalized result', async () => {
    const { ToolShellOutput } = views;
    const render = async (output: string, running: boolean) => {
        await act(async () => root.render(<I18nProvider><ToolShellOutput output={output} isStreaming={running} theme={getDefaultTheme(true)} /></I18nProvider>));
    };
    await render('Starting', true);
    const text = host.querySelector('pre')?.firstChild;
    await render('Starting\nSecond line', true);
    expect(host.querySelector('pre')?.firstChild).toBe(text);
    expect(text?.textContent).toBe('Starting\nSecond line');
    await render('Rewritten', true);
    expect(host.querySelector('pre')?.firstChild).toBe(text);
    expect(text?.textContent).toBe('Rewritten');
    await render('Short', true);
    expect(text?.textContent).toBe('Short');
    const final = getToolOutput('shell', '\u001b[32mFinal\u001b[0m', 'stale', 'completed');
    expect(final).toBe('Final');
    await render(final ?? '', false);
    expect(host.querySelector('code')?.textContent).toBe('Final');
    expect(host.querySelector('[aria-label="Copy output"]')).not.toBeNull();
    expect(host.querySelector('code')?.parentElement?.parentElement?.style.getPropertyValue('--md-syntax-foreground'))
        .toBe(getMarkdownSyntaxVars(getDefaultTheme(true))['--md-syntax-foreground']);
    await act(async () => host.querySelector<HTMLButtonElement>('button')?.click());
    expect(await dom.navigator.clipboard.readText()).toBe('Final');
    const failed = getToolOutput('shell', '\u001b[31mFailure\u001b[0m', 'old', 'error');
    await render(failed ?? '', false);
    expect(host.querySelector('code')?.textContent).toBe('Failure');
});

test('parsed multi-file malformed patches preserve separate titles and raw content with explicit action slots', async () => {
    const { ToolDiffEntries } = views;
    const entries = getDiffPatchEntries({ files: [
        { file: '/fixture/first.ts', patch: 'first malformed patch' },
        { file: '/fixture/second.ts', patch: 'second malformed patch' },
    ] }, undefined, (path) => path.replace('/fixture/', ''));
    expect(entries).toHaveLength(2);
    await act(async () => root.render(<ToolDiffEntries entries={entries} mode="unified" theme={getDefaultTheme(true)} renderActions={(entry) => <button>{entry.title}</button>} />));
    expect(host.querySelectorAll('pre')).toHaveLength(2);
    expect(host.textContent).toContain('first malformed patch');
    expect(host.textContent).toContain('second malformed patch');
    expect(host.querySelectorAll('button')).toHaveLength(2);
});

test('oversized diffs keep a bounded plain preview without loading the rich renderer', async () => {
    const { ToolDiffPreview } = views;
    const diff = 'x'.repeat(TOOL_DIFF_PREVIEW_MAX_CHARS + 100);
    await act(async () => root.render(<ToolDiffPreview diff={diff} diffViewMode="side-by-side" theme={getDefaultTheme(true)} />));
    expect(host.querySelector('pre')?.textContent?.length).toBeLessThan(diff.length);
    expect(host.querySelector('pre')?.textContent?.endsWith('…')).toBe(true);
    expect(host.querySelector('pierre-diffs')).toBeNull();
});

test('rich diff accepts an explicit dark palette without application theme context', async () => {
    const { default: ToolPartDiffPreview } = await import('./ToolPartDiffPreview');
    const diff = '--- a/file.ts\n+++ b/file.ts\n@@ -1 +1 @@\n-before\n+after';
    await act(async () => root.render(<ToolPartDiffPreview diff={diff} diffViewMode="unified" theme={getDefaultTheme(true)} />));
    const rendered = host.querySelector('diffs-container');
    expect(rendered).not.toBeNull();
    expect(rendered?.shadowRoot?.innerHTML).toContain('data-diff-type="single"');
    expect(rendered?.shadowRoot?.querySelector('[data-theme-css]')?.textContent).toContain('color-scheme: dark');
    await act(async () => root.render(<ToolPartDiffPreview diff={diff} diffViewMode="unified" theme={getDefaultTheme(false)} />));
    expect(rendered?.shadowRoot?.querySelector('[data-theme-css]')?.textContent).toContain('color-scheme: light');
});
