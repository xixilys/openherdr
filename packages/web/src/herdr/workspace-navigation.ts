/** A file action captures the bound conversation and its current host root. */
export type WorkspaceFileRequest = {
  id: string;
  server: string;
  machine: string;
  paneId: string;
  paneIdentity: string;
  sessionId: string;
  root: string;
  path: string;
  line?: number;
};

/** Host operations accept project-relative paths; tool output grants no wider scope. */
export function workspaceFilePath(path: string, root: string): string | null {
  if (!root.startsWith('/') || !path || path.includes('\\') || [...path].some((char) => char.charCodeAt(0) < 32) || /^[a-z][a-z\d+.-]*:/i.test(path)) return null;
  const base = root.replace(/\/+$/, '');
  const relative = path.startsWith('/')
    ? (path.startsWith(`${base}/`) ? path.slice(base.length + 1) : null)
    : path;
  if (!relative) return null;
  const parts = relative.split('/');
  if (parts.some((part) => part === '..')) return null;
  const normalized = parts.filter((part) => part !== '.' && part !== '').join('/');
  return normalized || null;
}

/** A diff request belongs to the existing terminal that produced the action. */
export type WorkspaceDiffRequest = {
  id: string;
  server: string;
  machine: string;
  paneId: string;
  terminalId: string;
  path: string;
  staged?: boolean;
};
