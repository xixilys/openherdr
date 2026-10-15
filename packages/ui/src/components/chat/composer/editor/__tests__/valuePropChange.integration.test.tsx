import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ComposerEditor, type ComposerChange, type ComposerEditorHandle } from '../ComposerEditor';
import { createComposerEditorViewStore } from '../viewStore';
import type { ComposerLanguageContext } from '../../language/tokenize';

const languageContext: ComposerLanguageContext = {
    inputMode: 'normal', knownAgentNames: new Set(), confirmedMentions: new Set(),
    knownSlashNames: new Set(), knownSnippetTriggers: new Set(), attachmentFilenames: [],
};

// The git conflict prompt ends with the `# Conflicts:` lines git writes into
// MERGE_MSG; its last line is a `#` token at the caret.
const conflictPrompt = "Preserve the intent of changes from MERGE_HEAD\n\n# Conflicts:\n#\tnotes.txt";

describe('composer change reports text set through the value prop', () => {
    let browser: Window;
    let root: Root;
    let host: HTMLDivElement;
    let descriptors: Map<string, PropertyDescriptor | undefined>;
    let changes: ComposerChange[];
    const editor = React.createRef<ComposerEditorHandle>();

    const render = (value: string) => act(async () => root.render(
        <ComposerEditor ref={editor} value={value} languageContext={languageContext}
            onChange={(change) => { changes.push(change); }} />,
    ));

    beforeEach(async () => {
        browser = new Window();
        const globals = {
            window: browser, document: browser.document, navigator: browser.navigator,
            HTMLElement: browser.HTMLElement, Element: browser.Element, Node: browser.Node,
            MutationObserver: browser.MutationObserver, ResizeObserver: browser.ResizeObserver,
            requestAnimationFrame: browser.requestAnimationFrame.bind(browser),
            cancelAnimationFrame: browser.cancelAnimationFrame.bind(browser),
            getComputedStyle: browser.getComputedStyle.bind(browser), IS_REACT_ACT_ENVIRONMENT: true,
        };
        descriptors = new Map(Object.keys(globals).map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
        for (const [name, value] of Object.entries(globals)) Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
        host = document.createElement('div'); document.body.append(host); root = createRoot(host);
        changes = [];
        await render('');
    });

    afterEach(async () => {
        await act(async () => root.unmount()); browser.close();
        for (const [name, descriptor] of descriptors) {
            if (descriptor) Object.defineProperty(globalThis, name, descriptor);
            else Reflect.deleteProperty(globalThis, name);
        }
    });

    test('a prompt handed in through value is marked as set by the app', async () => {
        await render(conflictPrompt);
        expect(changes).toHaveLength(1);
        expect(changes[0]).toMatchObject({ value: conflictPrompt, fromValueProp: true });
    });

    test('text inserted at the caret is not marked', async () => {
        await render(conflictPrompt);
        await act(async () => editor.current?.insertText('\n#'));
        expect(changes).toHaveLength(2);
        expect(changes[1]).toMatchObject({ value: `${conflictPrompt}\n#`, fromValueProp: false });
    });
    test('a translated label updates the live and retained editor without replacing text or selection', async () => {
        const store = createComposerEditorViewStore();
        const show = (label?: string, visible = true) => act(async () => root.render(visible
            ? <ComposerEditor ref={editor} viewStore={store} value="Unsent draft" languageContext={languageContext}
                aria-label={label} onChange={() => {}} />
            : null));
        try {
            await act(async () => root.render(null));
            await show('اسأل الوكيل');
            const content = host.querySelector('.cm-content');
            await act(async () => { editor.current?.setSelection(3); editor.current?.focus(); });
            await show('Ask the agent');
            expect(host.querySelector('.cm-content') === content).toBe(true);
            expect(content?.getAttribute('aria-label')).toBe('Ask the agent');
            expect(content?.getAttribute('role')).toBe('textbox');
            expect(content?.getAttribute('aria-multiline')).toBe('true');
            expect(editor.current?.getValue()).toBe('Unsent draft');
            expect(editor.current?.getSelection()).toEqual({ start: 3, end: 3 });
            await show(undefined);
            expect(content?.hasAttribute('aria-label')).toBe(false);
            await show(undefined, false);
            await show('Ask the agent again');
            expect(host.querySelector('.cm-content') === content).toBe(true);
            expect(content?.getAttribute('aria-label')).toBe('Ask the agent again');
            expect(editor.current?.getSelection()).toEqual({ start: 3, end: 3 });
        } finally {
            await show(undefined, false);
            store.view?.destroy();
        }
    });

});
