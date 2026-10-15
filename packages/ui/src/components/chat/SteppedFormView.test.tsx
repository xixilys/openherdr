import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import React, { act } from 'react';
import type { Root } from 'react-dom/client';
import { Window } from 'happy-dom';
import type { FormRequest } from '@/lib/opencode/model';

import { createSteppedFormState, type SteppedFormState } from './steppedFormState';

type FormField = FormRequest['fields'][number];

const DOM_GLOBAL_NAMES = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'localStorage', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'IS_REACT_ACT_ENVIRONMENT'] as const;
const installDom = () => {
  const win = new Window({ url: 'http://localhost' });
  const previous = DOM_GLOBAL_NAMES.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
  const values = { window: win, document: win.document, navigator: win.navigator, Node: win.Node, Element: win.Element,
    HTMLElement: win.HTMLElement, localStorage: win.localStorage, getComputedStyle: win.getComputedStyle.bind(win),
    requestAnimationFrame: win.requestAnimationFrame.bind(win), cancelAnimationFrame: win.cancelAnimationFrame.bind(win), IS_REACT_ACT_ENVIRONMENT: true };
  for (const name of DOM_GLOBAL_NAMES) Object.defineProperty(globalThis, name, { value: values[name], configurable: true, writable: true });
  const container = document.createElement('div');
  document.body.appendChild(container);
  return { container, restore: () => {
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
    void win.happyDOM.close();
  } };
};

const bootstrapDom = installDom();
const { createRoot } = await import('react-dom/client');
const { I18nProvider } = await import('@/lib/i18n');
const { SteppedFormView } = await import('./SteppedFormView');
bootstrapDom.restore();

