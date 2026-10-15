import React, { act } from 'react';
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { z } from 'zod';
import type { Root } from 'react-dom/client';

const rpcBody = z.object({ machine: z.string(), method: z.string(), params: z.object({ pane_id: z.string().optional(), source: z.string().optional() }), requestId: z.string().optional() });
type ReadRequest = z.infer<typeof rpcBody>;
let dom: Window;
let root: Root;
let host: HTMLElement;
let restore: () => void;
let cleanupConnection: () => Promise<void>;
let requests: string[];
let rpcs: { body: ReadRequest; signal: AbortSignal | null | undefined }[];
const server = 'https://active-instances.test';
const otherServer = 'https://second-instances.test';
const thirdServer = 'https://third-instances.test';
const tokenA = 'synthetic-active-device';
const tokenB = 'synthetic-second-device';
const tokenC = 'synthetic-third-device';
let details: {origin:string;path:string;auth:string|null}[];
let trace:string[];
let infoReply:(origin:string)=>Promise<Response>;
let activeUnauthorized:boolean;
let connectionApi: typeof import('../../../../web/src/herdr/transport');
let restoreStorage: () => void;
const wait = async (ms = 60) => { for (let elapsed = 0; elapsed < ms; elapsed += 20) await act(async () => { await new Promise(resolve => setTimeout(resolve, Math.min(20, ms - elapsed))); }); };
const until = async (condition: () => boolean) => { for (let attempt = 0; attempt < 100 && !condition(); attempt++) await wait(20); expect(condition()).toBe(true); };
const nativeSnapshot = (machine: string) => ({ type: 'session_snapshot', snapshot: { version: '0.9.3', protocol: 22,
  workspaces: [{ workspace_id: 'w1', label: 'Existing research', focused: true, active_tab_id: 'w1:t1', agent_status: 'unknown', pane_count: 1, tab_count: 1 }],
  tabs: [{ tab_id: 'w1:t1', workspace_id: 'w1', label: 'Research windows', focused: true, agent_status: 'unknown', pane_count: 1 }],
  panes: [{ pane_id: 'w1:p1', workspace_id: 'w1', tab_id: 'w1:t1', terminal_id: machine + ':terminal', focused: true, revision: 1, agent_status: 'unknown', label: 'Overview dashboard', agent: null, cwd: '/fixture' }], agents: [],
} });
const outputReply = (request: ReadRequest, text = `${request.machine.toUpperCase()}_VISIBLE_${request.params.pane_id}`) => Response.json({ id: 'read', result: { type: 'pane_read', read: {
  pane_id: request.params.pane_id, workspace_id: request.params.pane_id?.startsWith('w2:') ? 'w2' : 'w1', tab_id: request.params.pane_id === 'w2:p2' ? 'w2:t2' : request.params.pane_id?.startsWith('w2:') ? 'w2:t1' : 'w1:t1',
  source: request.params.source, format: 'text', text, revision: 4, truncated: false,
} } });
const monitorText = () => host.querySelector('[data-pane-monitor] pre')?.textContent;
const click = async (label: string) => {
  const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent?.trim() === label || item.getAttribute('aria-label') === label);
  if (!button) throw new Error(`Missing UI action ${label}`);
  await act(async () => button.click());
};
const openWindows = () => click('Open sessions and projects');

