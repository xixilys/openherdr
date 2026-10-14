import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRemoteClientAuthRuntime } from '../lib/client-auth/remote-clients.js';
import { createClientPairingRuntime } from '../lib/client-auth/pairing.js';
import { readEnterprisePolicy } from '../lib/enterprise-mode.js';
import { createHerdrBridge } from './bridge.js';
import { createReceiptStore } from './receipts.js';
import { ApiError, adminRequest, isReadMethod, methods, pairingEnvelope, parseRpc, terminalEnvelope } from './contracts.js';
import { filesRequest, gitRequest, readPaneFiles, readPaneGit } from './content.js';

const APP = { app: 'openherdr', version: '0.1.0' };
const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);
const NATIVE_ORIGINS = ['capacitor://localhost', 'https://localhost'];
function originValue(value) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== value || url.username || url.password) throw new Error();
    return url.origin;
  } catch { throw new ApiError(400, 'invalid_origin', 'Use an exact HTTP or HTTPS origin without a path'); }
}
function send(res, status, value) {
  if (res.headersSent) return res.destroy();
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
  res.end(JSON.stringify(value));
}
async function readJson(req) {
  if (!(req.headers['content-type'] || '').toLowerCase().match(/^application\/json(?:;|$)/)) throw new ApiError(415, 'json_required', 'Use Content-Type application/json');
  let size = 0; const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 128 * 1024) throw new ApiError(413, 'request_too_large', 'Request exceeds 128 KiB');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new ApiError(400, 'invalid_json', 'Invalid JSON request'); }
}
const parse = (schema, value) => {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ApiError(400, 'invalid_request', 'Invalid request');
  return parsed.data;
};

