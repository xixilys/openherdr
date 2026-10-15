import React from 'react';
import { z } from 'zod';
import { Button } from '@openchamber/ui/components/ui/button';
import { Input } from '@openchamber/ui/components/ui/input';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@openchamber/ui/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@openchamber/ui/components/ui/dialog';
import { Icon } from '@openchamber/ui/components/icon/Icon';
import { MobileOverlayPanel } from '@openchamber/ui/components/ui/MobileOverlayPanel';
import { MobileSessionSwitcherView } from '@openchamber/ui/apps/MobileSessionSwitcherView';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel } from '@openchamber/ui/components/ui/dropdown-menu';
import { copyTextToClipboard } from '@openchamber/ui/lib/clipboard';
import { getToolMetadata } from '@openchamber/ui/lib/toolHelpers';
import { getToolIcon } from '@openchamber/ui/components/chat/message/parts/toolPresentation';
import { getToolDescription } from '@openchamber/ui/components/chat/message/parts/toolDescription';
import { useI18n } from '@openchamber/ui/lib/i18n';
import { openExternalUrl } from '@openchamber/ui/lib/url';
import { isIMECompositionEvent } from '@openchamber/ui/lib/ime';
import { isMobileSurfaceRuntime } from '@openchamber/ui/lib/runtimeSurface';
import { shouldSubmitEnter } from '@openchamber/ui/components/chat/composer/keyboardPolicy';
import type { Theme } from '@openchamber/ui/types/theme';
import { MarkdownPresentationContext, type MarkdownPresentationSource } from '@openchamber/ui/components/chat/MarkdownPresentationContext';
import AssistantTextPart from '@openchamber/ui/components/chat/message/parts/AssistantTextPart';
import { ReasoningTimelineBlock } from '@openchamber/ui/components/chat/message/parts/ReasoningPart';
import { SimpleMarkdownRenderer } from '@openchamber/ui/components/chat/MarkdownRenderer';
import { JsonSummaryView } from '@openchamber/ui/components/chat/message/parts/JsonSummaryView';
import { FormFieldControl } from '@openchamber/ui/components/chat/FormFieldControl';
import { initialFormValues, visibleFields, missingRequiredKeys, valueOf, buildFormAnswer, type FormValues } from '@openchamber/ui/components/chat/formCardState';
import { ComposerAttachmentControls } from '@openchamber/ui/components/chat/composer/ui/ComposerAttachmentControls';
import { MobilePillComposerView, MOBILE_PILL_ICON_BUTTON_CLASS } from '@openchamber/ui/components/chat/composer/ui/MobilePillComposerView';
import { UserMessageBubble, UserTextView } from '@openchamber/ui/components/chat/message/parts/UserMessagePresentation';
import { ToolSummaryView } from '@openchamber/ui/components/chat/message/parts/ToolSummaryView';
import { ComposerFloatingPanel } from '@openchamber/ui/components/chat/composer/ui/ComposerFloatingPanel';
import { registerFloatingPanelClearanceReader } from '@openchamber/ui/components/chat/composer/state/composerInsetReaders';
import { ScrollToBottomView } from '@openchamber/ui/components/chat/components/ScrollToBottomView';
import { useMobileAutocompleteMaxHeight } from '@openchamber/ui/components/chat/useMobileAutocompleteMaxHeight';
import { ATTACHMENT_ACCEPT, getUnsupportedAttachmentInputs } from '@openchamber/ui/sync/attachment-files';
import { setNativeImagePasteEnabled, subscribeToNativeImagePastes } from '@openchamber/ui/lib/nativeImagePaste';
import type { ToolPart, ModelRef } from '@openchamber/ui/lib/opencode/model';
import { normalizeToolName } from '@openchamber/ui/lib/opencode/tools';
import {
  driverResolveSchema, driverListSchema, driverHistoryListSchema, driverReadSchema, driverHistoryReadSchema,
  driverCatalogSchema, driverCreateSchema, driverActionSchema, driverPromptSchema, driverForkSchema, driverEventSchema,
  mergeConversationMessages, type ConversationSnapshot, type ConversationRecord, type ConversationForm, type ConversationCatalog,
} from '@openchamber/ui/lib/opencode/herdr-driver';
import { type HerdrTransport, type PendingDelivery, type HerdrJsonValue, snapshotSchema, infoSchema } from './transport';
import { useHerdrText } from './herdr.i18n';
import { conversationDrafts, draftIdentity, reconcileConversationTail, prepareConversationAttachments, readConversationLines } from './conversation-state';
import { trackConversationMutation, type ConversationMutationRequest } from './conversation-actions';

type TargetMetadata = { workspaceId: string; tabId: string; session: string | null };
export type ConversationPanelProps = {
  transport: HerdrTransport; machine: string; paneId: string; disabled?: boolean; mutationBlocked?: boolean;
  themeMode?: 'light' | 'dark';
  theme?: Theme;
  preferences?: { enterToSend: boolean; enterToSendConfigured: boolean; expandReasoningWhileStreaming: boolean };
  targetMetadata?: TargetMetadata;
  navigation?: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    anchorRef: React.RefObject<HTMLElement | null>;
    onTitleChange: (title: string | null) => void;
  };
  onPendingDelivery?: (record: PendingDelivery | null) => void;
};
const endpoint = (operation: string) => `/api/herdr/conversations/${operation}`;
const emptyGitHubPicker = () => {};

export function ConversationPanel(props: ConversationPanelProps) {
  return <ConversationPanelOwner key={JSON.stringify([props.transport.connection.server, props.machine, props.paneId])} {...props} />;
}