beforeEach(async () => {
  dom = new Window({ url: server }); dom.innerWidth = 412; dom.innerHeight = 915;
  const globals = { window: dom, document: dom.document, navigator: dom.navigator, localStorage: dom.localStorage, sessionStorage: dom.sessionStorage,
    Node: dom.Node, Text: dom.Text, NodeList: dom.NodeList, NodeFilter: dom.NodeFilter, Element: dom.Element,
    HTMLElement: dom.HTMLElement, HTMLInputElement: dom.HTMLInputElement, HTMLTextAreaElement: dom.HTMLTextAreaElement,
    HTMLButtonElement: dom.HTMLButtonElement, HTMLAnchorElement: dom.HTMLAnchorElement, HTMLImageElement: dom.HTMLImageElement,
    HTMLTableElement: dom.HTMLTableElement, HTMLTableCellElement: dom.HTMLTableCellElement, HTMLTableRowElement: dom.HTMLTableRowElement,
    Document: dom.Document, DocumentFragment: dom.DocumentFragment, ShadowRoot: dom.ShadowRoot, Event: dom.Event,
    KeyboardEvent: dom.KeyboardEvent, MouseEvent: dom.MouseEvent, PointerEvent: dom.PointerEvent, CustomEvent: dom.CustomEvent,
    SVGElement: dom.SVGElement, customElements: dom.customElements, CSSStyleSheet: dom.CSSStyleSheet,
    MutationObserver: dom.MutationObserver, ResizeObserver: dom.ResizeObserver,
    getComputedStyle: dom.getComputedStyle.bind(dom), requestAnimationFrame: dom.requestAnimationFrame.bind(dom),
    cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom), IS_REACT_ACT_ENVIRONMENT: true };
  const previous = Object.getOwnPropertyDescriptors(globalThis);
  for (const [name, value] of Object.entries(globals)) Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  const locks = new Map<string, Promise<void>>();
  Object.defineProperty(dom.navigator, 'locks', { value: { request<T>(name: string, callback: () => Promise<T>) { const next = (locks.get(name) ?? Promise.resolve()).then(callback); locks.set(name, next.then(() => undefined, () => undefined)); return next; } }, configurable: true });
  const savedFetch = globalThis.fetch;
  details = []; trace = []; activeUnauthorized = false; infoReply = async () => Response.json({ app: 'openherdr', version: '0.1.0', session: 'fixture', allowRemoteFonts: false });
  requests = []; rpcs = []; restoreStorage = () => {};
  globalThis.fetch = Object.assign(async (input: RequestInfo | URL, options?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input), server); requests.push(url.pathname); details.push({origin:url.origin,path:url.pathname,auth:new Headers(options?.headers).get('Authorization')});
    if (url.pathname === '/api/pairing/redeem') return Response.json({ token: 'replacement-fixture-only', client: { id: 'synthetic-client' } });
    if (url.pathname === '/api/herdr/machines') return Response.json({ machines: [{ id: 'local', label: 'Local Mac' }], session: 'fixture' });
    if (url.pathname === '/api/herdr/info') {trace.push('info:'+url.origin); return infoReply(url.origin);}
    if (url.pathname === '/api/herdr/preferences') return Response.json({ version: 1, revision: 1, surface: 'mobile', values: {} });
    if (url.pathname === '/api/herdr/rpc') {
      const body = rpcBody.parse(JSON.parse(String(options?.body))); rpcs.push({ body, signal: options?.signal });
      if (body.method === 'session.snapshot') return Response.json({id:'snapshot',result:nativeSnapshot(body.machine)});
      if (body.method === 'pane.read') {trace.push('read:'+url.origin); if(url.origin===server&&activeUnauthorized)return Response.json({error:{code:'unauthorized',message:'Synthetic revoked credential'}},{status:401}); return outputReply(body,url.origin+'_OUTPUT');}
      throw new Error(`Unexpected mutation ${body.method}`);
    }
    if (url.pathname === '/api/herdr/terminal') { return Response.json({ error: { code: 'observer_unavailable', message: 'Text fallback fixture' } }, { status: 503 }); }
    throw new Error(`Unexpected source I/O ${url.pathname}`);
  }, savedFetch);
  restore = () => { globalThis.fetch = savedFetch; for (const name of Object.keys(globals)) { const saved = previous[name]; if (saved) Object.defineProperty(globalThis, name, saved); else Reflect.deleteProperty(globalThis, name); } };
  const { createRoot } = await import('react-dom/client');
  const { saveConnection, forgetConnection } = await import('../../../../web/src/herdr/transport');
  connectionApi = await import('../../../../web/src/herdr/transport');
  await saveConnection({server:thirdServer,token:tokenC,label:'Third device'}); await saveConnection({server:otherServer,token:tokenB,label:'Second device'}); await saveConnection({ server, token: tokenA }); cleanupConnection = async () => { await forgetConnection(server); await forgetConnection(otherServer); await forgetConnection(thirdServer); };
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await render(); await until(()=>monitorText()===server+'_OUTPUT');
});
afterEach(async () => {
  try {
    noCredentialUi();
    expect(rpcs.every(item => ['session.snapshot', 'pane.read'].includes(item.body.method) && !item.body.requestId)).toBe(true);
    expect(requests.some(path => /\/clients\/|\/conversations\/|\/pairing\/|\/receipt/.test(path))).toBe(false);
  } finally {
    restoreStorage();
    try { await act(async () => root.unmount()); await cleanupConnection(); localStorage.clear(); }
    finally { await dom.happyDOM.close(); restore(); }
  }
});


