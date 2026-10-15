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
import { HostClient, hostSchemas, targetKey, draftKey, editFileDraft, prepareFileSave, finishFileSave, acceptFileReload, isConfirmedHostRefusal, fileBytesToBase64, downloadBytes, type FileDraft, type HostMutation } from './host-client';
import { usePolling } from './usePolling';
import { useHerdrText } from './herdr.i18n';
import type { Theme } from '@/types/theme';

const CodeEditor = lazy(() => import('@/components/ui/CodeMirrorEditor').then((module) => ({ default: module.CodeMirrorEditor })));
const DiffViewer = lazy(() => import('@/components/views/PierreDiffViewer').then((module) => ({ default: module.PierreDiffViewer })));

type PanelProps = { transport: HerdrTransport; machine: string; paneId: string; disabled?: boolean; mutationBlocked?: boolean; themeMode?: 'light' | 'dark'; theme?: Theme; onPendingDelivery?: (record: PendingDelivery | null) => void };
type FileEntry = z.infer<typeof hostSchemas.list>['entries'][number];
type FileChoice = Pick<FileEntry, 'path' | 'name' | 'isDirectory'> & { root: string; revision: string | null };
type FileDialog =
  | { kind: 'file'; owner: string; root: string; directory: string }
  | { kind: 'folder'; owner: string; root: string; directory: string }
  | { kind: 'rename'; owner: string; choice: FileChoice }
  | { kind: 'delete'; owner: string; choice: FileChoice }
  | { kind: 'reload'; owner: string; draftId: string };
type BinaryFile = z.infer<typeof hostSchemas.download> & { owner: string; image: string | null };
const emptyPaths = new Set<string>();
const parentPath = (path: string) => path.split('/').slice(0, -1).join('/');
const childPath = (directory: string, name: string) => directory ? `${directory}/${name}` : name;

function useHostActions(client: HostClient, disabled: boolean, onPendingDelivery: PanelProps['onPendingDelivery']) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<{ owner: string; error: Error } | null>(null);
  const running = useRef(false);
  const owner = targetKey(client.transport.connection.server, client.target);
  const live = useRef({ owner, disabled });
  live.current = { owner, disabled };
  const execute = useCallback(async <T extends { root: string },>(request: HostMutation, schema: z.ZodType<T>): Promise<T | null> => {
    if (running.current || live.current.disabled || live.current.owner !== owner) return null;
    running.current = true;
    setBusy(true);
    setFailure(null);
    try {
      const { record, outcome } = await client.mutate(request, schema);
      if (outcome.kind === 'pending') {
        onPendingDelivery?.(outcome.record);
        setFailure({ owner, error: new TransportError('OUTCOME_UNKNOWN', 'outcomeUnknown', true, outcome.record.requestId) });
        return null;
      }
      if (!await clearPendingDelivery(record.server, record.requestId)) throw new TransportError('DELIVERY_STORAGE', 'deliveryStorage', false, record.requestId);
      onPendingDelivery?.(await loadPendingDelivery(record.server));
      return outcome.value;
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error));
      setFailure({ owner, error: failure });
      try {
        const pending = await loadPendingDelivery(client.transport.connection.server);
        if (pending) {
          onPendingDelivery?.(pending);
          if (isConfirmedHostRefusal(failure) && pending.requestId === failure.requestId && await clearPendingDelivery(pending.server, pending.requestId)) onPendingDelivery?.(await loadPendingDelivery(pending.server));
        }
      } catch { setFailure({ owner, error: new TransportError('DELIVERY_STORAGE', 'deliveryStorage') }); }
      return null;
    } finally {
      running.current = false;
      setBusy(false);
    }
  }, [client, onPendingDelivery, owner]);
  return { busy, execute, clearError: () => setFailure(null), error: failure?.owner === owner ? failure.error : null };
}

