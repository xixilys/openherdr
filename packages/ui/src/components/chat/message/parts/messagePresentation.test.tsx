import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import React, { act } from 'react';
import type { Root } from 'react-dom/client';
import { Window } from 'happy-dom';

describe('standalone original message presentation', () => {
    let dom: Window;
    let host: HTMLDivElement;
    let root: Root;
    let restore: () => void;
    let requests: string[];
    let I18nProvider: typeof import('@/lib/i18n')['I18nProvider'];
    let UserMessageBubble: typeof import('./UserMessagePresentation')['UserMessageBubble'];
    let UserTextView: typeof import('./UserMessagePresentation')['UserTextView'];
    let ToolSummaryView: typeof import('./ToolSummaryView')['ToolSummaryView'];

    beforeEach(async () => {
        dom = new Window({ url: 'https://localhost/' });
        const globals = { window: dom, document: dom.document, navigator: dom.navigator, localStorage: dom.localStorage, sessionStorage: dom.sessionStorage,
            HTMLElement: dom.HTMLElement, KeyboardEvent: dom.KeyboardEvent, Element: dom.Element, Node: dom.Node, MutationObserver: dom.MutationObserver, ResizeObserver: dom.ResizeObserver,
            requestAnimationFrame: dom.requestAnimationFrame.bind(dom), cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom), IS_REACT_ACT_ENVIRONMENT: true };
        const descriptors = Object.getOwnPropertyDescriptors(globalThis);
        for (const [name, value] of Object.entries(globals)) Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
        requests = [];
        const savedFetch = globalThis.fetch;
        globalThis.fetch = Object.assign(async (input: string | URL | Request) => { requests.push(String(input)); return Response.json({}, { status: 503 }); }, savedFetch);
        restore = () => {
            globalThis.fetch = savedFetch;
            for (const name of Object.keys(globals)) {
                const descriptor = descriptors[name];
                if (descriptor) Object.defineProperty(globalThis, name, descriptor);
                else Reflect.deleteProperty(globalThis, name);
            }
        };
        ({ I18nProvider } = await import('@/lib/i18n'));
        ({ UserMessageBubble, UserTextView } = await import('./UserMessagePresentation'));
        ({ ToolSummaryView } = await import('./ToolSummaryView'));
        const { createRoot } = await import('react-dom/client');
        host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
    });
    afterEach(async () => { await act(async () => root.unmount()); await dom.happyDOM.close(); expect(requests).toEqual([]); restore(); });

    test('pure imports and user bubble reuse the original end alignment, width and footer placement', async () => {
        await act(async () => root.render(<I18nProvider><UserMessageBubble footer={<button>Message actions</button>}><UserTextView text="Source text" expanded={false} onToggle={() => undefined} /></UserMessageBubble></I18nProvider>));
        const bubble = host.querySelector<HTMLElement>('[data-user-message-bubble]');
        expect(bubble?.className).toBe('px-5 py-3 shadow-none border border-primary/5');
        expect(bubble?.style.backgroundColor).toBe('var(--chat-user-message-bg)');
        expect(bubble?.parentElement?.className).toBe('max-w-[85%]');
        expect(bubble?.parentElement?.parentElement?.className).toBe('relative flex flex-col items-end');
        expect(bubble?.contains(host.querySelector('button'))).toBe(false);
        expect(host.textContent).toBe('Source textMessage actions');
    });

    test('overflow expands on tap and the original show-less control restores the two-line clamp', async () => {
        const truncations: boolean[] = [];
        const Harness = () => {
            const [expanded, setExpanded] = React.useState(false);
            return <UserTextView text={'A source message with several lines. '.repeat(8)} expanded={expanded} onToggle={() => setExpanded((value) => !value)} onTruncationChange={(value) => truncations.push(value)} />;
        };
        await act(async () => root.render(<I18nProvider><Harness /></I18nProvider>));
        const text = host.querySelector<HTMLDivElement>('.line-clamp-2'); expect(text).not.toBeNull();
        if (!text) throw new Error('Missing collapsed user text');
        Object.defineProperties(text, { scrollHeight: { configurable: true, value: 120 }, clientHeight: { configurable: true, value: 40 } });
        await act(async () => text.click());
        expect(text.classList.contains('line-clamp-2')).toBe(false);
        expect(host.querySelector('button')?.textContent).toBe('Show less');
        expect(truncations).toContain(true);
        await act(async () => host.querySelector('button')?.click());
        expect(text.classList.contains('line-clamp-2')).toBe(true);
        expect(host.querySelector('button')?.getAttribute('aria-expanded')).toBe('false');
        await act(async () => root.render(null)); expect(truncations.at(-1)).toBe(false);
    });

    test('selection and source-owned inline actions do not expand a clipped message', async () => {
        let toggles = 0;
        await act(async () => root.render(<I18nProvider><UserTextView text="Select this source text" expanded={false} onToggle={() => { toggles += 1; }} /></I18nProvider>));
        const text = host.querySelector<HTMLDivElement>('.line-clamp-2');
        if (!text?.firstChild) throw new Error('Missing source text');
        Object.defineProperties(text, { scrollHeight: { configurable: true, value: 100 }, clientHeight: { configurable: true, value: 40 } });
        const range = document.createRange(); range.selectNodeContents(text); window.getSelection()?.addRange(range);
        await act(async () => text.click()); expect(toggles).toBe(0);
        window.getSelection()?.removeAllRanges();
        await act(async () => root.render(<I18nProvider><UserTextView text="Select this source text" expanded={false} onToggle={() => { toggles += 1; }} onTextClick={(event) => event.preventDefault()} /></I18nProvider>));
        await act(async () => text.click()); expect(toggles).toBe(0);
    });

    test('source-prepared content and message-level toggle ownership remain available', async () => {
        await act(async () => root.render(<I18nProvider><UserTextView text="Source metadata" expanded collapsible showToggle={false} onToggle={() => undefined}><strong>Prepared skill and attachment text</strong></UserTextView></I18nProvider>));
        expect(host.querySelector('strong')?.textContent).toBe('Prepared skill and attachment text');
        expect(host.textContent).not.toContain('Source metadata'); expect(host.querySelector('button')).toBeNull();
    });

    test('compact tool rows toggle genuine details with click, keyboard and the connector', async () => {
        const Harness = () => {
            const [expanded, setExpanded] = React.useState(false);
            return <ToolSummaryView title="Read" icon={<span>R</span>} summary="actual.ts" status="completed" startedAt={100} endedAt={1100} expanded={expanded} onToggle={() => setExpanded((value) => !value)}><pre>Actual source output</pre></ToolSummaryView>;
        };
        await act(async () => root.render(<Harness />));
        const row = host.querySelector<HTMLDivElement>('[role="button"]'); if (!row) throw new Error('Missing tool row');
        expect(row.className).toBe('group/tool flex gap-1.5 pe-2 ps-px py-1.5 rounded-xl items-center cursor-pointer');
        expect(row.textContent).toContain('1.0s'); expect(host.querySelector('pre')).toBeNull();
        await act(async () => row.click());
        expect(host.querySelector('pre')?.textContent).toBe('Actual source output'); expect(row.getAttribute('aria-expanded')).toBe('true');
        await act(async () => row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })));
        expect(host.querySelector('pre')).toBeNull(); expect(row.getAttribute('aria-expanded')).toBe('false');
        await act(async () => row.click());
        const connector = host.querySelector<HTMLElement>('span[aria-hidden="true"].absolute'); if (!connector) throw new Error('Missing tool connector');
        await act(async () => connector.click()); expect(host.querySelector('pre')).toBeNull();
    });

    test('editor activation stays separate from expansion and nested actions keep their own keyboard events', async () => {
        let opens = 0; let toggles = 0; let actions = 0;
        await act(async () => root.render(<ToolSummaryView title="Edit" icon={<span>E</span>} summary="actual.ts" status="error" expanded={false} onToggle={() => { toggles += 1; }} onActivate={() => { opens += 1; }} titleActions={<button onClick={(event) => { event.stopPropagation(); actions += 1; }}>Open file</button>} />));
        const row = host.querySelector<HTMLDivElement>('[role="button"]'); if (!row) throw new Error('Missing tool row');
        await act(async () => row.click()); expect(opens).toBe(1); expect(toggles).toBe(0);
        const nested = row.querySelector('button'); if (!nested) throw new Error('Missing source action');
        const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
        await act(async () => nested.dispatchEvent(enter)); expect(enter.defaultPrevented).toBe(false); expect(opens).toBe(1);
        await act(async () => nested.click()); expect(actions).toBe(1); expect(opens).toBe(1);
        const icon = row.firstElementChild?.firstElementChild; if (!(icon instanceof HTMLElement)) throw new Error('Missing expansion icon');
        await act(async () => icon.click()); expect(toggles).toBe(1); expect(opens).toBe(1);
    });

    test('the original owner can retain a closing detail body and its animation ref', async () => {
        const contentRef = React.createRef<HTMLDivElement>();
        await act(async () => root.render(<ToolSummaryView title="Shell" icon={<span>S</span>} status="completed" expanded={false} onToggle={() => undefined} renderExpandedContent expandedContentRef={contentRef}><pre>Retained closing output</pre></ToolSummaryView>));
        expect(contentRef.current?.getAttribute('aria-hidden')).toBe('true'); expect(contentRef.current?.style.height).toBe('0px');
        expect(contentRef.current?.querySelector('pre')?.textContent).toBe('Retained closing output');
    });
});