async function render() {
  const { I18nProvider } = await import('@/lib/i18n');
  const { HerdrApp } = await import('../../../../web/src/herdr/HerdrApp');
  await act(async () => root.render(<I18nProvider><HerdrApp initialPairing={null} initialError={null} /></I18nProvider>));
}
async function coldRestart() {
  await act(async () => root.unmount()); host.remove();
  host = document.createElement('div'); document.body.append(host);
  const { createRoot } = await import('react-dom/client'); root = createRoot(host);
  rpcs = []; requests = []; await render();
}
const manager = () => document.querySelector<HTMLElement>('[role="dialog"][aria-label="Instances"]');
const visible = () => [...document.querySelectorAll<HTMLButtonElement>('button')].filter(button => !button.closest('[hidden],[aria-hidden="true"]'));
const press = async (label:string) => {const button=visible().find(button=>button.textContent?.trim()===label||button.getAttribute('aria-label')===label);if(!button)throw new Error('Missing '+label);await act(async()=>button.click());};
const openManager = async () => {await openWindows();await press('Instances');await until(()=>!!manager()?.querySelector('fieldset'));};
const row = (label:string) => {const button=[...manager()?.querySelectorAll('button')??[]].find(button=>button.querySelector('span[dir="auto"]')?.textContent===label);if(!button?.parentElement)throw new Error('Missing row '+label);return {button,container:button.parentElement};};
const action = async (label:string,aria:string) => {const button=row(label).container.querySelector<HTMLButtonElement>(`button[aria-label="${aria}"]`);if(!button)throw new Error('Missing row action '+aria);await act(async()=>button.click());};
const back = async()=>{const {closeTopmostBackLayer}=await import('@/lib/mobileBackLayers');await act(async()=>{expect(closeTopmostBackLayer()).toBe(true);});};
const welcome = ()=>[...host.querySelectorAll('h1')].some(element=>element.textContent==='Connect to OpenHerdr'&&!element.closest('[hidden]'));
const fill = async(input:HTMLInputElement,value:string)=>{const setter=Object.getOwnPropertyDescriptor(dom.HTMLInputElement.prototype,'value')?.set;if(!setter)throw new Error('No setter');await act(async()=>{setter.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));});};
const pending = (origin=server)=>({requestId:'synthetic-unknown',server:origin,machine:'local',session:null,workspaceId:'w1',tabId:'w1:t1',paneId:'w1:p1',method:'pane.send_input'});
function storageHook(callback:(value:string)=>void){const descriptor=Object.getOwnPropertyDescriptor(dom.localStorage,'setItem');const write=dom.localStorage.setItem.bind(dom.localStorage);Object.defineProperty(dom.localStorage,'setItem',{configurable:true,value:(key:string,value:string)=>{if(key==='openherdr.connections.v1')callback(value);write(key,value);}});restoreStorage=()=>{if(descriptor)Object.defineProperty(dom.localStorage,'setItem',descriptor);else Object.defineProperty(dom.localStorage,'setItem',{configurable:true,value:write});};}
function noCredentialUi(){const ui=document.body.innerHTML+[...document.querySelectorAll('input')].map(input=>input.value).join();for(const token of [tokenA,tokenB,tokenC])expect(ui).not.toContain(token);}
const goodInfo=()=>Response.json({app:'openherdr',version:'0.1.0',session:'fixture',allowRemoteFonts:false});

