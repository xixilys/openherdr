import React from 'react';
import type { FilePart } from '@openchamber/ui/lib/opencode/model';
import { MessageAttachmentsView, type MessageAttachmentItem } from '@/components/chat/MessageAttachmentsView';
import { ImagePreviewView } from '@/components/chat/ImagePreviewView';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { BinaryArtifact } from '@/components/views/files/previews/BinaryArtifact';
import { useI18n } from '@/lib/i18n';
import { isCapacitorApp } from '@/lib/platform';
import { shareFileFromNativeApp } from '@/lib/nativeFileShare';
import type { Theme } from '@/types/theme';
import { HostClient, hostSchemas, downloadBytes } from './host-client';
import type { HerdrTransport } from './transport';
import { useHerdrText } from './herdr.i18n';

const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
const MAX_ENCODED_BYTES = Math.ceil(MAX_ATTACHMENT_BYTES / 3) * 4;
const TEXT_PREVIEW_CHARACTERS = 200_000;

type AttachmentTarget = { machine: string; paneId: string };
export interface HerdrConversationAttachmentsProps {
  files: readonly FilePart[];
  transport: HerdrTransport;
  /** Includes the verified pane identity and conversation session, including history. */
  owner: string;
  target: AttachmentTarget | null;
  /** Captured, server-resolved session root. History must not borrow the active pane. */
  directory: string | null;
  theme: Theme;
  isMobile: boolean;
  compact?: boolean;
  className?: string;
  onOpenExternal: (url: string) => void;
}

type AttachmentContext = Pick<HerdrConversationAttachmentsProps, 'transport' | 'target' | 'directory'>;
type AttachmentProvenance = 'inline' | 'current-file';
type AttachmentContent =
  | { kind: 'external'; url: string }
  | { kind: 'image'; provenance: AttachmentProvenance; bytes: Uint8Array<ArrayBuffer>; mime: string }
  | { kind: 'text'; provenance: AttachmentProvenance; bytes: Uint8Array<ArrayBuffer>; mime: 'text/plain'; text: string }
  | { kind: 'binary'; provenance: AttachmentProvenance; bytes: Uint8Array<ArrayBuffer>; mime: 'application/octet-stream' };

class AttachmentUnavailable extends Error {
  constructor(readonly reason: 'unavailable' | 'too-large' | 'target-changed' = 'unavailable') { super(reason); }
}

function hasControlCharacters(value: string, allowTextWhitespace = false): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if ((code < 32 || code === 127) && !(allowTextWhitespace && (code === 9 || code === 10 || code === 13))) return true;
  }
  return false;
}

