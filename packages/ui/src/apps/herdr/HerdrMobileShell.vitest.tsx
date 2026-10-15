import React, { act } from 'react';
import { expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { I18nProvider, useI18nStore } from '@/lib/i18n';
import { HerdrMobileShell } from './HerdrMobileShell';
import type { HerdrMobileShellProps } from './types';

const installDom = () => {
  const dom = new Window({ url: 'https://herdr.test' });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  const globals = {
    window: dom, document: dom.document, navigator: dom.navigator, location: dom.location,
    Element: dom.Element, HTMLElement: dom.HTMLElement, Node: dom.Node,
    Event: dom.Event, CustomEvent: dom.CustomEvent, MutationObserver: dom.MutationObserver,
    ResizeObserver: dom.ResizeObserver, getComputedStyle: dom.getComputedStyle.bind(dom),
    requestAnimationFrame: dom.requestAnimationFrame.bind(dom), cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom),
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  for (const [name, value] of Object.entries(globals)) {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  return () => {
    dom.happyDOM.cancelAsync();
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  };
};
const noop = () => {};
for (const locale of ['en', 'ar'] as const) {
  test(`${locale} chat edges open the corresponding drawer and close its sibling`, async () => {
    const restoreDom = installDom();
    const initialLocale = useI18nStore.getState().locale;
    useI18nStore.setState({ locale });
    const { createRoot } = await import('react-dom/client');
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const calls: string[] = [];
    const props: HerdrMobileShellProps = {
      target: { machine: 'local', workspaceId: 'w1', tabId: 'w1:t1', paneId: 'w1:p1', available: true },
      workspaces: [], sessions: [], header: { title: 'Example' }, sessionsOpen: false, workspaceOpen: false,
      onSessionsOpenChange: open => calls.push(`sessions:${open}`), onWorkspaceOpenChange: open => calls.push(`workspace:${open}`),
      onOpenSessions: () => calls.push('sessions:open'), onOpenWorkspace: () => calls.push('workspace:open'),
      onSelectWorkspace: noop, onSelectSession: noop, workspaceTab: 'files', onWorkspaceTabChange: noop, workspacePanels: [],
      actions: { openChanges: noop, openFiles: noop, openSettings: noop, openSourceBoard: noop },
      fullscreen: null, overlay: null, children: <p>Chat</p>,
    };
    const render = async () => act(async () => root.render(<I18nProvider><HerdrMobileShell {...props} /></I18nProvider>));
    const swipe = (start: number, end: number) => {
      const main = host.querySelector('main');
      if (!main) throw new Error('Chat main is missing');
      Object.defineProperty(main, 'clientWidth', { configurable: true, value: 390 });
      for (const [type, x] of [['touchstart', start], ['touchend', end]] as const) {
        const point = { clientX: x, clientY: 100 };
        main.dispatchEvent(Object.assign(new Event(type, { bubbles: true }), { touches: type === 'touchstart' ? [point] : [], changedTouches: [point] }));
      }
    };
    try {
      await render();
      swipe(20, 140);
      expect(calls).toEqual(locale === 'en' ? ['workspace:false', 'sessions:open'] : ['sessions:false', 'workspace:open']);
      calls.length = 0;
      swipe(370, 250);
      expect(calls).toEqual(locale === 'en' ? ['sessions:false', 'workspace:open'] : ['workspace:false', 'sessions:open']);
      calls.length = 0;
      props.sessionsOpen = true;
      await render();
      swipe(20, 140);
      expect(calls).toEqual([]);
    } finally {
      await act(async () => root.unmount());
      useI18nStore.setState({ locale: initialLocale });
      restoreDom();
    }
  });
}

test('the header title opens its controller popup independently from the target drawer', async () => {
  const restoreDom = installDom();
  const { createRoot } = await import('react-dom/client');
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const calls: string[] = [];
  const titleRef = React.createRef<HTMLButtonElement>();
  const props: HerdrMobileShellProps = {
    target: { machine: 'local', workspaceId: 'w1', tabId: 'w1:t1', paneId: 'w1:p1', available: true },
    workspaces: [], sessions: [], header: { title: 'Actual conversation', titleButtonRef: titleRef, titleExpanded: true, onTitleClick: () => calls.push('title') },
    headerPopover: <div data-title-popup="true">Conversation history</div>,
    sessionsOpen: false, workspaceOpen: false,
    onSessionsOpenChange: noop, onWorkspaceOpenChange: noop,
    onOpenSessions: () => calls.push('targets'), onOpenWorkspace: () => calls.push('workspace'),
    onSelectWorkspace: noop, onSelectSession: noop, workspaceTab: 'files', onWorkspaceTabChange: noop, workspacePanels: [],
    actions: { openChanges: noop, openFiles: noop, openSettings: noop, openSourceBoard: noop },
    fullscreen: null, overlay: null, children: <p>Chat</p>,
  };
  const render = () => act(async () => root.render(<I18nProvider><HerdrMobileShell {...props} /></I18nProvider>));
  try {
    await render();
    const buttons = host.querySelectorAll<HTMLButtonElement>('header button');
    expect(titleRef.current).toBe(buttons[1]);
    expect(titleRef.current?.getAttribute('aria-expanded')).toBe('true');
    await act(async () => { buttons[0].click(); buttons[1].click(); buttons[2].click(); });
    expect(calls).toEqual(['targets', 'title', 'workspace']);
    expect(host.querySelector('header')?.nextElementSibling?.getAttribute('data-title-popup')).toBe('true');
    props.header = { title: 'Legacy target' };
    props.headerPopover = undefined;
    await render();
    await act(async () => host.querySelectorAll<HTMLButtonElement>('header button')[1].click());
    expect(calls).toEqual(['targets', 'title', 'workspace', 'targets']);
    expect(host.querySelector('[data-title-popup]')).toBeNull();
  } finally {
    await act(async () => root.unmount());
    host.remove();
    restoreDom();
  }
});
