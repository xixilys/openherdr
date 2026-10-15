import { z } from 'zod';
import { ApiError } from './contracts.js';

const relativePath = z.string().max(4096).refine((value) => !value.includes('\0') && !value.startsWith('/') && !value.split('/').some((part) => part === '..' || part.toLowerCase() === '.git'), 'Choose a path inside this pane');
const target = { machine: z.string().min(1).max(160).regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/), pane_id: z.string().max(160).regex(/^w[A-Za-z0-9]+:p[A-Za-z0-9]+$/) };
const pathField = { path: relativePath.default('') };
const pinned = { expectedRoot: z.string().min(1).max(4096) };
const revision = z.string().regex(/^[a-f0-9]{64}$/).nullable();
const branch = z.string().min(1).max(240).regex(/^[A-Za-z0-9][A-Za-z0-9_./-]*$/).refine((value) => !value.includes('..') && !value.includes('//') && !value.endsWith('/') && !value.endsWith('.lock'));
const operation = (name, fields = {}) => z.strictObject({ ...target, operation: z.literal(name), ...fields });
const hostRequest = z.discriminatedUnion('operation', [
  operation('files.list', pathField), operation('files.stat', pathField), operation('files.read', pathField), operation('files.binary', pathField), operation('files.download', pathField),
  operation('files.search', { ...pathField, query: z.string().min(1).max(512), maxResults: z.number().int().min(1).max(200).default(100), includeHidden: z.boolean().default(false) }),
  operation('files.write', { ...pathField, ...pinned, content: z.string().max(8 * 1024 * 1024), expectedRevision: revision }),
  operation('files.upload', { ...pathField, ...pinned, base64: z.string().max(12 * 1024 * 1024).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/), expectedRevision: revision }),
  operation('files.mkdir', { ...pathField, ...pinned }),
  operation('files.rename', { ...pathField, ...pinned, newPath: relativePath.min(1), expectedRevision: revision }),
  operation('files.delete', { ...pathField, ...pinned, expectedRevision: revision }),
  operation('git.status'), operation('git.diff', { path: relativePath.optional(), staged: z.boolean().default(false) }),
  operation('git.log', { limit: z.number().int().min(1).max(100).default(30) }), operation('git.branches'),
  operation('git.stage', { ...pinned, paths: z.array(relativePath.min(1)).min(1).max(200) }),
  operation('git.unstage', { ...pinned, paths: z.array(relativePath.min(1)).min(1).max(200) }),
  operation('git.commit', { ...pinned, message: z.string().min(1).max(64 * 1024).refine((value) => !value.includes('\0')) }),
  operation('git.branch', { ...pinned, name: branch, startPoint: branch.optional() }),
  operation('git.checkout', { ...pinned, branch }),
]);
const reads = new Set(['files.list', 'files.stat', 'files.read', 'files.binary', 'files.download', 'files.search', 'git.status', 'git.diff', 'git.log', 'git.branches']);
export const isHostMutation = (request) => !reads.has(request.operation);
export function parseHostRequest(body) {
  const parsed = hostRequest.safeParse(body);
  if (!parsed.success) throw new ApiError(400, 'invalid_host_request', 'Invalid host operation or path');
  return parsed.data;
}

const base = { root: z.string().min(1), path: z.string() };
const fileEntry = z.strictObject({ name: z.string(), path: z.string(), isDirectory: z.boolean(), size: z.number(), modifiedTime: z.number(), isSymbolicLink: z.boolean() });
const status = z.strictObject({ root: z.string(), current: z.string(), tracking: z.string().nullable(), ahead: z.number().int().nonnegative(), behind: z.number().int().nonnegative(), files: z.array(z.strictObject({ path: z.string(), index: z.string(), working_dir: z.string() })), isClean: z.boolean() });
const logEntry = z.strictObject({ hash: z.string(), date: z.string(), message: z.string(), refs: z.string(), body: z.string(), author_name: z.string(), author_email: z.string(), filesChanged: z.number(), insertions: z.number(), deletions: z.number(), parents: z.array(z.string()) });
const mutationResult = z.strictObject({ ...base, success: z.literal(true), revision: revision.optional() });
const results = {
  'files.list': z.strictObject({ ...base, directory: z.string(), entries: z.array(fileEntry), truncated: z.boolean() }),
  'files.stat': z.strictObject({ ...base, isFile: z.boolean(), isDirectory: z.boolean(), size: z.number(), mtimeMs: z.number() }),
  'files.read': z.strictObject({ ...base, content: z.string(), bytes: z.number(), revision }),
  'files.binary': z.strictObject({ ...base, dataUrl: z.string(), bytes: z.number(), revision }),
  'files.download': z.strictObject({ ...base, base64: z.string(), mime: z.string(), bytes: z.number(), revision }),
  'files.search': z.strictObject({ root: z.string(), results: z.array(z.strictObject({ path: z.string(), preview: z.array(z.string()) })), truncated: z.boolean() }),
  'files.write': mutationResult, 'files.upload': mutationResult, 'files.mkdir': mutationResult, 'files.rename': mutationResult, 'files.delete': mutationResult,
  'git.status': status,
  'git.diff': z.strictObject({ root: z.string(), diff: z.string() }),
  'git.log': z.strictObject({ root: z.string(), all: z.array(logEntry), latest: logEntry.nullable(), total: z.number().int().nonnegative() }),
  'git.branches': z.strictObject({ root: z.string(), current: z.string(), all: z.array(z.string()), branches: z.record(z.string(), z.strictObject({ current: z.boolean(), name: z.string(), commit: z.string(), label: z.string(), linkedWorktree: z.boolean() })) }),
  'git.stage': z.strictObject({ root: z.string(), success: z.literal(true) }),
  'git.unstage': z.strictObject({ root: z.string(), success: z.literal(true) }),
  'git.commit': z.strictObject({ root: z.string(), success: z.literal(true), commit: z.string(), branch: z.string(), summary: z.strictObject({ changes: z.number(), insertions: z.number(), deletions: z.number() }) }),
  'git.branch': z.strictObject({ root: z.string(), success: z.literal(true), branch: z.string() }),
  'git.checkout': z.strictObject({ root: z.string(), success: z.literal(true), branch: z.string() }),
};
export const hostOperations = Object.keys(results);
export async function executeHostOperation(bridge, body) {
  const request = parseHostRequest(body);
  if (!bridge.host) throw new ApiError(501, 'host_unavailable', 'Host operations are unavailable on this runtime');
  const response = await bridge.host(request);
  const parsed = results[request.operation].safeParse(response);
  if (!parsed.success) throw new ApiError(502, 'invalid_host_response', 'Host operation returned an invalid response');
  return parsed.data;
}
