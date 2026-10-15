import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { startTunnel, tunnelOptions, tunnelStatus, validateTunnelInput } from './openherdr-tunnel.js';

const cleanups = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

async function fixture(mode = 'ready', cloudflareMode = 'managed-remote') {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'openherdr-tunnel-test-'));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  const executable = path.join(dir, 'cloudflared');
  const capture = path.join(dir, 'capture.json');
  const secretFile = path.join(dir, 'operator-input');
  await writeFile(secretFile, 'dummy-private-value', { mode: 0o400 });
  await writeFile(executable, `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
const file = args[args.indexOf('--pidfile') + 1];
fs.writeFileSync(process.env.FIXTURE_CAPTURE, JSON.stringify({pid:process.pid,args,tunnelKeys:Object.keys(process.env).filter(key=>key.startsWith('TUNNEL_')),proxy:process.env.HTTPS_PROXY}));
process.stderr.write('dummy-private-value arbitrary registered output\\n');
const mode = process.env.FIXTURE_MODE;
if (args.includes('--url')) process.stdout.write('https://owned-fixture.trycloudflare.com\\n');
if (mode === 'exit') process.exit(7);
if (mode === 'ignore-term') process.on('SIGTERM', () => {});
if (mode !== 'noise' && mode !== 'wrong-pid') fs.writeFileSync(file, String(process.pid));
if (mode === 'wrong-pid') fs.writeFileSync(file, String(process.ppid));
if (mode === 'later-exit') setTimeout(() => process.exit(9), 600);
setInterval(() => {}, 1000);
`, { mode: 0o700 });
  const options = tunnelOptions({ cf: true, 'cf-mode': cloudflareMode, ...(cloudflareMode === 'managed-remote' ? { 'cf-token-file': secretFile } : cloudflareMode === 'managed-local' ? { 'cf-config': secretFile } : {}) }, 'serve', 'https://stable.example.test');
  const params = { origin: 'http://127.0.0.1:12345', stateDir: dir, options, executable, env: { PATH: process.env.PATH, FIXTURE_CAPTURE: capture, FIXTURE_MODE: mode, TUNNEL_TOKEN: 'dummy-env-authority', TUNNEL_CONFIG: '/must/not/use', HTTPS_PROXY: 'http://fixture-proxy.invalid' }, timeoutMs: 2000, stopGraceMs: 40 };
  return { dir, capture, secretFile, params };
}

