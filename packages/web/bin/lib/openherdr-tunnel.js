import { execFile, spawn } from 'node:child_process';
import { access, mkdtemp, readFile, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { z } from 'zod';
import { readEnterprisePolicy } from '../../server/lib/enterprise-mode.js';

const modes = ['quick', 'managed-remote', 'managed-local'];
const execute = promisify(execFile);
const publicOriginSchema = z.string().url().refine((value) => { const url = new URL(value); return url.protocol === 'https:' && url.origin === value; });
const pidSchema = z.number().int().positive().safe();
const receiptSchema = z.union([
  z.object({ version: z.literal(2), launchId: z.string().uuid(), ownerPid: pidSchema, pid: pidSchema, mode: z.enum(modes), publicOrigin: publicOriginSchema, connectedAt: z.string(), pidFile: z.string(), tokenFile: z.string().nullable(), configFile: z.string().nullable() }),
  z.object({ publicOrigin: publicOriginSchema, pid: pidSchema.optional() }),
]);

export function tunnelOptions(values, command, publicOrigin) {
  const mode = values['cf-mode'] ?? 'quick';
  const tokenFile = values['cf-token-file'];
  const configFile = values['cf-config'];
  const selected = values.cf || values['cf-mode'] !== undefined || tokenFile !== undefined || configFile !== undefined;
  if (!selected) return null;
  if (!['start', 'serve'].includes(command)) throw new Error('Cloudflare options apply only to start and serve');
  if (!values.cf) throw new Error('Cloudflare mode and file options require --cf');
  if (!modes.includes(mode)) throw new Error('--cf-mode must be quick, managed-remote or managed-local');
  if (mode === 'quick' && (tokenFile !== undefined || configFile !== undefined)) throw new Error('Quick Tunnel does not accept --cf-token-file or --cf-config');
  if (mode !== 'quick' && (!publicOrigin || !publicOrigin.startsWith('https://'))) throw new Error('Managed Cloudflare modes require --server with an HTTPS origin');
  if (mode === 'managed-remote' && (!tokenFile || configFile !== undefined)) throw new Error('managed-remote requires --cf-token-file and does not accept --cf-config');
  if (mode === 'managed-local' && (!configFile || tokenFile !== undefined)) throw new Error('managed-local requires --cf-config and does not accept --cf-token-file');
  return { mode, publicOrigin: mode === 'quick' ? null : publicOrigin, tokenFile: tokenFile ? path.resolve(tokenFile) : null, configFile: configFile ? path.resolve(configFile) : null };
}

export async function validateTunnelInput(options) {
  if (!options) return;
  if (readEnterprisePolicy().enterpriseMode) throw new Error('Cloudflare tunnels are disabled in enterprise mode');
  const file = options.tokenFile || options.configFile;
  if (!file) return;
  try {
    const info = await stat(file);
    if (!info.isFile() || info.size === 0) throw new Error();
    await access(file, constants.R_OK);
  } catch { throw new Error(`Cloudflare ${options.mode === 'managed-remote' ? 'token' : 'config'} file must be an existing readable non-empty file`); }
}

// Receipts are observations only. A PID read from disk never authorizes a signal.
async function receipt(stateDir) {
  try { const parsed = receiptSchema.safeParse(JSON.parse(await readFile(path.join(stateDir, 'tunnel.json'), 'utf8'))); return parsed.success ? parsed.data : null; }
  catch (error) { if (error.code === 'ENOENT' || error instanceof SyntaxError) return null; throw error; }
}

function alive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

async function confirmed(record, stateDir, ownerPid, expected) {
  if (!record || record.version !== 2 || record.ownerPid !== ownerPid || !modes.includes(record.mode) || !record.publicOrigin || !record.connectedAt) return false;
  if (expected && ((expected.launchId && record.launchId !== expected.launchId) || record.mode !== expected.mode || (expected.publicOrigin && record.publicOrigin !== expected.publicOrigin) || record.tokenFile !== expected.tokenFile || record.configFile !== expected.configFile)) return false;
  if (!record.pidFile || path.dirname(path.dirname(record.pidFile)) !== stateDir || !path.basename(path.dirname(record.pidFile)).startsWith('.cloudflared-') || path.basename(record.pidFile) !== 'connected.pid') return false;
  if (!alive(record.pid) || !alive(ownerPid)) return false;
  try {
    if ((await readFile(record.pidFile, 'utf8')).trim() !== String(record.pid)) return false;
    const result = process.platform === 'win32'
      ? await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `(Get-CimInstance Win32_Process -Filter 'ProcessId = ${record.pid}').ParentProcessId`], { windowsHide: true, timeout: 2000, maxBuffer: 1024 })
      : await execute('ps', ['-o', 'ppid=', '-p', String(record.pid)], { timeout: 2000, maxBuffer: 1024 });
    return Number(result.stdout.trim()) === ownerPid;
  } catch { return false; }
}

