import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Window } from 'happy-dom';
import { I18nProvider } from '@/lib/i18n';
import type { Part } from '@/lib/opencode/model';
import { MarkdownPresentationContext, type MarkdownPresentationSource } from '../../MarkdownPresentationContext';
import AssistantTextPart from './AssistantTextPart';

const source: MarkdownPresentationSource = {
  directory: '/fixture', runtimeKey: 'https://fixture.example', isVSCode: false,
  fileReferences: false, inlineImages: false, ownOrigins: ['https://fixture.example'],
  openExternalLink: () => undefined,
};

describe('generated assistant results with an explicit presentation source', () => {
  let dom: Window;
  let root: Root;
  let host: HTMLDivElement;
  let restore: () => void;

  beforeEach(() => {
    dom = new Window({ url: 'https://fixture.example/' });
    const globals = { window: dom, document: dom.document, navigator: dom.navigator, IS_REACT_ACT_ENVIRONMENT: true };
    const descriptors = Object.getOwnPropertyDescriptors(globalThis);
    for (const [name, value] of Object.entries(globals)) Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
    restore = () => {
      for (const name of Object.keys(globals)) {
        const descriptor = descriptors[name];
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else Reflect.deleteProperty(globalThis, name);
      }
    };
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  });
  afterEach(async () => { await act(async () => root.unmount()); await dom.happyDOM.close(); restore(); });

  const render = async (text: string) => {
    const part: Part = { id: 'part_fixture', sessionID: 'ses_fixture', messageID: 'msg_fixture', type: 'text', text, time: { start: 100, end: 200 } };
    await act(async () => root.render(
      <I18nProvider><MarkdownPresentationContext.Provider value={source}>
        <AssistantTextPart part={part} messageId="msg_fixture" streamPhase="completed" />
      </MarkdownPresentationContext.Provider></I18nProvider>,
    ));
    const card = host.querySelector('[data-component="generated-json-result"]');
    expect(card).not.toBeNull();
    return card;
  };

  test('finalized commit JSON renders its subject and highlights without session providers', async () => {
    const card = await render(JSON.stringify({ subject: 'Keep pane history', highlights: ['Preserve paged messages', 'Keep scroll position'] }));
    expect(card?.textContent).toContain('Keep pane history');
    expect(card?.textContent).toContain('Preserve paged messages');
    const copy = card?.querySelector('button'); expect(copy).not.toBeNull();
    await act(async () => copy?.click());
    expect(await dom.navigator.clipboard.readText()).toBe('Keep pane history\n- Preserve paged messages\n- Keep scroll position');
  });

  test('finalized change-request JSON keeps the generic card title, body and copy action', async () => {
    const card = await render(JSON.stringify({ title: 'Retain conversation state', body: 'Opening Files preserves the loaded timeline.' }));
    expect(card?.textContent).toContain('Generated pull request');
    expect(card?.textContent).toContain('Retain conversation state');
    expect(card?.querySelector('pre')?.textContent).toBe('Opening Files preserves the loaded timeline.');
    const copy = card?.querySelector('button'); expect(copy).not.toBeNull();
    await act(async () => copy?.click());
    expect(await dom.navigator.clipboard.readText()).toBe('Retain conversation state\n\nOpening Files preserves the loaded timeline.');
  });
});