export function FilesPanel({ transport, machine, paneId, disabled = false, mutationBlocked = false, onPendingDelivery }: PanelProps) {
  const { t } = useI18n();
  const h = useHerdrText();
  const client = useMemo(() => new HostClient(transport, { machine, pane_id: paneId }), [transport, machine, paneId]);
  const owner = targetKey(transport.connection.server, client.target);
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
  const [documents, setDocuments] = useState(new Map<string, FileDraft>());
  const documentsRef = useRef(documents);
  documentsRef.current = documents;
  const [selected, setSelected] = useState(new Map<string, string | null>());
  const [binary, setBinary] = useState<BinaryFile | null>(null);
  const [dialogState, setDialog] = useState<FileDialog | null>(null);
  const dialog = dialogState?.owner === owner ? dialogState : null;
  const [name, setName] = useState('');
  const [openingOwner, setOpeningOwner] = useState<string | null>(null);
  const opening = openingOwner === owner;
  const [failure, setFailure] = useState<{ owner: string; error: Error } | null>(null);
  const openingRequest = useRef(0);
  const uploadInput = useRef<HTMLInputElement>(null);
  const actions = useHostActions(client, disabled || mutationBlocked || !paneId, onPendingDelivery);
  const readDirectory = useCallback(async (signal: AbortSignal) => {
    void refresh;
    const result = await client.read({ operation: 'files.list', path: folder }, hostSchemas.list, signal);
    signal.throwIfAborted();
    const root = pinnedRoots.current.get(owner);
    if (root && root !== result.root) throw new TransportError('target_changed', 'hostTargetChanged');
    pinnedRoots.current.set(owner, result.root);
    return result;
  }, [client, folder, owner, refresh]);
  const listing = usePolling(readDirectory, !!paneId && !disabled, 15000, `${owner}:${folder}:${rootEpoch}`);
  const root = listing.data?.root ?? pinnedRoots.current.get(owner) ?? null;
  const readSearch = useCallback(async (signal: AbortSignal) => {
    const result = await client.read({ operation: 'files.search', path: '', query: searchTerm, maxResults: 100, includeHidden: false }, hostSchemas.search, signal);
    if (root && result.root !== root) throw new TransportError('target_changed', 'hostTargetChanged');
    return result;
  }, [client, searchTerm, root]);
  const search = usePolling(readSearch, !!searchTerm && !!root && !disabled, 15000, `${owner}:${root}:${searchTerm}`);
  const activeId = selected.get(editorOwner) ?? null;
  const draft = activeId ? documents.get(activeId) : undefined;
  const binaryFile = binary?.owner === owner ? binary : null;
  const openDocuments = [...documents.entries()].filter(([, document]) => targetKey(document.server, document.target) === editorOwner);
  const writable = !disabled && !mutationBlocked && !!paneId && !!root && !listing.error && !actions.busy && !opening;
  const error = actions.error ?? (failure?.owner === owner ? failure.error : null) ?? listing.error ?? search.error;
  const report = (error: Error) => setFailure({ owner, error });
  const selectDraft = (id: string | null) => {
    setSelected((previous) => new Map(previous).set(editorOwner, id));
    setBinary(null);
  };
  const navigate = (path: string) => {
    setDirectory(path); setDirectoryOwner(owner); setSearchTerm(''); setQuery(''); selectDraft(null);
  };
  const reloadRoot = () => {
    pinnedRoots.current.delete(owner);
    setDirectory(''); setDirectoryOwner(owner); setRootEpoch((value) => value + 1); setFailure(null); setDialog(null); actions.clearError(); setSearchTerm(''); setQuery('');
  };
  const loadFile = async (path: string, expectedRoot: string, replaceDraft = false) => {
    const identity = { server: transport.connection.server, target: client.target, root: expectedRoot, path };
    const id = draftKey(identity);
    if (!replaceDraft && documentsRef.current.has(id)) { selectDraft(id); return; }
    const captured = documentsRef.current.get(id);
    const request = ++openingRequest.current;
    setOpeningOwner(owner); setFailure(null);
    try {
      try {
        const result = await client.read({ operation: 'files.read', path }, hostSchemas.file);
        if (currentOwner.current !== owner || openingRequest.current !== request) return;
        if (result.root !== expectedRoot || result.path !== path) throw new TransportError('target_changed', 'hostTargetChanged');
        const document: FileDraft = { ...identity, revision: result.revision, baseContent: result.content, content: result.content, editVersion: 0 };
        setDocuments((previous) => new Map(previous).set(id, acceptFileReload(previous.get(id), captured, document)));
        selectDraft(id);
      } catch (error) {
        if (!(error instanceof TransportError) || error.code !== 'binary_file') throw error;
        const result = await client.read({ operation: 'files.download', path }, hostSchemas.download);
        if (currentOwner.current !== owner || openingRequest.current !== request) return;
        if (result.root !== expectedRoot || result.path !== path) throw new TransportError('target_changed', 'hostTargetChanged');
        const safeImage = /^image\/(png|jpeg|gif|webp|avif|bmp)$/.test(result.mime);
        setSelected((previous) => new Map(previous).set(owner, null));
        setBinary({ ...result, owner, image: safeImage ? `data:${result.mime};base64,${result.base64}` : null });
      }
    } catch (error) { if (currentOwner.current === owner && openingRequest.current === request) report(error instanceof Error ? error : new Error(String(error))); }
    finally { if (openingRequest.current === request) setOpeningOwner((previous) => previous === owner ? null : previous); }
  };
  const save = async () => {
    if (!draft || !activeId) return;
    const saved = draft;
    try {
      const request = prepareFileSave(saved, client, root, !writable);
      const result = await actions.execute(request, hostSchemas.write);
      if (!result) return;
      setDocuments((previous) => {
        const current = previous.get(activeId);
        return current ? new Map(previous).set(activeId, finishFileSave(current, saved, result)) : previous;
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
      let movedSelection = activeId;
      setDocuments((previous) => {
        const next = new Map(previous);
        for (const [id, document] of previous) {
          if (targetKey(document.server, document.target) !== owner || document.root !== choice.root || (document.path !== choice.path && !(choice.isDirectory && document.path.startsWith(choice.path + '/')))) continue;
          const moved = { ...document, path: newPath + document.path.slice(choice.path.length) };
          next.delete(id); next.set(draftKey(moved), moved);
        }
        return next;
      });
      // The selected editor is moved by its actual file identity, including unsaved text.
      const current = activeId ? documentsRef.current.get(activeId) : undefined;
      if (current && current.root === choice.root && (current.path === choice.path || (choice.isDirectory && current.path.startsWith(choice.path + '/')))) movedSelection = draftKey({ ...current, path: newPath + current.path.slice(choice.path.length) });
      setSelected((previous) => new Map(previous).set(owner, movedSelection));
    }
    if (dialog.kind === 'delete') {
      setDocuments((previous) => new Map([...previous].filter(([, document]) => targetKey(document.server, document.target) !== owner || document.root !== choice.root || document.path !== choice.path || document.content !== document.baseContent)));
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
  const dialogTitle = dialog?.kind === 'reload' ? t('filesView.unsaved.title') : dialog?.kind === 'rename' ? t('filesView.dialog.rename.title') : dialog?.kind === 'delete' ? t('filesView.dialog.delete.title') : dialog?.kind === 'folder' ? t('filesView.dialog.createFolder.title') : t('filesView.dialog.createFile.title');

  return <section className="herdr-content" aria-label={t('mobile.files.rootDirectory')}>
    <div className="herdr-content-toolbar flex-wrap">
      <Button variant="ghost" size="sm" onClick={() => draft || binaryFile ? selectDraft(null) : navigate(parentPath(folder))} disabled={!draft && !binaryFile && !folder}><Icon name="arrow-go-back" className="size-4" />{t('mobile.files.parentDirectory')}</Button>
      <span className="herdr-file-path" dir="ltr">/{draft?.path ?? binaryFile?.path ?? folder}</span>
      {draft && <Button size="sm" disabled={!writable || draft.root !== root || targetKey(draft.server, draft.target) !== owner || draft.content === draft.baseContent} onClick={() => void save()}>{actions.busy ? t('filesView.editor.saving') : t('filesView.fileEditor.save')}</Button>}
      {(draft || binaryFile) && <Button variant="ghost" size="icon" aria-label={t('sidebarFilesTree.menu.download')} disabled={disabled || !paneId} onClick={() => { const file = draft ?? binaryFile; if (file) void download(file.path, file.root); }}><Icon name="download" className="size-4" /></Button>}
      <Button variant="ghost" size="icon" aria-label={t('mobile.files.refreshAria')} disabled={opening} onClick={() => draft ? refreshFile() : setRefresh((value) => value + 1)}><Icon name="refresh" className="size-4" /></Button>
    </div>
    {openDocuments.length > 0 && <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-border p-2" aria-label={t('filesView.editor.openFilesAria')}>{openDocuments.map(([id, document]) => <Button key={id} variant="chip" size="sm" aria-pressed={activeId === id} onClick={() => selectDraft(id)}><span className="max-w-44 truncate" dir="auto">{document.path.split('/').at(-1)}{document.content !== document.baseContent ? ' *' : ''}</span></Button>)}</div>}
    {error && <div className="herdr-banner herdr-error" role="alert"><p>{error instanceof TransportError && error.code === 'target_changed' ? h('hostTargetChanged') : error.message === 'outcomeUnknown' ? h('hostUnknown') : error.message === 'deliveryStorage' ? h('deliveryStorage') : error.message}</p>{error instanceof TransportError && error.code === 'target_changed' && <Button size="sm" variant="outline" onClick={reloadRoot}>{t('contextPanel.browser.reload')}</Button>}</div>}
    {draft?.reloadConflict && <p className="herdr-banner herdr-warning" role="alert">{t('filesView.unsaved.title')}. {t('filesView.unsaved.description')}</p>}
    {disabled && draft && <p className="herdr-detail">{h('hostTargetChanged')}</p>}
    {(opening || listing.loading && !draft && !binaryFile) && <p className="herdr-detail" role="status">{t('common.loading')}</p>}
    {!paneId && <p className="herdr-detail">{h('noPane')}</p>}
    {draft ? <div className="flex min-h-0 flex-1 flex-col" dir="ltr"><Suspense fallback={<p className="herdr-detail">{t('common.loading')}</p>}><CodeEditor value={draft.content} readOnly={disabled || draft.root !== root || targetKey(draft.server, draft.target) !== owner} onChange={(content) => { if (!activeId) return; setDocuments((previous) => { const current = previous.get(activeId); return current ? new Map(previous).set(activeId, editFileDraft(current, content)) : previous; }); }} className="min-h-0 flex-1 overflow-auto oc-surface-code" enableSearch /></Suspense><p className="herdr-detail">{draft.content === draft.baseContent ? t('filesView.editor.saved') : t('filesView.unsaved.title')}</p></div> : binaryFile ? <div className="min-h-0 flex-1">{binaryFile.image ? <ImageArtifact src={binaryFile.image} name={binaryFile.path.split('/').at(-1) ?? binaryFile.path} sizeBytes={binaryFile.bytes} /> : <BinaryArtifact name={binaryFile.path.split('/').at(-1) ?? binaryFile.path} path={binaryFile.path} sizeBytes={binaryFile.bytes} />}</div> : <>
      <form className="flex shrink-0 gap-2 p-3" onSubmit={(event) => { event.preventDefault(); setSearchTerm(query.trim()); }}><Input inputSize="compact" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('mobile.files.search.placeholder')} aria-label={t('mobile.files.search.placeholder')} /><Button type="submit" size="sm" variant="outline" aria-label={t('mobile.files.search.placeholder')}><Icon name="search" className="size-4" /></Button>{searchTerm && <Button size="sm" variant="ghost" aria-label={t('sidebarFilesTree.search.clearAria')} onClick={() => { setSearchTerm(''); setQuery(''); }}><Icon name="close" className="size-4" /></Button>}</form>
      <div className="flex shrink-0 flex-wrap gap-2 px-3 pb-3"><Button variant="outline" size="sm" disabled={!writable} onClick={() => { if (root) { setDialog({ kind: 'file', owner, root, directory: folder }); setName(''); } }}>{t('sidebarFilesTree.menu.newFile')}</Button><Button variant="outline" size="sm" disabled={!writable} onClick={() => { if (root) { setDialog({ kind: 'folder', owner, root, directory: folder }); setName(''); } }}>{t('sidebarFilesTree.menu.newFolder')}</Button><Button variant="outline" size="sm" disabled={!writable} onClick={() => uploadInput.current?.click()}>{t('sidebarFilesTree.menu.uploadFiles')}</Button><input ref={uploadInput} type="file" className="hidden" aria-label={t('sidebarFilesTree.menu.uploadFiles')} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void upload(file); }} /></div>
      <div className="herdr-file-list">
        {searchTerm ? <>{search.loading && <p role="status">{t('sidebarFilesTree.state.searching')}</p>}{search.data?.results.length === 0 && <p>{t('mobile.files.search.empty')}</p>}{search.data?.results.map((entry) => <Button key={entry.path} variant="ghost" className="herdr-file-row flex-col items-start" onClick={() => root && void loadFile(entry.path, root)}><span className="flex items-center gap-2"><FileTypeIcon filePath={entry.path} className="size-4" /><span dir="auto">{entry.path}</span></span>{entry.preview.map((line, index) => <span key={index} className="text-muted-foreground typography-micro" dir="auto">{line}</span>)}</Button>)}{search.data?.truncated && <p>{t('mobile.files.file.truncated')}</p>}</> : <>{listing.data?.entries.length === 0 && <p>{t('mobile.files.empty.directory')}</p>}{listing.data?.entries.map((entry) => <div key={entry.path} className="flex items-center gap-1"><Button variant="ghost" className="herdr-file-row min-w-0 flex-1" disabled={entry.isSymbolicLink} onClick={() => entry.isDirectory ? navigate(entry.path) : root && void loadFile(entry.path, root)}>{entry.isDirectory ? <Icon name="folder" className="size-4 shrink-0" /> : <FileTypeIcon filePath={entry.path} className="size-4 shrink-0" />}<span dir="auto">{entry.name}</span>{entry.isSymbolicLink && <Icon name="link" className="size-3" />}</Button><Button variant="ghost" size="icon" aria-label={t('filesView.dialog.rename.description', { name: entry.name })} disabled={!writable || entry.isSymbolicLink} onClick={() => void chooseEntryAction('rename', entry)}><Icon name="edit" className="size-4" /></Button><Button variant="ghost" size="icon" aria-label={t('filesView.dialog.delete.description', { name: entry.name })} disabled={!writable || entry.isSymbolicLink} onClick={() => void chooseEntryAction('delete', entry)}><Icon name="delete-bin" className="size-4" /></Button></div>)}{listing.data?.truncated && <p className="herdr-muted">{t('mobile.files.file.truncated')}</p>}</>}
      </div>
    </>}
    <footer className="herdr-content-root" dir="ltr">{draft?.root ?? binaryFile?.root ?? root}</footer>
    <Dialog open={dialog !== null && !disabled} onOpenChange={(open) => { if (!open && !actions.busy) setDialog(null); }}><DialogContent><DialogHeader><DialogTitle>{dialogTitle}</DialogTitle><DialogDescription>{dialog?.kind === 'reload' ? t('filesView.unsaved.description') : dialog?.kind === 'delete' ? t('filesView.dialog.delete.description', { name: dialog.choice.name }) : dialog?.kind === 'rename' ? t('filesView.dialog.rename.description', { name: dialog.choice.name }) : t(dialog?.kind === 'folder' ? 'filesView.dialog.createFolder.description' : 'filesView.dialog.createFile.description', { path: folder || '/' })}</DialogDescription></DialogHeader>{dialog && dialog.kind !== 'delete' && dialog.kind !== 'reload' && <Input value={name} onChange={(event) => setName(event.target.value)} placeholder={t('filesView.dialog.namePlaceholder')} aria-label={t('filesView.dialog.namePlaceholder')} dir="ltr" autoFocus onKeyDown={(event) => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); void confirmDialog(); } }} />}<DialogFooter><Button variant="outline" disabled={actions.busy} onClick={() => setDialog(null)}>{t('filesView.dialog.cancel')}</Button><Button variant={dialog?.kind === 'delete' ? 'destructive' : 'default'} disabled={!writable || !!dialog && !['delete', 'reload'].includes(dialog.kind) && !name.trim()} onClick={() => void confirmDialog()}>{dialog?.kind === 'reload' ? t('filesView.unsaved.discard') : dialog?.kind === 'delete' ? t('filesView.dialog.delete.confirm') : t('filesView.dialog.confirm')}</Button></DialogFooter></DialogContent></Dialog>
  </section>;
}