export async function tunnelStatus(stateDir, ownerPid, expected) {
  const record = await receipt(stateDir);
  if (!record) return null;
  const ready = await confirmed(record, stateDir, ownerPid, expected);
  const exited = record.version === 2 && record.ownerPid === ownerPid && !alive(record.pid);
  const status = { mode: record.version === 2 && modes.includes(record.mode) ? record.mode : null, publicOrigin: record.publicOrigin || null, connector: ready ? 'first-connected' : exited ? 'exited' : 'unconfirmed', publicRouting: 'unverified' };
  if (exited) status.reason = 'Cloudflare connector process has exited';
  return status;
}

export async function startTunnel({ origin, stateDir, options, launchId = randomUUID(), signal, executable = 'cloudflared', env = process.env, timeoutMs = 30000, stopGraceMs = 3000 }) {
  await validateTunnelInput(options);
  signal?.throwIfAborted();
  const launchDir = await mkdtemp(path.join(stateDir, '.cloudflared-'));
  const pidFile = path.join(launchDir, 'connected.pid');
  const receiptPath = path.join(stateDir, 'tunnel.json');
  const tempReceipt = path.join(launchDir, 'receipt.json');
  let child;
  let exited = false;
  let spawnFailed = false;
  let exitCode;
  let exitResolve;
  let stopping;
  let publicOrigin = options.publicOrigin;
  const exit = new Promise((resolve) => { exitResolve = resolve; });
  async function retire() {
    const current = await receipt(stateDir);
    if (current?.version === 2 && current.launchId === launchId && current.ownerPid === process.pid) await unlink(receiptPath).catch((error) => { if (error.code !== 'ENOENT') throw error; });
    await rm(launchDir, { recursive: true, force: true });
  }
  function stop() {
    stopping ??= (async () => {
      if (child && !exited) {
        child.kill('SIGTERM');
        const force = setTimeout(() => { if (!exited) child.kill('SIGKILL'); }, stopGraceMs);
        try { await exit; } finally { clearTimeout(force); }
      }
      await retire();
    })();
    return stopping;
  }
  try {
    let configFile = options.configFile;
    if (!configFile) {
      configFile = path.join(launchDir, 'empty.yml');
      await writeFile(configFile, '# OpenHerdr explicitly disables default configuration discovery.\n', { mode: 0o600, flag: 'wx' });
    }
    signal?.throwIfAborted();
    const args = ['tunnel', '--config', configFile, '--no-autoupdate', '--protocol', 'http2', '--pidfile', pidFile];
    if (options.mode === 'quick') args.push('--url', origin);
    else if (options.mode === 'managed-remote') args.push('run', '--token-file', options.tokenFile);
    else args.push('run');
    const childEnv = Object.fromEntries(Object.entries(env).filter(([key]) => !key.toUpperCase().startsWith('TUNNEL_')));
    child = spawn(executable, args, { env: childEnv, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    child.once('error', () => { spawnFailed = true; exited = true; exitResolve(); });
    child.once('exit', (code) => { exited = true; exitCode = code; exitResolve(); });
    // Managed output may contain credentials, paths or account details. Consume it
    // without logging or incorporating it into errors. Quick inspects only its URL.
    let buffer = '';
    const inspect = (chunk) => {
      if (options.mode !== 'quick' || publicOrigin) return;
      buffer = (buffer + chunk.toString()).slice(-16384);
      publicOrigin = buffer.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com\b/)?.[0] ?? null;
    };
    child.stdout.on('data', inspect);
    child.stderr.on('data', inspect);
    const deadline = Date.now() + timeoutMs;
    while (true) {
      signal?.throwIfAborted();
      if (spawnFailed) throw new Error('Cloudflare could not start. Check that cloudflared is installed and executable');
      if (exited) throw new Error(`Cloudflare exited during startup (${exitCode ?? 'signal'})`);
      let pidReady = false;
      try { pidReady = (await readFile(pidFile, 'utf8')).trim() === String(child.pid); } catch (error) { if (error.code !== 'ENOENT') throw new Error('Cloudflare connection receipt could not be read'); }
      if (pidReady && publicOrigin) break;
      if (Date.now() >= deadline) throw new Error('Cloudflare did not confirm its first connection within the startup deadline');
      await delay(Math.min(50, Math.max(1, deadline - Date.now())), undefined, { signal });
    }
    signal?.throwIfAborted();
    if (exited) throw new Error('Cloudflare exited during startup');
    const record = { version: 2, launchId, ownerPid: process.pid, pid: child.pid, mode: options.mode, publicOrigin, connectedAt: new Date().toISOString(), pidFile, tokenFile: options.tokenFile, configFile: options.configFile };
    await writeFile(tempReceipt, JSON.stringify(record), { mode: 0o600, flag: 'wx' });
    await rename(tempReceipt, receiptPath);
    signal?.throwIfAborted();
    if (exited) throw new Error('Cloudflare exited during startup');
    return { publicOrigin, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}