function ConversationPanelOwner({ transport, machine, paneId, disabled = false, mutationBlocked = false, targetMetadata, themeMode, theme, preferences, navigation, onPendingDelivery }: ConversationPanelProps) {
  const { t } = useI18n(); const h = useHerdrText();
  const fallbackError = h('messageError'), missingNative = h('noNativeSession'), disconnected = h('conversationDisconnected');
  const suppliedMetadata = !!targetMetadata;
  const [resolved, setResolved] = React.useState<z.infer<typeof driverResolveSchema> | null>(null);
  const [bound, setBound] = React.useState<z.infer<typeof driverListSchema> | null>(null);
  const [history, setHistory] = React.useState<z.infer<typeof driverHistoryListSchema> | null>(null);
  const [metadata, setMetadata] = React.useState<TargetMetadata | null>(targetMetadata ?? null);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [snapshot, setSnapshot] = React.useState<ConversationSnapshot | null>(null);
  const [activityFresh, setActivityFresh] = React.useState(false);
  const [eventsConnected, setEventsConnected] = React.useState(false);
  const [catalog, setCatalog] = React.useState<ConversationCatalog | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [streamError, setStreamError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [preparingKey, setPreparingKey] = React.useState<string | null>(null);
  const [reading, setReading] = React.useState(false);
  const [reload, setReload] = React.useState(0);
  const [liveEpoch, setLiveEpoch] = React.useState(0);
  const [dialog, setDialog] = React.useState<'rename' | 'delete' | 'rebind' | null>(null);
  const [renameValue, setRenameValue] = React.useState('');
  const [picker, setPicker] = React.useState<'model' | 'agent' | null>(null);
  const [pickerQuery, setPickerQuery] = React.useState('');
  const [atLatest, setAtLatest] = React.useState(true);
  const alive = React.useRef(true); const selectedRef = React.useRef(selectedId); selectedRef.current = selectedId;
  const input = React.useRef<HTMLInputElement>(null);
  const timeline = React.useRef<HTMLDivElement>(null); const content = React.useRef<HTMLDivElement>(null);
  const composer = React.useRef<HTMLDivElement>(null);
  const editor = React.useRef<HTMLTextAreaElement>(null);
  const following = React.useRef(true); const prependHeight = React.useRef<number | null>(null);
  const viewportHeight = React.useRef<number | null>(null);
  const preparation = React.useRef<{ key: string; controller: AbortController } | null>(null);
  const resolvedOwner = React.useRef<string | null>(null);
  const ownerTransport = React.useRef(transport); ownerTransport.current = transport;
  const snapshotRef = React.useRef(snapshot); snapshotRef.current = snapshot;
  const activeSnapshot = snapshot?.session.id === selectedId ? snapshot : null;
  const draftKey = draftIdentity(transport.connection.server, machine, paneId, selectedId);
  const subscribe = React.useCallback((listener: () => void) => conversationDrafts.subscribe(draftKey, listener), [draftKey]);
  const getDraft = React.useCallback(() => conversationDrafts.get(draftKey), [draftKey]);
  const draft = React.useSyncExternalStore(subscribe, getDraft, getDraft);
  const preparing = preparingKey === draftKey;
  const writeDisabled = disabled || mutationBlocked || busy || !metadata || !resolved;
  const writable = !writeDisabled && activeSnapshot?.access === 'owned' && !!activeSnapshot.target;
  const selectedBound = !!selectedId && !!bound?.sessions.some((item) => item.session.id === selectedId);
  const hasSnapshot = !!activeSnapshot;

  // The floating slot grows independently of the transcript, as in ChatContainer.
  React.useLayoutEffect(() => {
    const slot = composer.current, list = timeline.current;
    if (!hasSnapshot || !slot || !list || !globalThis.ResizeObserver) return;
    const resize = () => {
      const inset = Math.ceil(slot.getBoundingClientRect().height) + 24;
      list.style.paddingBottom = `${inset}px`;
      list.style.scrollPaddingBottom = `${inset}px`;
      if (following.current) list.scrollTop = list.scrollHeight;
    };
    const observer = new ResizeObserver(resize);
    observer.observe(slot); resize();
    return () => { observer.disconnect(); list.style.removeProperty('padding-bottom'); list.style.removeProperty('scroll-padding-bottom'); };
  }, [hasSnapshot, selectedId]);
  const sizeEditor = React.useCallback(() => {
    const node = editor.current;
    if (!node) return;
    node.style.height = 'auto';
    node.style.height = `${Math.min(node.scrollHeight, Math.max(48, (window.visualViewport?.height ?? window.innerHeight) * 0.3))}px`;
  }, []);
  React.useLayoutEffect(sizeEditor, [draft.text, hasSnapshot, sizeEditor]);
  React.useEffect(() => {
    window.addEventListener('resize', sizeEditor); window.visualViewport?.addEventListener('resize', sizeEditor);
    return () => { window.removeEventListener('resize', sizeEditor); window.visualViewport?.removeEventListener('resize', sizeEditor); };
  }, [sizeEditor]);

  React.useEffect(() => { alive.current = true; return () => { alive.current = false; preparation.current?.controller.abort(); setNativeImagePasteEnabled(false); }; }, []);
  React.useEffect(() => () => {
    if (preparation.current?.key === draftKey) { preparation.current.controller.abort(); preparation.current = null; if (alive.current) setPreparingKey(null); }
  }, [draftKey]);
  const workspaceId = targetMetadata?.workspaceId, tabId = targetMetadata?.tabId, herdrSession = targetMetadata?.session;
  React.useEffect(() => { if (workspaceId && tabId) setMetadata({ workspaceId, tabId, session: herdrSession ?? null }); }, [workspaceId, tabId, herdrSession]);

  React.useEffect(() => {
    if (disabled) return;
    const controller = new AbortController();
    const request = async <T,>(operation: string, body: { machine: string } | { target: { machine: string; paneId: string } }, schema: z.ZodType<T>) => transport.request(endpoint(operation), schema, { method: 'POST', body: JSON.stringify({ request: body }), signal: controller.signal });
    setError(null);
    void (async () => {
      try { const value = await request('history/list', { machine }, driverHistoryListSchema); if (!controller.signal.aborted) setHistory(value); }
      catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : fallbackError); }
    })();
    if (paneId) void (async () => { try {
      const value = await request('resolve', { target: { machine, paneId } }, driverResolveSchema);
      if (controller.signal.aborted) return;
      setResolved(value);
      if (!suppliedMetadata) {
        const [state, info] = await Promise.all([transport.rpc(machine, 'session.snapshot', {}, snapshotSchema, controller.signal), transport.request('/api/herdr/info', infoSchema, { signal: controller.signal })]);
        const pane = state.snapshot.panes.find((item) => item.pane_id === paneId);
        if (!pane) throw new Error(missingNative);
        if (controller.signal.aborted) return;
        setMetadata({ workspaceId: pane.workspace_id, tabId: pane.tab_id, session: info.session });
      }
      const list = await request('list', { target: value.target }, driverListSchema);
      if (controller.signal.aborted) return;
      setBound(list);
      if (!selectedRef.current) setSelectedId(value.session?.id ?? list.sessions[0]?.session.id ?? null);
      try { const models = await request('catalog', { target: value.target }, driverCatalogSchema); if (!controller.signal.aborted) setCatalog(models); }
      catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : fallbackError); }
    } catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : fallbackError); } })();
    return () => controller.abort();
  }, [disabled, fallbackError, machine, missingNative, paneId, reload, suppliedMetadata, transport]);

  const readSelected = React.useCallback(async (signal: AbortSignal, cursor?: string) => {
    if (!selectedId) return;
    const useBound = selectedBound && resolved;
    const request = () => useBound
      ? transport.request(endpoint('read'), driverReadSchema, { method: 'POST', body: JSON.stringify({ request: { target: resolved.target, sessionId: selectedId, limit: 50, cursor } }), signal })
      : transport.request(endpoint('history/read'), driverHistoryReadSchema, { method: 'POST', body: JSON.stringify({ request: { sessionId: selectedId, limit: 50, cursor } }), signal });
    const next = await request().catch((reason) => {
      if (!signal.aborted && alive.current && selectedRef.current === selectedId && ownerTransport.current === transport) setActivityFresh(false);
      throw reason;
    });
    if (signal.aborted || !alive.current || selectedRef.current !== selectedId || ownerTransport.current !== transport) return;
    setActivityFresh(next.history === null);
    setSnapshot((previous) => {
      if (previous?.session.id !== next.session.id) return next;
      const messages = cursor ? mergeConversationMessages(previous.messages, next.messages) : reconcileConversationTail(previous.messages, next.messages, !!next.cursor.next);
      return { ...next, messages, cursor: cursor ? next.cursor : previous.cursor.next && previous.messages.length > 50 ? previous.cursor : next.cursor };
    });
  }, [resolved, selectedBound, selectedId, transport]);

  React.useEffect(() => {
    setSnapshot(null); setActivityFresh(false); setStreamError(null); setNotice(null); following.current = true; setAtLatest(true); prependHeight.current = null;
    setNativeImagePasteEnabled(false);
  }, [selectedId]);
  const targetIdentity = resolved?.target.identity;
  React.useEffect(() => {
    if (!targetIdentity) return;
    if (resolvedOwner.current && resolvedOwner.current !== targetIdentity) {
      setSnapshot(null); setActivityFresh(false); setStreamError(null); setNotice(null); following.current = true; setAtLatest(true); prependHeight.current = null;
      preparation.current?.controller.abort(); preparation.current = null; setPreparingKey(null);
    }
    resolvedOwner.current = targetIdentity;
  }, [targetIdentity]);
  React.useEffect(() => {
    if (disabled) setActivityFresh(false);
    if (disabled || !selectedId) return;
    const controller = new AbortController();
    setReading(snapshotRef.current?.session.id !== selectedId);
    void (async () => {
      try { await readSelected(controller.signal); }
      catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : fallbackError); }
      finally { if (!controller.signal.aborted) setReading(false); }
    })();
    return () => controller.abort();
  }, [disabled, fallbackError, readSelected, selectedId]);

  React.useEffect(() => {
    setEventsConnected(false);
    if (!selectedId || !selectedBound || disabled || !resolved) return;
    const controller = new AbortController();
    let connection: AbortController | null = null; let timer: ReturnType<typeof setTimeout> | undefined; let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0; let refreshing = false; let requested = false;
    const refresh = () => {
      requested = true;
      if (refreshing || refreshTimer || controller.signal.aborted) return;
      refreshTimer = setTimeout(async () => {
        refreshTimer = undefined; if (controller.signal.aborted || document.hidden || !navigator.onLine) return;
        refreshing = true; requested = false;
        const signal = connection ? AbortSignal.any([connection.signal, controller.signal]) : controller.signal;
        try { await readSelected(signal); if (!signal.aborted) setStreamError(null); }
        catch (reason) { if (!signal.aborted) setStreamError(reason instanceof Error ? reason.message : fallbackError); }
        finally { refreshing = false; if (requested) refresh(); }
      }, 350);
    };
    const connect = async () => {
      if (controller.signal.aborted || document.hidden || !navigator.onLine) return;
      connection = new AbortController();
      const signal = AbortSignal.any([connection.signal, controller.signal]);
      try {
        const response = await transport.streamResponse(endpoint('events'), { method: 'POST', body: JSON.stringify({ request: { target: resolved.target, sessionId: selectedId } }), signal });
        if (!signal.aborted) setEventsConnected(true);
        for await (const value of readConversationLines(response, signal)) {
          const event = driverEventSchema.parse(value);
          if (event.sessionId !== selectedId) continue;
          if (event.type === 'conversation.error') throw new Error(event.error.message);
          if (event.target.identity !== resolved.target.identity) throw new Error(disconnected);
          failures = 0; refresh();
          if (event.type === 'conversation.event' && /^session\.execution\.(succeeded|failed|interrupted)$/.test(event.event.type)) setNotice(null);
          if (event.type === 'conversation.event' && /^(model|agent|provider)\.updated$/.test(event.event.type)) {
            const next = await transport.request(endpoint('catalog'), driverCatalogSchema, { method: 'POST', body: JSON.stringify({ request: { target: resolved.target } }), signal });
            if (!signal.aborted) setCatalog(next);
          }
        }
        if (!signal.aborted) throw new Error(disconnected);
      } catch (reason) {
        if (signal.aborted) return;
        setActivityFresh(false); setEventsConnected(false);
        setStreamError(reason instanceof Error ? reason.message : disconnected);
        connection.abort();
        failures += 1;
        timer = setTimeout(() => { void connect(); }, Math.min(30000, 1000 * 2 ** Math.min(failures, 5)));
      }
    };
    const visibility = () => {
      setActivityFresh(false); setEventsConnected(false);
      clearTimeout(timer); clearTimeout(refreshTimer); refreshTimer = undefined; connection?.abort();
      if (!document.hidden && navigator.onLine) { refresh(); void connect(); }
    };
    document.addEventListener('visibilitychange', visibility); window.addEventListener('online', visibility); window.addEventListener('offline', visibility);
    void connect();
    return () => { controller.abort(); connection?.abort(); clearTimeout(timer); clearTimeout(refreshTimer); document.removeEventListener('visibilitychange', visibility); window.removeEventListener('online', visibility); window.removeEventListener('offline', visibility); };
  }, [disabled, disconnected, fallbackError, liveEpoch, readSelected, resolved, selectedBound, selectedId, transport]);

  React.useLayoutEffect(() => {
    const node = timeline.current; if (!node) return;
    if (prependHeight.current !== null) { node.scrollTop += node.scrollHeight - prependHeight.current; prependHeight.current = null; }
    else if (following.current) node.scrollTop = node.scrollHeight;
  }, [activeSnapshot?.messages]);
  React.useEffect(() => {
    const node = timeline.current, body = content.current; if (!node || !body || !globalThis.ResizeObserver) return;
    const resize = () => { viewportHeight.current = node.clientHeight; if (following.current) node.scrollTop = node.scrollHeight; };
    const keyboardSettled = () => { sizeEditor(); resize(); };
    const observer = new ResizeObserver(resize); observer.observe(body); observer.observe(node); resize();
    window.addEventListener('oc:keyboard-settled', keyboardSettled);
    return () => { observer.disconnect(); window.removeEventListener('oc:keyboard-settled', keyboardSettled); };
  }, [selectedId, sizeEditor]);

  const rows = new Map((history?.conversations ?? []).map((item) => [item.session.id, item.session]));
  for (const item of bound?.sessions ?? []) rows.set(item.session.id, item.session);
  const title = activeSnapshot?.session.title || (selectedId ? rows.get(selectedId)?.title : null) || h('newConversation');
  const onTitleChange = navigation?.onTitleChange;
  React.useLayoutEffect(() => { onTitleChange?.(title); }, [onTitleChange, title]);
  React.useEffect(() => () => onTitleChange?.(null), [onTitleChange]);
  const markdownSource = React.useMemo<MarkdownPresentationSource>(() => ({ directory: activeSnapshot?.session.directory ?? resolved?.directory ?? '', runtimeKey: transport.connection.server, themeMode, theme, isVSCode: false, fileReferences: false, inlineImages: false, ownOrigins: [transport.connection.server], openExternalLink: (url) => { void openExternalUrl(url); } }), [activeSnapshot?.session.directory, resolved?.directory, themeMode, theme, transport.connection.server]);
  const recordFor = (operation: string): PendingDelivery => {
    if (!metadata) throw new Error(h('noNativeSession'));
    return { requestId: crypto.randomUUID(), server: transport.connection.server, machine, session: metadata.session, workspaceId: metadata.workspaceId, tabId: metadata.tabId, paneId, method: `conversation.${operation}` };
  };
  const mutate = async <T,>(operation: 'create' | 'act' | 'rebind', request: ConversationMutationRequest, schema: z.ZodType<T>, method: string): Promise<T | null> => {
    if (writeDisabled) return null;
    setBusy(true); setError(null);
    try {
      const result = await trackConversationMutation({ transport, record: recordFor(method), path: endpoint(operation), request, schema, onPendingDelivery });
      return result.kind === 'complete' ? result.value : null;
    } catch (reason) { if (alive.current) setError(reason instanceof Error ? reason.message : h('messageError')); return null; }
    finally { if (alive.current) setBusy(false); }
  };
  const act = async (action: string, value: HerdrJsonValue) => {
    const target = activeSnapshot?.target; if (!writable || !target || !selectedId) return false;
    const expected = selectedId;
    const result = await mutate('act', { target, sessionId: selectedId, action, input: value }, driverActionSchema, action);
    if (!result || !alive.current || selectedRef.current !== expected) return false;
    if (action === 'delete') { setSnapshot(null); setSelectedId(null); setReload((n) => n + 1); }
    else {
      try { await readSelected(new AbortController().signal); }
      catch (reason) { if (alive.current) setError(reason instanceof Error ? reason.message : fallbackError); }
      if (action === 'rename') setReload((n) => n + 1);
    }
    return true;
  };
  const send = async () => {
    const target = activeSnapshot?.target; if (!writable || preparing || preparation.current?.key === draftKey || !target || !selectedId || (!draft.text.trim() && !draft.files.length)) return;
    const captured = { key: draftKey, revision: draft.revision, sessionId: selectedId };
    const result = await mutate('act', { target, sessionId: selectedId, action: 'prompt', input: { text: draft.text, files: draft.files.map(({ uri, name }) => ({ uri, name })), delivery: 'queue' } }, driverPromptSchema, 'prompt');
    if (!result) return;
    conversationDrafts.acknowledge(captured.key, captured.revision);
    if (alive.current && selectedRef.current === captured.sessionId) { setNotice(h('enqueued')); following.current = true; setAtLatest(true); setLiveEpoch((n) => n + 1); }
  };
  const attach = React.useCallback(async (files: File[]) => {
    preparation.current?.controller.abort(); const controller = new AbortController(); preparation.current = { key: draftKey, controller };
    const capturedKey = draftKey;
    setPreparingKey(capturedKey);
    try {
      const prepared = await prepareConversationAttachments(files, conversationDrafts.get(capturedKey).files, controller.signal);
      if (!controller.signal.aborted) conversationDrafts.update(capturedKey, (previous) => ({ ...previous, files: [...previous.files, ...prepared] }));
    } catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error && reason.message === 'attachmentTooLarge' ? h('attachmentTooLarge') : t('chat.chatInput.toast.sendAttachmentsFailed')); }
    finally {
      if (preparation.current?.controller === controller) { preparation.current = null; if (alive.current) setPreparingKey(null); }
    }
  }, [draftKey, h, t]);
  const loadOlder = async (cursor: string) => {
    if (timeline.current) prependHeight.current = timeline.current.scrollHeight;
    try { await readSelected(new AbortController().signal, cursor); }
    catch (reason) { if (alive.current) setError(reason instanceof Error ? reason.message : fallbackError); }
  };
  React.useEffect(() => subscribeToNativeImagePastes((paste) => {
    if (!writable || document.activeElement?.getAttribute('data-herdr-composer') !== 'true') return;
    if (paste.ok) void attach([paste.file]); else setError(t('chat.chatInput.toast.sendAttachmentsFailed'));
  }), [attach, t, writable]);
  React.useEffect(() => {
    const sync = () => setNativeImagePasteEnabled(writable && !document.hidden && document.activeElement?.getAttribute('data-herdr-composer') === 'true');
    sync(); document.addEventListener('visibilitychange', sync);
    return () => { setNativeImagePasteEnabled(false); document.removeEventListener('visibilitychange', sync); };
  }, [draftKey, writable]);

  const selectedModel = catalog?.models.find((item) => item.id === activeSnapshot?.session.model?.id && item.providerID === activeSnapshot?.session.model?.providerID);
  const latestAssistantId = React.useMemo(() => {
    if (!activeSnapshot) return null;
    for (let index = activeSnapshot.messages.length - 1; index >= 0; index -= 1) if (activeSnapshot.messages[index].message.role === 'assistant') return activeSnapshot.messages[index].message.id;
    return null;
  }, [activeSnapshot]);
  const unsupported = selectedModel ? getUnsupportedAttachmentInputs(draft.files, selectedModel.capabilities.input) : [];
  const fork = async (messageId?: string) => {
    if (!writable || !activeSnapshot?.target || !selectedId) return;
    const expected = selectedId;
    const result = await mutate('act', { target: activeSnapshot.target, sessionId: selectedId, action: 'fork', input: messageId ? { messageId } : {} }, driverForkSchema, 'fork');
    if (result && alive.current && selectedRef.current === expected) { setSelectedId(result.result.id); setReload((n) => n + 1); }
  };
  const loadMoreSessions = async () => {
    const sourceTransport = transport;
    try {
      if (history?.cursor.next) {
        const next = await transport.request(endpoint('history/list'), driverHistoryListSchema, { method: 'POST', body: JSON.stringify({ request: { machine, cursor: history.cursor.next, limit: 50 } }) });
        if (!alive.current || sourceTransport !== ownerTransport.current) return;
        setHistory((previous) => previous ? { ...next, conversations: [...new Map([...previous.conversations, ...next.conversations].map((item) => [item.session.id, item])).values()], complete: previous.complete && next.complete, failures: [...previous.failures, ...next.failures] } : next);
      }
      if (bound?.cursor.next && resolved && !disabled) {
        const next = await transport.request(endpoint('list'), driverListSchema, { method: 'POST', body: JSON.stringify({ request: { target: resolved.target, cursor: bound.cursor.next, limit: 50 } }) });
        if (!alive.current || sourceTransport !== ownerTransport.current) return;
        setBound((previous) => previous ? { ...next, sessions: [...new Map([...previous.sessions, ...next.sessions].map((item) => [item.session.id, item])).values()], complete: previous.complete && next.complete, failures: [...previous.failures, ...next.failures] } : next);
      }
    } catch (reason) { if (alive.current) setError(reason instanceof Error ? reason.message : fallbackError); }
  };

  const createConversation = () => {
    const expected = selectedId;
    if (resolved) void mutate('create', { target: resolved.target }, driverCreateSchema, 'create').then((value) => {
      if (value && alive.current && selectedRef.current === expected) { setSelectedId(value.session.id); setReload((n) => n + 1); }
    });
  };
  const refreshConversations = () => { setReload((n) => n + 1); setLiveEpoch((n) => n + 1); };
  const sessionActions = <div className="flex flex-wrap items-center gap-1">
    <Button size="sm" variant="ghost" aria-label={t('chat.container.sessionLoadError.retry')} onClick={refreshConversations}><Icon name="refresh" className="size-4" /></Button>
    {history?.cursor.next || bound?.cursor.next ? <Button size="sm" variant="ghost" onClick={() => { void loadMoreSessions(); }}>{t('chat.promptNavigator.loadMore')}</Button> : null}
    <span className="flex-1" />
    <Button size="sm" variant="ghost" disabled={!writable || !activeSnapshot?.capabilities.rename} onClick={() => { if (activeSnapshot) { setRenameValue(activeSnapshot.session.title); setDialog('rename'); navigation?.onOpenChange(false); } }}>{t('sessions.sidebar.session.menu.rename')}</Button>
    <Button size="sm" variant="ghost" disabled={!writable || !activeSnapshot?.capabilities.fork} onClick={() => { void fork(); navigation?.onOpenChange(false); }}>{t('chat.messageBody.actions.fork')}</Button>
    <Button size="sm" variant="ghost" disabled={!writable || !activeSnapshot?.capabilities.delete} aria-label={t('sessions.sidebar.dialogs.deleteSession.titleAction')} onClick={() => { setDialog('delete'); navigation?.onOpenChange(false); }}><Icon name="delete-bin" className="size-4" /></Button>
  </div>;
  const liveActivity = activityFresh && eventsConnected;
  const running = liveActivity && activeSnapshot?.history === null && activeSnapshot.activity?.type === 'running';
  const canSend = writable && !preparing && activeSnapshot?.capabilities.prompt === true && (!!draft.text.trim() || draft.files.length > 0);
  const modelLabel = selectedModel?.name ?? activeSnapshot?.session.model?.id ?? t('chat.modelControls.selectModel');
  const agentLabel = catalog?.agents.find((item) => item.id === activeSnapshot?.session.agent)?.name ?? activeSnapshot?.session.agent ?? t('chat.modelControls.selectAgent');
  const closePicker = () => { setPicker(null); setPickerQuery(''); };
  const visibleError = error ?? streamError;
  const hasRequest = !!(activeSnapshot?.permissions?.length || activeSnapshot?.forms?.length);

  return <MarkdownPresentationContext.Provider value={markdownSource}><section data-composer-bound className="relative flex h-full min-h-0 flex-col bg-background text-foreground" aria-label={h('conversations')}>
    {navigation ? <MobileSessionSwitcherView open={navigation.open && !disabled} onClose={() => navigation.onOpenChange(false)} anchorRef={navigation.anchorRef} selectedId={selectedId} rows={[...rows.values()].map((session) => ({ id: session.id, title: session.id === selectedId ? title : session.title || session.id, subtitle: session.directory, activity: liveActivity && session.id === activeSnapshot?.session.id && activeSnapshot.history === null ? activeSnapshot.activity?.type === 'running' ? 'running' : 'idle' : 'unknown' }))} onSelect={(id) => { setSelectedId(id); setError(null); }} onCreate={createConversation} createDisabled={writeDisabled || resolved?.capabilities.create !== true} footer={sessionActions} /> : <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border p-3">
      <Select value={selectedId ?? ''} onValueChange={(id) => { setSelectedId(id); setError(null); }}>
        <SelectTrigger className="min-w-0 flex-1" aria-label={h('history')}><SelectValue placeholder={h('history')}>{selectedId ? rows.get(selectedId)?.title || selectedId : h('history')}</SelectValue></SelectTrigger>
        <SelectContent>{[...rows.values()].map((session) => <SelectItem value={session.id} key={session.id}><span dir="auto">{session.title || session.id}</span></SelectItem>)}</SelectContent>
      </Select>
      <Button size="sm" variant="outline" disabled={writeDisabled || resolved?.capabilities.create !== true} onClick={createConversation}><Icon name="add" className="size-4" />{h('newConversation')}</Button>
      {sessionActions}
    </div>}
    {visibleError ? <div role="alert" className="shrink-0 break-words border-b border-border bg-[var(--status-error-background)] p-3 typography-meta text-[var(--status-error-text)]">{visibleError}</div> : null}
    {notice ? <div role="status" className="shrink-0 px-3 py-2 typography-meta text-muted-foreground">{notice}</div> : null}
    {history?.complete === false || bound?.complete === false ? <p className="shrink-0 px-3 py-2 typography-meta text-[var(--status-warning-text)]">{h('messageError')} {[...(history?.failures ?? []), ...(bound?.failures ?? [])].map((item) => item.error.message).join(' · ')}</p> : null}
    <div ref={timeline} className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 sm:p-5" onScroll={(event) => {
      const node = event.currentTarget;
      // A native keyboard resize is geometry, so retain the reader's prior intent.
      if (viewportHeight.current !== null && viewportHeight.current !== node.clientHeight) {
        viewportHeight.current = node.clientHeight;
        if (following.current) node.scrollTop = node.scrollHeight;
        return;
      }
      following.current = node.scrollHeight - node.clientHeight - node.scrollTop < 64;
      setAtLatest(following.current);
    }}>
      <div ref={content} className="mx-auto max-w-3xl space-y-5">
        {!selectedId ? <p className="py-8 text-center typography-ui text-muted-foreground">{resolved?.nativeAccess === 'unavailable' ? h('noNativeSession') : h('createFirst')}</p> : null}
        {reading ? <p role="status" className="typography-meta text-muted-foreground">{t('common.loading')}</p> : null}
        {activeSnapshot?.cursor.next ? <Button size="sm" variant="ghost" onClick={() => { if (activeSnapshot.cursor.next) void loadOlder(activeSnapshot.cursor.next); }}>{t('chat.history.loadOlder')}</Button> : null}
        {activeSnapshot?.messages.map((record) => <ConversationMessage key={record.message.id} record={record} live={!!running} streaming={!!running && record.message.id === latestAssistantId} expandReasoningWhileStreaming={preferences?.expandReasoningWhileStreaming ?? true} writable={writable && activeSnapshot.capabilities.fork === true} onFork={() => { void fork(record.message.id); }} />)}
        {activeSnapshot && activeSnapshot.access === 'read-only' ? <div className="rounded-lg border border-border bg-surface-muted p-3 typography-meta text-muted-foreground"><p>{activeSnapshot.history ? h('rebindConfirm') : h('nativeReadOnly')}</p>{activeSnapshot.history && resolved ? <Button className="mt-2" size="sm" variant="outline" disabled={writeDisabled} onClick={() => setDialog('rebind')}>{h('rebind')}</Button> : null}</div> : null}
        <div aria-hidden="true" ref={registerFloatingPanelClearanceReader} style={{ height: 'var(--chat-floating-panel-clearance, 0px)' }} />
      </div>
    </div>
    {activeSnapshot ? <div ref={composer} data-composer-slot="floating" className="absolute inset-x-0 bottom-0 z-10">
      <div className="chat-input-column mx-auto w-full max-w-3xl px-3 pt-2" style={{ paddingBottom: 'max(0.75rem, var(--oc-safe-area-bottom, 0px))' }}>
        <ScrollToBottomView visible={!atLatest} onClick={() => { following.current = true; setAtLatest(true); if (timeline.current) timeline.current.scrollTop = timeline.current.scrollHeight; }} />
        <MobilePillComposerView
          input={{
            kind: 'editor', value: draft.text, textareaRef: editor, disabled: !writable,
            placeholder: t('chat.chatInput.placeholder.chatCompact'), ariaLabel: h('draftPlaceholder'),
            onChange: (text) => conversationDrafts.update(draftKey, (previous) => ({ ...previous, text })),
            onFocus: () => setNativeImagePasteEnabled(writable), onBlur: () => setNativeImagePasteEnabled(false),
            onPaste: (event) => { const files = [...event.clipboardData.files]; if (files.length && writable) { event.preventDefault(); void attach(files); } },
            onKeyDown: (event) => { if (!isIMECompositionEvent(event) && event.key === 'Enter' && shouldSubmitEnter({ isMobile: !!navigation || isMobileSurfaceRuntime(), isDesktopExpanded: false, enterToSend: preferences?.enterToSend ?? true, enterToSendConfigured: preferences?.enterToSendConfigured ?? false, shiftKey: event.shiftKey, ctrlKey: event.ctrlKey, metaKey: event.metaKey })) { event.preventDefault(); void send(); } },
          }}
          isRunning={!!running} canSend={canSend} canQueue={!!running && canSend} canAbort={!!running && writable && activeSnapshot.capabilities.abort === true}
          onSend={() => { void send(); }} onAbort={() => { void act('abort', {}); }} onQueue={running ? () => { void send(); } : undefined}
          model={{ label: modelLabel, onChoose: () => setPicker('model'), disabled: !writable || !activeSnapshot.capabilities.modelSelection, icon: <Icon name="code-ai" className="size-3.5 shrink-0" /> }}
          agent={{ label: agentLabel, onChoose: () => setPicker('agent'), disabled: !writable || !activeSnapshot.capabilities.agentSelection, color: activeSnapshot.session.agent?.toLowerCase() === 'build' ? 'var(--status-success)' : undefined }}
          attachmentControl={<div aria-disabled={!writable} className={!writable ? 'pointer-events-none opacity-50' : undefined}><ComposerAttachmentControls isVSCode={false} footerIconButtonClass={MOBILE_PILL_ICON_BUTTON_CLASS} iconSizeClass="h-[18px] w-[18px]" handlePickLocalFiles={() => input.current?.click()} openGitHubPicker={emptyGitHubPicker} filesOnly /></div>}
          statusRow={running && atLatest && !hasRequest ? <div role="status" className="mb-2"><div className="oc-surface-floating inline-flex h-7 max-w-full items-center gap-2 whitespace-nowrap rounded-full ps-2 pe-3"><Icon name="code-ai" className="size-3.5 shrink-0" /><span className="truncate typography-meta">{modelLabel} · {t('chat.todo.inProgress')}</span></div></div> : undefined}
          topRow={preparing || unsupported.length || (catalog && (!catalog.models.length || !catalog.agents.length) && !catalog.authoritative) ? <div className="border-b border-border/40 px-3 py-2 typography-meta text-muted-foreground">
            {preparing ? <p role="status">{t('common.loading')}</p> : null}
            {catalog && (!catalog.models.length || !catalog.agents.length) && !catalog.authoritative ? <p>{h('catalogLoading')}</p> : null}
            {unsupported.length && selectedModel ? <p className="text-[var(--status-warning-text)]">{t('chat.chatInput.toast.unsupportedAttachmentModalities', { model: selectedModel.name, modalities: [...new Set(unsupported.map((item) => item.modality))].join(', '), files: unsupported.map((item) => item.attachment.name).join(', ') })}</p> : null}
          </div> : undefined}
          attachments={draft.files.length ? <div className="flex flex-wrap gap-2 px-3 pt-2">{draft.files.map((file) => <div key={file.id} className="flex min-w-0 items-center gap-1 rounded-md border border-border px-2 py-1 typography-meta"><span dir="auto" className="max-w-48 truncate">{file.name}</span><Button size="xs" variant="ghost" disabled={busy} aria-label={t('chat.fileAttachment.actions.removeNamed', { name: file.name })} onClick={() => conversationDrafts.update(draftKey, (previous) => ({ ...previous, files: previous.files.filter((item) => item.id !== file.id) }))}><Icon name="close" className="size-3" /></Button></div>)}</div> : undefined}
        />
        <input ref={input} type="file" multiple accept={ATTACHMENT_ACCEPT} className="hidden" onChange={(event) => { const files = [...(event.target.files ?? [])]; event.target.value = ''; if (files.length && writable) void attach(files); }} />
        <ConversationRequestDock key={activeSnapshot.session.id} snapshot={activeSnapshot} writable={writable} onAction={(action, value) => { void act(action, value); }} />
      </div>
    </div> : null}
    <MobileOverlayPanel open={picker !== null} onClose={closePicker} title={t(picker === 'agent' ? 'chat.modelControls.selectAgent' : 'chat.modelControls.selectModel')}>
      <div className="space-y-2 p-1">
        <Input value={pickerQuery} onChange={(event) => setPickerQuery(event.target.value)} placeholder={t(picker === 'model' ? 'chat.modelControls.searchModels' : 'chat.modelControls.searchAgents')} aria-label={t(picker === 'model' ? 'chat.modelControls.searchModels' : 'chat.modelControls.searchAgents')} />
        {picker === 'model' ? <>
          {catalog?.models.filter((item) => item.enabled && `${item.providerID} ${item.name}`.toLocaleLowerCase().includes(pickerQuery.toLocaleLowerCase())).map((item) => <Button key={JSON.stringify([item.providerID, item.id])} variant="ghost" className="h-auto min-h-10 w-full justify-start gap-2 text-start" disabled={!writable || !activeSnapshot?.capabilities.modelSelection} aria-pressed={activeSnapshot?.session.model?.id === item.id && activeSnapshot.session.model.providerID === item.providerID} onClick={() => { void act('model', { id: item.id, providerID: item.providerID }).then((success) => { if (success) closePicker(); }); }}><Icon name="code-ai" className="size-4 shrink-0" /><span className="flex min-w-0 flex-1 flex-col"><span dir="auto" className="truncate">{item.name}</span><span dir="auto" className="truncate typography-micro text-muted-foreground">{item.providerID}</span></span></Button>)}
          {selectedModel?.variants.length ? <Select value={activeSnapshot?.session.model?.variant ?? 'default'} disabled={!writable || !activeSnapshot?.capabilities.modelSelection} onValueChange={(variant) => { const current = activeSnapshot?.session.model; if (current) { const model: ModelRef = { id: current.id, providerID: current.providerID }; if (variant !== 'default') model.variant = variant; void act('model', model); } }}><SelectTrigger aria-label={t('chat.modelControls.thinking')}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="default">{t('chat.modelControls.default')}</SelectItem>{selectedModel.variants.filter((variant) => variant.id !== 'default').map((variant) => <SelectItem value={variant.id} key={variant.id}>{variant.id}</SelectItem>)}</SelectContent></Select> : null}
        </> : catalog?.agents.filter((item) => !item.hidden && item.mode !== 'subagent' && `${item.name} ${item.description ?? ''}`.toLocaleLowerCase().includes(pickerQuery.toLocaleLowerCase())).map((item) => <Button key={item.id} variant="ghost" className="h-auto min-h-10 w-full justify-start text-start" disabled={!writable || !activeSnapshot?.capabilities.agentSelection} aria-pressed={activeSnapshot?.session.agent === item.id} onClick={() => { void act('agent', { agent: item.id }).then((success) => { if (success) closePicker(); }); }}><span className="flex min-w-0 flex-col"><span dir="auto">{item.name}</span>{item.description ? <span dir="auto" className="typography-meta text-muted-foreground">{item.description}</span> : null}</span></Button>)}
      </div>
    </MobileOverlayPanel>
    <Dialog open={dialog !== null} onOpenChange={(open) => { if (!open) setDialog(null); }}><DialogContent><DialogHeader><DialogTitle>{dialog === 'rename' ? t('sessions.sidebar.session.menu.rename') : dialog === 'delete' ? t('sessions.sidebar.dialogs.deleteSession.title') : h('rebind')}</DialogTitle><DialogDescription>{dialog === 'rebind' ? h('rebindConfirm') : dialog === 'delete' ? t('sessions.sidebar.dialogs.deleteSession.single', { sessionTitle: activeSnapshot?.session.title ?? '' }) : activeSnapshot?.session.id}</DialogDescription></DialogHeader>{dialog === 'rename' ? <Input value={renameValue} onChange={(event) => setRenameValue(event.target.value)} aria-label={t('sessions.sidebar.session.menu.rename')} /> : null}<DialogFooter><Button variant="outline" onClick={() => setDialog(null)}>{t('chat.formCard.cancel')}</Button><Button disabled={writeDisabled || (dialog === 'rename' && !renameValue.trim())} variant={dialog === 'delete' ? 'destructive' : 'default'} onClick={() => {
      if (dialog === 'rebind' && resolved && selectedId) { const expected = selectedId; void mutate('rebind', { target: resolved.target, sessionId: selectedId }, driverCreateSchema, 'rebind').then((value) => { if (value && alive.current && selectedRef.current === expected) { setDialog(null); setReload((n) => n + 1); } }); }
      else if (dialog === 'rename') void act('rename', { title: renameValue.trim() }).then((complete) => { if (complete && alive.current) setDialog(null); });
      else if (dialog === 'delete') void act('delete', {}).then((complete) => { if (complete && alive.current) setDialog(null); });
    }}>{dialog === 'delete' ? t('sessions.sidebar.dialogs.deleteSession.titleAction') : dialog === 'rename' ? t('sessions.sidebar.session.rename.save') : h('rebind')}</Button></DialogFooter></DialogContent></Dialog>
  </section></MarkdownPresentationContext.Provider>;
}

