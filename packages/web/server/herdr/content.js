import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';
import { ApiError } from './contracts.js';

const exec = promisify(execFile);
const target = {
  machine: z.string().min(1).max(160),
  pane_id: z.string().max(160).regex(/^w[A-Za-z0-9]+:p[A-Za-z0-9]+$/),
};
export const filesRequest = z.strictObject({ ...target, path: z.string().max(4096).default(''), mode: z.enum(['list', 'read']).default('list') });
export const gitRequest = z.strictObject({ ...target, mode: z.enum(['status', 'diff', 'staged']).default('status') });

async function paneRoot(bridge, machine, paneId) {
  if (machine !== 'local') throw new ApiError(501, 'remote_files_unavailable', 'Files and Git review currently require a local Herdr pane');
  const response = await bridge.rpc(machine, 'session.snapshot', {});
  const pane = response.result?.snapshot?.panes?.find((item) => item.pane_id === paneId);
  if (!pane) throw new ApiError(404, 'pane_not_found', 'This pane is no longer available');
  const cwd = pane.foreground_cwd || pane.cwd;
  if (!cwd || !path.isAbsolute(cwd)) throw new ApiError(422, 'cwd_unavailable', 'Herdr has not reported a working directory for this pane');
  try { return await fs.realpath(cwd); }
  catch { throw new ApiError(422, 'directory_unavailable', 'The pane working directory is unavailable'); }
}

const inside = (root, candidate) => candidate === root || candidate.startsWith(root + path.sep);
async function scopedPath(root, relative) {
  if (relative.includes('\0') || path.isAbsolute(relative)) throw new ApiError(403, 'path_forbidden', 'Choose a path inside this pane working directory');
  const candidate = path.resolve(root, relative);
  if (!inside(root, candidate)) throw new ApiError(403, 'path_forbidden', 'Choose a path inside this pane working directory');
  let real;
  try { real = await fs.realpath(candidate); }
  catch { throw new ApiError(404, 'file_not_found', 'This file or folder is unavailable'); }
  if (!inside(root, real)) throw new ApiError(403, 'path_forbidden', 'This link leaves the pane working directory');
  return real;
}

export async function readPaneFiles(bridge, request) {
  const root = await paneRoot(bridge, request.machine, request.pane_id);
  const file = await scopedPath(root, request.path);
  const stat = await fs.stat(file);
  if (request.mode === 'list') {
    if (!stat.isDirectory()) throw new ApiError(422, 'not_directory', 'Choose a folder');
    const entries = (await fs.readdir(file, { withFileTypes: true }))
      .filter((item) => !['.git', 'node_modules'].includes(item.name))
      .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
    return { root, path: request.path, entries: entries.slice(0, 500).map((entry) => ({ name: entry.name, type: entry.isDirectory() ? 'directory' : entry.isSymbolicLink() ? 'link' : 'file' })), truncated: entries.length > 500 };
  }
  if (!stat.isFile()) throw new ApiError(422, 'not_file', 'Choose a regular text file');
  if (stat.size > 256 * 1024) throw new ApiError(413, 'file_too_large', 'Preview supports text files up to 256 KiB');
  const content = await fs.readFile(file);
  if (content.includes(0)) throw new ApiError(422, 'binary_file', 'Binary files cannot be shown in the text preview');
  return { root, path: request.path, content: content.toString('utf8'), bytes: content.length };
}

export async function readPaneGit(bridge, request) {
  const root = await paneRoot(bridge, request.machine, request.pane_id);
  const run = async (args) => {
    try {
      const { stdout } = await exec('git', ['-c', 'core.fsmonitor=false', '-C', root, ...args], { timeout: 10000, maxBuffer: 2 * 1024 * 1024, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } });
      return stdout;
    } catch (error) {
      if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') throw new ApiError(413, 'diff_too_large', 'This diff exceeds the 2 MiB preview limit');
      throw new ApiError(422, 'git_unavailable', 'Git could not read this pane repository');
    }
  };
  if (request.mode === 'status') {
    const status = await run(['status', '--short', '--branch']);
    const branch = (await run(['branch', '--show-current'])).trim();
    return { root, branch, status };
  }
  const diff = await run(['diff', '--no-ext-diff', '--no-textconv', '--no-color', ...(request.mode === 'staged' ? ['--cached'] : []), '--']);
  return { root, mode: request.mode, diff };
}
