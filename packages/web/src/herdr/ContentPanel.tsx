import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Icon } from '@/components/icon/Icon';
import { FileTypeIcon } from '@/components/icons/FileTypeIcon';
import { BinaryArtifact } from '@/components/views/files/previews/BinaryArtifact';
import { ImageArtifact } from '@/components/views/files/previews/ImageArtifact';
import { ChangesPanel as GitChangesList, type ChangesGroupConfig } from '@/components/views/git/ChangesPanel';
import { fileDiffFromPatch, isBinaryPatch } from '@/lib/diff/patchFileDiff';
import { useI18n } from '@/lib/i18n';
import { isCapacitorApp } from '@/lib/platform';
import { shareFileFromNativeApp } from '@/lib/nativeFileShare';
import { HerdrTransport, TransportError, clearPendingDelivery, loadPendingDelivery, type PendingDelivery } from './transport';
import { HostClient, hostSchemas, targetKey, draftKey, createFileDraft, editFileDraft, prepareFileSave, finishFileSave, acceptFileReload, isConfirmedHostRefusal, fileBytesToBase64, downloadBytes, type FileDraft, type HostMutation } from './host-client';
import { usePolling } from './usePolling';
import { useHerdrText } from './herdr.i18n';
import { EditorView } from '@codemirror/view';
import { driverResolveSchema } from '@/lib/opencode/herdr-driver';
import { MobileFilesView } from '@/apps/MobileFilesView';
import { MobileOpenFilesMenu } from '@/components/views/files/MobileOpenFilesMenu';
import { getDefaultTheme } from '@/lib/theme/themes';
import { MobileChangesState, MobileDiffDetail, MobileWorkingChangesView } from '@/apps/MobileChangesView';
import { CommitSection } from '@/components/views/git/CommitSection';
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { dropdownTriggerVariants } from '@/components/ui/dropdown-trigger';
import { useUIStore } from '@/stores/useUIStore';
import { registerBackLayer } from '@/lib/mobileBackLayers';
import { workspaceFilePath, type WorkspaceDiffRequest, type WorkspaceFileRequest } from './workspace-navigation';
import type { Theme } from '@/types/theme';
import { createHerdrMarkdownAssetSource } from './file-preview-source';
import { initialFileViewMode, textFilePreviewKind, type FileViewMode } from './file-view-mode';

const TextEditor = lazy(() => import('./TextFileEditor').then((module) => ({ default: module.TextFileEditor })));

type PanelProps = { transport: HerdrTransport; machine: string; paneId: string; disabled?: boolean; mutationBlocked?: boolean; themeMode?: 'light' | 'dark'; theme?: Theme; onPendingDelivery?: (record: PendingDelivery | null) => void };
type FileEntry = z.infer<typeof hostSchemas.list>['entries'][number];
type FileChoice = Pick<FileEntry, 'path' | 'name' | 'isDirectory'> & { root: string; revision: string | null };
type FileDialog =
  | { kind: 'file'; owner: string; root: string; directory: string }
  | { kind: 'folder'; owner: string; root: string; directory: string }
  | { kind: 'rename'; owner: string; choice: FileChoice }
  | { kind: 'delete'; owner: string; choice: FileChoice }
  | { kind: 'reload'; owner: string; draftId: string }
  | { kind: 'close'; owner: string; draftId: string };
type FileEditorsState = { documents: Map<string, FileDraft>; selected: Map<string, string | null>; viewModes: Map<string, FileViewMode>; dialog: FileDialog | null };

function removeFileDocument(state: FileEditorsState, id: string, owner: string): FileEditorsState {
  const siblings = [...state.documents.entries()].filter(([, document]) => targetKey(document.server, document.target) === owner).map(([key]) => key);
  const index = siblings.indexOf(id);
  if (index < 0) return state;
  const documents = new Map(state.documents);
  documents.delete(id);
  const viewModes = new Map(state.viewModes);
  viewModes.delete(id);
  const selected = state.selected.get(owner) === id ? new Map(state.selected).set(owner, siblings[index + 1] ?? siblings[index - 1] ?? null) : state.selected;
  return { documents, selected, viewModes, dialog: null };
}
type BinaryFile = z.infer<typeof hostSchemas.download> & { owner: string; image: string | null };
const emptyPaths = new Set<string>();
const parentPath = (path: string) => path.split('/').slice(0, -1).join('/');
const childPath = (directory: string, name: string) => directory ? `${directory}/${name}` : name;

function useHostActions(client: HostClient, disabled: boolean, onPendingDelivery: PanelProps['onPendingDelivery'], actionOwner?: string) {
  const [activeMutation, setActiveMutation] = useState<{ owner: string; operation: HostMutation['operation'] } | null>(null);
  const busy = activeMutation !== null;
  const [failure, setFailure] = useState<{ owner: string; error: Error; request: HostMutation } | null>(null);
  const running = useRef(false);
  const owner = actionOwner ?? targetKey(client.transport.connection.server, client.target);
  const live = useRef({ owner, disabled });
  live.current = { owner, disabled };
  const execute = useCallback(async <T extends { root: string },>(request: HostMutation, schema: z.ZodType<T>): Promise<T | null> => {
    if (running.current || live.current.disabled || live.current.owner !== owner) return null;
    running.current = true;
    setActiveMutation({ owner, operation: request.operation });
    setFailure(null);
    try {
      const { record, outcome } = await client.mutate(request, schema);
      if (outcome.kind === 'pending') {
        onPendingDelivery?.(outcome.record);
        setFailure({ owner, request, error: new TransportError('OUTCOME_UNKNOWN', 'outcomeUnknown', true, outcome.record.requestId) });
        return null;
      }
      if (!await clearPendingDelivery(record.server, record.requestId)) throw new TransportError('DELIVERY_STORAGE', 'deliveryStorage', false, record.requestId);
      onPendingDelivery?.(await loadPendingDelivery(record.server));
      return outcome.value;
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error));
      setFailure({ owner, request, error: failure });
      try {
        const pending = await loadPendingDelivery(client.transport.connection.server);
        if (pending) {
          onPendingDelivery?.(pending);
          if (isConfirmedHostRefusal(failure) && pending.requestId === failure.requestId && await clearPendingDelivery(pending.server, pending.requestId)) onPendingDelivery?.(await loadPendingDelivery(pending.server));
        }
      } catch { setFailure({ owner, request, error: new TransportError('DELIVERY_STORAGE', 'deliveryStorage') }); }
      return null;
    } finally {
      running.current = false;
      setActiveMutation(null);
    }
  }, [client, onPendingDelivery, owner]);
  return { busy, operation: activeMutation?.owner === owner ? activeMutation.operation : null, execute, clearError: (captured?: Error) => setFailure(previous => !captured || previous?.error === captured ? null : previous), error: failure?.owner === owner ? failure.error : null, failedRequest: failure?.owner === owner ? failure.request : null };
}