function ConversationMessage({ record, streaming, live, writable, onFork, expandReasoningWhileStreaming }: { record: ConversationRecord; streaming: boolean; live: boolean; writable: boolean; onFork: () => void; expandReasoningWhileStreaming: boolean }) {
  const { t, locale } = useI18n(); const message = record.message;
  const [expanded, setExpanded] = React.useState(false);
  const [truncatedParts, setTruncatedParts] = React.useState<ReadonlySet<string>>(() => new Set());
  const onTruncation = React.useCallback((id: string, truncated: boolean) => {
    setTruncatedParts((previous) => {
      if (previous.has(id) === truncated) return previous;
      const next = new Set(previous);
      if (truncated) next.add(id); else next.delete(id);
      return next;
    });
  }, []);
  const expandMessage = React.useCallback(() => setExpanded(true), []);
  const [copyState, setCopyState] = React.useState<'copied' | 'error' | null>(null);
  const active = streaming && message.role === 'assistant' && message.time.completed === undefined && message.finish === undefined;
  const text = record.parts.filter((part) => part.type === 'text').map((part) => part.text).join('\n');
  const actions = message.role === 'user' || message.role === 'assistant' ? <div className="mt-1 flex items-center gap-1">
    {copyState ? <span role="status" className="typography-micro text-muted-foreground">{t(copyState === 'copied' ? 'chat.messageBody.toast.copied' : 'mobile.files.toast.copyFailed')}</span> : null}
    <DropdownMenu><DropdownMenuTrigger asChild><Button size="icon" variant="ghost" className="size-8 text-muted-foreground" aria-label={t('chat.messageBody.actions.moreActions')}><Icon name="more" className="size-4" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end">
      <DropdownMenuLabel><time dateTime={new Date(message.time.created).toISOString()}>{new Date(message.time.created).toLocaleString(locale)}</time></DropdownMenuLabel>
      {text ? <DropdownMenuItem onClick={() => { void copyTextToClipboard(text).then((result) => setCopyState(result.ok ? 'copied' : 'error')).catch(() => setCopyState('error')); }}><Icon name="file-copy" className="size-4" />{t('chat.messageBody.actions.copyMessage')}</DropdownMenuItem> : null}
      {writable ? <DropdownMenuItem onClick={onFork}><Icon name="git-branch" className="size-4" />{t('chat.messageBody.actions.fork')}</DropdownMenuItem> : null}
    </DropdownMenuContent></DropdownMenu>
  </div> : null;
  const body = <>
    {record.parts.map((part) => part.type === 'text' ? message.role === 'assistant' ? <AssistantTextPart key={part.id} part={part} messageId={message.id} streamPhase={active ? 'streaming' : 'completed'} /> : <ConversationUserText key={part.id} id={part.id} text={part.text} expanded={expanded} onExpand={expandMessage} onTruncation={onTruncation} /> : part.type === 'reasoning' ? <ReasoningTimelineBlock key={part.id} blockId={part.id} text={part.text} time={part.time} isStreaming={active} expandWhileStreaming={expandReasoningWhileStreaming} /> : part.type === 'tool' ? <ConversationTool key={part.id} part={part} live={live} /> : part.type === 'file' ? <div key={part.id} className="flex items-center gap-2 rounded border border-border px-2 py-1 typography-meta"><Icon name="attachment-2" className="size-4" /><span dir="auto">{part.filename ?? part.mime}</span></div> : null)}
    {'text' in message && message.text ? <SimpleMarkdownRenderer content={message.text} enableFileReferences={false} /> : null}
    {message.role === 'compaction' && message.summary ? <SimpleMarkdownRenderer content={message.summary} variant="reasoning" enableFileReferences={false} /> : null}
    {message.role === 'shell' ? <div dir="ltr" className="whitespace-pre-wrap break-words font-mono typography-meta">{message.command}{message.output ? `\n${message.output.output}` : ''}</div> : null}
    {'error' in message && message.error ? <p role="alert" className="whitespace-pre-wrap break-words typography-meta text-[var(--status-error-text)]">{message.error.message}</p> : null}
    {message.role === 'user' && (expanded || truncatedParts.size > 0) ? <button type="button" onClick={(event) => { event.stopPropagation(); setExpanded((value) => !value); }} className="ms-auto mt-1 block py-0.5 text-end text-sm text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline focus-visible:underline focus-visible:outline-none focus-visible:text-foreground" style={{ minHeight: 0, minWidth: 0 }} aria-expanded={expanded}>{t(expanded ? 'chat.message.userText.showLess' : 'chat.message.userText.showFullMessage')}</button> : null}
  </>;
  return <article data-message-id={message.id} className="min-w-0">{message.role === 'user' ? <UserMessageBubble footer={actions}>{body}</UserMessageBubble> : <>{body}{actions}</>}</article>;
}