export function ChangesPanel({ transport, machine, paneId, disabled = false, mutationBlocked = false, themeMode, theme, onPendingDelivery, initialDiff }: PanelProps & { initialDiff?: { path: string; staged?: boolean } | null }) {
  const { t } = useI18n();
  const h = useHerdrText();
  const client = useMemo(() => new HostClient(transport, { machine, pane_id: paneId }), [transport, machine, paneId]);
  const owner = targetKey(transport.connection.server, client.target);
  const pinnedRoots = useRef(new Map<string, string>());
  const [refresh, setRefresh] = useState(0);
  const [epoch, setEpoch] = useState(0);
  const [mode, setMode] = useState<'changes' | 'branches' | 'history' | 'diff'>('changes');
  const [diffTarget, setDiffTarget] = useState({ path: '', staged: false });
  useEffect(() => { if (initialDiff) { setDiffTarget({ path: initialDiff.path, staged: initialDiff.staged ?? false }); setMode('diff'); } }, [initialDiff]);
  const [messages, setMessages] = useState(new Map<string, string>());
  const [branchName, setBranchName] = useState('');
  const [branchDialogOwner, setBranchDialogOwner] = useState<string | null>(null);
  const branchDialog = branchDialogOwner === owner;
  const setBranchDialog = (open: boolean) => setBranchDialogOwner(open ? owner : null);
  const [historyLimit, setHistoryLimit] = useState(30);
  const actions = useHostActions(client, disabled || mutationBlocked || !paneId, onPendingDelivery);
  const readStatus = useCallback(async (signal: AbortSignal) => {
    void refresh;
    const result = await client.read({ operation: 'git.status' }, hostSchemas.status, signal);
    signal.throwIfAborted();
    const root = pinnedRoots.current.get(owner);
    if (root && root !== result.root) throw new TransportError('target_changed', 'hostTargetChanged');
    pinnedRoots.current.set(owner, result.root);
    return result;
  }, [client, owner, refresh]);
  const status = usePolling(readStatus, !!paneId && !disabled, 15000, `${owner}:${epoch}`);
  const root = status.data?.root ?? pinnedRoots.current.get(owner) ?? null;
  const readBranches = useCallback(async (signal: AbortSignal) => {
    void refresh;
    const result = await client.read({ operation: 'git.branches' }, hostSchemas.branches, signal);
    if (root && root !== result.root) throw new TransportError('target_changed', 'hostTargetChanged');
    return result;
  }, [client, root, refresh]);
  const branches = usePolling(readBranches, mode === 'branches' && !!root && !disabled, 15000, `${owner}:${root}`);
  const readHistory = useCallback(async (signal: AbortSignal) => {
    void refresh;
    const result = await client.read({ operation: 'git.log', limit: historyLimit }, hostSchemas.log, signal);
    if (root && root !== result.root) throw new TransportError('target_changed', 'hostTargetChanged');
    return result;
  }, [client, root, refresh, historyLimit]);
  const history = usePolling(readHistory, mode === 'history' && !!root && !disabled, 15000, `${owner}:${root}:${historyLimit}`);
  const readDiff = useCallback(async (signal: AbortSignal) => {
    void refresh;
    const path = root && diffTarget.path.startsWith(root + '/') ? diffTarget.path.slice(root.length + 1) : diffTarget.path;
    const result = await client.read({ operation: 'git.diff', path, staged: diffTarget.staged }, hostSchemas.diff, signal);
    if (root && root !== result.root) throw new TransportError('target_changed', 'hostTargetChanged');
    return result;
  }, [client, root, diffTarget, refresh]);
  const diff = usePolling(readDiff, mode === 'diff' && !!root && !disabled, 15000, `${owner}:${root}:${diffTarget.path}:${diffTarget.staged}`);
  const relativeDiffPath = root && diffTarget.path.startsWith(root + '/') ? diffTarget.path.slice(root.length + 1) : diffTarget.path;
  const fileDiff = useMemo(() => diff.data?.diff && !isBinaryPatch(diff.data.diff) ? fileDiffFromPatch(diffTarget.path, diff.data.diff) : null, [diff.data, diffTarget.path]);
  const writable = !disabled && !mutationBlocked && !!root && !status.error && !actions.busy;
  const message = messages.get(owner) ?? '';
  const error = actions.error ?? status.error ?? (mode === 'branches' ? branches.error : mode === 'history' ? history.error : mode === 'diff' ? diff.error : null);
  const stage = async (paths: string[], staged: boolean) => {
    if (!writable || !root) return;
    const result = await actions.execute({ operation: staged ? 'git.unstage' : 'git.stage', expectedRoot: root, paths }, hostSchemas.gitMutation);
    if (result) setRefresh((value) => value + 1);
  };
  const openDiff = (path: string, staged: boolean) => { setDiffTarget({ path, staged }); setMode('diff'); };
  const stagedFiles = status.data?.files.filter((file) => file.index.trim() && file.index !== '?') ?? [];
  const workingFiles = status.data?.files.filter((file) => file.working_dir.trim() || file.index === '?') ?? [];
  const groups: ChangesGroupConfig[] = [
    { id: 'staged', title: t('gitView.changes.stagedTitle'), entries: stagedFiles, statsScope: 'staged', actionSymbol: '-', actionAllLabel: t('gitView.changes.unstageAllAria'), getActionLabel: (path) => t('gitView.changes.unstageFileAria', { path }), onActionFile: (path) => void stage([path], true), onActionAll: (paths) => void stage(paths, true), onViewDiff: (path) => openDiff(path, true), onRevertFile: () => undefined, showRevertActions: false },
    { id: 'working', title: t('gitView.changes.title'), entries: workingFiles, statsScope: 'working', actionSymbol: '+', actionAllLabel: t('gitView.changes.stageAllAria'), getActionLabel: (path) => t('gitView.changes.stageFileAria', { path }), onActionFile: (path) => void stage([path], false), onActionAll: (paths) => void stage(paths, false), onViewDiff: (path) => openDiff(path, false), onRevertFile: () => undefined, showRevertActions: false },
  ];
  const commit = async () => {
    if (!root || !writable || !message.trim()) return;
    const sent = message;
    const result = await actions.execute({ operation: 'git.commit', expectedRoot: root, message: sent }, hostSchemas.commit);
    if (!result) return;
    setMessages((previous) => previous.get(owner) === sent ? new Map(previous).set(owner, '') : previous);
    setRefresh((value) => value + 1);
  };
  const createBranch = async () => {
    if (!root || !writable || !branchName.trim()) return;
    const result = await actions.execute({ operation: 'git.branch', expectedRoot: root, name: branchName.trim() }, hostSchemas.branchMutation);
    if (result) { setBranchDialog(false); setBranchName(''); setRefresh((value) => value + 1); }
  };
  const checkout = async (branch: string) => {
    if (!root || !writable) return;
    if (await actions.execute({ operation: 'git.checkout', expectedRoot: root, branch }, hostSchemas.branchMutation)) setRefresh((value) => value + 1);
  };
  return <section className="herdr-content" aria-label={t('gitView.changes.title')}>
    <div className="herdr-content-toolbar flex-wrap"><Button variant="chip" size="sm" aria-pressed={mode === 'changes'} onClick={() => setMode('changes')}>{t('gitView.changes.title')}</Button><Button variant="chip" size="sm" aria-pressed={mode === 'branches'} onClick={() => setMode('branches')}>{t('gitView.branch.localBranches')}</Button><Button variant="chip" size="sm" aria-pressed={mode === 'history'} onClick={() => setMode('history')}>{t('gitView.history.title')}</Button><span className="herdr-spacer" /><Button variant="ghost" size="icon" aria-label={t('gitView.history.refresh')} onClick={() => setRefresh((value) => value + 1)}><Icon name="refresh" className="size-4" /></Button></div>
    <p className="herdr-content-root" dir="ltr">{root}{status.data?.current ? ` · ${status.data.current}` : ''}</p>
    {error && <div className="herdr-banner herdr-error" role="alert"><p>{error instanceof TransportError && error.code === 'target_changed' ? h('hostTargetChanged') : error.message === 'outcomeUnknown' ? h('hostUnknown') : error.message === 'deliveryStorage' ? h('deliveryStorage') : error.message}</p>{error instanceof TransportError && error.code === 'target_changed' && <Button variant="outline" size="sm" onClick={() => { pinnedRoots.current.delete(owner); actions.clearError(); setEpoch((value) => value + 1); }}>{t('contextPanel.browser.reload')}</Button>}</div>}
    {!paneId && <p className="herdr-detail">{h('noPane')}</p>}
    {status.loading && <p className="herdr-detail" role="status">{t('common.loading')}</p>}
    {mode === 'changes' && <><form className="flex shrink-0 gap-2 border-b border-border p-3" onSubmit={(event) => { event.preventDefault(); void commit(); }}><Input value={message} onChange={(event) => setMessages((previous) => new Map(previous).set(owner, event.target.value))} placeholder={t('gitView.commit.messagePlaceholder')} aria-label={t('gitView.commit.messagePlaceholder')} /><Button type="submit" size="sm" disabled={!writable || !message.trim() || stagedFiles.length === 0}>{actions.busy ? t('gitView.commit.committing') : t('gitView.commit.commit')}</Button></form>{status.data?.isClean && <p className="herdr-detail">{h('empty')}</p>}<fieldset disabled={!writable} className="m-0 flex min-h-0 flex-1 flex-col border-0 p-0" aria-label={t('gitView.changes.changedFilesAria')}><GitChangesList groups={groups} diffStats={undefined} revertingPaths={emptyPaths} /></fieldset></>}
    {mode === 'diff' && <><div className="herdr-content-toolbar"><Button variant="ghost" size="sm" onClick={() => setMode('changes')}><Icon name="arrow-go-back" className="size-4" />{t('gitView.changes.title')}</Button><span className="herdr-file-path" dir="ltr">{diffTarget.path}</span><Button size="sm" variant="outline" disabled={!writable || !!diff.error || !diff.data || !relativeDiffPath} onClick={() => void stage([relativeDiffPath], diffTarget.staged)}>{t(diffTarget.staged ? 'gitView.changes.unstageFileAria' : 'gitView.changes.stageFileAria', { path: diffTarget.path })}</Button></div>{diff.loading && <p className="herdr-detail">{t('gitView.history.loadingDiff')}</p>}{diff.data && (isBinaryPatch(diff.data.diff) ? <p className="herdr-detail">{t('gitView.history.binaryNoDiff')}</p> : fileDiff ? <div className="min-h-0 flex-1 overflow-auto" dir="ltr"><Suspense fallback={<p className="herdr-detail">{t('common.loading')}</p>}><DiffViewer original="" modified="" fileDiff={fileDiff} language="text" fileName={diffTarget.path} renderSideBySide={false} enableComments={false} theme={theme} themeMode={themeMode} wrapLines /></Suspense></div> : <p className="herdr-detail">{h('empty')}</p>)}</>}
    {mode === 'branches' && <div className="herdr-file-list"><Button variant="outline" size="sm" disabled={!writable} onClick={() => { setBranchName(''); setBranchDialog(true); }}>{t('gitView.branch.create')}</Button>{branches.loading && <p>{t('common.loading')}</p>}{branches.data?.all.length === 0 && <p>{t('gitView.branch.empty')}</p>}{branches.data?.all.map((name) => <div key={name} className="flex items-center gap-2 py-2"><Icon name="git-branch" className="size-4 shrink-0" /><span className="min-w-0 flex-1 truncate" dir="auto">{name}</span>{name === branches.data?.current ? <span className="text-muted-foreground typography-micro">{t('gitView.branch.currentBadge')}</span> : <Button variant="outline" size="sm" disabled={!writable || branches.data?.branches[name]?.linkedWorktree} onClick={() => void checkout(name)}>{t('gitView.history.actions.checkout')}</Button>}</div>)}</div>}
    {mode === 'history' && <div className="herdr-file-list">{history.loading && <p>{t('common.loading')}</p>}{history.data?.all.length === 0 && <p>{t('gitView.history.noCommits')}</p>}{history.data?.all.map((entry) => <details key={entry.hash} className="border-b border-border py-3"><summary className="cursor-pointer"><span className="font-medium" dir="auto">{entry.message}</span><span className="ms-2 text-muted-foreground typography-micro" dir="ltr">{entry.hash.slice(0, 8)}</span></summary><p className="text-muted-foreground typography-micro" dir="auto">{entry.author_name} · {entry.date}</p>{entry.body && <pre className="whitespace-pre-wrap typography-ui" dir="auto">{entry.body}</pre>}</details>)}{history.data && history.data.total > history.data.all.length && historyLimit < 100 && <Button variant="outline" size="sm" onClick={() => setHistoryLimit((value) => Math.min(100, value + 30))}>{t('gitView.history.loadMore')}</Button>}</div>}
    <Dialog open={branchDialog && !disabled} onOpenChange={(open) => !actions.busy && setBranchDialog(open)}><DialogContent><DialogHeader><DialogTitle>{t('gitView.branch.create')}</DialogTitle><DialogDescription>{t('gitView.branch.currentBranchTooltip')} <span dir="ltr">{status.data?.current}</span></DialogDescription></DialogHeader><Input value={branchName} onChange={(event) => setBranchName(event.target.value)} placeholder={t('gitView.branch.namePlaceholder')} aria-label={t('gitView.branch.namePlaceholder')} autoFocus dir="ltr" onKeyDown={(event) => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); void createBranch(); } }} /><DialogFooter><Button variant="outline" disabled={actions.busy} onClick={() => setBranchDialog(false)}>{t('gitView.common.cancel')}</Button><Button disabled={!writable || !branchName.trim()} onClick={() => void createBranch()}>{t('gitView.history.actions.createBranchConfirm')}</Button></DialogFooter></DialogContent></Dialog>
  </section>;
}