export async function createHerdrServer(options = {}) {
  const host = options.host ?? '127.0.0.1';
  const port = options.port ?? 4318;
  const stateDir = path.resolve(options.stateDir ?? path.join(os.homedir(), '.local/state/openherdr'));
  const adminSocketPath = path.join(stateDir, 'admin.sock');
  const bridge = options.bridge ?? createHerdrBridge(options);
  const policy = options.readPolicy ?? readEnterprisePolicy;
  const origins = new Set((options.publicOrigins ?? []).map(originValue));
  const nativeOrigins = options.nativeOrigins ?? NATIVE_ORIGINS;
  if (!Array.isArray(nativeOrigins) || nativeOrigins.some((origin) => !NATIVE_ORIGINS.includes(origin))) throw new Error('Unsupported native application origin');
  const streams = new Map();
  const rate = new Map();
  let listening = false;
  let actualPort = port;
  const requireNetworkPolicy = () => {
    const value = policy();
    if (value.enterpriseMode && !value.allowNetworkAccess) throw new ApiError(403, 'enterprise_mode', 'Enterprise policy blocks remote access');
  };
  const checkExposure = () => { if (!LOOPBACK.has(host) || origins.size) requireNetworkPolicy(); };
  checkExposure();
  await fs.mkdir(stateDir, { recursive: true, mode: 0o700 });
  const dir = await fs.lstat(stateDir);
  if (!dir.isDirectory() || dir.isSymbolicLink() || dir.uid !== process.getuid?.()) throw new Error('OpenHerdr state directory must be owned by this user');
  await fs.chmod(stateDir, 0o700);
  const remoteAuth = createRemoteClientAuthRuntime({ fsPromises: fs, path, crypto, storePath: path.join(stateDir, 'clients.json') });
  const pairing = createClientPairingRuntime({ fsPromises: fs, path, crypto, remoteClientAuthRuntime: remoteAuth, storePath: path.join(stateDir, 'pairing.json') });
  const receipts = await createReceiptStore(path.join(stateDir, 'receipts.jsonl'));
  const state = () => ({ ...APP, pid: process.pid, host, port: actualPort, session: options.session ?? null, socketPath: bridge.socketPath ?? options.socketPath ?? null, adminSocketPath, publicOrigins: [...origins], baseUrl: `http://${host.includes(':') ? `[${host}]` : host}:${actualPort}` });
  const writeState = async () => {
    const file = path.join(stateDir, 'server.json');
    const temporary = `${file}.${process.pid}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(state()), { mode: 0o600 });
    await fs.rename(temporary, file);
  };
  const setPublicOrigin = async (origin) => {
    requireNetworkPolicy();
    origins.add(originValue(origin));
    if (listening) await writeState();
    return state();
  };
  const allowedOrigins = () => new Set([...origins, ...nativeOrigins, `http://127.0.0.1:${actualPort}`, `http://localhost:${actualPort}`, `http://[::1]:${actualPort}`]);
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.search) throw new ApiError(400, 'query_forbidden', 'API credentials and parameters must be sent in headers or JSON');
      const origin = req.headers.origin;
      if (origin && !allowedOrigins().has(origin)) throw new ApiError(403, 'origin_forbidden', 'This browser origin is not registered');
      if (origin) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
      }
      if (req.method === 'OPTIONS') {
        if (!origin) throw new ApiError(403, 'origin_required', 'Preflight requests require an Origin');
        res.writeHead(204, { 'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Max-Age': '600' }); return res.end();
      }
      if (url.pathname === '/health' && req.method === 'GET') return send(res, 200, { ok: true, ...APP });
      const remote = req.socket.remoteAddress;
      if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote) || origins.size) requireNetworkPolicy();
      if (url.pathname === '/api/pairing/redeem' && req.method === 'POST') {
        const now = Date.now();
        for (const [key, value] of rate) if (value.reset < now) rate.delete(key);
        const counter = rate.get(remote) ?? { count: 0, reset: now + 60000 };
        if (rate.size >= 10000 && !rate.has(remote)) throw new ApiError(429, 'rate_limited', 'Too many pairing attempts');
        counter.count += 1; rate.set(remote, counter);
        if (counter.count > 10) throw new ApiError(429, 'rate_limited', 'Too many pairing attempts. Wait a minute.');
        const body = parse(pairingEnvelope, await readJson(req));
        const result = await pairing.redeemPairingSession({ ...body, clientKind: 'mobile' });
        return send(res, 200, { token: result.token, client: result.client });
      }
      if (!url.pathname.startsWith('/api/')) return await serveStatic(req, res, url.pathname, options.staticDir);
      const token = /^Bearer ([A-Za-z0-9_-]+)$/.exec(req.headers.authorization ?? '')?.[1];
      const auth = await remoteAuth.authenticateBearerToken(token);
      if (!auth) throw new ApiError(401, 'unauthorized', 'Pair this device to connect');
      if (url.pathname === '/api/herdr/info' && req.method === 'GET') return send(res, 200, { ...APP, session: options.session ?? null, capabilities: { methods: Object.keys(methods), terminalObserve: true, mutationReceipts: true } });
      if (url.pathname === '/api/herdr/machines' && req.method === 'GET') return send(res, 200, { machines: await bridge.machines(), session: options.session ?? null });
      if (url.pathname === '/api/herdr/clients' && req.method === 'GET') return send(res, 200, { clients: await remoteAuth.listClients() });
      if (url.pathname === '/api/herdr/files' && req.method === 'POST') return send(res, 200, await readPaneFiles(bridge, parse(filesRequest, await readJson(req))));
      if (url.pathname === '/api/herdr/git' && req.method === 'POST') return send(res, 200, await readPaneGit(bridge, parse(gitRequest, await readJson(req))));
      const clientId = /^\/api\/herdr\/clients\/([a-zA-Z0-9_-]+)$/.exec(url.pathname)?.[1];
      if (clientId && req.method === 'DELETE') {
        const result = await remoteAuth.revokeClient(clientId);
        for (const child of streams.get(clientId) ?? []) child.kill();
        streams.delete(clientId);
        return send(res, result.revoked ? 200 : 404, result);
      }
      const receiptId = /^\/api\/herdr\/receipts\/([a-zA-Z0-9_-]+)$/.exec(url.pathname)?.[1];
      if (receiptId && req.method === 'GET') {
        const receipt = receipts.get(auth.clientId, receiptId);
        if (!receipt) throw new ApiError(404, 'receipt_not_found', 'No receipt exists for this request');
        return send(res, 200, { receipt });
      }
      if (url.pathname === '/api/herdr/rpc' && req.method === 'POST') {
        const request = parseRpc(await readJson(req));
        if (request.machine !== 'local' && !(await bridge.machines()).some((m) => m.id === request.machine)) throw new ApiError(400, 'unknown_machine', 'Choose a saved Herdr machine');
        const mutation = !isReadMethod(request.method);
        const receipt = mutation ? await receipts.begin(auth.clientId, request) : null;
        let response;
        try { response = await bridge.rpc(request.machine, request.method, request.params); }
        catch (error) {
          const rejected = error instanceof ApiError && (error.status < 500 || error.confirmedNoEffect === true);
          if (receipt && rejected) await receipts.finish(receipt, 'rejected');
          if (receipt && !rejected) throw new ApiError(502, 'outcome_unknown', 'Herdr did not confirm this mutation. Check the receipt and terminal before sending again.');
          throw error;
        }
        if (receipt) await receipts.finish(receipt, 'complete', response);
        return send(res, 200, response);
      }
      if (url.pathname === '/api/herdr/terminal' && req.method === 'POST') {
        const body = parse(terminalEnvelope, await readJson(req));
        let child;
        let disconnected = res.destroyed;
        let cleanup = () => {};
        res.once('close', () => { disconnected = true; cleanup(); child?.kill(); });
        child = await bridge.observe(body.machine, body.pane_id, body.cols, body.rows);
        const children = streams.get(auth.clientId) ?? new Set(); children.add(child); streams.set(auth.clientId, children);
        cleanup = () => { children.delete(child); if (!children.size) streams.delete(auth.clientId); };
        let failure = false;
        let closed = false;
        let exitCode = null;
        let streaming = false;
        const finish = () => {
          if (!streaming || !closed || !child.stdout.readableEnded || res.destroyed || res.writableEnded) return;
          if (failure || exitCode) res.write(`${JSON.stringify({ type: 'terminal.error', error: 'Terminal observation stopped unexpectedly' })}\n`);
          res.end();
        };
        child.on('error', () => { failure = true; cleanup(); if (streaming && !res.destroyed && !res.writableEnded) res.end(`${JSON.stringify({ type: 'terminal.error', error: 'Terminal observation failed' })}\n`); });
        child.on('close', (code) => { closed = true; exitCode = code; cleanup(); finish(); });
        child.stdout.on('end', finish);
        child.stderr.resume();
        try {
          if (!await remoteAuth.authenticateBearerToken(token)) throw new ApiError(401, 'unauthorized', 'This device has been revoked');
          if (failure) throw new ApiError(502, 'observer_unavailable', 'Terminal observation could not start');
          if (disconnected) { cleanup(); child.kill(); return; }
          res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
          streaming = true;
          child.stdout.pipe(res, { end: false });
          finish();
        } catch (error) { cleanup(); child.kill(); throw error; }
        return;
      }
      throw new ApiError(404, 'not_found', 'Unknown API route');
    } catch (error) {
      const status = error.status ?? error.statusCode ?? 502;
      const responseError = { code: error instanceof ApiError ? error.code : status === 400 ? 'invalid_pairing' : 'upstream_error', message: error instanceof ApiError || status === 400 ? error.message : 'OpenHerdr could not complete the request' };
      if (error.receipt) responseError.receipt = error.receipt;
      send(res, status, { error: responseError });
    }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 15000;
  const adminConnections = new Set();
  const adminServer = net.createServer((connection) => {
    adminConnections.add(connection);
    connection.setEncoding('utf8');
    connection.on('close', () => adminConnections.delete(connection));
    connection.setTimeout(10000, () => connection.destroy());
    let buffer = ''; let used = false;
    connection.on('data', async (chunk) => {
      if (used) return;
      buffer += chunk.toString('utf8');
      if (buffer.length > 8192) return connection.destroy();
      if (!buffer.includes('\n')) return;
      used = true; let id = null;
      try {
        const request = parse(adminRequest, JSON.parse(buffer.slice(0, buffer.indexOf('\n'))));
        id = request.id;
        const params = request.params ?? {};
        let result;
        if (request.command === 'status') result = state();
        else if (request.command === 'origin.add') result = await setPublicOrigin(params.origin);
        else if (request.command === 'pair') {
          const serverOrigin = params.server ? originValue(params.server) : state().baseUrl;
          if (!allowedOrigins().has(serverOrigin)) throw new ApiError(400, 'origin_not_registered', 'Register this server origin before pairing');
          if (origins.has(serverOrigin)) requireNetworkPolicy();
          const { pairing: issued } = await pairing.createPairingSession({ label: params.label });
          const payload = { pairingId: issued.id, secret: issued.secret, server: serverOrigin };
          result = { ...payload, expiresAt: issued.expiresAt, fingerprint: issued.fingerprint, url: `${serverOrigin}/#pairing=${Buffer.from(JSON.stringify(payload)).toString('base64url')}` };
        } else if (request.command === 'stop') {
          result = { stopping: true };
          connection.end(`${JSON.stringify({ id, result })}\n`);
          setImmediate(() => close()); return;
        } else throw new ApiError(400, 'unknown_command', 'Unknown admin command');
        connection.end(`${JSON.stringify({ id, result })}\n`);
      } catch (error) { connection.end(`${JSON.stringify({ id, error: { code: error.code ?? 'admin_error', message: error.message } })}\n`); }
    });
  });
  async function listen() {
    if (listening) return state();
    checkExposure();
    // Existing sockets are never unlinked here. The CLI owns stale-instance recovery.
    await new Promise((resolve, reject) => { adminServer.once('error', reject); adminServer.listen(adminSocketPath, resolve); });
    try {
      await fs.chmod(adminSocketPath, 0o600);
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
      actualPort = server.address().port; listening = true;
      await writeState();
      return state();
    } catch (error) { await close(); throw error; }
  }
  async function close() {
    for (const children of streams.values()) for (const child of children) child.kill();
    streams.clear();
    for (const connection of adminConnections) connection.destroy();
    await Promise.all([server, adminServer].map((instance) => new Promise((resolve) => { if (!instance.listening) return resolve(); instance.close(resolve); instance.closeIdleConnections?.(); })));
    if (listening) { await fs.rm(path.join(stateDir, 'server.json'), { force: true }); listening = false; }
  }
  return { server, adminServer, adminSocketPath, stateDir, listen, close, setPublicOrigin, address: () => state() };
}

