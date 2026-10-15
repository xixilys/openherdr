import React, { act } from 'react';
import { afterAll, expect, test } from 'bun:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { renderToString } from 'react-dom/server';
import { Worker as NodeWorker } from 'node:worker_threads';
import type { WorkerRequest, WorkerResponse } from '@pierre/diffs/worker';
import type { MobileDiffDetailProps } from './MobileChangesView';
import type { CommitSection } from '@/components/views/git/CommitSection';

const dom = new Window({ url: 'https://mobile-changes-view.test' });
dom.happyDOM.setWindowSize({ width: 390, height: 844 });
const WorkerEventTarget = globalThis.EventTarget;
const WorkerMessageEvent = globalThis.MessageEvent;
const workerThreads = new Set<NodeWorker>();
const workerFailures: Error[] = [];
const workerEntry = import.meta.resolve('@pierre/diffs/worker/worker.js');
// Preserve the installed Pierre worker; adapt only the browser message boundary.
class FixtureHighlightWorker extends WorkerEventTarget {
  private worker = new NodeWorker(new URL(`data:text/javascript,${encodeURIComponent(`
    import { parentPort, workerData } from 'node:worker_threads';
    globalThis.postMessage = (data) => parentPort.postMessage(data);
    globalThis.self = { addEventListener(type, listener) {
      if (type === 'message') parentPort.on('message', (data) => listener({ data }));
    } };
    await import(workerData);
  `)}`), { workerData: workerEntry });
  constructor() {
    super();
    workerThreads.add(this.worker);
    this.worker.on('message', (data: WorkerResponse) => this.dispatchEvent(new WorkerMessageEvent('message', { data })));
    this.worker.on('error', (error) => workerFailures.push(error));
  }
  postMessage(request: WorkerRequest) { this.worker.postMessage(request); }
  terminate() { return this.worker.terminate(); }
}
const descriptors = new Map<string, PropertyDescriptor | undefined>();
for (const [name, value] of Object.entries({
  window: dom, Window: dom.Window, document: dom.document, navigator: dom.navigator, location: dom.location,
  localStorage: dom.localStorage, sessionStorage: dom.sessionStorage,
  Node: dom.Node, Text: dom.Text, NodeList: dom.NodeList, NodeFilter: dom.NodeFilter,
  Element: dom.Element, HTMLElement: dom.HTMLElement, HTMLInputElement: dom.HTMLInputElement,
  HTMLTextAreaElement: dom.HTMLTextAreaElement, HTMLButtonElement: dom.HTMLButtonElement,
  ShadowRoot: dom.ShadowRoot, Document: dom.Document, DocumentFragment: dom.DocumentFragment,
  SVGElement: dom.SVGElement, Range: dom.Range, Worker: FixtureHighlightWorker,
  Event: dom.Event, CustomEvent: dom.CustomEvent,
  KeyboardEvent: dom.KeyboardEvent, MouseEvent: dom.MouseEvent, PointerEvent: dom.PointerEvent,
  MutationObserver: dom.MutationObserver, ResizeObserver: dom.ResizeObserver, IntersectionObserver: dom.IntersectionObserver,
  customElements: dom.customElements, CSSStyleSheet: dom.CSSStyleSheet,
  getComputedStyle: dom.getComputedStyle.bind(dom), requestAnimationFrame: dom.requestAnimationFrame.bind(dom),
  cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom), IS_REACT_ACT_ENVIRONMENT: true,
})) {
  descriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}
const savedFetch = globalThis.fetch;
const requests: string[] = [];
globalThis.fetch = Object.assign(async (input: string | URL | Request) => {
  requests.push(input instanceof Request ? input.url : String(input));
  throw new Error('A shared Changes presentation must not initialize a runtime');
}, savedFetch);
const { MobileChangesState, MobileDiffDetail, MobileWorkingChangesView } = await import('./MobileChangesView');
const { CommitSection: Commit } = await import('@/components/views/git/CommitSection');
const { ChangeRow } = await import('@/components/views/git/ChangeRow');
const { I18nProvider } = await import('@/lib/i18n');
const { getDefaultTheme } = await import('@/lib/theme/themes');
const { createRoot } = await import('react-dom/client');