function ConversationUserText({ id, text, expanded, onExpand, onTruncation }: { id: string; text: string; expanded: boolean; onExpand: () => void; onTruncation: (id: string, truncated: boolean) => void }) {
  const reportTruncation = React.useCallback((truncated: boolean) => onTruncation(id, truncated), [id, onTruncation]);
  return <UserTextView text={text} expanded={expanded} onToggle={onExpand} showToggle={false} onTruncationChange={reportTruncation} />;
}

function ConversationTool({ part, live }: { part: ToolPart; live: boolean }) {
  const { t } = useI18n();
  const markdown = React.useContext(MarkdownPresentationContext);
  const state = part.state;
  const [expanded, setExpanded] = React.useState(false);
  return <ToolSummaryView title={getToolMetadata(part.tool).displayName} icon={getToolIcon(normalizeToolName(part.tool))} summary={getToolDescription(part, state, markdown?.directory ?? '', t)} status={state.status} active={live && (state.status === 'pending' || state.status === 'running')} startedAt={state.status !== 'pending' && (live || state.status === 'completed' || state.status === 'error') ? state.time.start : undefined} endedAt={state.status === 'completed' || state.status === 'error' ? state.time.end : undefined} expanded={expanded} onToggle={() => setExpanded((value) => !value)}>
    <div className="space-y-3 py-2"><JsonSummaryView data={state.input} />{state.status === 'pending' && state.raw ? <div dir="ltr" className="whitespace-pre-wrap break-words font-mono typography-meta">{state.raw}</div> : null}{(state.status === 'completed' || state.status === 'error') && state.output ? <SimpleMarkdownRenderer content={state.output} variant="tool" enableFileReferences={false} /> : null}{state.status === 'error' ? <p role="alert" className="whitespace-pre-wrap break-words typography-meta text-[var(--status-error-text)]">{state.error}</p> : null}{state.status === 'completed' ? state.attachments?.map((file) => <p key={file.id} dir="auto" className="typography-meta">{file.filename ?? file.mime}</p>) : null}</div>
  </ToolSummaryView>;
}

