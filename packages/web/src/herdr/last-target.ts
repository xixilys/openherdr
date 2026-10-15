import { z } from 'zod';
import { normalizeServer, type snapshotSchema } from './transport';

const id = z.string().min(1).max(256);
const targetSchema = z.strictObject({ machine: id, workspaceId: id, tabId: id, paneId: id, terminalId: id });
const envelopeSchema = z.strictObject({ version: z.literal(1), target: targetSchema });
const maxStoredLength = 8192;
type TargetStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
type WindowSnapshot = Pick<z.infer<typeof snapshotSchema>['snapshot'], 'workspaces' | 'tabs' | 'panes'>;
export type LastTarget = z.infer<typeof targetSchema>;

const storageKey = (server: string) => `openherdr.last-target.v1:${normalizeServer(server)}`;

/** Non-secret startup context; the current machine and snapshot remain authoritative. */
export function readLastTarget(server: string, storage?: TargetStorage): LastTarget | null {
  try {
    const raw = (storage ?? localStorage).getItem(storageKey(server));
    if (raw === null || raw.length > maxStoredLength) return null;
    const parsed = envelopeSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data.target : null;
  } catch { return null; }
}

export function rememberLastTarget(server: string, target: LastTarget, storage?: TargetStorage): boolean {
  const parsed = envelopeSchema.safeParse({ version: 1, target });
  if (!parsed.success) return false;
  try {
    const raw = JSON.stringify(parsed.data);
    if (raw.length > maxStoredLength) return false;
    (storage ?? localStorage).setItem(storageKey(server), raw);
    return true;
  } catch { return false; }
}

export function clearLastTarget(server: string, storage?: TargetStorage): boolean {
  try { (storage ?? localStorage).removeItem(storageKey(server)); return true; }
  catch { return false; }
}

export function matchesLastTarget(target: LastTarget, machine: string, snapshot: WindowSnapshot): boolean {
  return target.machine === machine
    && snapshot.workspaces.some(workspace => workspace.workspace_id === target.workspaceId)
    && snapshot.tabs.some(tab => tab.tab_id === target.tabId && tab.workspace_id === target.workspaceId)
    && snapshot.panes.some(pane => pane.pane_id === target.paneId && pane.tab_id === target.tabId && pane.workspace_id === target.workspaceId && pane.terminal_id === target.terminalId);
}
