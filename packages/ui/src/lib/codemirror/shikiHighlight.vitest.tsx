import { afterAll, afterEach, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { createMarkdownWorkerFixture } from './__tests__/markdownWorker.fixture';

const markdown = createMarkdownWorkerFixture();
const dom = new Window({ url: 'https://editor-highlight.test' });
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const [name, value] of Object.entries({
  window: dom, document: dom.document, navigator: dom.navigator, location: dom.location,
  localStorage: dom.localStorage, Node: dom.Node, Text: dom.Text, Element: dom.Element,
  HTMLElement: dom.HTMLElement, DocumentFragment: dom.DocumentFragment, Range: dom.Range,
  customElements: dom.customElements, CSSStyleSheet: dom.CSSStyleSheet, ShadowRoot: dom.ShadowRoot,
  MutationObserver: dom.MutationObserver, ResizeObserver: dom.ResizeObserver,
  getComputedStyle: dom.getComputedStyle.bind(dom), requestAnimationFrame: dom.requestAnimationFrame.bind(dom),
  cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom), Worker: markdown.Worker,
})) {
  originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
}
const originalFetch = globalThis.fetch;
const requests: string[] = [];
globalThis.fetch = Object.assign(async (input: RequestInfo | URL) => {
  requests.push(input instanceof Request ? input.url : String(input));
  throw new Error('Editor highlighting must not initialize an application runtime');
}, originalFetch);
const { shikiHighlightExtension } = await import('./shikiHighlight');
const { resetMarkdownWorkerClientCacheForTests } = await import('@/components/chat/markdown/markdown-worker');
const { getDefaultTheme } = await import('@/lib/theme/themes');
const { getResolvedShikiTheme } = await import('@/lib/shiki/appThemeRegistry');
let editor: EditorView | undefined;

const waitFor = async (condition: () => boolean) => {
  const deadline = Date.now() + 5000;
  while (!condition() && Date.now() < deadline) {
    if (markdown.failures.length) throw markdown.failures[0];
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  expect(condition()).toBe(true);
};
const mount = (content: string) => {
  const host = document.createElement('div'); document.body.append(host);
  let dispatches = 0;
  const theme = getDefaultTheme(false);
  editor = new EditorView({
    parent: host,
    state: EditorState.create({ doc: content, extensions: [shikiHighlightExtension({ language: 'typescript', themeName: theme.metadata.id, theme: getResolvedShikiTheme(theme) })] }),
    dispatchTransactions: (transactions, view) => { dispatches++; view.update(transactions); },
  });
  return { editor, host, get dispatches() { return dispatches; } };
};
afterEach(() => {
  editor?.destroy(); editor = undefined;
  resetMarkdownWorkerClientCacheForTests();
  markdown.releaseResponses();
  document.body.replaceChildren();
  expect(requests).toEqual([]);
});
afterAll(async () => {
  await markdown.close();
  globalThis.fetch = originalFetch;
  await dom.happyDOM.close();
  for (const [name, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
});

test('a same-length edit rejects the pending old colors before the next idle tokenization', async () => {
  markdown.pauseResponses();
  const fixture = mount('const first = 1;');
  await waitFor(() => markdown.pendingResponses === 1);
  fixture.editor.dispatch({ changes: { from: 0, to: fixture.editor.state.doc.length, insert: 'const other = 2;' } });
  const beforeRelease = fixture.dispatches;
  markdown.releaseResponses();
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(fixture.dispatches).toBe(beforeRelease);
  expect(fixture.host.querySelector('.cm-content [style*="color:"]')).toBeNull();
  await waitFor(() => fixture.host.querySelector('.cm-content [style*="color:"]') !== null);
  expect(fixture.editor.state.doc.toString()).toBe('const other = 2;');
  expect(markdown.requests.filter(request => request.type === 'highlightTokens').map(request => request.code)).toEqual(['const first = 1;', 'const other = 2;']);
});

test('disposing an editor rejects its real worker result without dispatching into a destroyed view', async () => {
  markdown.pauseResponses();
  const fixture = mount('const disposed = true;');
  await waitFor(() => markdown.pendingResponses === 1);
  fixture.editor.destroy(); editor = undefined;
  const beforeRelease = fixture.dispatches;
  markdown.releaseResponses();
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(fixture.dispatches).toBe(beforeRelease);
  expect(markdown.pendingRequests).toBe(0);
  expect(markdown.failures).toEqual([]);
});
