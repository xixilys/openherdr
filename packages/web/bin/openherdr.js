#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdir, open, chmod, access } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { randomUUID } from 'node:crypto';
import { tunnelOptions, validateTunnelInput, startTunnel, tunnelStatus } from './lib/openherdr-tunnel.js';

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const executable = fileURLToPath(import.meta.url);
const defaultStateDir = path.join(os.homedir(), '.local/state/openherdr');

const help = `OpenHerdr: mobile access to your Herdr workspaces

Usage: openherdr <command> [options]

  start               Start an owned background bridge
  serve               Run the bridge in this terminal
  connect             Create a one-time pairing link for a phone or browser
  status              Inspect this bridge
  stop                Stop this bridge and its Cloudflare tunnel
  ssh                 Forward an existing OpenHerdr server through SSH

Options:
  --session NAME      Herdr session (default: default)
  --socket PATH       Explicit Herdr socket (plugin context is inherited)
  --port N            HTTP port (default: 4318)
  --host ADDRESS      Listen address (default: 127.0.0.1)
  --state-dir PATH    Separate bridge state and credentials
  --server URL        Reachable public/LAN/SSH URL for pairing
  --public-origin URL Allow an exact browser origin (repeatable)
  --cf                Start an owned Cloudflare tunnel with the bridge
  --cf-mode MODE      quick (default), managed-remote or managed-local
  --cf-token-file PATH Explicit token file for managed-remote
  --cf-config PATH    Explicit configuration file for managed-local
  --qr                Show the one-time pairing QR code
  --open              Open the pairing link in this computer's browser
  --label NAME        Device name for pairing
  --json              JSON-only output
  --quiet             Print only the result
  --target SSH_ALIAS  Existing SSH target for the ssh command
  --remote-port N     Remote OpenHerdr port for ssh (default: 4318)

Examples:
  openherdr start --cf
  openherdr connect --qr
  openherdr serve --session work --server https://herdr.example.com
  openherdr ssh --target workstation --port 4318

Quick Tunnel URLs are temporary. Managed modes require an HTTPS --server.
A connected connector does not confirm public DNS or ingress routing.
Stop only affects this OpenHerdr bridge.
The underlying Herdr server and its agents keep running.
`;

export function adminRequest(stateDir, command, params = {}) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(path.join(stateDir, 'admin.sock'));
    const id = randomUUID();
    let pending = '';
    let settled = false;
    const timer = setTimeout(() => socket.destroy(new Error('OpenHerdr admin request timed out')), 10000);
    socket.once('connect', () => socket.write(JSON.stringify({ id, command, params }) + '\n'));
    socket.on('data', (chunk) => {
      pending += chunk.toString();
      if (pending.length > 128 * 1024) return socket.destroy(new Error('Invalid admin response'));
      const end = pending.indexOf('\n');
      if (end < 0) return;
      try {
        const response = JSON.parse(pending.slice(0, end));
        if (response.id !== id) throw new Error('Mismatched admin response');
        if (response.error) throw new Error(response.error.message || 'Admin request failed');
        settled = true;
        socket.end();
        resolve(response.result);
      } catch (error) { socket.destroy(error); }
    });
    socket.once('error', reject);
    socket.once('end', () => {
      if (settled) return;
      const error = new Error('OpenHerdr admin disconnected before returning a result');
      error.code = 'ECONNRESET';
      reject(error);
    });
    socket.once('close', () => clearTimeout(timer));
  });
}

function portNumber(value, name) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 65535) throw new Error(`${name} must be between 1 and 65535`);
  return number;
}

function serverOrigin(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) {
    throw new Error('Server URL must be an HTTP(S) origin without credentials, a path or query');
  }
  return url.origin;
}

async function runningStatus(stateDir) {
  try { return await adminRequest(stateDir, 'status'); }
  catch (error) {
    if (['ENOENT', 'ECONNREFUSED'].includes(error.code)) return null;
    throw error;
  }
}