function safeFilename(name: string): string {
  const cleaned = Array.from(name.normalize('NFKC'), (char) => hasControlCharacters(char) ? '_' : char).join('').replace(/[\\/:*?"<>|\u202a-\u202e\u2066-\u2069]/g, '_').replace(/^[. ]+|[. ]+$/g, '');
  return cleaned.slice(0, 160) || 'file';
}

function validatePath(path: string): void {
  if (!path || (hasControlCharacters(path) || /[\\?#]/.test(path)) || path.split('/').some((segment) => segment === '.' || segment === '..')) throw new AttachmentUnavailable();
}

/** Check the original segments before a URL parser can collapse traversal. */
function fileReferencePath(uri: string, directory: string): string {
  if (!directory.startsWith('/') || (directory.length > 1 && directory.endsWith('/'))) throw new AttachmentUnavailable();
  validatePath(directory);
  let raw = uri;
  if (/^file:/i.test(uri)) {
    const match = /^file:\/\/([^/]*)(\/.*)$/i.exec(uri);
    if (!match || (match[1] !== '' && match[1].toLowerCase() !== 'localhost')) throw new AttachmentUnavailable();
    raw = match[2];
  } else if (/^[a-z][a-z\d+.-]*:/i.test(uri) || uri.startsWith('//')) throw new AttachmentUnavailable();
  validatePath(raw);
  if (/%(?:2f|5c|00)/i.test(raw)) throw new AttachmentUnavailable();
  let decoded: string;
  try { decoded = decodeURIComponent(raw); } catch { throw new AttachmentUnavailable(); }
  validatePath(decoded);
  // A second URI decode must never change the requested filesystem path.
  if (/%[a-f\d]{2}/i.test(decoded)) throw new AttachmentUnavailable();
  const path = decoded.startsWith('/')
    ? decoded.startsWith(directory === '/' ? '/' : `${directory}/`) ? decoded.slice(directory === '/' ? 1 : directory.length + 1) : null
    : decoded;
  if (!path || path.startsWith('/') || path.split('/').some((segment) => !segment || segment.toLowerCase() === '.git')) throw new AttachmentUnavailable();
  return path;
}

function decodeAttachmentBytes(base64: string): Uint8Array<ArrayBuffer> {
  if (base64.length > MAX_ENCODED_BYTES) throw new AttachmentUnavailable('too-large');
  if (base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) throw new AttachmentUnavailable();
  let bytes: Uint8Array<ArrayBuffer>;
  try { bytes = downloadBytes(base64); } catch { throw new AttachmentUnavailable(); }
  if (bytes.length > MAX_ATTACHMENT_BYTES) throw new AttachmentUnavailable('too-large');
  return bytes;
}

function rasterMime(bytes: Uint8Array): string | null {
  const begins = (signature: readonly number[]) => signature.every((byte, index) => bytes[index] === byte);
  const ascii = (offset: number, text: string) => [...text].every((char, index) => bytes[offset + index] === char.charCodeAt(0));
  if (begins([137, 80, 78, 71, 13, 10, 26, 10])) return 'image/png';
  if (bytes.length >= 4 && begins([255, 216, 255])) return 'image/jpeg';
  if (ascii(0, 'GIF87a') || ascii(0, 'GIF89a')) return 'image/gif';
  if (bytes.length >= 12 && ascii(0, 'RIFF') && ascii(8, 'WEBP')) return 'image/webp';
  if (bytes.length >= 26 && ascii(0, 'BM')) return 'image/bmp';
  if (bytes.length >= 16 && ascii(4, 'ftyp')) {
    const size = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0);
    if (size >= 16 && size <= bytes.length) {
      for (let offset = 8; offset + 4 <= Math.min(size, 64); offset += 4) {
        if (offset !== 12 && (ascii(offset, 'avif') || ascii(offset, 'avis'))) return 'image/avif';
      }
    }
  }
  return null;
}

function classifyAttachmentBytes(bytes: Uint8Array<ArrayBuffer>, provenance: AttachmentProvenance): AttachmentContent {
  if (bytes.length > MAX_ATTACHMENT_BYTES) throw new AttachmentUnavailable('too-large');
  const mime = rasterMime(bytes);
  if (mime) return { kind: 'image', provenance, bytes, mime };
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (!hasControlCharacters(text, true) && !text.startsWith('%PDF-')) return { kind: 'text', provenance, bytes, text, mime: 'text/plain' };
  } catch { /* Non-UTF-8 bytes remain downloadable without interpretation. */ }
  return { kind: 'binary', provenance, bytes, mime: 'application/octet-stream' };
}

/** Reads only inline bytes or the captured pane's confined host file endpoint. */
async function resolveConversationAttachment(file: FilePart, context: AttachmentContext, signal: AbortSignal): Promise<AttachmentContent> {
  signal.throwIfAborted();
  const uri = file.url;
  if (uri.startsWith('data:')) {
    const comma = uri.indexOf(',');
    if (comma < 0 || comma > 256 || !/^data:[^;,]*(?:;charset=utf-8)?;base64$/i.test(uri.slice(0, comma))) throw new AttachmentUnavailable();
    return classifyAttachmentBytes(decodeAttachmentBytes(uri.slice(comma + 1)), 'inline');
  }
  if (/^https?:/i.test(uri)) {
    if (uri !== uri.trim() || (hasControlCharacters(uri) || uri.includes(' ') || uri.includes('\\'))) throw new AttachmentUnavailable();
    let url: URL;
    try { url = new URL(uri); } catch { throw new AttachmentUnavailable(); }
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) throw new AttachmentUnavailable();
    return { kind: 'external', url: url.href };
  }
  if (!context.target || !context.directory) throw new AttachmentUnavailable();
  const path = fileReferencePath(uri, context.directory);
  const client = new HostClient(context.transport, { machine: context.target.machine, pane_id: context.target.paneId });
  const result = await client.read({ operation: 'files.download', path }, hostSchemas.download, signal);
  signal.throwIfAborted();
  if (result.root !== context.directory || result.path !== path) throw new AttachmentUnavailable('target-changed');
  if (result.bytes > MAX_ATTACHMENT_BYTES) throw new AttachmentUnavailable('too-large');
  const bytes = decodeAttachmentBytes(result.base64);
  if (bytes.length !== result.bytes) throw new AttachmentUnavailable();
  return classifyAttachmentBytes(bytes, 'current-file');
}

type AttachmentState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error'; reason: AttachmentUnavailable['reason'] }
  | { kind: 'ready'; content: AttachmentContent; previewUrl?: string };
type AttachmentResource = {
  source: FilePart;
  scope: string;
  transport: HerdrTransport;
  controller: AbortController;
  state: AttachmentState;
};
const sameFile = (left: FilePart, right: FilePart) => left.url === right.url && left.mime === right.mime && left.filename === right.filename && left.sessionID === right.sessionID && left.messageID === right.messageID;
const releaseResource = (resource: AttachmentResource) => {
  resource.controller.abort();
  if (resource.state.kind === 'ready' && resource.state.previewUrl) URL.revokeObjectURL(resource.state.previewUrl);
};

export function HerdrConversationAttachments({ files, transport, owner, target, directory, theme, isMobile, compact = true, className, onOpenExternal }: HerdrConversationAttachmentsProps) {
  const { t } = useI18n();
  const h = useHerdrText();
  const scope = JSON.stringify([transport.connection.server, owner, target?.machine, target?.paneId, directory]);
  const live = React.useRef({ scope, transport });
  live.current = { scope, transport };
  const resources = React.useRef(new Map<string, AttachmentResource>());
  const downloads = React.useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const [, invalidate] = React.useReducer((value: number) => value + 1, 0);
  const [popup, setPopup] = React.useState<{ scope: string; id: string; source: FilePart } | null>(null);
  const [downloadError, setDownloadError] = React.useState<string | null>(null);
  const fileEntries = React.useMemo(() => files.map((file, index) => ({ id: `${index}:${file.id}`, file })), [files]);
  const current = React.useCallback((resource: AttachmentResource) => !resource.controller.signal.aborted && live.current.scope === resource.scope && live.current.transport === resource.transport, []);

  React.useEffect(() => {
    const ownedResources = resources.current;
    const ownedDownloads = downloads.current;
    setPopup(null); setDownloadError(null);
    return () => {
      for (const resource of ownedResources.values()) releaseResource(resource);
      ownedResources.clear();
      for (const [url, timer] of ownedDownloads) { clearTimeout(timer); URL.revokeObjectURL(url); }
      ownedDownloads.clear();
    };
  }, [scope, transport]);

  const startResource = React.useCallback((id: string, resource: AttachmentResource) => {
    if (resource.state.kind !== 'idle' || !current(resource)) return;
    resource.state = { kind: 'loading' };
    invalidate();
    void resolveConversationAttachment(resource.source, { transport, target, directory }, resource.controller.signal).then((content) => {
      if (!current(resource) || resources.current.get(id) !== resource) return;
      const previewUrl = content.kind === 'image' ? URL.createObjectURL(new Blob([content.bytes], { type: content.mime })) : undefined;
      resource.state = { kind: 'ready', content, previewUrl };
      invalidate();
    }).catch((error: Error) => {
      if (!current(resource) || resources.current.get(id) !== resource) return;
      resource.state = { kind: 'error', reason: error instanceof AttachmentUnavailable ? error.reason : 'unavailable' };
      invalidate();
    });
  }, [current, directory, target, transport]);

  // Reconcile scalar file fields, so a caller recreating its array never rereads bytes.
  React.useEffect(() => {
    if (popup?.scope === scope && !fileEntries.some(({ id, file }) => id === popup.id && sameFile(file, popup.source))) setPopup(null);
    const selected = new Set(fileEntries.map(({ id }) => id));
    for (const [id, resource] of resources.current) {
      if (!selected.has(id)) { releaseResource(resource); resources.current.delete(id); }
    }
    for (const { id, file } of fileEntries) {
      const existing = resources.current.get(id);
      if (existing && existing.scope === scope && existing.transport === transport && sameFile(existing.source, file)) {
        if (popup?.scope === scope && popup.id === id && sameFile(popup.source, file)) startResource(id, existing);
        continue;
      }
      if (existing) releaseResource(existing);
      const resource: AttachmentResource = { source: file, scope, transport, controller: new AbortController(), state: { kind: 'idle' } };
      resources.current.set(id, resource);
      if (file.url.startsWith('data:') || /^https?:/i.test(file.url)) {
        startResource(id, resource);
        continue;
      }
      try {
        if (!target || !directory) throw new AttachmentUnavailable();
        fileReferencePath(file.url, directory);
        invalidate();
      } catch {
        resource.state = { kind: 'error', reason: 'unavailable' };
        invalidate();
      }
    }
  }, [directory, fileEntries, popup, scope, startResource, target, transport]);

  const displayed = fileEntries.map(({ id, file }) => {
    const resource = resources.current.get(id);
    const state: AttachmentState = resource && resource.scope === scope && resource.transport === transport && sameFile(resource.source, file) ? resource.state : { kind: 'loading' };
    const item: MessageAttachmentItem = { id, name: safeFilename(file.filename || file.mime), mime: file.mime, kind: 'file', compactOpenable: true };
    if (state.kind === 'ready') {
      if (state.content.kind !== 'external') item.size = state.content.bytes.length;
      if (state.content.kind === 'image') { item.kind = 'image'; item.previewUrl = state.previewUrl; item.mime = state.content.mime; }
      if (state.content.kind === 'external') { item.kind = 'issue'; item.icon = 'external-link'; }
    }
    return { item, source: file, resource, state };
  });
  const selected = popup?.scope === scope ? displayed.find(({ item, source }) => item.id === popup.id && sameFile(source, popup.source)) : undefined;
  const selectedContent = selected?.state.kind === 'ready' ? selected.state.content : null;
  const gallery = displayed.flatMap(({ item, state }) => state.kind === 'ready' && state.content.kind === 'image' && item.previewUrl ? [{ url: item.previewUrl, filename: state.content.provenance === 'current-file' ? `${item.name} · ${h('currentFile')}` : item.name, mimeType: state.content.mime, size: item.size }] : []);

  const download = async () => {
    if (!selected?.resource || !current(selected.resource) || !selectedContent || selectedContent.kind === 'external') return;
    const resource = selected.resource;
    const file = new File([selectedContent.bytes], selected.item.name, { type: selectedContent.mime });
    try {
      if (isCapacitorApp()) { await shareFileFromNativeApp(file); return; }
      if (!current(resource)) return;
      const url = URL.createObjectURL(file);
      const timer = setTimeout(() => { URL.revokeObjectURL(url); downloads.current.delete(url); }, 1000);
      downloads.current.set(url, timer);
      const anchor = document.createElement('a');
      anchor.href = url; anchor.download = file.name;
      document.body.append(anchor); anchor.click(); anchor.remove();
    } catch {
      if (current(resource)) setDownloadError(scope);
    }
  };
  const downloadButton = <Button size="sm" variant="outline" onClick={() => { void download(); }}>{t('sidebarFilesTree.menu.download')}</Button>;

  return <>
    <MessageAttachmentsView items={displayed.map(({ item }) => item)} compact={compact} className={className} onOpen={(item) => {
      if (live.current.scope !== scope || live.current.transport !== transport) return;
      const entry = displayed.find((value) => value.item.id === item.id);
      if (entry?.state.kind === 'ready' && entry.state.content.kind === 'external') { onOpenExternal(entry.state.content.url); return; }
      if (!entry) return;
      if (entry.resource) startResource(item.id, entry.resource);
      setPopup({ scope, id: item.id, source: entry.source }); setDownloadError(null);
    }} />
    {displayed.filter(({ state }) => state.kind === 'error').map(({ item, state }) => <p key={item.id} role="alert" className="typography-meta text-[var(--status-error-text)]">{item.name}: {state.kind === 'error' && state.reason === 'too-large' ? t('chat.chatInput.toast.attachmentsTooLarge') : t('mobile.files.error.readUnavailable')}</p>)}
    {selectedContent?.kind === 'image' && <ImagePreviewView open images={gallery} initialIndex={gallery.findIndex((image) => image.url === selected?.item.previewUrl)} title={selected?.item.name ?? ''} isMobile={isMobile} onOpenChange={(open) => { if (!open) setPopup(null); }} />}
    {selected && selectedContent?.kind !== 'image' && <Dialog open onOpenChange={(open) => { if (!open) setPopup(null); }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader><DialogTitle>{selected.item.name}</DialogTitle>{selectedContent && selectedContent.kind !== 'external' && selectedContent.provenance === 'current-file' && <p className="typography-meta text-muted-foreground">{h('currentFile')}</p>}</DialogHeader>
        {(selected.state.kind === 'idle' || selected.state.kind === 'loading') && <p role="status">{t('common.loading')}</p>}
        {selected.state.kind === 'error' && <p role="alert">{t('mobile.files.error.readUnavailable')}</p>}
        {selectedContent?.kind === 'text' && <><pre dir="ltr" className="max-h-[60vh] overflow-auto whitespace-pre-wrap break-words rounded-md p-3 typography-code" style={{ backgroundColor: theme.colors.syntax.base.background, color: theme.colors.syntax.base.foreground }}>{selectedContent.text.slice(0, TEXT_PREVIEW_CHARACTERS)}</pre>{selectedContent.text.length > TEXT_PREVIEW_CHARACTERS && <p className="typography-meta text-muted-foreground">{t('mobile.files.file.truncated')}</p>}{downloadButton}</>}
        {selectedContent?.kind === 'external' && <Button size="sm" variant="outline" onClick={() => { if (selected.resource && current(selected.resource)) onOpenExternal(selectedContent.url); }}>{t('contextPanel.preview.actions.openExternal')}</Button>}
        {selectedContent?.kind === 'binary' && <BinaryArtifact name={selected.item.name} path={selected.item.name} sizeBytes={selectedContent.bytes.length} download={downloadButton} />}
        {downloadError === scope && <p role="alert">{t('mobile.files.error.readUnavailable')}</p>}
      </DialogContent>
    </Dialog>}
  </>;
}
