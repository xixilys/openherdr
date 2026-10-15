import { test } from 'bun:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Window } from 'happy-dom';
import type { Part } from '@/lib/opencode/model';
import type { MarkdownPresentationSource } from './MarkdownPresentationContext';

test('standalone chat imports and real Markdown render without OpenCode bootstrap requests', async () => {
  const dom = new Window({ url: 'https://localhost/' });
  dom.document.write('<!doctype html><html><body></body></html>');
  const globals = {
    window: dom, document: dom.document, navigator: dom.navigator,
    localStorage: dom.localStorage, sessionStorage: dom.sessionStorage,
    Node: dom.Node, NodeList: dom.NodeList, SVGElement: dom.SVGElement, NodeFilter: dom.NodeFilter, Element: dom.Element,
    HTMLElement: dom.HTMLElement, HTMLAnchorElement: dom.HTMLAnchorElement, HTMLButtonElement: dom.HTMLButtonElement, HTMLImageElement: dom.HTMLImageElement, HTMLTableElement: dom.HTMLTableElement, HTMLTableCellElement: dom.HTMLTableCellElement, HTMLTableRowElement: dom.HTMLTableRowElement, HTMLInputElement: dom.HTMLInputElement,
    Document: dom.Document, DocumentFragment: dom.DocumentFragment,
    ShadowRoot: dom.ShadowRoot, MutationObserver: dom.MutationObserver,
    ResizeObserver: dom.ResizeObserver, customElements: dom.customElements, CSSStyleSheet: dom.CSSStyleSheet, CustomEvent: dom.CustomEvent,
    requestAnimationFrame: dom.requestAnimationFrame.bind(dom),
    cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom),
    getComputedStyle: dom.getComputedStyle.bind(dom), IS_REACT_ACT_ENVIRONMENT: true,
  };
  const descriptors = Object.getOwnPropertyDescriptors(globalThis);
  for (const [name, value] of Object.entries(globals)) Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  const requests: string[] = [];
  const savedFetch = globalThis.fetch;
  globalThis.fetch = Object.assign(async (input: string | URL | Request) => {
    requests.push(new URL(input instanceof Request ? input.url : input, 'https://localhost').pathname);
    return Response.json({ error: 'This fixture has no OpenCode server' }, { status: 503 });
  }, savedFetch);
  const host = document.createElement('div'); document.body.appendChild(host);
  const root = createRoot(host);
  try {
    const { I18nProvider } = await import('@/lib/i18n');
    const { MarkdownPresentationContext } = await import('./MarkdownPresentationContext');
    const { default: AssistantTextPart } = await import('./message/parts/AssistantTextPart');
    const { ReasoningTimelineBlock } = await import('./message/parts/ReasoningPart');
    const { SimpleMarkdownRenderer } = await import('./MarkdownRenderer');
    const { JsonSummaryView } = await import('./message/parts/JsonSummaryView');
    const { ComposerAttachmentControls } = await import('./composer/ui/ComposerAttachmentControls');
    const { getDefaultTheme } = await import('@/lib/theme/themes');
    await new Promise((resolve) => setTimeout(resolve, 650));
    assert.equal(requests.length, 0, 'importing standalone presentation must not start an OpenCode runtime');
    const links: string[] = [];
    const selectedTheme = structuredClone(getDefaultTheme(false));
    selectedTheme.colors.syntax.base.keyword = '#123456';
    const source: MarkdownPresentationSource = {
      directory: '/fixture', runtimeKey: 'https://fixture.example', themeMode: 'light', theme: selectedTheme,
      isVSCode: false, fileReferences: false, inlineImages: false, ownOrigins: ['https://fixture.example'],
      openExternalLink: (url) => { links.push(url); },
    };
    const part = (id: string, text: string): Part => ({ id, sessionID: 'ses_fixture', messageID: id, type: 'text', text, time: { start: 100, end: 200 } });
    const renderFixture = (expand = false) => (
      <I18nProvider><MarkdownPresentationContext.Provider value={source}>
        <AssistantTextPart part={part('answer', '**Original answer**\n\n- First item\n- Second item\n\n[Source](https://example.com/reference)\n\n```text\nactual code\n```')} messageId="answer" streamPhase="completed" />
        <ReasoningTimelineBlock blockId="reasoning" text="Reasoning **details**" time={{ start: 100, end: 200 }} defaultExpanded />
        <ReasoningTimelineBlock blockId="live-preference" text="Live reasoning details" isStreaming expandWhileStreaming={expand} />
        <section data-tool-fixture><JsonSummaryView data={{ path: 'actual.ts' }} /><SimpleMarkdownRenderer content="Tool **output**" variant="tool" /></section>
        <AssistantTextPart part={part('commit', '{"subject":"Keep history","highlights":["Preserve pages"]}')} messageId="commit" streamPhase="completed" />
        <AssistantTextPart part={part('request', '{"title":"Retain state","body":"Opening Files keeps the timeline."}')} messageId="request" streamPhase="completed" />
        <ComposerAttachmentControls isVSCode={false} filesOnly footerIconButtonClass="" iconSizeClass="size-4" handlePickLocalFiles={() => undefined} openGitHubPicker={() => undefined} />
      </MarkdownPresentationContext.Provider></I18nProvider>
    );
    await act(async () => root.render(renderFixture()));
    for (let attempt = 0; attempt < 50 && host.querySelectorAll('[data-markdown-content] strong').length < 3; attempt += 1) {
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 40)); });
    }
    assert.equal(host.querySelector('strong')?.textContent, 'Original answer');
    assert.equal(host.querySelector<HTMLElement>('[data-markdown-content]')?.style.getPropertyValue('--md-syntax-keyword'), '#123456', 'the selected host theme supplies Markdown syntax colors');
    assert.equal(host.querySelectorAll('li').length, 3, 'Markdown list and generated commit highlights render');
    assert.equal(host.querySelector('pre code')?.textContent?.trim(), 'actual code');
    assert(host.querySelector('[data-tool-fixture] strong')?.textContent === 'output');
    assert(host.textContent?.includes('Reasoning details'));
    assert.equal(host.querySelectorAll('[data-component="generated-json-result"]').length, 2);
    assert(host.textContent?.includes('Opening Files keeps the timeline.'));
    const link = host.querySelector<HTMLAnchorElement>('a[href="https://example.com/reference"]');
    assert(link); await act(async () => link.click());
    assert.deepEqual(links, ['https://example.com/reference']);
    assert.equal(host.querySelector('[data-reasoning-block-id="live-preference"] [aria-expanded]')?.getAttribute('aria-expanded'), 'false');
    await act(async () => root.render(renderFixture(true)));
    assert.equal(host.querySelector('[data-reasoning-block-id="live-preference"] [aria-expanded]')?.getAttribute('aria-expanded'), 'true', 'changing the preference expands the live reasoning block');
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 650)); });
    assert.equal(requests.length, 0, 'real Markdown, reasoning, tool output and generated cards must stay with the explicit source');
    await act(async () => root.unmount());

    // Positive control: the original container still resolves its own OpenCode runtime.
    await import('./OpenCodeMarkdownSource');
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert(requests.includes('/api/fs/home'), 'the request recorder detects the original runtime bootstrap');
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