async function captured(file) {
  for (let i = 0; i < 100; i++) {
    try { return JSON.parse(await readFile(file, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await delay(10);
  }
  throw new Error('Fixture did not start');
}

function isAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

describe('OpenHerdr tunnel inputs', () => {
  it('keeps --cf alone as Quick with a separate supplied pairing origin', () => {
    expect(tunnelOptions({ cf: true }, 'start', 'https://pairing.example.test')).toEqual({ mode: 'quick', publicOrigin: null, tokenFile: null, configFile: null });
    expect(tunnelOptions({}, 'status', null)).toBeNull();
  });
  it.each([
    [{ 'cf-mode': 'managed-local' }, 'start', 'https://stable.example.test'],
    [{ cf: true, 'cf-mode': 'other' }, 'start', null],
    [{ cf: true, 'cf-token-file': '/unused' }, 'start', null],
    [{ cf: true, 'cf-mode': 'managed-remote', 'cf-token-file': '/unused' }, 'start', 'http://stable.example.test'],
    [{ cf: true, 'cf-mode': 'managed-local', 'cf-config': '/unused', 'cf-token-file': '/unused' }, 'start', 'https://stable.example.test'],
    [{ cf: true, 'cf-mode': 'managed-remote' }, 'start', 'https://stable.example.test'],
    [{ cf: true, 'cf-mode': 'managed-local' }, 'start', 'https://stable.example.test'],
    [{ cf: true }, 'connect', null],
  ])('rejects irrelevant, missing and conflicting flags before execution', (values, command, origin) => {
    expect(() => tunnelOptions(values, command, origin)).toThrow();
  });
  it('refuses unreadable/missing explicit files without exposing their path', async () => {
    const test = await fixture();
    await expect(validateTunnelInput({ ...test.params.options, tokenFile: path.join(test.dir, 'missing-dummy-private-value') })).rejects.toThrow('existing readable non-empty file');
    const empty = path.join(test.dir, 'empty-input');
    await writeFile(empty, '');
    await expect(validateTunnelInput({ ...test.params.options, tokenFile: empty })).rejects.toThrow('existing readable non-empty file');
  });
  it.each(['quick', 'managed-remote', 'managed-local'])('refuses %s in enterprise mode before creating launch files or children', async (mode) => {
    const test = await fixture('ready', mode);
    const previous = process.env.OPENCHAMBER_ENTERPRISE_MODE;
    process.env.OPENCHAMBER_ENTERPRISE_MODE = '1';
    try { await expect(startTunnel(test.params)).rejects.toThrow('disabled in enterprise mode'); }
    finally { if (previous === undefined) delete process.env.OPENCHAMBER_ENTERPRISE_MODE; else process.env.OPENCHAMBER_ENTERPRISE_MODE = previous; }
    expect(await readdir(test.dir)).toEqual(expect.arrayContaining(['cloudflared', 'operator-input']));
    expect(await readdir(test.dir)).not.toContain('capture.json');
    expect((await readdir(test.dir)).some((name) => name.startsWith('.cloudflared-'))).toBe(false);
  });
});

describe('owned Cloudflare lifecycle', () => {
  it.each(['quick', 'managed-remote', 'managed-local'])('confirms %s using the exact child pidfile and preserves operator files', async (mode) => {
    const test = await fixture('ready', mode);
    const launchId = randomUUID();
    const tunnel = await startTunnel({ ...test.params, launchId });
    cleanups.push(() => tunnel.stop());
    const capture = await captured(test.capture);
    expect(capture.tunnelKeys).toEqual([]);
    expect(capture.proxy).toBe('http://fixture-proxy.invalid');
    expect(capture.args).not.toContain('dummy-private-value');
    expect(capture.args).not.toContain('--token');
    const configFile = capture.args[capture.args.indexOf('--config') + 1];
    if (mode === 'managed-local') expect(configFile).toBe(test.secretFile);
    else expect(await readFile(configFile, 'utf8')).toContain('disables default configuration discovery');
    if (mode === 'managed-remote') expect(capture.args.slice(-2)).toEqual(['--token-file', test.secretFile]);
    const status = await tunnelStatus(test.dir, process.pid, { ...test.params.options, launchId });
    expect(status).toEqual({ mode, publicOrigin: tunnel.publicOrigin, connector: 'first-connected', publicRouting: 'unverified' });
    expect(await tunnelStatus(test.dir, process.pid, { ...test.params.options, launchId: randomUUID() })).toMatchObject({ connector: 'unconfirmed' });
    await Promise.all([tunnel.stop(), tunnel.stop()]);
    expect(isAlive(capture.pid)).toBe(false);
    expect(await readFile(test.secretFile, 'utf8')).toBe('dummy-private-value');
    expect(await readdir(test.dir)).not.toContain('tunnel.json');
    expect((await readdir(test.dir)).some((name) => name.startsWith('.cloudflared-'))).toBe(false);
  });
  it.each(['noise', 'wrong-pid'])('does not accept %s, arbitrary output or supplied origins as connection success', async (mode) => {
    const test = await fixture(mode, 'quick');
    await expect(startTunnel({ ...test.params, timeoutMs: 500 })).rejects.toThrow('first connection');
    expect(isAlive((await captured(test.capture)).pid)).toBe(false);
    expect((await readdir(test.dir)).some((name) => name.startsWith('.cloudflared-'))).toBe(false);
  });
  it('aborts a pending startup and joins its exact child exit', async () => {
    const test = await fixture('noise');
    const controller = new AbortController();
    const pending = startTunnel({ ...test.params, timeoutMs: 5000, signal: controller.signal });
    const rejected = expect(pending).rejects.toThrow(/abort/i);
    const capture = await captured(test.capture);
    controller.abort();
    await rejected;
    expect(isAlive(capture.pid)).toBe(false);
    expect(await tunnelStatus(test.dir, process.pid)).toBeNull();
  });
  it('forces only its own stubborn child, then confirms exact exit', async () => {
    const test = await fixture('ignore-term');
    const tunnel = await startTunnel(test.params);
    cleanups.push(() => tunnel.stop());
    const capture = await captured(test.capture);
    await tunnel.stop();
    expect(isAlive(capture.pid)).toBe(false);
    expect(isAlive(process.pid)).toBe(true);
  });
  it('handles spawn failure and early exit without propagating managed output', async () => {
    const test = await fixture('exit');
    await expect(startTunnel(test.params)).rejects.toThrow('Cloudflare exited during startup (7)');
    await expect(startTunnel({ ...test.params, executable: path.join(test.dir, 'missing-executable') })).rejects.toThrow('installed and executable');
    expect((await readdir(test.dir)).some((name) => name.startsWith('.cloudflared-'))).toBe(false);
  });
  it('reports a later child exit without claiming public routing health', async () => {
    const test = await fixture('later-exit');
    const tunnel = await startTunnel(test.params);
    cleanups.push(() => tunnel.stop());
    await delay(700);
    expect(await tunnelStatus(test.dir, process.pid)).toMatchObject({ connector: 'exited', publicRouting: 'unverified', reason: 'Cloudflare connector process has exited' });
  });
  it('does not adopt a legacy PID or remove a different owner receipt on failure', async () => {
    const test = await fixture('noise');
    const legacy = JSON.stringify({ pid: process.pid, publicOrigin: 'https://legacy.trycloudflare.com' });
    await writeFile(path.join(test.dir, 'tunnel.json'), legacy);
    expect(await tunnelStatus(test.dir, process.pid)).toMatchObject({ mode: null, connector: 'unconfirmed' });
    await expect(startTunnel({ ...test.params, timeoutMs: 500 })).rejects.toThrow('first connection');
    expect(await readFile(path.join(test.dir, 'tunnel.json'), 'utf8')).toBe(legacy);
    expect(isAlive(process.pid)).toBe(true);
  });
  it('rejects a matching pidfile pointing at an unrelated live process', async () => {
    const test = await fixture();
    const tunnel = await startTunnel(test.params);
    cleanups.push(() => tunnel.stop());
    const file = path.join(test.dir, 'tunnel.json');
    const record = JSON.parse(await readFile(file, 'utf8'));
    await writeFile(record.pidFile, String(process.pid));
    await writeFile(file, JSON.stringify({ ...record, pid: process.pid }));
    expect(await tunnelStatus(test.dir, process.pid)).toMatchObject({ connector: 'unconfirmed' });
    await tunnel.stop();
    expect(isAlive(process.pid)).toBe(true);
  });
});
