import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { OpenCode } from '@opencode/client';
import { Service } from '@opencode/client/service';
import { ApiError } from '../contracts.js';
import { isSupportedOpenCodeVersion } from '../../lib/opencode/compatibility.js';
import { readEnterprisePolicy } from '../../lib/enterprise-mode.js';
import { z } from 'zod';

const infoSchema = z.object({ version: z.string(), pid: z.number().int().positive() });
const exited = (child) => child.exitCode !== null || child.signalCode != null;
async function stopOwnedChild(child) {
  if (exited(child)) return;
  await new Promise((resolve, reject) => {
    let forcedTimer;
    const cleanup = () => { clearTimeout(timer); clearTimeout(forcedTimer); child.off('exit', onExit); };
    const onExit = () => { cleanup(); resolve(); };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      forcedTimer = setTimeout(() => { cleanup(); reject(new ApiError(503, 'conversation_stop_timeout', 'The private OpenCode child did not confirm shutdown')); }, 1000);
    }, 2000);
    child.once('exit', onExit); child.kill('SIGTERM');
  });
}
export function loopbackEndpoint(endpoint) {
  const url = new URL(endpoint.url);
  if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new ApiError(403, 'conversation_endpoint_forbidden', 'OpenCode must use a verified local loopback service');
  }
  return endpoint;
}

export function createConversationRuntime({ stateDir, opencodeBinary = 'opencode', discover = Service.discover, spawnProcess = spawn, makeClient = OpenCode.make, readPolicy = readEnterprisePolicy }) {
  let owned;
  let starting;
  let closed = false;
  const controllers = new Set();
  const clientFor = async (endpoint, signal, kind = 'registered') => {
    loopbackEndpoint(endpoint);
    const client = makeClient({ baseUrl: endpoint.url, headers: Service.headers(endpoint) });
    const info = infoSchema.parse(await client.server.info({ signal: signal ?? AbortSignal.timeout(4000) }));
    if (!isSupportedOpenCodeVersion(info.version)) throw new ApiError(501, 'conversation_version_unsupported', 'This conversation driver requires a supported OpenCode 2 service at version 2.0.20 or newer');
    return { client, info, key: `${info.pid}:${endpoint.url}`, kind };
  };
  const start = async () => {
    const cwd = path.join(stateDir, 'runtime');
    await fs.mkdir(cwd, { recursive: true, mode: 0o700 });
    const password = randomBytes(32).toString('hex');
    const binary = readPolicy().opencodeBinary ?? opencodeBinary;
    const child = spawnProcess(binary, ['serve', '--hostname', '127.0.0.1', '--port', '0'], {
      cwd, env: { ...process.env, OPENCODE_PASSWORD: password, OPENCODE_SERVER_PASSWORD: undefined }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    const instance = { child, endpoint: undefined };
    owned = instance;
    child.once('exit', () => { instance.endpoint = undefined; if (owned === instance) owned = undefined; });
    child.stderr.resume();
    try {
      const url = await new Promise((resolve, reject) => {
        let output = '';
        const timer = setTimeout(() => { cleanup(); reject(new ApiError(503, 'conversation_start_timeout', 'The private OpenCode coordinator did not become ready')); }, 15000);
        const onData = (chunk) => {
          output += chunk.toString();
          if (output.length > 16384) { cleanup(); reject(new ApiError(502, 'conversation_start_failed', 'OpenCode returned an invalid startup response')); return; }
          const match = output.match(/(?:^|\n)server listening on (http:\/\/127\.0\.0\.1:\d+)\r?\n/);
          if (match) { cleanup(); resolve(match[1]); }
        };
        const onError = () => { cleanup(); reject(new ApiError(503, 'conversation_runtime_unavailable', 'OpenCode could not start')); };
        const cleanup = () => { clearTimeout(timer); child.stdout.off('data', onData); child.off('error', onError); child.off('exit', onError); };
        child.stdout.on('data', onData); child.once('error', onError); child.once('exit', onError);
      });
      child.stdout.resume();
      instance.endpoint = { url, auth: { type: 'basic', username: 'opencode', password } };
      const runtime = await clientFor(instance.endpoint, undefined, 'private');
      if (runtime.info.pid !== child.pid) throw new ApiError(409, 'conversation_coordinator_changed', 'The private OpenCode coordinator identity changed');
      return runtime;
    } catch (error) { await stopOwnedChild(child); if (owned === instance) owned = undefined; throw error; }
  };
  return {
    async get({ allowStart = false, kind, signal } = {}) {
      if (closed) throw new ApiError(503, 'conversation_closed', 'This conversation service has stopped');
      signal?.throwIfAborted();
      if (owned && exited(owned.child)) owned = undefined;
      if (kind !== 'private') {
        const endpoint = await discover();
        if (endpoint) return clientFor(endpoint, signal);
        if (kind === 'registered') throw new ApiError(503, 'conversation_coordinator_unavailable', 'The registered OpenCode coordinator is unavailable');
      }
      if (owned?.endpoint) return clientFor(owned.endpoint, signal, 'private');
      if (!allowStart) throw new ApiError(503, 'conversation_coordinator_unavailable', 'No verified local OpenCode coordinator is available');
      starting ??= start().finally(() => { starting = undefined; });
      return starting;
    },
    capture(signal) {
      const controller = new AbortController(); controllers.add(controller);
      return { signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal, release: () => controllers.delete(controller) };
    },
    async close() {
      closed = true;
      for (const controller of controllers) controller.abort();
      controllers.clear();
      if (starting) await starting.catch(() => undefined);
      if (owned?.child && !exited(owned.child)) {
        await stopOwnedChild(owned.child);
      }
    },
  };
}
