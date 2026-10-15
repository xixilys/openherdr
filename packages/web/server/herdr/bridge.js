import net from 'node:net';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID, createHash } from 'node:crypto';
import { lstat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ApiError } from './contracts.js';
import { z } from 'zod';
import { runHostOperation } from './host-transport.js';
import { openHostAsset } from './asset-transport.js';
import { parseAssetDescribeRequest, parseAssetRawRequest } from './asset-protocol.js';

const exec = promisify(execFile);
const cliErrorBody = z.strictObject({ code: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/), message: z.string().max(65536) });
const savedMachines = z.array(z.object({
  id: z.string().min(1).max(160).regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/),
  label: z.string().min(1).max(160),
  target: z.string().min(1).max(1024).regex(/^[A-Za-z0-9_][A-Za-z0-9_.@:[\]%-]*$/),
  session: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  enabled: z.boolean().optional(),
}));
const rpcResponse = z.union([
  z.strictObject({ id: z.string(), result: z.json() }),
  z.strictObject({ id: z.string(), error: cliErrorBody }),
]);

// Request bytes travel only on stdin. This fixed program never evaluates input.
const REMOTE_RPC_SCRIPT = String.raw`
import json, os, select, shutil, signal, socket, subprocess, sys
LIMIT = 16 * 1024 * 1024
payload = json.loads(sys.stdin.buffer.readline(256 * 1024))
request = payload.get('request')
session = payload['session']
dispatched = False
try:
    env = dict(os.environ)
    for key in ['HERDR_SOCKET_PATH', 'HERDR_CLIENT_SOCKET_PATH', 'HERDR_SESSION', 'HERDR_PANE_ID', 'HERDR_TAB_ID', 'HERDR_WORKSPACE_ID']:
        env.pop(key, None)
    binary = env.get('HERDR_BIN_PATH') or shutil.which('herdr')
    if not binary:
        raise RuntimeError('Herdr executable unavailable')
    status_process = subprocess.run([binary, '--session', session, 'status', 'server', '--json'], env=env, capture_output=True, timeout=10)
    if status_process.returncode != 0 or len(status_process.stdout) > 65536:
        raise RuntimeError('Herdr status unavailable')
    status = json.loads(status_process.stdout)
    expected_sessions = [None, 'default'] if session == 'default' else [session]
    socket_path = status.get('socket')
    if status.get('running') is not True or status.get('compatible') is not True or status.get('endpoint_compatible') is not True or status.get('protocol') != 22 or type(status.get('protocol')) is not int or status.get('session') not in expected_sessions or not isinstance(socket_path, str) or not os.path.isabs(socket_path):
        raise RuntimeError('Herdr status does not identify the selected session')
    if payload.get('observe'):
        observation = payload['observe']
        env['HERDR_SOCKET_PATH'] = socket_path
        observer = subprocess.Popen([binary, '--session', session, 'terminal', 'session', 'observe', observation['pane_id'], '--cols', str(observation['cols']), '--rows', str(observation['rows'])], env=env, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE)
        def stop(signum, frame):
            raise SystemExit(0)
        signal.signal(signal.SIGTERM, stop)
        signal.signal(signal.SIGHUP, stop)
        try:
            while True:
                ready, _, _ = select.select([sys.stdin.buffer, observer.stdout], [], [], 1)
                if sys.stdin.buffer in ready:
                    break
                if observer.stdout in ready:
                    chunk = os.read(observer.stdout.fileno(), 65536)
                    if not chunk:
                        break
                    sys.stdout.buffer.write(chunk)
                    sys.stdout.buffer.flush()
                if observer.poll() is not None and not ready:
                    break
        finally:
            if observer.poll() is None:
                observer.terminate()
            try:
                observer.wait(timeout=2)
            except subprocess.TimeoutExpired:
                observer.kill()
                observer.wait()
        if observer.returncode:
            sys.stdout.write(json.dumps({'type': 'terminal.error', 'error': 'Remote terminal observer stopped'}) + '\n')
        raise SystemExit(0)
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as connection:
        connection.settimeout(payload['timeoutMs'] / 1000)
        connection.connect(socket_path)
        dispatched = True
        connection.sendall((json.dumps(request, ensure_ascii=False) + '\n').encode('utf-8'))
        with connection.makefile('rb') as stream:
            consumed = 0
            while True:
                line = stream.readline(LIMIT + 1 - consumed)
                consumed += len(line)
                if not line or consumed > LIMIT or not line.endswith(b'\n'):
                    raise RuntimeError('Herdr response unavailable')
                response = json.loads(line)
                if response.get('id') == request['id']:
                    sys.stdout.buffer.write(line)
                    sys.stdout.buffer.flush()
                    break
except Exception:
    if request is None:
        sys.stdout.write(json.dumps({'type': 'terminal.error', 'error': 'Remote terminal observation unavailable'}) + '\n')
    else:
        code = 'openherdr_outcome_unknown' if dispatched else 'openherdr_remote_unavailable'
        sys.stdout.write(json.dumps({'id': request['id'], 'error': {'code': code, 'message': 'Remote Herdr request could not complete'}}) + '\n')
`;
const REMOTE_RPC_COMMAND = "python3 -c '" + REMOTE_RPC_SCRIPT.replaceAll("'", "'\"'\"'") + "'";