afterAll(async () => {
  await Promise.all([...workerThreads].map(worker => worker.terminate()));
  globalThis.fetch = savedFetch;
  await dom.happyDOM.close();
  for (const [name, descriptor] of descriptors) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
});

const mount = () => {
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  return { host, render: async (content: React.ReactNode) => { await act(async () => root.render(<I18nProvider>{content}</I18nProvider>)); }, dispose: async () => { await act(async () => root.unmount()); host.remove(); } };
};
const button = (host: HTMLElement, label: string) => {
  const found = [...host.querySelectorAll<HTMLButtonElement>('button')].find(item => item.getAttribute('aria-label') === label || item.textContent?.trim() === label);
  if (!found) throw new Error(`Missing original Changes action ${label}`);
  return found;
};
const click = async (host: HTMLElement, label: string) => { await act(async () => button(host, label).click()); };
const detail = (overrides: Partial<MobileDiffDetailProps> = {}): MobileDiffDetailProps => ({
  path: 'source.ts', diff: null, fileExists: true, error: null, hideWhitespace: false,
  onHideWhitespaceChange: () => { throw new Error('Unexpected whitespace action'); },
  onBack: () => { throw new Error('Unexpected Back'); }, onRetry: () => { throw new Error('Unexpected retry'); }, ...overrides,
});

test('the source-free state and working frame preserve original list/footer geometry and order without runtime initialization', async () => {
  expect(requests).toEqual([]);
  const fixture = mount();
  try {
    await fixture.render(<MobileWorkingChangesView commitFooter={<button>Local commit footer</button>}><MobileChangesState loading icon message="Owned status" description="Current project" /></MobileWorkingChangesView>);
    const frame = fixture.host.firstElementChild;
    expect(frame?.className).toBe('flex min-h-0 flex-1 flex-col');
    expect(frame?.children).toHaveLength(2);
    expect(frame?.firstElementChild?.className).toBe('min-h-0 flex-1 overflow-hidden px-4 pt-4');
    expect(frame?.lastElementChild?.className).toBe('shrink-0 border-t border-border/70 px-4 pb-4 pt-3');
    expect(frame?.firstElementChild?.textContent).toBe('Owned statusCurrent project');
    expect(frame?.lastElementChild?.textContent).toBe('Local commit footer');
    expect(fixture.host.querySelector('.animate-spin')).not.toBeNull();
    expect(requests).toEqual([]);
  } finally { await fixture.dispose(); }
});

test('the real detail header forwards Back and retry while whitespace remains controlled by its owner', async () => {
  const fixture = mount(); const calls: string[] = [];
  const props = detail({ path: 'src/owned.ts', subtitle: 'Working tree', error: 'Owned diff fetch failed', onBack: () => calls.push('back'), onRetry: () => calls.push('retry'), onHideWhitespaceChange: value => calls.push(`whitespace:${value}`) });
  try {
    await fixture.render(<MobileDiffDetail {...props} />);
    expect(fixture.host.querySelector('header')?.className).toContain('h-[var(--oc-header-height,56px)]');
    expect(fixture.host.querySelector('h2')?.textContent).toBe('src/owned.ts');
    expect(fixture.host.querySelector('header p')?.textContent).toBe('Working tree');
    expect(fixture.host.textContent).toContain('Failed to load diff');
    await click(fixture.host, 'Back'); await click(fixture.host, 'Retry'); await click(fixture.host, 'Hide whitespace changes');
    expect(calls).toEqual(['back', 'retry', 'whitespace:true']);
    expect(button(fixture.host, 'Hide whitespace changes').getAttribute('aria-pressed')).toBe('false');
    props.error = null; props.hideWhitespace = true;
    props.diff = { original: 'const value=1;\n', modified: 'const value = 1;\n' };
    await fixture.render(<MobileDiffDetail {...props} />);
    expect(button(fixture.host, 'Hide whitespace changes').getAttribute('aria-pressed')).toBe('true');
    expect(fixture.host.textContent).toContain('Only whitespace changed in this file.');
    await click(fixture.host, 'Hide whitespace changes');
    expect(calls).toEqual(['back', 'retry', 'whitespace:true', 'whitespace:false']);
    expect(requests).toEqual([]);
  } finally { await fixture.dispose(); }
});

