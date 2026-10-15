import React, { act } from 'react';
import { expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import type { SkillAutocompleteHandle } from './SkillAutocomplete';

// The real OpenCode wrapper retains its directory store. Only the network
// returns fixture data; the wrapper, store, ranking and shared view run intact.
test('the original wrapper retains directory badges and keyboard selection through parent renders', async () => {
  const dom = new Window({ url: 'https://skill-wrapper.test' });
  const globals = { window: dom, document: dom.document, navigator: dom.navigator, localStorage: dom.localStorage,
    Node: dom.Node, Element: dom.Element, HTMLElement: dom.HTMLElement, Event: dom.Event, CustomEvent: dom.CustomEvent,
    MutationObserver: dom.MutationObserver, ResizeObserver: dom.ResizeObserver,
    getComputedStyle: dom.getComputedStyle.bind(dom), requestAnimationFrame: dom.requestAnimationFrame.bind(dom),
    cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom), IS_REACT_ACT_ENVIRONMENT: true };
  const previous = Object.getOwnPropertyDescriptors(globalThis);
  for (const [name, value] of Object.entries(globals)) Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  const savedFetch = globalThis.fetch;
  const skillReads: string[] = [];
  const fixtureFetch = async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : String(input), 'https://skill-wrapper.test');
    if (url.pathname.endsWith('/config/skills')) {
      skillReads.push(url.searchParams.get('directory') ?? 'missing');
      return Response.json({ skills: [
        { name: 'user-alpha', path: '/user/alpha/SKILL.md', scope: 'user' },
        { name: 'project-zeta', path: '/wrapper-fixture/.agents/skills/zeta/SKILL.md', scope: 'project', source: 'agents' },
      ] });
    }
    if (url.pathname.endsWith('/event')) return new Response(new ReadableStream(), { headers: { 'content-type': 'text/event-stream' } });
    if (url.pathname.endsWith('/location')) return Response.json({ directory: '/wrapper-fixture', project: { id: 'fixture', directory: '/wrapper-fixture', canonical: '/wrapper-fixture' } });
    if (url.pathname.endsWith('/session/active')) return Response.json({});
    if (url.pathname.endsWith('/path')) return Response.json({ home: '/home/fixture', config: '/config', state: '/state', worktree: '/wrapper-fixture', directory: '/wrapper-fixture' });
    return Response.json({ data: [] });
  };
  globalThis.fetch = Object.assign(fixtureFetch, savedFetch);
  const { createRoot } = await import('react-dom/client');
  const { OpenCode } = await import('@opencode/client');
  const { SyncProvider } = await import('@/sync/sync-context');
  const { I18nProvider } = await import('@/lib/i18n');
  const { useSessionUIStore } = await import('@/sync/session-ui-store');
  const { useDirectoryStore } = await import('@/stores/useDirectoryStore');
  const { useSkillsStore } = await import('@/stores/useSkillsStore');
  const { useUIStore } = await import('@/stores/useUIStore');
  const { SkillAutocomplete } = await import('./SkillAutocomplete');
  const previousUI = useUIStore.getState().isMobile;
  const previousDirectory = useDirectoryStore.getState().currentDirectory;
  const previousSelection = useSessionUIStore.getState().currentSessionId;
  const previousDraft = useSessionUIStore.getState().newSessionDraft;
  const container = document.createElement('div'); document.body.append(container); const root = createRoot(container);
  const handle = React.createRef<SkillAutocompleteHandle>();
  const sdk = OpenCode.make({ baseUrl: 'https://skill-wrapper.test', fetch: fixtureFetch });
  let selected: string | null = null;
  let query = '';
  const render = () => act(async () => root.render(<SyncProvider sdk={sdk} directory="/wrapper-fixture"><I18nProvider><SkillAutocomplete
    ref={handle} searchQuery={query} onSkillSelect={name => { selected = name; }} onClose={() => {}} /></I18nProvider></SyncProvider>));
  const rows = () => [...container.querySelectorAll<HTMLElement>('[data-skill-autocomplete] .cursor-pointer')];
  try {
    useUIStore.setState({ isMobile: false });
    useDirectoryStore.setState({ currentDirectory: '/wrapper-fixture' });
    useSessionUIStore.setState({ currentSessionId: null, newSessionDraft: { ...previousDraft, open: false, directoryOverride: null } });
    useSkillsStore.getState().resetForRuntimeSwitch();
    await render();
    for (let attempt = 0; attempt < 50 && rows().length !== 2; attempt++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
    expect(skillReads).toEqual(['/wrapper-fixture']);
    expect(rows().map(row => row.textContent)).toEqual(['project-zetaprojectagents', 'user-alphauseropencode']);
    await act(async () => handle.current?.handleKeyDown('ArrowDown'));
    expect(rows()[1]?.classList.contains('bg-interactive-selection')).toBe(true);
    await render();
    expect(rows()[1]?.classList.contains('bg-interactive-selection')).toBe(true);
    await act(async () => handle.current?.handleKeyDown('Enter'));
    expect(selected).toBe('user-alpha');
    query = 'project'; await render();
    expect(rows().map(row => row.textContent)).toEqual(['project-zetaprojectagents']);
    await act(async () => handle.current?.handleKeyDown('Tab'));
    expect(selected).toBe('project-zeta');
    expect(skillReads).toHaveLength(1);
  } finally {
    await act(async () => root.unmount());
    useUIStore.setState({ isMobile: previousUI });
    useDirectoryStore.setState({ currentDirectory: previousDirectory });
    useSessionUIStore.setState({ currentSessionId: previousSelection, newSessionDraft: previousDraft });
    useSkillsStore.getState().resetForRuntimeSwitch();
    await dom.happyDOM.close(); globalThis.fetch = savedFetch;
    for (const name of Object.keys(globals)) { const saved = previous[name]; if (saved) Object.defineProperty(globalThis, name, saved); else Reflect.deleteProperty(globalThis, name); }
  }
});