test('old unlabeled format renders its origin and rename persists without reordering or exposing credentials',async()=>{
 const initial=connectionApi.savedConnections();await openManager();expect(row(server).button.textContent).toContain('Current');
 await action('Second device','Edit');const form=manager()?.querySelector('form');const input=form?.querySelector<HTMLInputElement>('input:not([readonly])');if(!input)throw new Error('No name editor');expect(form?.querySelector<HTMLInputElement>('input[readonly]')?.value).toBe(otherServer);
 await fill(input,'Watched remote');await press('Save changes');await wait();expect(row('Watched remote').button.textContent).toContain(otherServer);
 expect(connectionApi.savedConnections()).toEqual(initial.map(item=>item.server===otherServer?{...item,label:'Watched remote'}:item));noCredentialUi();
 await back();await wait(220);await coldRestart();await until(()=>monitorText()===server+'_OUTPUT');await openManager();expect(row('Watched remote').button.textContent).toContain(otherServer);noCredentialUi();
});

test('candidate probes exactly once with its own bearer before durable MRU and pauses old output',async()=>{
 let finish:(response:Response)=>void=()=>{};infoReply=async origin=>origin===otherServer?new Promise(resolve=>{finish=resolve;}):goodInfo();
 storageHook(value=>{const first=z.array(z.object({server:z.string()})).parse(JSON.parse(value))[0];trace.push('store:'+first.server);});
 await openManager();const reads=rpcs.length;await act(async()=>row('Second device').button.click());
 expect(details.filter(request=>request.origin===otherServer&&request.path==='/api/herdr/info')).toHaveLength(1);expect(details.find(request=>request.origin===otherServer)?.auth).toBe('Bearer '+tokenB);expect(connectionApi.savedConnections()[0].server).toBe(server);
 await wait(100);expect(rpcs).toHaveLength(reads);infoReply=async()=>goodInfo();await act(async()=>finish(goodInfo()));await until(()=>monitorText()===otherServer+'_OUTPUT');
 expect(connectionApi.savedConnections().map(item=>item.server)).toEqual([otherServer,server,thirdServer]);expect(trace.indexOf('info:'+otherServer)).toBeLessThan(trace.indexOf('store:'+otherServer));expect(trace.indexOf('store:'+otherServer)).toBeLessThan(trace.indexOf('read:'+otherServer));noCredentialUi();
});

for(const failure of ['network','html401','upstream401','strict401']as const){test(failure+' candidate rejection preserves active and MRU; only exact Herdr unauthorized disables candidate',async()=>{
 const initial=connectionApi.savedConnections();infoReply=async origin=>{if(origin!==otherServer)return goodInfo();if(failure==='network')throw new TypeError('Synthetic offline');if(failure==='html401')return new Response('<html>Proxy</html>',{status:401,headers:{'Content-Type':'text/html'}});return Response.json({error:{code:failure==='strict401'?'unauthorized':'upstream_rejected',message:'Synthetic refusal'}},{status:401});};
 await openManager();await act(async()=>row('Second device').button.click());await until(()=>!!manager()?.querySelector('[role="alert"],[role="status"]'));
 expect(connectionApi.savedConnections()).toEqual(initial);expect(row('Second device').button.disabled).toBe(failure==='strict401');expect(row(server).button.disabled).toBe(false);
 await back();await wait(220);await until(()=>monitorText()===server+'_OUTPUT');expect(welcome()).toBe(false);
});}

test('two-step inactive removal can cancel and preserves active connection and pending record',async()=>{
 const record=pending(otherServer);localStorage.setItem(`openherdr.pending.v1:${otherServer}`,JSON.stringify(record));
 await openManager();await action('Second device','Delete Second device');expect(connectionApi.savedConnections()).toHaveLength(3);await action('Second device','Keep Second device');expect(connectionApi.savedConnections()).toHaveLength(3);
 await action('Second device','Delete Second device');await action('Second device','Confirm deleting Second device');await until(()=>connectionApi.savedConnections().length===2);expect(connectionApi.savedConnections().map(item=>item.server)).toEqual([server,thirdServer]);expect(await connectionApi.loadPendingDelivery(otherServer)).toEqual(record);
 await back();await wait(220);await until(()=>monitorText()===server+'_OUTPUT');
});

