import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { ApiError } from './contracts.js';

const source = readFileSync(new URL('./host-helper.py', import.meta.url), 'utf8');
const fixedRemoteCommand = "python3 -c '" + source.replaceAll("'", "'\"'\"'") + "'";
const wireResponse = z.union([
  z.strictObject({ result: z.json() }),
  z.strictObject({ error: z.strictObject({ status: z.number().int().min(400).max(599), code: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/), message: z.string().max(1024), confirmedNoEffect: z.boolean() }) }),
]);

// The helper source and SSH command are fixed. Only parsed request JSON reaches stdin.
export function runHostOperation({ request, socketPath, profile, spawnProcess = spawn, sshBinary = 'ssh', pythonBinary = 'python3', timeoutMs = 30000 }) {
  return new Promise((resolve, reject) => {
    const remote = Boolean(profile);
    const binary = remote ? sshBinary : pythonBinary;
    const args = remote ? ['-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '--', profile.target, fixedRemoteCommand] : ['-c', source];
    const env = { ...process.env, HERDR_SOCKET_PATH: undefined, HERDR_SESSION: undefined, HERDR_PANE_ID: undefined, HERDR_TAB_ID: undefined, HERDR_WORKSPACE_ID: undefined };
    const child = spawnProcess(binary, args, { stdio: ['pipe', 'pipe', 'pipe'], env });
    const chunks = [];
    let bytes = 0;
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy(); child.kill();
      error ? reject(error) : resolve(result);
    };
    const unavailable = (code, message, confirmedNoEffect = false) => {
      const error = new ApiError(502, code, message);
      error.confirmedNoEffect = confirmedNoEffect;
      return error;
    };
    const timer = setTimeout(() => finish(unavailable('host_timeout', 'The host operation timed out. Check its current state before retrying')), timeoutMs);
    child.on('error', (error) => finish(unavailable('host_transport_unavailable', 'The host transport could not start', error.code === 'ENOENT')));
    child.stdin.on('error', () => finish(unavailable('host_transport_disconnected', 'The host request could not be delivered')));
    child.stderr.resume();
    child.stdout.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > 16 * 1024 * 1024) return finish(unavailable('host_response_too_large', 'The host response exceeded 16 MiB'));
      chunks.push(chunk);
    });
    child.on('close', (code) => {
      if (code === 127) {
        const error = new ApiError(501, remote ? 'remote_python_unavailable' : 'host_python_unavailable', 'Python3 is unavailable on the selected host');
        error.confirmedNoEffect = true;
        return finish(error);
      }
      if (code !== 0) return finish(unavailable('host_transport_disconnected', 'The host disconnected before returning a result'));
      const parsed = wireResponse.safeParse((() => {
        try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
        catch { return null; }
      })());
      if (!parsed.success) return finish(unavailable('invalid_host_response', 'The host returned an incomplete or invalid response'));
      if (parsed.data.error) {
        const body = parsed.data.error;
        const error = new ApiError(body.status, body.code, body.message);
        error.confirmedNoEffect = body.confirmedNoEffect;
        return finish(error);
      }
      finish(null, parsed.data.result);
    });
    child.stdin.end(JSON.stringify({ request, ...(remote ? { session: profile.session } : { socketPath }) }) + '\n');
  });
}