test('detail keeps missing, unavailable, loading, binary, image and staged submodule presentation branches', async () => {
  const fixture = mount(); const props = detail({ fileExists: false });
  try {
    await fixture.render(<MobileDiffDetail {...props} />);
    expect(fixture.host.textContent).toContain('File is no longer changed');
    props.fileExists = true; props.unavailableReason = 'nested_repository'; await fixture.render(<MobileDiffDetail {...props} />);
    expect(fixture.host.textContent).toContain('Separate Git repository');
    props.unavailableReason = 'untracked_directory'; await fixture.render(<MobileDiffDetail {...props} />);
    expect(fixture.host.textContent).toContain('Folder of new files');
    props.unavailableReason = null; await fixture.render(<MobileDiffDetail {...props} />);
    expect(fixture.host.textContent).toContain('Loading diff...');
    props.diff = { original: '', modified: '', isBinary: true }; await fixture.render(<MobileDiffDetail {...props} />);
    expect(fixture.host.textContent).toContain('Content of this file cannot be viewed.');
    props.path = 'cover.png'; props.diff.isBinary = false; await fixture.render(<MobileDiffDetail {...props} />);
    expect(fixture.host.textContent).toContain('Image diffs are not available in mobile Changes yet.');
    props.diff.submodule = { headCommit: 'a'.repeat(40), indexCommit: 'b'.repeat(40), worktreeCommit: 'c'.repeat(40), hasConflict: false, hasTrackedChanges: true, hasUntrackedFiles: false };
    await fixture.render(<MobileDiffDetail {...props} />);
    expect(fixture.host.textContent).toContain('Submodule'); expect(fixture.host.textContent).toContain('bbbbbbb'); expect(fixture.host.textContent).toContain('ccccccc');
    expect(fixture.host.textContent).not.toContain('aaaaaaa');
    props.staged = true; await fixture.render(<MobileDiffDetail {...props} />);
    expect(fixture.host.textContent).toContain('aaaaaaa'); expect(fixture.host.textContent).toContain('bbbbbbb'); expect(fixture.host.textContent).not.toContain('ccccccc');
    expect(requests).toEqual([]);
  } finally { await fixture.dispose(); }
});

test('a real read-only diff accepts explicit appearance without SyncProvider', () => {
  const props = detail({ diff: { original: 'const value = 1;\n', modified: 'const value = 2;\n' } });
  for (const themeMode of ['light', 'dark']) {
    assert.doesNotThrow(() => renderToString(<I18nProvider><MobileDiffDetail {...props} theme={getDefaultTheme(themeMode === 'dark')} themeMode={themeMode === 'dark' ? 'dark' : 'light'} enableComments={false} /></I18nProvider>));
  }
  expect(requests).toEqual([]);
});

test('the real read-only Pierre worker renders text changes without loading a legacy runtime', async () => {
  const fixture = mount();
  const props = detail({ diff: { original: 'const value = 1;\n', modified: 'const value = 2;\n' }, enableComments: false, theme: getDefaultTheme(true), themeMode: 'dark' });
  const shadow = () => fixture.host.querySelector('diffs-container')?.shadowRoot;
  try {
    await fixture.render(<MobileDiffDetail {...props} />);
    const deadline = Date.now() + 5000;
    while (!shadow()?.textContent?.includes('const value = 2;') && Date.now() < deadline) {
      if (workerFailures.length > 0) throw workerFailures[0];
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
    }
    expect(shadow()?.textContent).toContain('const value = 1;');
    expect(shadow()?.textContent).toContain('const value = 2;');
    expect(shadow()?.querySelector('[data-diff-type="single"]')).not.toBeNull();
    expect(shadow()?.querySelector('[data-line-annotation]')).toBeNull();
    expect(requests).toEqual([]);
  } finally { await fixture.dispose(); }
});