for(const last of [false,true])test('removing active '+(last?'last':'non-last')+' server returns Welcome without automatic replacement',async()=>{
 if(last){await connectionApi.forgetConnection(otherServer);await connectionApi.forgetConnection(thirdServer);}const record=pending();localStorage.setItem(`openherdr.pending.v1:${server}`,JSON.stringify(record));
 await openManager();await action(server,'Delete '+server);await action(server,'Confirm deleting '+server);await until(welcome);
 expect(host.querySelector('[data-pane-monitor]')).toBeNull();expect(connectionApi.savedConnections().some(item=>item.server===server)).toBe(false);expect(details.some(request=>request.origin!==server)).toBe(false);expect(await connectionApi.loadPendingDelivery(server)).toEqual(record);if(last)expect(connectionApi.savedConnections()).toEqual([]);
});

test('durable remove and rename failures leave saved data and active selection intact',async()=>{
 const initial=connectionApi.savedConnections();storageHook(()=>{throw new Error('Synthetic blocked write');});await openManager();await action(server,'Delete '+server);await action(server,'Confirm deleting '+server);await until(()=>!!manager()?.querySelector('[role="alert"]'));
 expect(connectionApi.savedConnections()).toEqual(initial);expect(welcome()).toBe(false);await back();await action('Second device','Edit');const input=manager()?.querySelector<HTMLInputElement>('form input:not([readonly])');if(!input)throw new Error('No name editor');await fill(input,'Must not persist');await press('Save changes');await wait();expect(connectionApi.savedConnections()).toEqual(initial);expect(manager()?.querySelector('form')).not.toBeNull();
});

test('failed durable selection cannot activate a successfully probed candidate',async()=>{
 const initial=connectionApi.savedConnections();storageHook(()=>{throw new Error('Synthetic blocked selection write');});await openManager();await act(async()=>row('Second device').button.click());await until(()=>!!manager()?.querySelector('[role="alert"]'));
 expect(connectionApi.savedConnections()).toEqual(initial);expect(details.filter(request=>request.origin===otherServer).every(request=>request.path==='/api/herdr/info')).toBe(true);
 await back();await wait(220);await until(()=>monitorText()===server+'_OUTPUT');
});

test('Back dismisses rename and delete confirmation before closing manager',async()=>{
 await openManager();await action('Second device','Edit');expect(manager()?.querySelector('form')).not.toBeNull();await back();expect(manager()?.querySelector('form')).toBeNull();expect(manager()).not.toBeNull();
 await action('Second device','Delete Second device');await back();expect(row('Second device').container.querySelector('[aria-label="Confirm deleting Second device"]')).toBeNull();expect(manager()).not.toBeNull();await back();await wait(220);await until(()=>monitorText()===server+'_OUTPUT');
});

test('unknown delivery survives switching saved origins without replay',async()=>{
 const record=pending();localStorage.setItem(`openherdr.pending.v1:${server}`,JSON.stringify(record));await openManager();await act(async()=>row('Second device').button.click());await until(()=>monitorText()===otherServer+'_OUTPUT');expect(await connectionApi.loadPendingDelivery(server)).toEqual(record);
});

test('rejected ACTIVE credential remains behind Welcome when manager closes',async()=>{
 activeUnauthorized=true;await act(async()=>window.dispatchEvent(new Event('online')));await until(welcome);await press('Instances');await until(()=>!!manager());await back();await wait(220);expect(welcome()).toBe(true);expect(host.querySelector('[data-pane-monitor]')?.closest('[hidden]')).not.toBeNull();
});