export function FilesPanel({ transport, machine, paneId, disabled = false, mutationBlocked = false, theme = getDefaultTheme(false), onPendingDelivery, requestedFile, isMobile = false, visible = true }: PanelProps & { requestedFile?: WorkspaceFileRequest | null; isMobile?: boolean; visible?: boolean }) {
  const { t } = useI18n();
  const h = useHerdrText();
  const client = useMemo(() => new HostClient(transport, { machine, pane_id: paneId }), [transport, machine, paneId]);
  const owner = targetKey(transport.connection.server, client.target);
  const enabled = visible && !disabled && !!paneId;
  const currentOwner = useRef(owner);
  currentOwner.current = owner;
  const lastEditorOwner = useRef(owner);
  if (paneId) lastEditorOwner.current = owner;
  const editorOwner = paneId ? owner : lastEditorOwner.current;
  const pinnedRoots = useRef(new Map<string, string>());
  const [directory, setDirectory] = useState('');
  const [directoryOwner, setDirectoryOwner] = useState(owner);
  const folder = directoryOwner === owner ? directory : '';
  const [refresh, setRefresh] = useState(0);
  const [rootEpoch, setRootEpoch] = useState(0);
  const [query, setQuery] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [editors, setEditors] = useState<FileEditorsState>(() => ({ documents: new Map(), selected: new Map(), viewModes: new Map(), dialog: null }));
  const { documents, selected, dialog: dialogState } = editors;
  const setDocuments = useCallback((update: (previous: Map<string, FileDraft>) => Map<string, FileDraft>) => {
    setEditors(previous => { const documents = update(previous.documents); return documents === previous.documents ? previous : { ...previous, documents }; });
  }, []);
  const setSelected = useCallback((update: (previous: Map<string, string | null>) => Map<string, string | null>) => {
    setEditors(previous => { const selected = update(previous.selected); return selected === previous.selected ? previous : { ...previous, selected }; });
  }, []);
  const setDialog = useCallback((dialog: FileDialog | null) => setEditors(previous => ({ ...previous, dialog })), []);
  const documentsRef = useRef(documents);
  documentsRef.current = documents;
  const [binary, setBinary] = useState<BinaryFile | null>(null);
  const dialog = dialogState?.owner === owner ? dialogState : null;
  const [openFilesOwner, setOpenFilesOwner] = useState<string | null>(null);
  useEffect(() => { setOpenFilesOwner(null); setDialog(null); }, [owner, enabled, setDialog]);
  const [name, setName] = useState('');
  const [openingOwner, setOpeningOwner] = useState<string | null>(null);
  const opening = openingOwner === owner;
  const [failure, setFailure] = useState<{ owner: string; error: Error } | null>(null);
  const openingRequest = useRef(0);
  const readScope = useRef({ owner, enabled, transport });
  if (readScope.current.owner !== owner || readScope.current.enabled !== enabled || readScope.current.transport !== transport) {
    openingRequest.current += 1;
    readScope.current = { owner, enabled, transport };
  }
  useEffect(() => { setOpeningOwner(null); }, [owner, enabled, transport]);
  useEffect(() => () => { openingRequest.current += 1; }, []);
  const currentRequestedFile = useRef(requestedFile);
  currentRequestedFile.current = requestedFile;
  const consumedRequest = useRef<string | null>(null);
  const [focusLine, setFocusLine] = useState<{ id: string; draftId: string; line: number } | null>(null);
  const editorView = useRef<EditorView | null>(null);
  const appliedFocus = useRef<string | null>(null);
  const uploadInput = useRef<HTMLInputElement>(null);
  const actions = useHostActions(client, !enabled || mutationBlocked, onPendingDelivery);
  const readDirectory = useCallback(async (signal: AbortSignal) => {
    void refresh;
    const result = await client.read({ operation: 'files.list', path: folder }, hostSchemas.list, signal);
    signal.throwIfAborted();
    const root = pinnedRoots.current.get(owner);
    if (root && root !== result.root) throw new TransportError('target_changed', 'hostTargetChanged');
    pinnedRoots.current.set(owner, result.root);
    return result;
  }, [client, folder, owner, refresh]);
  const listing = usePolling(readDirectory, enabled, 15000, `${owner}:${folder}:${rootEpoch}`);
  const root = listing.data?.root ?? pinnedRoots.current.get(owner) ?? null;
  const editorScope = useRef({ owner, root, enabled, rootValid: !listing.error });
  editorScope.current = { owner, root, enabled, rootValid: !listing.error };
  const readSearch = useCallback(async (signal: AbortSignal) => {
    const result = await client.read({ operation: 'files.search', path: '', query: searchTerm, maxResults: 100, includeHidden: false }, hostSchemas.search, signal);
    if (root && result.root !== root) throw new TransportError('target_changed', 'hostTargetChanged');
    return result;
  }, [client, searchTerm, root]);
  const search = usePolling(readSearch, !!searchTerm && !!root && enabled, 15000, `${owner}:${root}:${searchTerm}`);
  const activeId = selected.get(editorOwner) ?? null;
  const draft = activeId ? documents.get(activeId) : undefined;
  const markdownAssetSource = useMemo(() => draft && textFilePreviewKind(draft.path) === 'markdown' && draft.root === root && targetKey(draft.server, draft.target) === owner
    ? createHerdrMarkdownAssetSource(client, draft.root, draft.path) : null, [client, draft, owner, root]);
  const binaryFile = binary?.owner === owner ? binary : null;
  const openDocuments = [...documents.entries()].filter(([, document]) => targetKey(document.server, document.target) === editorOwner);
  const writable = enabled && !mutationBlocked && !!root && !listing.error && !actions.busy && !opening;
  const fileConflict = actions.error instanceof TransportError && actions.error.code === 'file_conflict' && !actions.error.uncertain && actions.failedRequest?.operation === 'files.write' ? actions.failedRequest : null;
  const errorDraft = dialog?.kind === 'close' || dialog?.kind === 'reload' ? documents.get(dialog.draftId) : draft;
  const actionError = fileConflict && (!errorDraft || errorDraft.path !== fileConflict.path || errorDraft.root !== fileConflict.expectedRoot) ? null : actions.error;
  const error = actionError ?? (failure?.owner === owner ? failure.error : null) ?? listing.error ?? search.error;
  const report = (error: Error) => setFailure({ owner, error });
  const selectDraft = (id: string | null) => {
    openingRequest.current += 1; setOpeningOwner(null);
    setSelected((previous) => new Map(previous).set(editorOwner, id));
    setBinary(null);
    setDialog(null);
  };
  const navigate = (path: string) => {
    setDirectory(path); setDirectoryOwner(owner); setSearchTerm(''); setQuery(''); selectDraft(null);
  };
  const reloadRoot = () => {
    pinnedRoots.current.delete(owner);
    setDirectory(''); setDirectoryOwner(owner); setRootEpoch((value) => value + 1); setFailure(null); setDialog(null); actions.clearError(); setSearchTerm(''); setQuery('');
  };
  const loadFile = async (path: string, expectedRoot: string, replaceDraft = false, source?: WorkspaceFileRequest) => {
    if (!enabled) return;
    const request = ++openingRequest.current;
    const identity = { server: transport.connection.server, target: client.target, root: expectedRoot, path };
    const id = draftKey(identity);
    const captured = documentsRef.current.get(id);
    if ((replaceDraft || !captured) && fileConflict?.path === path && fileConflict.expectedRoot === expectedRoot && actions.error) actions.clearError(actions.error);
    const selectRequestedLine = () => {
      if (!source) return;
      const line = source.line && Number.isInteger(source.line) && source.line > 0 ? source.line : null;
      setFocusLine(line ? { id: source.id, draftId: id, line } : null);
      if (line) setEditors(previous => ({ ...previous, viewModes: new Map(previous.viewModes).set(id, 'edit') }));
    };
    setOpeningOwner(owner); setFailure(null);
    const stillCurrent = () => currentOwner.current === owner && openingRequest.current === request && readScope.current.enabled && (!source || currentRequestedFile.current?.id === source.id);
    const confirmSource = async () => {
      if (!source) return stillCurrent();
      if (!stillCurrent()) return false;
      const current = await transport.request('/api/herdr/conversations/resolve', driverResolveSchema, {
        method: 'POST', body: JSON.stringify({ request: { target: { machine: source.machine, paneId: source.paneId, identity: source.paneIdentity } } }),
      });
      if (!stillCurrent()) return false;
      if (current.target.machine !== source.machine || current.target.paneId !== source.paneId || current.target.identity !== source.paneIdentity || current.directory !== source.root) throw new TransportError('target_changed', 'hostTargetChanged');
      return true;
    };
    try {
      if (!await confirmSource()) return;
      if (!replaceDraft && documentsRef.current.has(id)) { selectRequestedLine(); selectDraft(id); return; }
      try {
        const result = await client.read({ operation: 'files.read', path }, hostSchemas.file);
        if (currentOwner.current !== owner || openingRequest.current !== request) return;
        if (result.root !== expectedRoot || result.path !== path) throw new TransportError('target_changed', 'hostTargetChanged');
        if (!await confirmSource()) return;
        const document = createFileDraft({ ...identity, revision: result.revision, content: result.content });
        setEditors(previous => ({
          ...previous,
          documents: new Map(previous.documents).set(id, acceptFileReload(previous.documents.get(id), captured, document)),
          viewModes: previous.viewModes.has(id) ? previous.viewModes : new Map(previous.viewModes).set(id, initialFileViewMode(path, document.content)),
        }));
        selectRequestedLine(); selectDraft(id);
      } catch (error) {
        if (!(error instanceof TransportError) || error.code !== 'binary_file') throw error;
        if (currentOwner.current !== owner || openingRequest.current !== request) return;
        const result = await client.read({ operation: 'files.download', path }, hostSchemas.download);
        if (currentOwner.current !== owner || openingRequest.current !== request) return;
        if (result.root !== expectedRoot || result.path !== path) throw new TransportError('target_changed', 'hostTargetChanged');
        if (!await confirmSource()) return;
        const safeImage = /^image\/(png|jpeg|gif|webp|avif|bmp)$/.test(result.mime);
        setSelected((previous) => new Map(previous).set(owner, null));
        setBinary({ ...result, owner, image: safeImage ? `data:${result.mime};base64,${result.base64}` : null });
      }
    } catch (error) { if (currentOwner.current === owner && openingRequest.current === request) report(error instanceof Error ? error : new Error(String(error))); }
    finally { if (openingRequest.current === request) setOpeningOwner((previous) => previous === owner ? null : previous); }
  };
  const loadRequestedFile = useRef(loadFile);
  loadRequestedFile.current = loadFile;
  useEffect(() => {
    if (!enabled || !requestedFile || consumedRequest.current === requestedFile.id) return;
    if (requestedFile.server !== transport.connection.server || requestedFile.machine !== machine || requestedFile.paneId !== paneId) return;
    if (!listing.data || listing.loading || listing.error) return;
    consumedRequest.current = requestedFile.id;
    if (requestedFile.root !== listing.data.root) {
      setFailure({ owner, error: new TransportError('target_changed', 'hostTargetChanged') });
      return;
    }
    setQuery(''); setSearchTerm('');
    void loadRequestedFile.current(requestedFile.path, requestedFile.root, false, requestedFile);
  }, [enabled, requestedFile, transport.connection.server, machine, paneId, owner, listing.data, listing.loading, listing.error, client]);
  const focusEditor = useCallback((view: EditorView) => {
    editorView.current = view;
    if (!enabled || !focusLine || activeId !== focusLine.draftId || appliedFocus.current === focusLine.id) return;
    const line = view.state.doc.line(Math.min(focusLine.line, view.state.doc.lines));
    view.dispatch({ selection: { anchor: line.from }, effects: EditorView.scrollIntoView(line.from, { y: 'center' }) });
    appliedFocus.current = focusLine.id;
  }, [enabled, focusLine, activeId]);
  useEffect(() => { if (editorView.current) focusEditor(editorView.current); }, [focusEditor, draft]);
  const innerBack = useRef(() => {});
  innerBack.current = () => {
    if (draft || binaryFile) selectDraft(null);
    else if (query || searchTerm) { setQuery(''); setSearchTerm(''); }
    else if (folder) navigate(parentPath(folder));
  };
  const hasInnerRoute = !!(draft || binaryFile || query || searchTerm || folder);
  useEffect(() => {
    if (!isMobile || !enabled || !hasInnerRoute) return;
    return registerBackLayer(() => innerBack.current());
  }, [isMobile, enabled, hasInnerRoute]);
  useEffect(() => {
    if (!isMobile || !enabled) return;
    const timer = setTimeout(() => setSearchTerm(query.trim()), 250);
    return () => clearTimeout(timer);
  }, [isMobile, enabled, query]);
  const discardClosedDocument = (intent: Extract<FileDialog, { kind: 'close' }>) => {
    if (!enabled || actions.busy) return;
    setEditors(previous => previous.dialog === intent ? removeFileDocument(previous, intent.draftId, owner) : previous);
  };
  const requestCloseDocument = (id: string) => {
    if (!enabled || actions.busy) return;
    setEditors(previous => {
      const document = previous.documents.get(id);
      if (!document || targetKey(document.server, document.target) !== owner) return previous;
      return document.content !== document.baseContent ? { ...previous, dialog: { kind: 'close', owner, draftId: id } } : removeFileDocument(previous, id, owner);
    });
  };
  const save = async (id = activeId, closing?: Extract<FileDialog, { kind: 'close' }>) => {
    if (!id) return;
    const saved = documentsRef.current.get(id);
    if (!saved) return;
    try {
      const request = prepareFileSave(saved, client, root, !writable);
      const result = await actions.execute(request, hostSchemas.write);
      if (!result) return;
      setEditors(previous => {
        const current = previous.documents.get(id);
        if (!current) return previous;
        const next = { ...previous, documents: new Map(previous.documents).set(id, finishFileSave(current, saved, result)) };
        const scope = editorScope.current;
        return closing && previous.dialog === closing && scope.owner === owner && scope.root === saved.root && scope.enabled && scope.rootValid
          && current.editVersion === saved.editVersion && current.content === saved.content && current.baseContent === saved.baseContent && current.revision === saved.revision && current.lineEnding === saved.lineEnding
          ? removeFileDocument(next, id, owner) : next;
      });
      setRefresh((value) => value + 1);
    } catch (error) { report(error instanceof Error ? error : new Error(String(error))); }
  };
  const download = async (path: string, expectedRoot: string) => {
    try {
      const result = await client.read({ operation: 'files.download', path }, hostSchemas.download);
      if (result.root !== expectedRoot || result.path !== path || currentOwner.current !== owner) throw new TransportError('target_changed', 'hostTargetChanged');
      const fileName = path.split('/').at(-1) ?? path;
      const file = new File([downloadBytes(result.base64)], fileName, { type: result.mime });
      if (isCapacitorApp()) { await shareFileFromNativeApp(file); return; }
      const url = URL.createObjectURL(file);
      const anchor = document.createElement('a');
      anchor.href = url; anchor.download = path.split('/').at(-1) ?? path;
      document.body.append(anchor); anchor.click(); anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { report(error instanceof Error ? error : new Error(String(error))); }
  };
  const chooseEntryAction = async (kind: 'rename' | 'delete', entry: FileEntry) => {
    if (!root || !writable || entry.isSymbolicLink) return;
    setOpeningOwner(owner); setFailure(null);
    try {
      const document = documentsRef.current.get(draftKey({ server: transport.connection.server, target: client.target, root, path: entry.path }));
      const revision = entry.isDirectory ? null : document?.revision ?? (await client.read({ operation: 'files.download', path: entry.path }, hostSchemas.download)).revision;
      if (currentOwner.current !== owner) return;
      setName(entry.name);
      setDialog({ kind, owner, choice: { ...entry, root, revision } });
    } catch (error) { report(error instanceof Error ? error : new Error(String(error))); }
    finally { setOpeningOwner((previous) => previous === owner ? null : previous); }
  };
  const confirmDialog = async () => {
    if (!dialog || !root || !writable) return;
    if (dialog.kind === 'close') { await save(dialog.draftId, dialog); return; }
    if (dialog.kind === 'reload') {
      const document = documentsRef.current.get(dialog.draftId);
      setDialog(null);
      if (document) await loadFile(document.path, document.root, true);
      return;
    }
    if (dialog.kind === 'file' || dialog.kind === 'folder') {
      const path = childPath(dialog.directory, name.trim());
      if (!name.trim()) return;
      const result = dialog.kind === 'file'
        ? await actions.execute({ operation: 'files.write', expectedRoot: dialog.root, path, content: '', expectedRevision: null }, hostSchemas.write)
        : await actions.execute({ operation: 'files.mkdir', expectedRoot: dialog.root, path }, hostSchemas.fileMutation);
      if (!result) return;
      setDialog(null); setRefresh((value) => value + 1);
      if (dialog.kind === 'file') await loadFile(path, dialog.root);
      return;
    }
    const choice = dialog.choice;
    const newPath = childPath(parentPath(choice.path), name.trim());
    if (dialog.kind === 'rename' && !name.trim()) return;
    const result = await actions.execute(dialog.kind === 'rename'
      ? { operation: 'files.rename', expectedRoot: choice.root, path: choice.path, newPath, expectedRevision: choice.revision }
      : { operation: 'files.delete', expectedRoot: choice.root, path: choice.path, expectedRevision: choice.revision }, hostSchemas.fileMutation);
    if (!result) return;
    if (dialog.kind === 'rename') {
      setEditors(previous => {
        const documents = new Map(previous.documents);
        const viewModes = new Map(previous.viewModes);
        let movedSelection = previous.selected.get(owner) ?? null;
        for (const [id, document] of previous.documents) {
          if (targetKey(document.server, document.target) !== owner || document.root !== choice.root || (document.path !== choice.path && !(choice.isDirectory && document.path.startsWith(choice.path + '/')))) continue;
          const moved = { ...document, path: newPath + document.path.slice(choice.path.length) };
          const movedId = draftKey(moved);
          documents.delete(id); documents.set(movedId, moved);
          const mode = viewModes.get(id);
          viewModes.delete(id);
          if (mode) viewModes.set(movedId, mode);
          if (movedSelection === id) movedSelection = movedId;
        }
        return { ...previous, documents, viewModes, selected: new Map(previous.selected).set(owner, movedSelection) };
      });
    }
    if (dialog.kind === 'delete') {
      setEditors(previous => {
        const documents = new Map([...previous.documents].filter(([, document]) => targetKey(document.server, document.target) !== owner || document.root !== choice.root || document.path !== choice.path || document.content !== document.baseContent));
        const selectedId = previous.selected.get(owner);
        return {
          ...previous, documents,
          viewModes: new Map([...previous.viewModes].filter(([id]) => documents.has(id))),
          selected: selectedId && !documents.has(selectedId) ? new Map(previous.selected).set(owner, null) : previous.selected,
        };
      });
    }
    setDialog(null); setRefresh((value) => value + 1);
  };
  const upload = async (file: File) => {
    if (!root || !writable) return;
    const expectedRoot = root;
    const path = childPath(folder, file.name);
    try {
      if (file.size > 8 * 1024 * 1024) throw new TransportError('file_too_large', t('filesView.warning.largeFilePreviewLimited', { sizeKb: Math.ceil(file.size / 1024) }));
      const base64 = fileBytesToBase64(new Uint8Array(await file.arrayBuffer()));
      if (currentOwner.current !== owner) return;
      const result = await actions.execute({ operation: 'files.upload', expectedRoot, path, base64, expectedRevision: null }, hostSchemas.write);
      if (result) setRefresh((value) => value + 1);
    } catch (error) { report(error instanceof Error ? error : new Error(String(error))); }
  };
  const refreshFile = () => {
    if (!draft || !activeId) return;
    if (draft.content !== draft.baseContent) setDialog({ kind: 'reload', owner, draftId: activeId });
    else void loadFile(draft.path, draft.root, true);
  };
  const unsavedDialog = dialog?.kind === 'reload' || dialog?.kind === 'close';
  const dialogTitle = unsavedDialog ? t('filesView.unsaved.title') : dialog?.kind === 'rename' ? t('filesView.dialog.rename.title') : dialog?.kind === 'delete' ? t('filesView.dialog.delete.title') : dialog?.kind === 'folder' ? t('filesView.dialog.createFolder.title') : t('filesView.dialog.createFile.title');

  const editorContent = draft && activeId ? <div className="flex min-h-0 flex-1 flex-col">
    <Suspense fallback={<p className="herdr-detail">{t('common.loading')}</p>}>
      <TextEditor key={activeId} id={activeId} server={draft.server} root={draft.root} path={draft.path} content={draft.content} baseContent={draft.baseContent} sizeBytes={draft.bytes} theme={theme} enabled={enabled} isMobile={isMobile}
        mode={editors.viewModes.get(activeId) ?? initialFileViewMode(draft.path, draft.content)}
        onModeChange={mode => setEditors(previous => enabled && previous.selected.get(owner) === activeId
          ? { ...previous, viewModes: new Map(previous.viewModes).set(activeId, mode) } : previous)}
        assetSource={enabled && !listing.error ? markdownAssetSource : null}
        onOpenFile={path => { if (enabled && root === draft.root && currentOwner.current === owner) void loadFile(path, draft.root); }}
        readOnly={draft.root !== root || targetKey(draft.server, draft.target) !== owner}
        onViewReady={focusEditor} onViewDestroy={() => { editorView.current = null; }}
        canSave={writable && draft.root === root && targetKey(draft.server, draft.target) === owner && draft.content !== draft.baseContent}
        onSave={() => void save()}
        onChange={content => {
          if (!enabled || draft.root !== root || targetKey(draft.server, draft.target) !== owner) return;
          setDocuments(previous => { const current = previous.get(activeId); return current ? new Map(previous).set(activeId, editFileDraft(current, content)) : previous; });
        }} />
    </Suspense>
    <p className="shrink-0 px-3 py-2 typography-meta text-muted-foreground">{draft.content === draft.baseContent ? t('filesView.editor.saved') : t('filesView.unsaved.title')}</p>
  </div> : binaryFile ? <div className="min-h-0 flex-1">{binaryFile.image ? <ImageArtifact src={binaryFile.image} name={binaryFile.path.split('/').at(-1) ?? binaryFile.path} sizeBytes={binaryFile.bytes} /> : <BinaryArtifact name={binaryFile.path.split('/').at(-1) ?? binaryFile.path} path={binaryFile.path} sizeBytes={binaryFile.bytes} />}</div> : null;
  const fileDialog = <Dialog open={dialog !== null && enabled} onOpenChange={open => { if (!open && !actions.busy) setDialog(null); }}>
    <DialogContent><DialogHeader><DialogTitle>{dialogTitle}</DialogTitle>
      <DialogDescription>{unsavedDialog ? t('filesView.unsaved.description') : dialog?.kind === 'delete' ? t('filesView.dialog.delete.description', { name: dialog.choice.name }) : dialog?.kind === 'rename' ? t('filesView.dialog.rename.description', { name: dialog.choice.name }) : t(dialog?.kind === 'folder' ? 'filesView.dialog.createFolder.description' : 'filesView.dialog.createFile.description', { path: folder || '/' })}{dialog?.kind === 'close' && <span className="mt-2 block break-all" dir="auto">{documents.get(dialog.draftId)?.path}</span>}</DialogDescription>
    </DialogHeader>
      {actionError && <p role="alert" className="typography-meta text-[var(--status-error-text)]">{actionError instanceof TransportError && actionError.code === 'target_changed' ? h('hostTargetChanged') : actionError.message === 'outcomeUnknown' ? h('hostUnknown') : actionError.message === 'deliveryStorage' ? h('deliveryStorage') : actionError.message}</p>}
      {dialog && dialog.kind !== 'delete' && !unsavedDialog && <Input value={name} onChange={event => setName(event.target.value)} placeholder={t('filesView.dialog.namePlaceholder')} aria-label={t('filesView.dialog.namePlaceholder')} dir="ltr" autoFocus onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); void confirmDialog(); } }} />}
      <DialogFooter>
        <Button variant="outline" disabled={actions.busy} onClick={() => setDialog(null)}>{t('filesView.dialog.cancel')}</Button>
        {dialog?.kind === 'close' && <Button variant="destructive" disabled={actions.busy} onClick={() => discardClosedDocument(dialog)}>{t('filesView.unsaved.discard')}</Button>}
        <Button variant={dialog?.kind === 'delete' ? 'destructive' : 'default'} disabled={!writable || !!dialog && !['delete', 'reload', 'close'].includes(dialog.kind) && !name.trim()} onClick={() => void confirmDialog()}>{dialog?.kind === 'close' ? t('filesView.unsaved.saveChanges') : dialog?.kind === 'reload' ? t('filesView.unsaved.discard') : dialog?.kind === 'delete' ? t('filesView.dialog.delete.confirm') : t('filesView.dialog.confirm')}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
  const openFileMenu = activeId && enabled && <div className="flex min-w-0 shrink-0 items-center border-b border-border/40 px-3 py-1.5"><MobileOpenFilesMenu
    rows={openDocuments.map(([id, document]) => ({ id, path: document.path, name: document.path.split('/').at(-1) ?? document.path, dirty: document.content !== document.baseContent }))}
    activeId={activeId} open={enabled && openFilesOwner === owner} onOpenChange={open => setOpenFilesOwner(open ? owner : null)} disabled={!enabled}
    onSelect={selectDraft} onCloseFile={requestCloseDocument} /></div>;
  if (isMobile) {
    const file = draft ?? binaryFile;
    const viewDirectory = folder ? `${root === '/' ? '' : root}/${folder}` : root ?? '';
    const rowActions = (entry: FileEntry) => <>
      <Button variant="ghost" size="icon" aria-label={t('filesView.dialog.rename.description', { name: entry.name })} disabled={!writable || entry.isSymbolicLink} onClick={() => void chooseEntryAction('rename', entry)}><Icon name="edit" className="size-4" /></Button>
      <Button variant="ghost" size="icon" aria-label={t('filesView.dialog.delete.description', { name: entry.name })} disabled={!writable || entry.isSymbolicLink} onClick={() => void chooseEntryAction('delete', entry)}><Icon name="delete-bin" className="size-4" /></Button>
    </>;
    const fileActions = <>
      {draft && <Button size="sm" disabled={!writable || draft.root !== root || targetKey(draft.server, draft.target) !== owner || draft.content === draft.baseContent} onClick={() => void save()}>{actions.busy ? t('filesView.editor.saving') : t('filesView.fileEditor.save')}</Button>}
      {file && <Button variant="ghost" size="icon" aria-label={t('sidebarFilesTree.menu.download')} disabled={!enabled} onClick={() => void download(file.path, file.root)}><Icon name="download" className="size-4" /></Button>}
      <Button variant="ghost" size="icon" aria-label={t('mobile.files.refreshAria')} disabled={opening || !enabled} onClick={() => draft ? refreshFile() : setRefresh(value => value + 1)}><Icon name="refresh" className="size-4" /></Button>
    </>;
    const notices = <>
      {error && <div className="herdr-banner herdr-error" role="alert"><p>{error instanceof TransportError && error.code === 'target_changed' ? h('hostTargetChanged') : error.message === 'outcomeUnknown' ? h('hostUnknown') : error.message}</p>{error instanceof TransportError && error.code === 'target_changed' && <Button size="sm" onClick={reloadRoot}>{t('contextPanel.browser.reload')}</Button>}</div>}
      {file && <p className="shrink-0 px-3 py-2 typography-meta text-muted-foreground">{h('currentFile')}</p>}
      {draft?.reloadConflict && <p className="herdr-banner herdr-warning" role="alert">{t('filesView.unsaved.title')}. {t('filesView.unsaved.description')}</p>}
      {(listing.data?.truncated || search.data?.truncated) && <p className="shrink-0 px-3 py-2 typography-meta text-muted-foreground">{t('mobile.files.file.truncated')}</p>}
      {opening && <p className="shrink-0 px-3 py-2 typography-meta text-muted-foreground" role="status">{t('common.loading')}</p>}
    </>;
    return <section className="herdr-content" aria-label={t('mobile.files.rootDirectory')}>
      <MobileFilesView root={root ?? file?.root ?? ''} route={file ? { type: 'file', path: file.path, returnDirectory: viewDirectory } : { type: 'browser', directory: viewDirectory }}
        entries={(listing.data?.entries ?? []).map(entry => ({ ...entry, disabled: entry.isSymbolicLink || !enabled, actions: rowActions(entry) }))}
        isLoadingDirectory={listing.loading} directoryError={!root && error ? error instanceof TransportError && error.code === 'target_changed' ? h('hostTargetChanged') : error.message : null} query={query} searchResults={search.data?.results ?? []} isSearching={search.loading && !!searchTerm}
        onQueryChange={setQuery} onOpenDirectory={path => navigate(path === root ? '' : root && path.startsWith(root === '/' ? '/' : `${root}/`) ? path.slice(root === '/' ? 1 : root.length + 1) : path)}
        onOpenFile={path => { if (root && enabled) void loadFile(path, root); }} onBack={() => innerBack.current()}
        onRefresh={() => setRefresh(value => value + 1)} fileActions={fileActions}
        browserActions={<>{notices}<div className="flex shrink-0 flex-wrap gap-2 px-3 py-2">
          <Button variant="outline" size="sm" disabled={!writable} onClick={() => { if (root) { setDialog({ kind: 'file', owner, root, directory: folder }); setName(''); } }}>{t('sidebarFilesTree.menu.newFile')}</Button>
          <Button variant="outline" size="sm" disabled={!writable} onClick={() => { if (root) { setDialog({ kind: 'folder', owner, root, directory: folder }); setName(''); } }}>{t('sidebarFilesTree.menu.newFolder')}</Button>
        </div></>}
        canUpload={writable} isUploading={actions.busy} onUpload={() => uploadInput.current?.click()}
      >{notices}{openFileMenu}{editorContent}</MobileFilesView>
      <input ref={uploadInput} type="file" className="hidden" aria-label={t('sidebarFilesTree.menu.uploadFiles')} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void upload(file); }} />
      {enabled && fileDialog}
    </section>;
  }
  return <section className="herdr-content" aria-label={t('mobile.files.rootDirectory')}>
    <div className="herdr-content-toolbar flex-wrap">
      <Button variant="ghost" size="sm" onClick={() => draft || binaryFile ? selectDraft(null) : navigate(parentPath(folder))} disabled={!draft && !binaryFile && !folder}><Icon name="arrow-go-back" className="size-4" />{t('mobile.files.parentDirectory')}</Button>
      <span className="herdr-file-path" dir="ltr">/{draft?.path ?? binaryFile?.path ?? folder}</span>
      {draft && <Button size="sm" disabled={!writable || draft.root !== root || targetKey(draft.server, draft.target) !== owner || draft.content === draft.baseContent} onClick={() => void save()}>{actions.busy ? t('filesView.editor.saving') : t('filesView.fileEditor.save')}</Button>}
      {(draft || binaryFile) && <Button variant="ghost" size="icon" aria-label={t('sidebarFilesTree.menu.download')} disabled={disabled || !paneId} onClick={() => { const file = draft ?? binaryFile; if (file) void download(file.path, file.root); }}><Icon name="download" className="size-4" /></Button>}
      <Button variant="ghost" size="icon" aria-label={t('mobile.files.refreshAria')} disabled={opening} onClick={() => draft ? refreshFile() : setRefresh((value) => value + 1)}><Icon name="refresh" className="size-4" /></Button>
    </div>
    {openFileMenu}
    {error && <div className="herdr-banner herdr-error" role="alert"><p>{error instanceof TransportError && error.code === 'target_changed' ? h('hostTargetChanged') : error.message === 'outcomeUnknown' ? h('hostUnknown') : error.message === 'deliveryStorage' ? h('deliveryStorage') : error.message}</p>{error instanceof TransportError && error.code === 'target_changed' && <Button size="sm" variant="outline" onClick={reloadRoot}>{t('contextPanel.browser.reload')}</Button>}</div>}
    {draft?.reloadConflict && <p className="herdr-banner herdr-warning" role="alert">{t('filesView.unsaved.title')}. {t('filesView.unsaved.description')}</p>}
    {(opening || listing.loading && !draft && !binaryFile) && <p className="herdr-detail" role="status">{t('common.loading')}</p>}
    {!paneId && <p className="herdr-detail">{h('noPane')}</p>}
    {draft || binaryFile ? editorContent : <>
      <form className="flex shrink-0 gap-2 p-3" onSubmit={(event) => { event.preventDefault(); setSearchTerm(query.trim()); }}><Input inputSize="compact" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('mobile.files.search.placeholder')} aria-label={t('mobile.files.search.placeholder')} /><Button type="submit" size="sm" variant="outline" aria-label={t('mobile.files.search.placeholder')}><Icon name="search" className="size-4" /></Button>{searchTerm && <Button size="sm" variant="ghost" aria-label={t('sidebarFilesTree.search.clearAria')} onClick={() => { setSearchTerm(''); setQuery(''); }}><Icon name="close" className="size-4" /></Button>}</form>
      <div className="flex shrink-0 flex-wrap gap-2 px-3 pb-3"><Button variant="outline" size="sm" disabled={!writable} onClick={() => { if (root) { setDialog({ kind: 'file', owner, root, directory: folder }); setName(''); } }}>{t('sidebarFilesTree.menu.newFile')}</Button><Button variant="outline" size="sm" disabled={!writable} onClick={() => { if (root) { setDialog({ kind: 'folder', owner, root, directory: folder }); setName(''); } }}>{t('sidebarFilesTree.menu.newFolder')}</Button><Button variant="outline" size="sm" disabled={!writable} onClick={() => uploadInput.current?.click()}>{t('sidebarFilesTree.menu.uploadFiles')}</Button><input ref={uploadInput} type="file" className="hidden" aria-label={t('sidebarFilesTree.menu.uploadFiles')} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void upload(file); }} /></div>
      <div className="herdr-file-list">
        {searchTerm ? <>{search.loading && <p role="status">{t('sidebarFilesTree.state.searching')}</p>}{search.data?.results.length === 0 && <p>{t('mobile.files.search.empty')}</p>}{search.data?.results.map((entry) => <Button key={entry.path} variant="ghost" className="herdr-file-row flex-col items-start" onClick={() => root && void loadFile(entry.path, root)}><span className="flex items-center gap-2"><FileTypeIcon filePath={entry.path} className="size-4" /><span dir="auto">{entry.path}</span></span>{entry.preview.map((line, index) => <span key={index} className="text-muted-foreground typography-micro" dir="auto">{line}</span>)}</Button>)}{search.data?.truncated && <p>{t('mobile.files.file.truncated')}</p>}</> : <>{listing.data?.entries.length === 0 && <p>{t('mobile.files.empty.directory')}</p>}{listing.data?.entries.map((entry) => <div key={entry.path} className="flex items-center gap-1"><Button variant="ghost" className="herdr-file-row min-w-0 flex-1" disabled={entry.isSymbolicLink} onClick={() => entry.isDirectory ? navigate(entry.path) : root && void loadFile(entry.path, root)}>{entry.isDirectory ? <Icon name="folder" className="size-4 shrink-0" /> : <FileTypeIcon filePath={entry.path} className="size-4 shrink-0" />}<span dir="auto">{entry.name}</span>{entry.isSymbolicLink && <Icon name="link" className="size-3" />}</Button><Button variant="ghost" size="icon" aria-label={t('filesView.dialog.rename.description', { name: entry.name })} disabled={!writable || entry.isSymbolicLink} onClick={() => void chooseEntryAction('rename', entry)}><Icon name="edit" className="size-4" /></Button><Button variant="ghost" size="icon" aria-label={t('filesView.dialog.delete.description', { name: entry.name })} disabled={!writable || entry.isSymbolicLink} onClick={() => void chooseEntryAction('delete', entry)}><Icon name="delete-bin" className="size-4" /></Button></div>)}{listing.data?.truncated && <p className="herdr-muted">{t('mobile.files.file.truncated')}</p>}</>}
      </div>
    </>}
    <footer className="herdr-content-root" dir="ltr">{draft?.root ?? binaryFile?.root ?? root}</footer>
    {enabled && fileDialog}
  </section>;
}

