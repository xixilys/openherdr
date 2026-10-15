import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { ApiError } from './contracts.js';
import { assetHeaderSchema, assetCompletionSchema, parseAssetDescribeRequest, parseAssetRawRequest } from './asset-protocol.js';

const source = readFileSync(new URL('./host-helper.py', import.meta.url), 'utf8');
const fixedRemoteCommand = "python3 -c '" + source.replaceAll("'", "'\"'\"'") + "'";
const transportError = (code = 'asset_transport_failed', message = 'The file host disconnected before completing the read') => new ApiError(502, code, message);
const aborted = () => new ApiError(499, 'asset_cancelled', 'The file read was cancelled');

// Only this owned helper receives termination signals. Request values travel as
// JSON on stdin; the remote command contains only the fixed helper source.
export async function openHostAsset({ request: input, socketPath, profile, signal, range = null, headOnly = false, validateTarget, spawnProcess = spawn, sshBinary = 'ssh', pythonBinary = 'python3', timeoutMs = 30000 }) {
  const request = input.operation === 'files.describe' ? parseAssetDescribeRequest(input) : parseAssetRawRequest(input);
  if (signal?.aborted) throw aborted();
  if (range !== null && (!Number.isSafeInteger(range.start) || !Number.isSafeInteger(range.end) || range.start < 0 || range.end < range.start)) throw new ApiError(416, 'invalid_asset_range', 'The requested file range is unavailable');
  const remote = Boolean(profile);
  const argv = remote ? ['-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '--', profile.target, fixedRemoteCommand] : ['-c', source];
  const child = spawnProcess(remote ? sshBinary : pythonBinary, argv, { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, HERDR_SOCKET_PATH: undefined, HERDR_SESSION: undefined, HERDR_PANE_ID: undefined, HERDR_TAB_ID: undefined, HERDR_WORKSPACE_ID: undefined } });
  // ChildProcess resumes stdio on exit. Keep readable mode throughout target
  // validation and consumer pauses so that automatic flushing cannot drop bytes.
  const retainReadable = () => {};
  child.stdout.on('readable', retainReadable);
  let processError;
  let exitResult;
  const exited = new Promise((resolve) => {
    child.once('error', (error) => { processError = error; });
    child.once('close', (code, exitSignal) => { exitResult = { code, signal: exitSignal }; resolve(exitResult); });
  });
  let failure;
  const waiters = new Set();
  const fail = (error) => {
    failure ||= error;
    for (const reject of waiters) reject(failure);
  };
  let closing;
  let complete = false;
  let released = false;
  const detach = () => {
    signal?.removeEventListener('abort', onAbort);
    child.stdout.off('readable', retainReadable);
  };
  const waitExit = async (milliseconds) => {
    let timer;
    try { return await Promise.race([exited, new Promise((resolve) => { timer = setTimeout(() => resolve(null), milliseconds); })]); }
    finally { clearTimeout(timer); }
  };
  const close = () => {
    if (closing) return closing;
    released = true;
    if (!complete) fail(aborted());
    closing = (async () => {
      detach();
      child.stdin.destroy();
      child.stdout.destroy();
      child.stderr.destroy();
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
      if (!await waitExit(1000)) {
        child.kill('SIGKILL');
        if (!await waitExit(2000)) throw transportError('asset_cleanup_failed', 'The owned file helper did not exit');
      }
    })();
    return closing;
  };
  function onAbort() { fail(aborted()); void close().catch(() => {}); }
  signal?.addEventListener('abort', onAbort, { once: true });
  child.stdin.on('error', () => fail(transportError()));
  child.stdout.on('error', () => fail(transportError()));
  child.stderr.resume();
  let buffered = Buffer.alloc(0);
  const setupDeadline = Date.now() + timeoutMs;
  const waiting = async (promise, budget = timeoutMs) => {
    if (failure) throw failure;
    let timer;
    let rejectFailure;
    try {
      return await Promise.race([
        promise,
        new Promise((_, reject) => { rejectFailure = reject; waiters.add(reject); }),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new ApiError(504, 'asset_timeout', 'The file host stopped making progress')), Math.max(1, budget)); }),
      ]);
    } finally { clearTimeout(timer); waiters.delete(rejectFailure); }
  };
  const readChunk = async (deadline) => {
    let cleanup;
    const next = new Promise((resolve) => {
      let settled = false;
      const check = () => {
        if (settled) return;
        const available = Math.min(65536, child.stdout.readableLength);
        if (available) {
          const chunk = child.stdout.read(available);
          if (chunk !== null) { settled = true; resolve({ done: false, value: chunk }); return; }
        } else child.stdout.read(0);
        if (child.stdout.readableEnded || child.stdout.destroyed) { settled = true; resolve({ done: true }); }
      };
      cleanup = () => {
        child.stdout.off('readable', check);
        child.stdout.off('end', check);
        child.stdout.off('close', check);
      };
      child.stdout.on('readable', check);
      child.stdout.on('end', check);
      child.stdout.on('close', check);
      check();
    });
    try { return await waiting(next, deadline === undefined ? timeoutMs : deadline - Date.now()); }
    finally { cleanup(); }
  };
  const pull = async (deadline) => {
    const result = await readChunk(deadline);
    if (failure) throw failure;
    if (result.done) return false;
    if (!Buffer.isBuffer(result.value)) throw transportError('invalid_asset_response', 'The file host returned an invalid byte chunk');
    buffered = result.value;
    return true;
  };
  const line = async (limit, deadline) => {
    const pieces = [];
    let bytes = 0;
    while (true) {
      const newline = buffered.indexOf(10);
      if (newline >= 0) {
        if (bytes + newline > limit) throw transportError('invalid_asset_response', 'The file host returned an oversized frame');
        pieces.push(buffered.subarray(0, newline));
        buffered = buffered.subarray(newline + 1);
        try { return JSON.parse(Buffer.concat(pieces).toString('utf8')); }
        catch { throw transportError('invalid_asset_response', 'The file host returned an invalid frame'); }
      }
      bytes += buffered.length;
      if (bytes > limit) throw transportError('invalid_asset_response', 'The file host returned an oversized frame');
      if (buffered.length) pieces.push(buffered);
      buffered = Buffer.alloc(0);
      if (!await pull(deadline)) throw transportError('invalid_asset_response', 'The file host returned an incomplete frame');
    }
  };
  const finish = async (deadline) => {
    const footer = assetCompletionSchema.safeParse(await line(1024, deadline));
    if (!footer.success || buffered.length || await pull(deadline)) throw transportError('invalid_asset_response', 'The file host returned an invalid completion frame');
    const result = await waiting(exited, deadline === undefined ? timeoutMs : deadline - Date.now());
    if (processError || result.code !== 0) throw transportError();
    if (validateTarget) await waiting(validateTarget(), deadline === undefined ? timeoutMs : deadline - Date.now());
    if (failure) throw failure;
    complete = true;
    detach();
    child.stdin.destroy();
  };
  try {
    if (signal?.aborted) throw aborted();
    child.stdin.write(JSON.stringify({ request, assetStream: true, headOnly, range, ...(remote ? { session: profile.session } : { socketPath }) }) + '\n');
    const header = assetHeaderSchema.safeParse(await line(65536, setupDeadline));
    if (!header.success) throw transportError('invalid_asset_response', 'The file host returned invalid metadata');
    if ('error' in header.data) {
      const error = header.data.error;
      throw new ApiError(error.status, error.code, error.message);
    }
    const { metadata, length } = header.data;
    const expectedLength = headOnly || request.operation === 'files.describe' ? 0 : range ? range.end - range.start + 1 : metadata.bytes;
    if (metadata.root !== request.expectedRoot || metadata.path !== request.path || metadata.terminal_id !== request.terminal_id || (request.operation === 'files.raw' && metadata.assetVersion !== request.expectedAssetVersion) || length !== expectedLength || (range && range.end >= metadata.bytes)) throw transportError('invalid_asset_response', 'The file host returned metadata for another file');
    if (length === 0) await finish(setupDeadline);
    else if (validateTarget) await waiting(validateTarget(), setupDeadline - Date.now());
    let consumed = false;
    const body = {
      async *[Symbol.asyncIterator]() {
        if (consumed) throw transportError('asset_already_read', 'The file response has already been read');
        if (released) throw aborted();
        consumed = true;
        let remaining = length;
        let tail;
        try {
          while (remaining) {
            if (failure) throw failure;
            if (!buffered.length && !await pull()) throw transportError('invalid_asset_response', 'The file host returned a short body');
            const count = Math.min(remaining, buffered.length);
            const chunk = buffered.subarray(0, count);
            buffered = buffered.subarray(count);
            remaining -= count;
            if (remaining) yield chunk;
            else tail = chunk;
          }
          if (length) await finish();
          if (failure) throw failure;
          if (released) throw aborted();
          if (tail) yield tail;
        } finally { await close(); }
      },
    };
    return { metadata, body, close };
  } catch (error) {
    fail(error);
    await close();
    if (processError?.code === 'ENOENT') throw new ApiError(501, remote ? 'asset_ssh_unavailable' : 'host_python_unavailable', 'The file transport is unavailable');
    if (exitResult?.code === 127) throw new ApiError(501, remote ? 'remote_python_unavailable' : 'host_python_unavailable', 'Python3 is unavailable on the selected host');
    throw error;
  }
}