function ConversationRequestDock({ snapshot, writable, onAction }: { snapshot: ConversationSnapshot; writable: boolean; onAction: (action: string, value: HerdrJsonValue) => void }) {
  const { t } = useI18n();
  const [selected, setSelected] = React.useState<string | null>(null);
  const [collapsed, setCollapsed] = React.useState(false);
  const body = React.useRef<HTMLDivElement>(null);
  const permissions = snapshot.permissions ?? [], forms = snapshot.forms ?? [];
  const index = Math.max(0, permissions.findIndex((item) => item.id === selected));
  const permission = permissions[index];
  const requestId = permission?.id ?? forms[0]?.id;
  const availableMaxHeight = useMobileAutocompleteMaxHeight(body, !!requestId && !collapsed, 320);
  React.useEffect(() => setCollapsed(false), [requestId]);
  if (!requestId) return null;
  const title = permission ? t('chat.permissionCard.title') : forms[0].title;
  const expandKey = permission ? 'chat.permissionDock.expandAria' : 'chat.formDock.expandAria';
  const collapseKey = permission ? 'chat.permissionDock.collapseAria' : 'chat.formDock.collapseAria';
  return <ComposerFloatingPanel role="dialog" ariaLabel={title} compact={collapsed} header={<>
    <button type="button" onClick={() => setCollapsed((value) => !value)} aria-expanded={!collapsed} aria-label={t(collapsed ? expandKey : collapseKey)} className="flex min-w-0 flex-1 items-center gap-2 text-start text-muted-foreground hover:text-foreground"><Icon name="question" className="size-3.5 shrink-0 text-[var(--status-warning)]" /><Icon name={collapsed ? 'arrow-up-s' : 'arrow-down-s'} className="size-4 shrink-0" /><span className="truncate typography-ui-label text-foreground">{title}</span>{(permission ? permissions.length : forms.length) > 1 ? <span className="shrink-0 typography-micro">{t('chat.formDock.progress', { current: String(permission ? index + 1 : 1), total: String(permission ? permissions.length : forms.length) })}</span> : null}</button>
    {!collapsed && permissions.length > 1 ? <div className="flex shrink-0 gap-1" role="tablist">{permissions.map((item, position) => <button key={item.id} type="button" role="tab" aria-selected={position === index} aria-label={t('chat.permissionDock.stepAria', { index: String(position + 1), tool: item.action })} onClick={() => setSelected(item.id)} className="flex size-4 items-center justify-center"><span className={`block size-1.5 rounded-full ${position === index ? 'bg-primary' : 'bg-foreground/15'}`} /></button>)}</div> : null}
  </>}>
    <div ref={body} hidden={collapsed} className="max-h-[50vh] overflow-y-auto overscroll-contain" style={availableMaxHeight === undefined ? undefined : { maxHeight: Math.max(120, availableMaxHeight - 96) }}>
      {permission ? <section className="space-y-2 p-3"><p className="typography-ui font-medium">{t('chat.permissionRequest.required')} {permission.action}</p>{permission.message ? <SimpleMarkdownRenderer content={permission.message} enableFileReferences={false} /> : null}<div dir="ltr" className="whitespace-pre-wrap break-words font-mono typography-meta">{permission.resources.join('\n')}</div><div className="flex flex-wrap gap-2"><Button size="sm" disabled={!writable || !snapshot.capabilities.permissions} onClick={() => onAction('permission', { requestId: permission.id, decision: 'once' })}>{t('chat.permissionRequest.actions.once')}</Button>{permission.save?.length ? <Button size="sm" variant="outline" disabled={!writable || !snapshot.capabilities.permissions} onClick={() => onAction('permission', { requestId: permission.id, decision: 'always' })}>{t('chat.permissionRequest.actions.always')}</Button> : null}<Button size="sm" variant="outline" disabled={!writable || !snapshot.capabilities.permissions} onClick={() => onAction('permission', { requestId: permission.id, decision: 'reject' })}>{t('chat.permissionRequest.actions.reject')}</Button></div></section> : null}
      <div hidden={!!permission}>{forms.map((form, position) => <div key={form.id} hidden={position !== 0}><ConversationFormCard form={form} disabled={!writable || !snapshot.capabilities.forms} onReply={(answer) => onAction('form_reply', { formId: form.id, answer })} onCancel={() => onAction('form_cancel', { formId: form.id })} /></div>)}</div>
    </div>
  </ComposerFloatingPanel>;
}