function sshRpc(profile, method, params, timeoutMs, spawnProcess, sshBinary) {
  return new Promise((resolve, reject) => {
    const request = { id: randomUUID(), method, params };
    const child = spawnProcess(sshBinary, ['-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '--', profile.target, REMOTE_RPC_COMMAND], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, HERDR_SOCKET_PATH: undefined, HERDR_SESSION: undefined } });
    let settled = false;
    let output = '';
    const finish = (error, response) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy(); child.kill();
      error ? reject(error) : resolve(response);
    };
    const timer = setTimeout(() => finish(new Error('SSH Herdr request timed out')), timeoutMs + 12000);
    child.stdout.setEncoding('utf8');
    child.on('error', () => finish(new Error('SSH Herdr transport could not start')));
    child.stdin.on('error', () => finish(new Error('SSH Herdr request could not be delivered')));
    child.stderr.resume();
    child.stdout.on('data', (chunk) => {
      output += chunk;
      if (Buffer.byteLength(output) > 16 * 1024 * 1024) finish(new Error('SSH Herdr response exceeded the size limit'));
    });
    child.on('close', (code) => {
      if (code === 127) {
        const error = new ApiError(501, 'remote_python_unavailable', 'Remote Python3 is unavailable');
        error.confirmedNoEffect = true;
        return finish(error);
      }
      if (code !== 0) return finish(new Error('SSH Herdr transport disconnected'));
      try {
        const response = rpcResponse.parse(JSON.parse(output));
        if (response.id !== request.id) throw new Error('SSH Herdr response ID does not match');
        if (response.error?.code === 'openherdr_remote_unavailable') {
          const error = new ApiError(501, 'remote_herdr_unavailable', 'Remote Herdr session or Python3 bridge is unavailable');
          error.confirmedNoEffect = true;
          return finish(error);
        }
        if (response.error?.code === 'openherdr_outcome_unknown') return finish(new Error('Remote Herdr disconnected after dispatch'));
        if (response.error) return finish(herdrRpcError(method, response.error));
        finish(null, response);
      } catch (error) { finish(error); }
    });
    child.stdin.end(`${JSON.stringify({ session: profile.session, request, timeoutMs })}\n`);
  });
}

export function herdrRpcError(method, body) {
  const parsed = cliErrorBody.safeParse(body);
  const code = parsed.success ? parsed.data.code : 'herdr_error';
  const error = new ApiError(502, code, 'Herdr refused this request');
  // These identifier checks precede effects. Agent startup can have partial effects.
  error.confirmedNoEffect = method !== 'agent.start' && ['invalid_pane', 'invalid_tab', 'invalid_workspace', 'pane_not_found', 'tab_not_found', 'workspace_not_found'].includes(code);
  return error;
}
function socketRpc(socketPath, method, params, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const id = randomUUID();
    const connection = net.createConnection(socketPath);
    connection.setEncoding('utf8');
    let data = '';
    const finish = (error, result) => { connection.destroy(); error ? reject(error) : resolve(result); };
    connection.setTimeout(timeoutMs, () => finish(new Error('Herdr response timed out')));
    connection.on('error', (error) => finish(error));
    connection.on('connect', () => connection.write(`${JSON.stringify({ id, method, params })}\n`));
    connection.on('data', (chunk) => {
      data += chunk.toString('utf8');
      if (data.length > 16 * 1024 * 1024) return finish(new Error('Herdr response exceeded the size limit'));
      let end;
      while ((end = data.indexOf('\n')) !== -1) {
        const line = data.slice(0, end); data = data.slice(end + 1);
        try {
          const response = JSON.parse(line);
          if (response.id !== id) continue;
          if (response.error) return finish(herdrRpcError(method, response.error));
          if (!Object.hasOwn(response, 'result')) return finish(new Error('Invalid Herdr response'));
          return finish(null, response);
        } catch (error) { return finish(error); }
      }
    });
    connection.on('end', () => finish(new Error('Herdr disconnected before returning a result')));
  });
}