type ChangesRoute = { type: 'changes' | 'branches' | 'history' } | { type: 'diff'; path: string; staged: boolean };

export function ChangesPanel({ transport, machine, paneId, terminalId, disabled = false, mutationBlocked = false, themeMode, theme, onPendingDelivery, initialDiff }: PanelProps & { terminalId?: string; initialDiff?: WorkspaceDiffRequest | null }) {
  const { t } = useI18n();
  const h = useHerdrText();
  const client = useMemo(() => new HostClient(transport, { machine, pane_id: paneId }), [transport, machine, paneId]);
  const owner = JSON.stringify([transport.connection.server, machine, paneId, terminalId ?? null]);
  const enabled = !!paneId && !disabled;
  const pinnedRoots = useRef(new Map<string, string>());
  const [refresh, setRefresh] = useState(0);
  const [epoch, setEpoch] = useState(0);
  const [navigation, setNavigation] = useState<{ scope: string; route: ChangesRoute } | null>(null);
  const [messages, setMessages] = useState(new Map<string, string>());
  const [branchName, setBranchName] = useState('');
  const [branchDialogOwner, setBranchDialogOwner] = useState<string | null>(null);
  const [historyLimit, setHistoryLimit] = useState(30);
  const hideWhitespace = useUIStore(state => state.diffHideWhitespace);
  const setHideWhitespace = useUIStore(state => state.setDiffHideWhitespace);
  const readStatus = useCallback(async (signal: AbortSignal) => {
    void refresh;
    const result = await client.read({ operation: 'git.status' }, hostSchemas.status, signal);
    signal.throwIfAborted();
    const pinned = pinnedRoots.current.get(owner);
    if (pinned && pinned !== result.root) throw new TransportError('target_changed', 'hostTargetChanged');
    pinnedRoots.current.set(owner, result.root);
    return result;
  }, [client, owner, refresh]);
  const status = usePolling(readStatus, enabled, 15000, `${owner}:${epoch}`);
  const root = status.data?.root ?? pinnedRoots.current.get(owner) ?? null;
  const scope = JSON.stringify([owner, root]);
  const actions = useHostActions(client, !enabled || mutationBlocked, onPendingDelivery, scope);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const route: ChangesRoute = navigation?.scope === scope ? navigation.route : { type: 'changes' };
  const mode = route.type;
  const setMode = (type: 'changes' | 'branches' | 'history') => setNavigation({ scope, route: { type } });
  const branchDialog = branchDialogOwner === scope;
  const setBranchDialog = (open: boolean) => setBranchDialogOwner(open ? scope : null);
  const [modeMenuOwner, setModeMenuOwner] = useState<string | null>(null);
  useEffect(() => setModeMenuOwner(null), [enabled, scope]);
  const consumedRequest = useRef<string | null>(null);
  useEffect(() => {
    if (!enabled || !initialDiff || consumedRequest.current === initialDiff.id || !status.data || status.error) return;
    if (initialDiff.server !== transport.connection.server || initialDiff.machine !== machine || initialDiff.paneId !== paneId || initialDiff.terminalId !== terminalId) return;
    consumedRequest.current = initialDiff.id;
    const path = workspaceFilePath(initialDiff.path, status.data.root);
    if (path) setNavigation({ scope, route: { type: 'diff', path, staged: initialDiff.staged ?? false } });
  }, [enabled, initialDiff, status.data, status.error, transport.connection.server, machine, paneId, terminalId, scope]);
  const backToList = useRef(() => {});
  backToList.current = () => setMode('changes');
  useEffect(() => {
    if (!enabled || mode !== 'diff') return;
    return registerBackLayer(() => backToList.current());
  }, [enabled, mode]);
  const readBranches = useCallback(async (signal: AbortSignal) => {
    void refresh;
    const result = await client.read({ operation: 'git.branches' }, hostSchemas.branches, signal);
    if (root && root !== result.root) throw new TransportError('target_changed', 'hostTargetChanged');
    return result;
  }, [client, root, refresh]);
  const branches = usePolling(readBranches, mode === 'branches' && !!root && enabled && !status.error, 15000, `${owner}:${root}`);
  const readHistory = useCallback(async (signal: AbortSignal) => {
    void refresh;
    const result = await client.read({ operation: 'git.log', limit: historyLimit }, hostSchemas.log, signal);
    if (root && root !== result.root) throw new TransportError('target_changed', 'hostTargetChanged');
    return result;
  }, [client, root, refresh, historyLimit]);
  const history = usePolling(readHistory, mode === 'history' && !!root && enabled && !status.error, 15000, `${owner}:${root}:${historyLimit}`);
  const diffPath = route.type === 'diff' ? route.path : '';
  const diffStaged = route.type === 'diff' && route.staged;
  const stagedFiles = status.data?.files.filter(file => file.index.trim() && file.index !== '?') ?? [];
  const workingFiles = status.data?.files.filter(file => file.working_dir.trim() || file.index === '?') ?? [];
  const fileExists = (diffStaged ? stagedFiles : workingFiles).some(file => file.path === diffPath);
  const readDiff = useCallback(async (signal: AbortSignal) => {
    void refresh;
    const result = await client.read({ operation: 'git.diff', path: diffPath, staged: diffStaged }, hostSchemas.diff, signal);
    if (root && root !== result.root) throw new TransportError('target_changed', 'hostTargetChanged');
    return result;
  }, [client, root, diffPath, diffStaged, refresh]);
  const diff = usePolling(readDiff, mode === 'diff' && !!root && enabled && !status.error && fileExists, 15000, `${scope}:${diffPath}:${diffStaged}`);
  const selectedDiff = useMemo(() => {
    if (!diff.data) return null;
    const isBinary = isBinaryPatch(diff.data.diff);
    return { original: '', modified: '', isBinary, fileDiff: !isBinary && diff.data.diff ? fileDiffFromPatch(diffPath, diff.data.diff) ?? undefined : undefined };
  }, [diff.data, diffPath]);
  const writable = enabled && !mutationBlocked && !!root && !!status.data && !status.error && !actions.busy;
  const message = messages.get(scope) ?? '';
  const error = actions.error ?? status.error ?? (mode === 'branches' ? branches.error : mode === 'history' ? history.error : null);
  const errorText = (failure: Error) => failure instanceof TransportError && failure.code === 'target_changed' ? h('hostTargetChanged') : failure.message === 'outcomeUnknown' ? h('hostUnknown') : failure.message === 'deliveryStorage' ? h('deliveryStorage') : failure.message;
  const stage = async (paths: string[], staged: boolean) => {
    if (!writable || !root) return;
    const result = await actions.execute({ operation: staged ? 'git.unstage' : 'git.stage', expectedRoot: root, paths }, hostSchemas.gitMutation);
    if (result && currentScope.current === scope) setRefresh(value => value + 1);
  };
  const openDiff = (path: string, staged: boolean) => setNavigation({ scope, route: { type: 'diff', path, staged } });
  const groups: ChangesGroupConfig[] = [
    { id: 'staged', title: t('gitView.changes.stagedTitle'), entries: stagedFiles, statsScope: 'staged', actionSymbol: '-', actionAllLabel: t('gitView.changes.unstageAllAria'), getActionLabel: path => t('gitView.changes.unstageFileAria', { path }), onActionFile: path => void stage([path], true), onActionAll: paths => void stage(paths, true), onViewDiff: path => openDiff(path, true), onRevertFile: () => undefined, showRevertActions: false },
    { id: 'working', title: t('gitView.changes.title'), entries: workingFiles, statsScope: 'working', actionSymbol: '+', actionAllLabel: t('gitView.changes.stageAllAria'), getActionLabel: path => t('gitView.changes.stageFileAria', { path }), onActionFile: path => void stage([path], false), onActionAll: paths => void stage(paths, false), onViewDiff: path => openDiff(path, false), onRevertFile: () => undefined, showRevertActions: false },
  ];
  const commit = async () => {
    if (!root || !writable || !message.trim() || stagedFiles.length === 0) return;
    const sent = message;
    const result = await actions.execute({ operation: 'git.commit', expectedRoot: root, message: sent }, hostSchemas.commit);
    if (!result) return;
    setMessages(previous => previous.get(scope) === sent ? new Map(previous).set(scope, '') : previous);
    if (currentScope.current === scope) setRefresh(value => value + 1);
  };
  const createBranch = async () => {
    if (!root || !writable || !branchName.trim()) return;
    const result = await actions.execute({ operation: 'git.branch', expectedRoot: root, name: branchName.trim() }, hostSchemas.branchMutation);
    if (result && currentScope.current === scope) { setBranchDialog(false); setBranchName(''); setRefresh(value => value + 1); }
  };
  const checkout = async (branch: string) => {
    if (!root || !writable) return;
    if (await actions.execute({ operation: 'git.checkout', expectedRoot: root, branch }, hostSchemas.branchMutation) && currentScope.current === scope) setRefresh(value => value + 1);
  };
  const reloadRoot = () => { pinnedRoots.current.delete(owner); setNavigation(null); setBranchDialogOwner(null); actions.clearError(); setEpoch(value => value + 1); };
  const notices = <>{error && <div className="herdr-banner herdr-error" role="alert"><p>{errorText(error)}</p>{error instanceof TransportError && error.code === 'target_changed' && <Button variant="outline" size="sm" onClick={reloadRoot}>{t('contextPanel.browser.reload')}</Button>}</div>}{!paneId && <p className="herdr-detail">{h('noPane')}</p>}</>;
  return <section className="herdr-content bg-background text-foreground" aria-label={t('gitView.changes.title')} onKeyDownCapture={event => { if (mode === 'diff' && enabled && event.key === 'Escape' && !event.nativeEvent.isComposing) { event.preventDefault(); event.stopPropagation(); setMode('changes'); } }}>
    {mode === 'diff' ? <>{notices}<MobileDiffDetail path={diffPath} subtitle={t(diffStaged ? 'gitView.changes.stagedTitle' : 'gitView.changes.title')} diff={selectedDiff} staged={diffStaged} fileExists={fileExists || !status.data || !!status.error} error={diff.error ? errorText(diff.error) : null} onBack={() => setMode('changes')} onRetry={() => setRefresh(value => value + 1)} hideWhitespace={hideWhitespace} onHideWhitespaceChange={setHideWhitespace} theme={theme} themeMode={themeMode} enableComments={false} /></> : <>
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border/60 px-3 py-2">
        <DropdownMenu open={enabled && modeMenuOwner === scope} onOpenChange={open => setModeMenuOwner(open ? scope : null)}><DropdownMenuTrigger asChild><Button variant="outline" className={dropdownTriggerVariants({ size: 'mobile' })} aria-label={t('diffView.scope.selectorAria')}><span>{t(mode === 'branches' ? 'gitView.branch.localBranches' : mode === 'history' ? 'gitView.history.title' : 'mobile.nav.changes')}</span><Icon name="arrow-down-s" className="size-4" /></Button></DropdownMenuTrigger><DropdownMenuContent align="start"><DropdownMenuRadioGroup value={mode} onValueChange={value => { if (value === 'changes' || value === 'branches' || value === 'history') { setMode(value); setModeMenuOwner(null); } }}><DropdownMenuRadioItem value="changes">{t('mobile.nav.changes')}</DropdownMenuRadioItem><DropdownMenuRadioItem value="branches">{t('gitView.branch.localBranches')}</DropdownMenuRadioItem><DropdownMenuRadioItem value="history">{t('gitView.history.title')}</DropdownMenuRadioItem></DropdownMenuRadioGroup></DropdownMenuContent></DropdownMenu>
        <span className="min-w-0 flex-1 truncate typography-meta text-muted-foreground" dir="ltr" title={root ?? undefined}>{status.data?.current ?? root}</span><Button variant="ghost" size="icon" aria-label={t('gitView.history.refresh')} onClick={() => setRefresh(value => value + 1)}><Icon name="refresh" className="size-4" /></Button>
      </header>
      {notices}
      {mode === 'changes' && (!status.data ? <MobileChangesState loading={status.loading} message={t(status.loading ? 'gitView.loading.checkingRepository' : 'common.unavailable')} /> : status.data.files.length === 0 ? <MobileChangesState icon message={t('gitView.empty.cleanTitle')} description={t('mobile.changes.cleanDescription')} /> : <MobileWorkingChangesView commitFooter={<fieldset disabled={!writable} className="m-0 min-w-0 border-0 p-0"><CommitSection stagedCount={stagedFiles.length} commitMessage={message} onCommitMessageChange={value => setMessages(previous => new Map(previous).set(scope, value))} onCommit={() => void commit()} commitAction={actions.operation === 'git.commit' ? 'commit' : null} hasPendingIndexMutation={!writable} /></fieldset>}><fieldset disabled={!writable} className="m-0 flex h-full min-h-0 flex-col border-0 p-0" aria-label={t('gitView.changes.changedFilesAria')}><GitChangesList groups={groups} diffStats={undefined} revertingPaths={emptyPaths} headerBackgroundClassName="bg-transparent" /></fieldset></MobileWorkingChangesView>)}
    {mode === 'branches' && <div className="herdr-file-list"><Button variant="outline" size="sm" disabled={!writable} onClick={() => { setBranchName(''); setBranchDialog(true); }}>{t('gitView.branch.create')}</Button>{branches.loading && <p>{t('common.loading')}</p>}{branches.data?.all.length === 0 && <p>{t('gitView.branch.empty')}</p>}{branches.data?.all.map((name) => <div key={name} className="flex items-center gap-2 py-2"><Icon name="git-branch" className="size-4 shrink-0" /><span className="min-w-0 flex-1 truncate" dir="auto">{name}</span>{name === branches.data?.current ? <span className="text-muted-foreground typography-micro">{t('gitView.branch.currentBadge')}</span> : <Button variant="outline" size="sm" disabled={!writable || branches.data?.branches[name]?.linkedWorktree} onClick={() => void checkout(name)}>{t('gitView.history.actions.checkout')}</Button>}</div>)}</div>}
    {mode === 'history' && <div className="herdr-file-list">{history.loading && <p>{t('common.loading')}</p>}{history.data?.all.length === 0 && <p>{t('gitView.history.noCommits')}</p>}{history.data?.all.map((entry) => <details key={entry.hash} className="border-b border-border py-3"><summary className="cursor-pointer"><span className="font-medium" dir="auto">{entry.message}</span><span className="ms-2 text-muted-foreground typography-micro" dir="ltr">{entry.hash.slice(0, 8)}</span></summary><p className="text-muted-foreground typography-micro" dir="auto">{entry.author_name} · {entry.date}</p>{entry.body && <pre className="whitespace-pre-wrap typography-ui" dir="auto">{entry.body}</pre>}</details>)}{history.data && history.data.total > history.data.all.length && historyLimit < 100 && <Button variant="outline" size="sm" onClick={() => setHistoryLimit((value) => Math.min(100, value + 30))}>{t('gitView.history.loadMore')}</Button>}</div>}
    </>}
    <Dialog open={branchDialog && !disabled} onOpenChange={(open) => !actions.busy && setBranchDialog(open)}><DialogContent><DialogHeader><DialogTitle>{t('gitView.branch.create')}</DialogTitle><DialogDescription>{t('gitView.branch.currentBranchTooltip')} <span dir="ltr">{status.data?.current}</span></DialogDescription></DialogHeader><Input value={branchName} onChange={(event) => setBranchName(event.target.value)} placeholder={t('gitView.branch.namePlaceholder')} aria-label={t('gitView.branch.namePlaceholder')} autoFocus dir="ltr" onKeyDown={(event) => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); void createBranch(); } }} /><DialogFooter><Button variant="outline" disabled={actions.busy} onClick={() => setBranchDialog(false)}>{t('gitView.common.cancel')}</Button><Button disabled={!writable || !branchName.trim()} onClick={() => void createBranch()}>{t('gitView.history.actions.createBranchConfirm')}</Button></DialogFooter></DialogContent></Dialog>
  </section>;
}
