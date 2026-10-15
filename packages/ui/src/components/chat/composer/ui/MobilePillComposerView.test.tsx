import React, { act } from 'react';
import { test, expect } from 'bun:test';
import { Window } from 'happy-dom';
import { I18nProvider } from '@/lib/i18n';
import { MobilePillComposerView, type MobilePillComposerViewProps } from './MobilePillComposerView';

async function mountPill(props: MobilePillComposerViewProps) {
    const dom = new Window({ url: 'https://herdr.test' });
    const globals = {
        window: dom, document: dom.document, navigator: dom.navigator,
        Element: dom.Element, HTMLElement: dom.HTMLElement, HTMLTextAreaElement: dom.HTMLTextAreaElement,
        Node: dom.Node, Event: dom.Event, KeyboardEvent: dom.KeyboardEvent, MouseEvent: dom.MouseEvent, PointerEvent: dom.PointerEvent,
        MutationObserver: dom.MutationObserver, ResizeObserver: dom.ResizeObserver,
        getComputedStyle: dom.getComputedStyle.bind(dom), IS_REACT_ACT_ENVIRONMENT: true,
    };
    const previous = new Map<string, PropertyDescriptor | undefined>();
    for (const [name, value] of Object.entries(globals)) {
        previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
        Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    }
    const originalFetch = globalThis.fetch;
    const requests: string[] = [];
    globalThis.fetch = Object.assign(async (input: RequestInfo | URL) => { requests.push(String(input)); throw new Error('Pure composer must not read a runtime'); }, originalFetch);
    const { createRoot } = await import('react-dom/client');
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const render = () => act(async () => root.render(<I18nProvider><MobilePillComposerView {...props} /></I18nProvider>));
    await render();
    return {
        container, requests, render,
        async close() {
            await act(async () => root.unmount());
            globalThis.fetch = originalFetch;
            dom.happyDOM.cancelAsync();
            for (const [name, descriptor] of previous) {
                if (descriptor) Object.defineProperty(globalThis, name, descriptor);
                else Reflect.deleteProperty(globalThis, name);
            }
        },
    };
}
const noop = () => {};
const preview = { value: 'Actual draft', placeholder: 'Plan, build, or ask', onExpand: noop } as const;

test('standalone preview preserves the original pill and footer without config or runtime requests', async () => {
    let sends = 0;
    let modelChoices = 0;
    let agentChoices = 0;
    const props: MobilePillComposerViewProps = {
        input: preview, isRunning: false, canSend: true, canQueue: false, canAbort: false, onSend: () => { sends++; }, onAbort: noop,
        attachmentControl: <button type="button">Attach</button>,
        topRow: <div data-actual-queue>Actual queued prompt</div>,
        statusRow: <div data-actual-status>Actual activity</div>,
        model: { label: 'Selected model', onChoose: () => { modelChoices++; }, icon: <span data-provider-icon /> },
        agent: { label: 'Build', onChoose: () => { agentChoices++; }, color: 'var(--status-success)' },
    };
    const mounted = await mountPill(props);
    try {
        const pill = mounted.container.querySelector('[data-mobile-composer-pill]');
        expect(pill?.classList.contains('oc-surface-floating')).toBe(true);
        expect(pill?.classList.contains('rounded-[1.5rem]')).toBe(true);
        expect(pill?.textContent).toContain('Actual draft');
        expect(mounted.container.querySelector('textarea')).toBeNull();
        const model = mounted.container.querySelector<HTMLButtonElement>('[title="Selected model"]');
        const agent = mounted.container.querySelector<HTMLButtonElement>('[title="Build"]');
        expect(model?.parentElement?.className).toBe('flex items-center justify-between gap-x-2 px-3.5 pb-2 pt-0.5');
        await act(async () => {
            mounted.container.querySelector<HTMLButtonElement>('[aria-label="Send message"]')?.click();
            model?.click(); agent?.click();
        });
        expect(sends).toBe(1); expect(modelChoices).toBe(1); expect(agentChoices).toBe(1);
        expect(mounted.container.querySelector('[aria-label="Start dictation"]')).toBeNull();
        expect(mounted.container.querySelector('[aria-label="Queue message"]')).toBeNull();
        expect(mounted.requests).toEqual([]);
    } finally { await mounted.close(); }
});