async function serveStatic(req, res, pathname, staticDir) {
  if (req.method !== 'GET' || !staticDir) throw new ApiError(404, 'not_found', 'Unknown route');
  const root = await fs.realpath(staticDir);
  let requested;
  try { requested = decodeURIComponent(pathname); } catch { throw new ApiError(400, 'invalid_path', 'Invalid URL path'); }
  const relative = requested === '/' ? 'herdr.html' : requested.slice(1);
  const candidate = path.resolve(root, relative);
  if (!candidate.startsWith(`${root}${path.sep}`)) throw new ApiError(403, 'path_forbidden', 'Invalid asset path');
  let real;
  try { real = await fs.realpath(candidate); } catch { throw new ApiError(404, 'not_found', 'Asset not found'); }
  if (!real.startsWith(`${root}${path.sep}`)) throw new ApiError(403, 'path_forbidden', 'Invalid asset path');
  const stat = await fs.stat(real);
  if (!stat.isFile()) throw new ApiError(404, 'not_found', 'Asset not found');
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.json': 'application/json', '.wasm': 'application/wasm' };
  res.writeHead(200, { 'Content-Type': types[path.extname(real)] ?? 'application/octet-stream', 'Cache-Control': path.extname(real) === '.html' ? 'no-store' : 'public, max-age=3600', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
  res.end(await fs.readFile(real));
}

export async function startHerdrServer(options = {}) {
  const runtime = await createHerdrServer(options);
  await runtime.listen();
  return runtime;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const runtime = await startHerdrServer({ session: process.env.OPENHERDR_SESSION ?? 'default', port: Number(process.env.OPENHERDR_PORT ?? 4318) });
  const stop = () => runtime.close().then(() => process.exit(0));
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
}
