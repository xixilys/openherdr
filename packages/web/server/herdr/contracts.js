import { z } from 'zod';

const id = z.string().min(1).max(160).regex(/^[A-Za-z0-9][A-Za-z0-9:_-]*$/);
const text = z.string().max(64 * 1024);
const label = z.string().min(1).max(160);
const cwd = z.string().min(1).max(4096);
const workspace = z.string().max(160).regex(/^w[A-Za-z0-9]+$/);
const pane = z.string().max(160).regex(/^w[A-Za-z0-9]+:p[A-Za-z0-9]+$/);
const tab = z.string().max(160).regex(/^w[A-Za-z0-9]+:t[A-Za-z0-9]+$/);
const keys = z.array(z.string().min(1).max(40)).min(1).max(64);
const empty = z.strictObject({});
const list = z.strictObject({ workspace_id: workspace.optional() });
const create = { cwd: cwd.optional(), label: label.optional(), focus: z.boolean().optional() };
export const methods = {
  'session.snapshot': empty,
  'workspace.list': empty,
  'workspace.create': z.strictObject(create),
  'workspace.rename': z.strictObject({ workspace_id: workspace, label }),
  'workspace.close': z.strictObject({ workspace_id: workspace }),
  'tab.list': list,
  'tab.create': z.strictObject({ ...create, workspace_id: workspace }),
  'tab.rename': z.strictObject({ tab_id: tab, label }),
  'tab.close': z.strictObject({ tab_id: tab }),
  'pane.list': list,
  'pane.get': z.strictObject({ pane_id: pane }),
  'pane.read': z.strictObject({ pane_id: pane, source: z.enum(['visible', 'recent', 'recent_unwrapped', 'detection']), lines: z.number().int().min(1).max(2000).optional(), format: z.enum(['text', 'ansi']).optional(), strip_ansi: z.boolean().optional() }),
  'pane.send_input': z.strictObject({ pane_id: pane, text: text.optional(), keys: keys.optional() }).refine((p) => p.text !== undefined || p.keys !== undefined),
  'pane.send_keys': z.strictObject({ pane_id: pane, keys }),
  'pane.split': z.strictObject({ target_pane_id: pane, direction: z.enum(['right', 'down']), cwd: cwd.optional(), ratio: z.number().min(0.1).max(0.9).optional(), focus: z.boolean().optional() }),
  'pane.close': z.strictObject({ pane_id: pane }),
  'pane.rename': z.strictObject({ pane_id: pane, label }),
  'agent.list': empty,
  'agent.start': z.strictObject({ pane_id: pane, name: z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/), kind: z.enum(['pi', 'claude', 'codex', 'gemini', 'cursor', 'devin', 'agy', 'cline', 'omp', 'mastracode', 'opencode', 'copilot', 'kimi', 'kiro', 'droid', 'amp', 'grok', 'hermes', 'kilo', 'qodercli', 'qwen', 'letta', 'maki', 'muse']), args: z.array(z.string().max(4096)).max(64).optional(), timeout_ms: z.number().int().min(3001).max(300000).optional() }),
  'agent.prompt': z.strictObject({ target: pane, text }),
  'agent.rename': z.strictObject({ target: pane, name: z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/).nullable() }),
  'worktree.list': z.strictObject({ workspace_id: workspace }),
  'worktree.create': z.strictObject({ workspace_id: workspace, branch: z.string().min(1).max(240).regex(/^[A-Za-z0-9][A-Za-z0-9_./-]*$/), base: z.string().min(1).max(240).regex(/^[A-Za-z0-9][A-Za-z0-9_./-]*$/).optional(), label: label.optional(), focus: z.boolean().optional() }),
  'worktree.open': z.strictObject({ workspace_id: workspace, branch: z.string().min(1).max(240).regex(/^[A-Za-z0-9][A-Za-z0-9_./-]*$/), label: label.optional(), focus: z.boolean().optional() }),
  'worktree.remove': z.strictObject({ workspace_id: workspace, force: z.literal(false).optional() }),
};
const rpcEnvelope = z.strictObject({ machine: id, method: z.string().min(1).max(80), params: z.unknown(), requestId: z.string().min(8).max(128).regex(/^[a-zA-Z0-9_-]+$/).optional() });
export const pairingEnvelope = z.strictObject({ pairingId: z.string().min(1).max(160), secret: z.string().min(1).max(160), deviceName: z.string().max(80).optional() });
export const terminalEnvelope = z.strictObject({ machine: id, pane_id: pane, cols: z.number().int().min(20).max(300).default(100), rows: z.number().int().min(5).max(150).default(30) });
export const isReadMethod = (method) => ['session.snapshot', 'workspace.list', 'tab.list', 'pane.list', 'pane.get', 'pane.read', 'agent.list', 'worktree.list'].includes(method);
export class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
export function parseRpc(body) {
  const envelope = rpcEnvelope.safeParse(body);
  if (!envelope.success) throw new ApiError(400, 'invalid_request', 'Invalid RPC request');
  const { method } = envelope.data;
  if (!Object.hasOwn(methods, method)) throw new ApiError(403, 'method_forbidden', 'This Herdr method is not available');
  const params = methods[method].safeParse(envelope.data.params);
  if (!params.success) throw new ApiError(400, 'invalid_params', 'Invalid parameters for this Herdr method');
  if (!isReadMethod(method) && !envelope.data.requestId) throw new ApiError(400, 'request_id_required', 'Mutations require a unique requestId');
  return { ...envelope.data, params: params.data };
}


export const adminRequest = z.discriminatedUnion('command', [
  z.strictObject({ id, command: z.literal('status'), params: empty.default({}) }),
  z.strictObject({ id, command: z.literal('stop'), params: empty.default({}) }),
  z.strictObject({ id, command: z.literal('origin.add'), params: z.strictObject({ origin: z.string().min(1).max(4096) }) }),
  z.strictObject({ id, command: z.literal('pair'), params: z.strictObject({ label: z.string().max(80).optional(), server: z.string().min(1).max(4096).optional() }).default({}) }),
]);