describe('SteppedFormView', () => {
  let root: Root;
  let dom: ReturnType<typeof installDom>;
  let fields: FormField[];
  let state: SteppedFormState;
  let hidden: boolean;
  let mobile: boolean;
  let beforePassive: (() => void) | undefined;
  const CommitProbe = () => {
    React.useLayoutEffect(() => { const probe = beforePassive; beforePassive = undefined; probe?.(); });
    return null;
  };
  let replies: Parameters<React.ComponentProps<typeof SteppedFormView>['onSubmit']>[0][];
  const change: React.Dispatch<React.SetStateAction<SteppedFormState>> = (next) => {
    state = typeof next === 'function' ? next(state) : next;
    render();
  };
  const render = () => root.render(<I18nProvider><div data-composer-bound>
    <SteppedFormView fields={fields} state={state} onStateChange={change} title="Questions"
      isMobile={mobile} isResponding={false} waiting={1} isFromSubagent={false} hidden={hidden}
      onSubmit={(answer) => { replies.push(answer); }} onDismiss={() => {}} onCopy={() => {}} />
    <CommitProbe />
  </div></I18nProvider>);
  const button = (label: string) => [...dom.container.querySelectorAll('button')].find((item) => item.textContent === label);
  const click = (label: string) => act(async () => { const target = button(label); expect(target).toBeDefined(); target?.click(); });
  const jump = (index: number) => act(async () => { dom.container.querySelectorAll<HTMLButtonElement>('[role="tab"]')[index]?.click(); });
  const key = async (init: KeyboardEventInit = {}) => {
    const textarea = dom.container.querySelector('textarea');
    expect(textarea).not.toBeNull();
    const event = new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...init });
    await act(async () => { textarea?.dispatchEvent(event); });
    return event;
  };
  beforeEach(() => {
    dom = installDom(); root = createRoot(dom.container); fields = []; hidden = false; mobile = false; replies = []; beforePassive = undefined;
  });
  afterEach(async () => { await act(async () => root.unmount()); dom.restore(); });
  const mount = async (next: FormField[]) => { fields = next; state = createSteppedFormState(fields); await act(async () => render()); };

  test('steps, segments, back and gated fields use current answers', async () => {
    await mount([
      { key: 'gate', title: 'Gate', type: 'string', options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] },
      { key: 'detail', title: 'Detail', type: 'string', when: [{ key: 'gate', op: 'eq', value: 'yes' }] },
      { key: 'last', title: 'Last', type: 'string', default: 'done' },
    ]);
    expect(dom.container.querySelectorAll('[role="tab"]')).toHaveLength(2);
    await click('Yes');
    expect(dom.container.querySelectorAll('[role="tab"]')).toHaveLength(3);
    await click('Next'); expect(state.step).toBe(1); expect(dom.container.textContent).toContain('Detail');
    await click('Back'); await click('No');
    expect(dom.container.querySelectorAll('[role="tab"]')).toHaveLength(2);
    await click('Next'); await click('Submit');
    expect(replies).toEqual([{ gate: 'no', last: 'done' }]);
  });

  test('Ctrl+Enter jumps to missing required field and submits exactly once', async () => {
    await mount([{ key: 'required', title: 'Required', type: 'string', required: true }, { key: 'last', type: 'string', default: 'done' }]);
    await jump(1); await key({ ctrlKey: true });
    expect(state.step).toBe(0); expect(state.showErrors).toBe(true); expect(replies).toHaveLength(0);
    const editor = dom.container.querySelector('textarea');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
    expect(setter).toBeDefined();
    await act(async () => {
      setter?.call(editor, 'answer');
      editor?.dispatchEvent(new window.Event('input', { bubbles: true }));
    });
    expect(state.values.required.text).toBe('answer');
    await key({ ctrlKey: true }); expect(replies).toEqual([{ required: 'answer', last: 'done' }]);
  });

  test('external steps acknowledge only when visible and retain mounted editors while hidden', async () => {
    hidden = true;
    await mount([{ key: 'link', type: 'external', url: 'https://example.com' }, { key: 'name', type: 'string', default: 'draft' }]);
    const panel = dom.container.querySelector<HTMLElement>('[role="dialog"]');
    expect(panel?.hidden).toBe(true); expect(state.values.link.acknowledged).toBe(false);
    expect(dom.container.querySelector('[data-composer-bound]')?.hasAttribute('data-floating-panel')).toBe(false);
    hidden = false; await act(async () => render()); expect(state.values.link.acknowledged).toBe(true);
    expect(dom.container.querySelector('[data-composer-bound]')?.hasAttribute('data-floating-panel')).toBe(true);
    await click('Next'); const editor = dom.container.querySelector('textarea');
    hidden = true; await act(async () => render());
    expect(dom.container.querySelector('textarea')).toBe(editor);
    expect(dom.container.querySelector('[data-composer-bound]')?.hasAttribute('data-floating-panel')).toBe(false);
    hidden = false; await act(async () => render());
    expect(dom.container.querySelector('textarea')).toBe(editor); expect(state.values.name.text).toBe('draft');
    await click('Submit'); expect(replies).toEqual([{ link: true, name: 'draft' }]);
  });

  test('desktop Enter advances, mobile Enter and Shift/IME Enter preserve text entry', async () => {
    await mount([{ key: 'first', type: 'string', default: 'a' }, { key: 'last', type: 'string', default: 'b' }]);
    expect((await key({ shiftKey: true })).defaultPrevented).toBe(false); expect(state.step).toBe(0);
    expect((await key({ isComposing: true })).defaultPrevented).toBe(false); expect(state.step).toBe(0);
    mobile = true; await act(async () => render());
    expect((await key()).defaultPrevented).toBe(false); expect(state.step).toBe(0);
    mobile = false; await act(async () => render());
    expect((await key()).defaultPrevented).toBe(true); expect(state.step).toBe(1);
    await key(); expect(replies).toEqual([{ first: 'a', last: 'b' }]);
  });

  test('optional unanswered fields keep the original button and keyboard behavior', async () => {
    await mount([{ key: 'optional', type: 'string' }]);
    expect(button('Submit')?.disabled).toBe(true);
    await key({ metaKey: true }); expect(replies).toEqual([{}]);
  });

  test('a same-id string becoming external acknowledges the new definition without a later reset', async () => {
    await mount([{ key: 'answer', type: 'string', default: 'old answer' }]);
    fields = [{ key: 'answer', type: 'external', url: 'https://example.com/new' }];
    await act(async () => render());
    expect(state.values.answer.text).toBe('');
    expect(state.values.answer.acknowledged).toBe(true);
    expect(button('Submit')?.disabled).toBe(false);
    await click('Submit'); expect(replies).toEqual([{ answer: true }]);
  });

  test('URL changes reset old acknowledgements and collapsed steps wait until expanded', async () => {
    await mount([{ key: 'link', type: 'external', url: 'https://example.com/old' }]);
    expect(state.values.link.acknowledged).toBe(true);
    await act(async () => change((previous) => ({ ...previous, collapsed: true })));
    fields = [{ key: 'link', type: 'external', url: 'https://example.com/new' }];
    await act(async () => render());
    expect(state.collapsed).toBe(true); expect(state.values.link.acknowledged).toBe(false);
    await act(async () => dom.container.querySelector<HTMLButtonElement>('[aria-expanded]')?.click());
    expect(state.values.link.acknowledged).toBe(true);
    hidden = true;
    fields = [{ key: 'link', type: 'external', url: 'https://example.com/hidden' }];
    await act(async () => render()); expect(state.values.link.acknowledged).toBe(false);
    hidden = false; await act(async () => render()); expect(state.values.link.acknowledged).toBe(true);
  });

  test('option and gating definition changes discard previous answers and rebuild steps', async () => {
    await mount([{ key: 'mode', type: 'string', options: [{ value: 'old', label: 'Old' }], default: 'old' }]);
    expect(state.values.mode.selected).toEqual(['old']);
    fields = [{ key: 'mode', type: 'string', options: [{ value: 'new', label: 'New' }], required: true }];
    await act(async () => render());
    expect(state.values.mode.selected).toEqual([]); expect(button('Submit')?.disabled).toBe(true);
    await click('New');
    fields = [...fields, { key: 'extra', type: 'string', required: true, when: [{ key: 'mode', op: 'eq', value: 'new' }] }];
    await act(async () => render());
    expect(state.values.mode.selected).toEqual([]);
    expect(dom.container.querySelectorAll('[role="tab"]')).toHaveLength(1);
  });


  test('a changed external URL cannot submit an old acknowledgement before effects commit', async () => {
    await mount([{ key: 'link', type: 'external', url: 'https://example.com/old' }]);
    expect(state.values.link.acknowledged).toBe(true);
    fields = [{ key: 'link', type: 'external', url: 'https://example.com/new' }];
    beforePassive = () => {
      expect(button('Submit')?.disabled).toBe(true);
      dom.container.querySelector('a')?.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true }));
      expect(replies).toEqual([]);
    };
    await act(async () => render());
    expect(state.values.link.acknowledged).toBe(true);
    expect(button('Submit')?.disabled).toBe(false);
    expect(replies).toEqual([]);
  });

});