function ConversationFormCard({ form, disabled, onReply, onCancel }: { form: ConversationForm; disabled: boolean; onReply: (answer: HerdrJsonValue) => void; onCancel: () => void }) {
  const { t } = useI18n();
  const [values, setValues] = React.useState<FormValues>(() => initialFormValues(form.fields, { acknowledgeExternal: true }));
  const [showErrors, setShowErrors] = React.useState(false);
  const fields = visibleFields(form.fields, values); const missing = missingRequiredKeys(form.fields, values);
  const submit = () => { setShowErrors(true); if (!missing.length && !disabled) onReply(buildFormAnswer(form.fields, values)); };
  return <form className="rounded-lg border border-border bg-surface-elevated p-3" onSubmit={(event) => { event.preventDefault(); submit(); }}><h3 className="mb-2 typography-ui font-medium" dir="auto">{form.title}</h3>{fields.map((field) => <FormFieldControl key={field.key} field={field} values={values} missing={missing} showErrors={showErrors} isResponding={disabled} updateValue={(key, patch) => setValues((previous) => ({ ...previous, [key]: { ...valueOf(previous, key), ...patch } }))} onTextKeyDown={(event) => { if (!isIMECompositionEvent(event) && event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); submit(); } }} />)}{showErrors && missing.length ? <p role="alert" className="typography-meta text-[var(--status-error-text)]">{t('chat.formCard.missingRequired')}</p> : null}<div className="mt-3 flex gap-2"><Button size="sm" type="submit" disabled={disabled}>{t('chat.formCard.submit')}</Button><Button size="sm" type="button" variant="outline" disabled={disabled} onClick={onCancel}>{t('chat.formCard.cancel')}</Button></div></form>;
}