test('running actions expose only supplied queue and abort callbacks', async () => {
    let sends = 0; let queues = 0; let aborts = 0;
    const props: MobilePillComposerViewProps = { input: preview, isRunning: true, canSend: true, canQueue: true, canAbort: true, onSend: () => { sends++; }, onAbort: () => { aborts++; } };
    const mounted = await mountPill(props);
    try {
        expect(mounted.container.querySelector('[aria-label="Queue message"]')).toBeNull();
        expect(mounted.container.querySelector('[aria-label="Send message"]')).toBeNull();
        props.onQueue = () => { queues++; };
        await mounted.render();
        await act(async () => {
            mounted.container.querySelector<HTMLButtonElement>('[aria-label="Queue message"]')?.click();
            mounted.container.querySelector<HTMLButtonElement>('[aria-label="Stop generating"]')?.click();
        });
        expect(queues).toBe(1); expect(aborts).toBe(1); expect(sends).toBe(0);
        expect(mounted.requests).toEqual([]);
    } finally { await mounted.close(); }
});

for (const canQueue of [true, false]) {
    test(`running without abort keeps idle send hidden when canQueue=${canQueue}`, async () => {
        let sends = 0; let queues = 0; let aborts = 0;
        const mounted = await mountPill({
            input: preview, isRunning: true, canSend: true, canQueue, canAbort: false,
            onSend: () => { sends++; }, onQueue: () => { queues++; }, onAbort: () => { aborts++; },
        });
        try {
            expect(mounted.container.querySelector('[aria-label="Send message"]')).toBeNull();
            expect(mounted.container.querySelector('[aria-label="Stop generating"]')).toBeNull();
            const queue = mounted.container.querySelector<HTMLButtonElement>('[aria-label="Queue message"]');
            expect(Boolean(queue)).toBe(canQueue);
            await act(async () => { queue?.click(); });
            expect(queues).toBe(canQueue ? 1 : 0);
            expect(sends).toBe(0); expect(aborts).toBe(0);
            expect(mounted.requests).toEqual([]);
        } finally { await mounted.close(); }
    });
}

test('queue eligibility is independent of idle send eligibility and requires a running turn', async () => {
    let queues = 0; let sends = 0;
    const props: MobilePillComposerViewProps = {
        input: preview, isRunning: true, canSend: false, canQueue: true, canAbort: false,
        onSend: () => { sends++; }, onQueue: () => { queues++; }, onAbort: noop,
    };
    const mounted = await mountPill(props);
    try {
        const queue = mounted.container.querySelector<HTMLButtonElement>('[aria-label="Queue message"]');
        expect(queue).not.toBeNull();
        await act(async () => { queue?.click(); });
        expect(queues).toBe(1);
        props.isRunning = false;
        props.canSend = true;
        await mounted.render();
        expect(mounted.container.querySelector('[aria-label="Queue message"]')).toBeNull();
        await act(async () => { mounted.container.querySelector<HTMLButtonElement>('[aria-label="Send message"]')?.click(); });
        expect(sends).toBe(1);
        expect(mounted.requests).toEqual([]);
    } finally { await mounted.close(); }
});

test('stop prevents touch and mouse focus changes while leaving other pointer defaults intact', async () => {
    let aborts = 0;
    const mounted = await mountPill({
        input: preview, isRunning: true, canSend: false, canQueue: false, canAbort: true,
        onSend: noop, onAbort: () => { aborts++; },
    });
    try {
        const stop = mounted.container.querySelector<HTMLButtonElement>('[aria-label="Stop generating"]');
        if (!stop) throw new Error('Missing stop button');
        const mouse = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
        const touch = new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'touch' });
        const pen = new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'pen' });
        await act(async () => { stop.dispatchEvent(mouse); stop.dispatchEvent(touch); stop.dispatchEvent(pen); stop.click(); });
        expect(mouse.defaultPrevented).toBe(true);
        expect(touch.defaultPrevented).toBe(true);
        expect(pen.defaultPrevented).toBe(false);
        expect(aborts).toBe(1);
    } finally { await mounted.close(); }
});