test('local-only commit omits unavailable generation, push and gitmoji actions without placeholder callbacks', async () => {
  const fixture = mount(); let commits = 0;
  const props: React.ComponentProps<typeof CommitSection> = { stagedCount: 2, commitMessage: 'Local fixture commit', onCommitMessageChange: () => { throw new Error('Unexpected message edit'); }, onCommit: () => { commits += 1; }, commitAction: null, gitmojiEnabled: true };
  try {
    await fixture.render(<Commit {...props} />);
    expect(fixture.host.querySelector('[aria-label="Generate commit message"]')).toBeNull();
    expect(fixture.host.querySelector('[aria-label="Commit and sync"]')).toBeNull();
    expect([...fixture.host.querySelectorAll('button')].some(item => item.textContent?.includes('Add gitmoji'))).toBe(false);
    await click(fixture.host, 'Commit  aria label'); expect(commits).toBe(1);
    const textarea = fixture.host.querySelector('textarea');
    if (!textarea) throw new Error('Missing original commit input');
    await act(async () => textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true })));
    expect(commits).toBe(2);
    props.hasPendingIndexMutation = true; await fixture.render(<Commit {...props} />);
    expect(button(fixture.host, 'Commit  aria label').disabled).toBe(true);
    await click(fixture.host, 'Commit  aria label');
    await act(async () => textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true })));
    expect(commits).toBe(2); expect(requests).toEqual([]);
  } finally { await fixture.dispose(); }
});

test('existing full commit actions and network blocking keep their original callbacks and local-commit availability', async () => {
  const fixture = mount(); const calls: string[] = [];
  const props: React.ComponentProps<typeof CommitSection> = {
    stagedCount: 1, commitMessage: 'Existing fixture commit', onCommitMessageChange: value => calls.push(`message:${value}`),
    generatedHighlights: ['Original generated highlight'], onInsertHighlights: values => calls.push(`insert:${values.join(',')}`),
    onGenerateMessage: () => calls.push('generate'), isGeneratingMessage: false, onCommit: () => calls.push('commit'),
    onCommitAndPush: () => calls.push('push'), commitAction: null, gitmojiEnabled: true, onOpenGitmojiPicker: () => calls.push('gitmoji'),
  };
  try {
    await fixture.render(<Commit {...props} />);
    expect(fixture.host.textContent).toContain('Original generated highlight');
    await click(fixture.host, 'Insert  aria label'); await click(fixture.host, 'Generate commit message');
    await click(fixture.host, 'Add gitmoji'); await click(fixture.host, 'Commit and sync'); await click(fixture.host, 'Commit  aria label');
    expect(calls).toEqual(['insert:Original generated highlight', 'generate', 'gitmoji', 'push', 'commit']);
    props.networkOperationBlocked = true; await fixture.render(<Commit {...props} />);
    expect(button(fixture.host, 'Commit and sync').disabled).toBe(true); expect(button(fixture.host, 'Commit  aria label').disabled).toBe(false);
    await click(fixture.host, 'Commit and sync'); await click(fixture.host, 'Commit  aria label');
    expect(calls).toEqual(['insert:Original generated highlight', 'generate', 'gitmoji', 'push', 'commit', 'commit']);
    expect(requests).toEqual([]);
  } finally { await fixture.dispose(); }
});

test('working rows keep absent diff statistics unknown while real zero and nonzero counts remain visible', async () => {
  const fixture = mount();
  const props: React.ComponentProps<typeof ChangeRow> = { file: { path: 'owned.ts', index: 'M', working_dir: ' ' }, actionLabel: 'Unstage owned.ts', actionSymbol: '-', onAction: () => { throw new Error('Unexpected unstage'); }, onViewDiff: () => { throw new Error('Unexpected file open'); }, onRevert: () => { throw new Error('Unexpected revert'); }, isReverting: false, showRevert: false };
  try {
    await fixture.render(<ChangeRow {...props} />);
    expect(fixture.host.textContent).not.toContain('+0'); expect(fixture.host.textContent).not.toContain('-0');
    expect(fixture.host.querySelector('[style*="--status-success"]')).toBeNull();
    props.stats = { insertions: 0, deletions: 0 }; await fixture.render(<ChangeRow {...props} />);
    expect(fixture.host.textContent).toContain('+0'); expect(fixture.host.textContent).toContain('-0');
    props.stats = { insertions: 4, deletions: 2 }; await fixture.render(<ChangeRow {...props} />);
    expect(fixture.host.textContent).toContain('+4'); expect(fixture.host.textContent).toContain('-2');
    expect(requests).toEqual([]);
  } finally { await fixture.dispose(); }
});