async function waitForStopped(stateDir, pid) {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    let status;
    try { status = await runningStatus(stateDir); }
    catch (error) { if (!['EPIPE', 'ECONNRESET'].includes(error.code)) throw error; }
    let alive = true;
    try { process.kill(pid, 0); } catch (error) { if (error.code === 'ESRCH') alive = false; else throw error; }
    let tunnelPresent = true;
    try { await access(path.join(stateDir, 'tunnel.json')); } catch (error) { if (error.code === 'ENOENT') tunnelPresent = false; else throw error; }
    if (!status && !alive && !tunnelPresent) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error('Shutdown was requested but process exit is not confirmed. Check openherdr status.');
}

function show(value, options) {
  if (options.json) console.log(JSON.stringify(value));
  else if (options.quiet) console.log(value.url || value.publicOrigin || value.tunnel?.publicOrigin || value.baseUrl || value.status || JSON.stringify(value));
  else console.log(JSON.stringify(value, null, 2));
}

async function showPairing(pair, options) {
  if (options.json) return show(pair, options);
  show(options.quiet ? { url: pair.url } : pair, options);
  if (options.qr && !options.quiet) {
    const { default: qr } = await import('qrcode-terminal');
    qr.generate(pair.url, { small: true });
  }
  if (options.open) {
    const [command, args] = process.platform === 'darwin' ? ['open', [pair.url]]
      : process.platform === 'win32' ? ['rundll32', ['url.dll,FileProtocolHandler', pair.url]]
        : ['xdg-open', [pair.url]];
    const child = spawn(command, args, { stdio: 'ignore' });
    child.on('error', () => console.error('Browser could not open. Use the pairing link.'));
    child.unref();
  }
}