for(const stage of ['probe','save']as const)test('new pairing intent during saved '+stage+' remains explicit and prevents stale activation',async()=>{
 const {HerdrConnectionController}=await import('../../../../web/src/herdr/connection-controller');
 const {ConnectionInstances}=await import('../../../../web/src/herdr/ConnectionInstances');
 const {ConnectionWelcome}=await import('../../../../web/src/herdr/ConnectionWelcome');
 const {I18nProvider}=await import('@/lib/i18n');
 let raw=JSON.stringify([{server,token:tokenA},{server:otherServer,token:tokenB,label:'Second device'}]);let writes=0;let saveStarted=false;
 let finishSave:()=>void=()=>{};const saveGate=new Promise<void>(resolve=>{finishSave=resolve;});
 const store=new connectionApi.ConnectionStore({kind:'native',read:async()=>raw,write:async value=>{writes++;saveStarted=true;if(stage==='save')await saveGate;raw=value;}});await store.initialize();
 let finishProbe:(response:Response)=>void=()=>{};
 infoReply=async origin=>origin===otherServer&&stage==='probe'?new Promise(resolve=>{finishProbe=resolve;}):goodInfo();
 const activations:string[]=[];let redemptions=0;
 const controller=new HerdrConnectionController({initialize:()=>store.initialize(),list:()=>store.list(),save:connection=>store.save(connection),probe:connectionApi.probeConnection,rename:(origin,label)=>store.rename(origin,label),forget:origin=>store.forget(origin),redeem:async()=>{redemptions++;return{server:thirdServer,token:tokenC};}},connection=>activations.push(connection.server),{server,pairing:null,error:null});
 const record=pending();localStorage.setItem(`openherdr.pending.v1:${server}`,JSON.stringify(record));
 await act(async()=>root.render(<I18nProvider><section role="dialog" aria-label="Instances"><ConnectionInstances controller={controller} activeConnection={{server,token:tokenA}} onAdd={()=>{}} onRemoved={()=>{}}/></section></I18nProvider>));
 await act(async()=>row('Second device').button.click());
 if(stage==='save')await until(()=>saveStarted);else expect(controller.getSnapshot().phase).toBe('probing');
 expect(manager()?.querySelector('fieldset')?.disabled).toBe(true);expect(store.list()[0].server).toBe(server);
 const pairing={pairingId:'synthetic-queued',secret:'synthetic-queued-secret',server:thirdServer};
 await act(async()=>controller.acceptLink(`${thirdServer}/#pairing=${Buffer.from(JSON.stringify(pairing)).toString('base64url')}`));
 if(stage==='probe')await act(async()=>finishProbe(goodInfo()));else await act(async()=>finishSave());
 await until(()=>controller.getSnapshot().phase==='editing');
 expect(activations).toEqual([]);expect(redemptions).toBe(0);expect(controller.getSnapshot().pairing).toEqual(pairing);expect(writes).toBe(stage==='probe'?0:1);
 expect(store.list().map(item=>item.server)).toEqual(stage==='probe'?[server,otherServer]:[otherServer,server]);
 await act(async()=>root.render(<I18nProvider><ConnectionWelcome controller={controller} toolbar={null} onClose={null}/></I18nProvider>));
 expect(host.querySelector<HTMLInputElement>('input[type="url"]')?.value).toBe(thirdServer);expect(visible().find(button=>button.textContent?.trim()==='Connect')?.disabled).toBe(false);
 expect(await connectionApi.loadPendingDelivery(server)).toEqual(record);noCredentialUi();
});

test('Instances follows original short-side layout: narrow and rotated phone fullscreen, tablet dialog',async()=>{
 await openManager();expect(manager()?.classList.contains('fixed')).toBe(true);expect(manager()?.classList.contains('inset-0')).toBe(true);expect(manager()?.classList.contains('max-w-[720px]')).toBe(false);
 await act(async()=>{dom.innerWidth=915;dom.innerHeight=412;window.dispatchEvent(new Event('resize'));});await wait();expect(manager()?.classList.contains('fixed')).toBe(true);
 await act(async()=>{dom.innerWidth=1024;dom.innerHeight=768;window.dispatchEvent(new Event('resize'));});await until(()=>manager()?.classList.contains('max-w-[720px]')===true);
 expect(manager()?.classList.contains('rounded-2xl')).toBe(true);expect(row('Second device').button.textContent).toContain(otherServer);
});