export function createHerdrBridge({ session, socketPath, herdrBinary = 'herdr', execute = exec, timeoutMs = 15000, spawnProcess = spawn, sshBinary = 'ssh' } = {}) {
  if (!socketPath && (!session || !/^[a-zA-Z0-9_-]{1,64}$/.test(session))) throw new Error('A named Herdr session or explicit socketPath is required');
  const configDir = process.env.HERDR_CONFIG_PATH ? path.dirname(process.env.HERDR_CONFIG_PATH) : path.join(os.homedir(), '.config/herdr');
  const localSocket = path.resolve(socketPath || (session === 'default' ? path.join(configDir, 'herdr.sock') : path.join(configDir, 'sessions', session, 'herdr.sock')));
  const run = async (args, signal) => {
    const { stdout } = await execute(herdrBinary, args, { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, signal, env: { ...process.env, HERDR_SOCKET: undefined, HERDR_SOCKET_PATH: undefined, HERDR_PANE_ID: undefined, HERDR_TAB_ID: undefined, HERDR_WORKSPACE_ID: undefined } });
    return JSON.parse(stdout);
  };
  const profiles = async (signal) => savedMachines.parse(await run(['machine', 'list', '--json'], signal));
  const machines = async () => {
    const saved = await profiles();
    return [{ id: 'local', label: 'Local' }, ...saved.filter((m) => m.enabled !== false).map(({ id, label }) => ({ id, label }))];
  };
  const assetTarget = async (machine, signal, expectedBinding) => {
    const checkAbort = () => { if (signal?.aborted) throw new ApiError(499, 'asset_cancelled', 'The file read was cancelled'); };
    checkAbort();
    let profile;
    let identity;
    if (machine === 'local') {
      let info;
      try { info = await lstat(localSocket, { bigint: true }); }
      catch { throw new ApiError(502, 'herdr_unavailable', 'The selected Herdr socket is unavailable'); }
      if (!info.isSocket()) throw new ApiError(502, 'herdr_unavailable', 'The selected Herdr socket is unavailable');
      identity = ['local', localSocket, String(info.dev), String(info.ino)];
    } else {
      let saved;
      try { saved = await profiles(signal); }
      catch (error) { checkAbort(); throw error; }
      profile = saved.find((entry) => entry.id === machine && entry.enabled !== false);
      if (!profile) throw new ApiError(400, 'unknown_machine', 'Choose a saved Herdr machine');
      identity = ['ssh', profile.target, profile.session];
    }
    checkAbort();
    const binding = createHash('sha256').update(JSON.stringify(identity)).digest('hex');
    if (expectedBinding !== undefined && binding !== expectedBinding) throw new ApiError(409, 'target_changed', 'The saved file host changed. Open the file again');
    return { binding, profile, socketPath: profile ? undefined : localSocket };
  };
  const describeAsset = async (input, { signal, expectedBinding } = {}) => {
    const request = parseAssetDescribeRequest(input);
    const target = await assetTarget(request.machine, signal, expectedBinding);
    const opened = await openHostAsset({ request, ...target, signal, headOnly: true, validateTarget: () => assetTarget(request.machine, signal, target.binding), spawnProcess, sshBinary });
    try { return { binding: target.binding, metadata: opened.metadata }; }
    finally { await opened.close(); }
  };
  return {
    socketPath: localSocket,
    machines,
    describeAsset,
    async openAsset(input, { signal, expectedBinding, range = null, headOnly = false } = {}) {
      const request = parseAssetRawRequest(input);
      const target = await assetTarget(request.machine, signal, expectedBinding);
      return openHostAsset({ request, ...target, signal, range, headOnly, validateTarget: () => assetTarget(request.machine, signal, target.binding), spawnProcess, sshBinary });
    },
    async host(request) {
      if (request.operation === 'files.describe') return (await describeAsset(request)).metadata;
      if (request.machine === 'local') return runHostOperation({ request, socketPath: localSocket, spawnProcess, sshBinary });
      const profile = (await profiles()).find((entry) => entry.id === request.machine && entry.enabled !== false);
      if (!profile) throw new ApiError(400, 'unknown_machine', 'Choose a saved Herdr machine');
      return runHostOperation({ request, profile, spawnProcess, sshBinary });
    },
    async rpc(machine, method, params) {
      if (machine === 'local') return socketRpc(localSocket, method, params, method === 'agent.start' ? (params.timeout_ms || 30000) + 2000 : timeoutMs);
      const profile = (await profiles()).find((entry) => entry.id === machine && entry.enabled !== false);
      if (!profile) throw new ApiError(400, 'unknown_machine', 'Choose a saved Herdr machine');
      return sshRpc(profile, method, params, method === 'agent.start' ? (params.timeout_ms || 30000) + 2000 : timeoutMs, spawnProcess, sshBinary);
    },
    async observe(machine, paneId, cols, rows) {
      let binary = herdrBinary;
      let argv = [...(socketPath ? [] : ['--session', session]), 'terminal', 'session', 'observe', paneId, '--cols', String(cols), '--rows', String(rows)];
      let observation;
      if (machine !== 'local') {
        const profile = (await profiles()).find((entry) => entry.id === machine && entry.enabled !== false);
        if (!profile) throw new ApiError(400, 'unknown_machine', 'Choose a saved Herdr machine');
        binary = sshBinary;
        argv = ['-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '--', profile.target, REMOTE_RPC_COMMAND];
        observation = { session: profile.session, observe: { pane_id: paneId, cols, rows } };
      }
      return new Promise((resolve, reject) => {
        const child = spawnProcess(binary, argv, { stdio: [observation ? 'pipe' : 'ignore', 'pipe', 'pipe'], env: { ...process.env, HERDR_SOCKET: undefined, HERDR_SOCKET_PATH: machine === 'local' && socketPath ? socketPath : undefined, HERDR_PANE_ID: undefined, HERDR_TAB_ID: undefined, HERDR_WORKSPACE_ID: undefined } });
        // Listen before yielding to authentication or any other async operation.
        child.on('error', reject);
        if (observation) {
          child.stdin.on('error', reject);
          child.once('exit', () => child.stdin.destroy());
        }
        child.once('spawn', () => {
          if (observation) child.stdin.write(`${JSON.stringify(observation)}\n`);
          resolve(child);
        });
      });
    },
  };
}