export async function runOpenHerdr(argv = process.argv.slice(2)) {
  let values;
  try {
    const parsed = parseArgs({ args: argv, allowPositionals: true, options: {
      help: { type: 'boolean', short: 'h' }, version: { type: 'boolean', short: 'V' },
      session: { type: 'string' }, socket: { type: 'string' }, port: { type: 'string', default: '4318' },
      host: { type: 'string', default: '127.0.0.1' }, 'state-dir': { type: 'string', default: defaultStateDir },
      server: { type: 'string' }, 'public-origin': { type: 'string', multiple: true, default: [] },
      'cf-mode': { type: 'string' }, 'cf-token-file': { type: 'string' }, 'cf-config': { type: 'string' },
      cf: { type: 'boolean', default: false }, qr: { type: 'boolean' }, open: { type: 'boolean' },
      json: { type: 'boolean' }, quiet: { type: 'boolean' }, label: { type: 'string' },
      target: { type: 'string' }, 'remote-port': { type: 'string', default: '4318' },
    } });
    values = parsed.values;
    const [command = 'start', ...extra] = parsed.positionals;
    if (values.help) { console.log(help); return 0; }
    if (values.version) { console.log('0.1.0'); return 0; }
    if (extra.length) throw new Error(`Unexpected argument: ${extra[0]}`);
    const stateDir = path.resolve(values['state-dir']);
    const port = portNumber(values.port, 'port');
    const origins = values['public-origin'].map(serverOrigin);
    const suppliedServer = values.server ? serverOrigin(values.server) : null;
    const cloudflare = tunnelOptions(values, command, suppliedServer);
    await validateTunnelInput(cloudflare);
    if (suppliedServer && !origins.includes(suppliedServer)) origins.push(suppliedServer);
    if (values.socket && values.session) throw new Error('Choose either --session or --socket');
    const selectedSocket = values.socket || (values.session ? undefined : process.env.HERDR_SOCKET_PATH);
    const socketPath = selectedSocket ? path.resolve(selectedSocket) : undefined;
    const session = values.session || (socketPath ? undefined : 'default');

    if (command === 'status') {
      const status = await runningStatus(stateDir);
      show(status ? { status: 'running', ...status, tunnel: await tunnelStatus(stateDir, status.pid) } : { status: 'stopped', stateDir }, values);
      return 0;
    }
    if (command === 'stop') {
      const current = await runningStatus(stateDir);
      if (!current) { show({ status: 'stopped' }, values); return 0; }
      try { await adminRequest(stateDir, 'stop'); }
      catch (error) { if (!['EPIPE', 'ECONNRESET'].includes(error.code)) throw error; }
      await waitForStopped(stateDir, current.pid);
      show({ status: 'stopped' }, values);
      return 0;
    }
    if (command === 'connect') {
      const current = await runningStatus(stateDir);
      if (!current) throw new Error('OpenHerdr is stopped. Run openherdr start --cf, then connect --qr.');
      if (suppliedServer) await adminRequest(stateDir, 'origin.add', { origin: suppliedServer });
      const pair = await adminRequest(stateDir, 'pair', { label: values.label, server: suppliedServer || current.publicOrigins?.at(-1) || undefined });
      await showPairing(pair, values);
      return 0;
    }
    if (command === 'ssh') {
      if (!values.target || values.target.startsWith('-') || /[\s\x00-\x1f]/.test(values.target)) throw new Error('ssh requires --target with an existing SSH host or alias');
      const remotePort = portNumber(values['remote-port'], 'remote-port');
      const ssh = spawn('ssh', ['-N', '-o', 'ExitOnForwardFailure=yes', '-L', `127.0.0.1:${port}:127.0.0.1:${remotePort}`, '--', values.target], { stdio: 'inherit' });
      return await new Promise((resolve, reject) => { ssh.once('error', reject); ssh.once('exit', (code) => resolve(code ?? 1)); });
    }
    if (!['start', 'serve'].includes(command)) throw new Error(`Unknown command: ${command}`);
    const current = await runningStatus(stateDir);
    if (current) {
      const { createHerdrBridge } = await import('../server/herdr/bridge.js');
      const expectedSocket = socketPath || (values.session ? createHerdrBridge({ session }).socketPath : undefined);
      if (expectedSocket && expectedSocket !== current.socketPath) {
        throw new Error('This state directory already serves a different Herdr target. Choose another --state-dir and --port.');
      }
      const currentTunnel = await tunnelStatus(stateDir, current.pid, cloudflare);
      if (cloudflare && !(cloudflare.mode === 'quick' && currentTunnel?.mode === null) && currentTunnel?.connector !== 'first-connected') {
        throw new Error('The running bridge does not confirm this Cloudflare configuration. Stop it first or choose another --state-dir and --port.');
      }
      show({ status: 'running', ...current, tunnel: currentTunnel }, values);
      return 0;
    }
    await mkdir(stateDir, { recursive: true, mode: 0o700 });
    await chmod(stateDir, 0o700);
    if (command === 'start') {
      const log = await open(path.join(stateDir, 'server.log'), 'a', 0o600);
      const args = [executable, 'serve', '--state-dir', stateDir, '--host', values.host, '--port', String(port)];
      if (socketPath) args.push('--socket', socketPath);
      if (session) args.push('--session', session);
      for (const origin of origins) args.push('--public-origin', origin);
      const launchId = randomUUID();
      if (cloudflare) {
        args.push('--cf', '--cf-mode', cloudflare.mode);
        if (suppliedServer) args.push('--server', suppliedServer);
        if (cloudflare.tokenFile) args.push('--cf-token-file', cloudflare.tokenFile);
        if (cloudflare.configFile) args.push('--cf-config', cloudflare.configFile);
      }
      const child = spawn(process.execPath, args, { env: { ...process.env, OPENHERDR_TUNNEL_LAUNCH_ID: launchId }, stdio: ['ignore', log.fd, log.fd], detached: true, windowsHide: true });
      let childExited = false;
      let childError = false;
      let cancelled = false;
      const cancelStart = () => { cancelled = true; };
      process.once('SIGTERM', cancelStart);
      process.once('SIGINT', cancelStart);
      child.once('error', () => { childError = true; childExited = true; });
      child.once('exit', () => { childExited = true; });
      child.unref();
      await log.close();
      const deadline = Date.now() + (cloudflare ? 40000 : 12000);
      let status;
      let connector;
      let ready = false;
      try {
        while (Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 100));
          if (cancelled) throw new Error('Bridge startup was cancelled');
          if (childExited) throw new Error(childError ? 'Bridge process could not start' : 'Bridge exited before startup completed');
          status = await runningStatus(stateDir);
          if (status?.pid !== child.pid) continue;
          connector = await tunnelStatus(stateDir, child.pid, cloudflare ? { ...cloudflare, launchId } : undefined);
          if (!cloudflare || connector?.connector === 'first-connected') { ready = true; break; }
        }
        if (!ready || childExited) throw new Error(`Bridge startup did not finish. Inspect ${path.join(stateDir, 'server.log')}`);
      } catch (error) {
        // Only the child handle created by this invocation authorizes termination.
        if (!childExited) {
          child.ref();
          const exit = new Promise((resolve) => child.once('exit', resolve));
          child.kill('SIGTERM');
          await exit;
        }
        throw error;
      } finally {
        process.off('SIGTERM', cancelStart);
        process.off('SIGINT', cancelStart);
      }
      show({ status: 'running', ...status, tunnel: connector }, values);
      return 0;
    }

    const controller = new AbortController();
    let app;
    let tunnel;
    let tunnelStartup = Promise.resolve(null);
    let shuttingDown;
    const shutdown = () => {
      controller.abort();
      shuttingDown ??= (async () => {
        const ownedTunnel = await tunnelStartup.catch(() => null);
        try { await ownedTunnel?.stop(); } finally { await app?.close(); }
      })();
      return shuttingDown;
    };
    const signalStop = () => { shutdown().catch(() => {}); };
    // Signals can arrive while imports or tunnel startup are still pending.
    process.once('SIGTERM', signalStop);
    process.once('SIGINT', signalStop);
    try {
      const { startHerdrServer } = await import('../server/herdr/index.js');
      controller.signal.throwIfAborted();
      app = await startHerdrServer({ host: values.host, port, session, socketPath, stateDir, publicOrigins: origins, staticDir: path.join(webRoot, 'dist-herdr'), onStopRequested: shutdown });
      const closed = new Promise((resolve) => app.server.once('close', () => { controller.abort(); resolve(); }));
      controller.signal.throwIfAborted();
      if (cloudflare) {
        tunnelStartup = startTunnel({ origin: `http://127.0.0.1:${port}`, stateDir, options: cloudflare, signal: controller.signal, launchId: process.env.OPENHERDR_TUNNEL_LAUNCH_ID || randomUUID() });
        tunnel = await tunnelStartup;
        controller.signal.throwIfAborted();
        await adminRequest(stateDir, 'origin.add', { origin: tunnel.publicOrigin });
      }
      controller.signal.throwIfAborted();
      const status = await adminRequest(stateDir, 'status');
      show({ status: 'running', ...status, tunnel: await tunnelStatus(stateDir, status.pid) }, values);
      if (values.qr || values.open) await showPairing(await adminRequest(stateDir, 'pair', { label: values.label, server: suppliedServer || tunnel?.publicOrigin }), values);
      await closed;
    } finally {
      controller.abort();
      // A signal during an earlier await may have closed the partial app before
      // the tunnel handle became available. Join both final owners here.
      try {
        const ownedTunnel = await tunnelStartup.catch(() => null);
        try { await ownedTunnel?.stop(); } finally { await app?.close(); }
        await shuttingDown;
      } finally {
        process.off('SIGTERM', signalStop);
        process.off('SIGINT', signalStop);
      }
    }
    return 0;
  } catch (error) {
    if (values?.json || argv.includes('--json')) console.log(JSON.stringify({ error: { code: 'openherdr_cli', message: error.message } }));
    else console.error(`OpenHerdr: ${error.message}`);
    return 1;
  }
}

if (import.meta.main) process.exitCode = await runOpenHerdr();
