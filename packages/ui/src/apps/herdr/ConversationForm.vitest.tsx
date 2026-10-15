import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import React, { act } from 'react';
import type { Root } from 'react-dom/client';
import { Window } from 'happy-dom';
import type { ConversationForm as DriverForm } from '@/lib/opencode/herdr-driver';
import type { HerdrJsonValue } from '../../../../web/src/herdr/transport';

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
const { ConversationForm } = await import('../../../../web/src/herdr/ConversationForm');
bootstrapDom.restore();

let sequence = 0;
describe('Herdr ConversationForm draft ownership', () => {
  let root: Root;
  let dom: ReturnType<typeof installDom>;
  let form: DriverForm;
  let owner: string;
  let hidden: boolean;
  let disabled: boolean;
  let mounted: boolean;
  let replies: HerdrJsonValue[];
  let cancels: number;
  let notices: string[];
  let reply: (answer: HerdrJsonValue) => Promise<boolean>;
  let cancel: () => Promise<boolean>;
  const render = () => root.render(<I18nProvider><div data-composer-bound>{mounted && <ConversationForm
    form={form} owner={owner} hidden={hidden} waiting={0} isMobile={true} disabled={disabled}
    onReply={reply} onCancel={cancel} onNotice={(message) => notices.push(message)} />}</div></I18nProvider>);
  const refresh = () => act(async () => render());
  const button = (label: string) => [...dom.container.querySelectorAll('button')].find((item) => item.textContent === label);
  const click = (label: string) => act(async () => { const target = button(label); expect(target).toBeDefined(); target?.click(); });
  const fill = async (text: string) => {
    const editor = dom.container.querySelector('textarea');
    expect(editor).not.toBeNull();
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
    await act(async () => { setter?.call(editor, text); editor?.dispatchEvent(new window.Event('input', { bubbles: true })); });
  };
  const value = () => dom.container.querySelector('textarea')?.value;
  const remount = async () => { mounted = false; await refresh(); mounted = true; await refresh(); };
  beforeEach(async () => {
    dom = installDom(); root = createRoot(dom.container); owner = `owner-${++sequence}`;
    form = { id: 'form-1', sessionID: 'session-1', title: 'Question', fields: [{ key: 'answer', type: 'string', required: true }] };
    hidden = false; disabled = false; mounted = true; replies = []; cancels = 0; notices = [];
    reply = async (answer) => { replies.push(answer); return false; };
    cancel = async () => { cancels += 1; return false; };
    await refresh();
  });
  afterEach(async () => { await act(async () => root.unmount()); dom.restore(); });

  test('owner and session switches preserve independent drafts and hidden editor identity', async () => {
    const firstOwner = owner;
    await fill('first owner'); owner = `${firstOwner}-second`; await refresh(); expect(value()).toBe('');
    await fill('second owner'); owner = firstOwner; await refresh(); expect(value()).toBe('first owner');
    form = { ...form, sessionID: 'session-2' }; await refresh(); expect(value()).toBe('');
    await fill('second session'); form = { ...form, sessionID: 'session-1' }; await refresh(); expect(value()).toBe('first owner');
    const editor = dom.container.querySelector('textarea'); hidden = true; await refresh();
    expect(dom.container.querySelector('textarea')).toBe(editor);
    hidden = false; await refresh(); expect(value()).toBe('first owner');
    await remount(); expect(value()).toBe('first owner');
  });

  test('failed replies and cancellations retain drafts, confirmed success clears them', async () => {
    await fill('retain reply'); await click('Submit'); expect(replies).toEqual([{ answer: 'retain reply' }]);
    await remount(); expect(value()).toBe('retain reply');
    await click('Dismiss'); expect(cancels).toBe(1); await remount(); expect(value()).toBe('retain reply');
    reply = async (answer) => { replies.push(answer); return true; }; await refresh(); await click('Submit');
    expect(dom.container.querySelector('[role="dialog"]')).toBeNull();
    await remount(); expect(value()).toBe('');
    await fill('cancel draft'); cancel = async () => true; await refresh(); await click('Dismiss');
    expect(dom.container.querySelector('[role="dialog"]')).toBeNull(); await remount(); expect(value()).toBe('');
  });

  test('a late confirmation for a departed owner cannot clear the current owner draft', async () => {
    let resolveReply: (success: boolean) => void = () => { throw new Error('Reply was not started'); };
    reply = () => new Promise<boolean>((resolve) => { resolveReply = resolve; });
    await refresh(); await fill('departed'); await click('Submit');
    owner = `${owner}-current`; await refresh(); await fill('current draft');
    await act(async () => resolveReply(true));
    expect(value()).toBe('current draft'); await remount(); expect(value()).toBe('current draft');
  });

  test('field type, link URL and option changes discard stale answers and acknowledgements', async () => {
    await fill('old answer');
    form = { ...form, fields: [{ key: 'answer', type: 'external', url: 'https://example.com/first' }] };
    await refresh(); expect(button('Submit')?.disabled).toBe(false);
    await click('Submit'); expect(replies).toEqual([{ answer: true }]);
    hidden = true; form = { ...form, fields: [{ key: 'answer', type: 'external', url: 'https://example.com/second' }] };
    await refresh(); expect(button('Submit')?.disabled).toBe(true);
    hidden = false; await refresh(); expect(button('Submit')?.disabled).toBe(false);
    form = { ...form, fields: [{ key: 'answer', type: 'string', options: [{ value: 'old', label: 'Old' }], default: 'old' }] };
    await refresh(); expect(button('Submit')?.disabled).toBe(false);
    form = { ...form, fields: [{ key: 'answer', type: 'string', options: [{ value: 'new', label: 'New' }] }] };
    await refresh(); expect(button('Submit')?.disabled).toBe(true);
    await click('New'); await click('Submit'); expect(replies.at(-1)).toEqual({ answer: 'new' });
  });

  test('disabled form blocks both buttons and keyboard replies', async () => {
    await fill('ready'); disabled = true; await refresh();
    expect(button('Submit')?.disabled).toBe(true); expect(button('Dismiss')?.disabled).toBe(true);
    expect(button('Submit')?.querySelector('.animate-spin')).toBe(null);
    await click('Submit'); await click('Dismiss');
    await act(async () => { dom.container.querySelector('textarea')?.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true })); });
    expect(replies).toEqual([]); expect(cancels).toBe(0);
  });

  test('thrown reply retains the draft and reports the existing failure notice', async () => {
    reply = async () => { throw new Error('fixture failure'); }; await refresh();
    await fill('retry'); await click('Submit'); expect(notices).toContain('Could not submit the answer');
    await remount(); expect(value()).toBe('retry');
  });

  test('a late reply for an old field definition preserves the replacement draft', async () => {
    let resolveReply: (success: boolean) => void = () => { throw new Error('Reply was not started'); };
    reply = () => new Promise<boolean>((resolve) => { resolveReply = resolve; });
    await refresh(); await fill('old definition'); await click('Submit');
    form = { ...form, fields: [{ key: 'answer', type: 'string', title: 'New definition', required: true }] };
    await refresh(); expect(value()).toBe(''); await fill('replacement draft');
    await act(async () => resolveReply(true));
    expect(value()).toBe('replacement draft'); await remount(); expect(value()).toBe('replacement draft');
  });


  test('the 50-entry page cache evicts the oldest owner while retaining the newest', async () => {
    const oldestOwner = owner;
    await fill('oldest');
    for (let index = 0; index < 50; index += 1) {
      owner = `${oldestOwner}-limit-${index}`;
      await refresh();
    }
    await fill('newest'); const newestOwner = owner;
    owner = oldestOwner; await refresh(); expect(value()).toBe('');
    owner = newestOwner; await refresh(); expect(value()).toBe('newest');
  });

  test('a late reply cannot clear edits after revisiting the same owner and field definition', async () => {
    let resolveReply: (success: boolean) => void = () => { throw new Error('Reply was not started'); };
    reply = () => new Promise<boolean>((resolve) => { resolveReply = resolve; });
    await refresh(); await fill('submitted draft'); await click('Submit');
    await remount(); expect(value()).toBe('submitted draft');
    await fill('newer draft');
    await act(async () => resolveReply(true));
    expect(value()).toBe('newer draft');
    expect(button('Submit')?.disabled).toBe(false);
    await remount(); expect(value()).toBe('newer draft');
  });

});
