import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Icon } from '@/components/icon/Icon';
import { KnowledgeCard } from '@/components/session/project-context/KnowledgeCard';
import { KnowledgeEntryView } from '@/components/session/project-context/KnowledgeEntryView';
import { NoteEditor } from '@/components/session/project-context/NoteEditor';
import { splitNoteTitle, formatKnowledgeDate } from '@/components/session/project-context/knowledgeFormat';
import { useI18n } from '@/lib/i18n';
import { HerdrTransport, TransportError, clearPendingDelivery, loadPendingDelivery, type PendingDelivery } from './transport';
import { isConfirmedHostRefusal, targetKey } from './host-client';
import { ProjectContextClient, projectDraftKey, projectDraftMutation, confirmProjectDraft, type ProjectContext, type ProjectContextMutation, type ProjectEntryDraft, type ProjectEntryKind } from './project-context-client';
import { useProjectContextText } from './project-context.i18n';
import { useHerdrText } from './herdr.i18n';

type Props = { transport: HerdrTransport; machine: string; paneId: string; active?: boolean; disabled?: boolean; mutationBlocked?: boolean; onPendingDelivery?: (record: PendingDelivery | null) => void };
type Entry = { kind: ProjectEntryKind; id: string; title: string };
type Choice = { owner: string; entry: Entry };
type Section = 'notes' | 'todos' | 'plans';
const noBlur = () => {};

export function ProjectContextPanel({ transport, machine, paneId, active = true, disabled = false, mutationBlocked = false, onPendingDelivery }: Props) {
  const { t } = useI18n();
  const text = useProjectContextText();
  const h = useHerdrText();
  const client = useMemo(() => new ProjectContextClient(transport, { machine, pane_id: paneId }), [transport, machine, paneId]);
  const target = targetKey(transport.connection.server, client.target);
  const [contexts, setContexts] = useState(new Map<string, ProjectContext>());
  const data = contexts.get(target);
  const projectKey = data ? JSON.stringify([transport.connection.server, data.owner.machine, data.owner.id]) : null;
  const [section, setSection] = useState<Section>('notes');
  const [choice, setChoice] = useState<Choice | null>(null);
  const [drafts, setDrafts] = useState(new Map<string, ProjectEntryDraft>());
  const draftRef = useRef(drafts);
  draftRef.current = drafts;
  const [addDrafts, setAddDrafts] = useState(new Map<string, string>());
  const addKey = JSON.stringify([target, projectKey, section]);
  const addText = addDrafts.get(addKey) ?? '';
  const [failure, setFailure] = useState<{ target: string; error: Error } | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [readyTarget, setReadyTarget] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<{ target: string; kind: 'delete'; entry: Entry } | { target: string; kind: 'reload' } | null>(null);
  const current = useRef({ target, disabled, active, mutationBlocked, section });
  current.current = { target, disabled, active, mutationBlocked, section };
  const readSequence = useRef(0);
  const readAbort = useRef<AbortController | null>(null);
  const openSequence = useRef(0);
  const running = useRef(false);
  const blocked = disabled || mutationBlocked || busy || !active || !paneId || readyTarget !== target;
  const selected = projectKey && choice?.owner === projectKey ? choice.entry : null;
  const selectedDraftKey = data && selected ? projectDraftKey({ server: transport.connection.server, owner: data.owner, kind: selected.kind, id: selected.id }) : null;
  const draft = selectedDraftKey ? drafts.get(selectedDraftKey) : undefined;

  useEffect(() => {
    if (!active || disabled || !paneId) return;
    const controller = new AbortController();
    readAbort.current = controller;
    const sequence = ++readSequence.current;
    setLoading(target);
    setReadyTarget(null);
    void client.read(controller.signal).then((value) => {
      if (controller.signal.aborted || readSequence.current !== sequence) return;
      setContexts((previous) => new Map(previous).set(target, value));
      setFailure(null);
      setReadyTarget(target);
    }).catch((error: Error) => {
      if (!controller.signal.aborted && readSequence.current === sequence) setFailure({ target, error });
    }).finally(() => {
      if (readSequence.current === sequence) setLoading(null);
    });
    return () => controller.abort();
  }, [client, target, active, disabled, paneId, refresh]);

  const execute = useCallback(async (request: ProjectContextMutation): Promise<ProjectContext | null> => {
    if (running.current || current.current.target !== target || current.current.disabled || !current.current.active || current.current.mutationBlocked) return null;
    running.current = true;
    readAbort.current?.abort();
    ++readSequence.current;
    setLoading(null);
    setBusy(true);
    setFailure(null);
    try {
      const { record, outcome } = await client.mutate(request);
      if (outcome.kind === 'pending') {
        onPendingDelivery?.(outcome.record);
        throw new TransportError('OUTCOME_UNKNOWN', 'outcomeUnknown', true, outcome.record.requestId);
      }
      if (!await clearPendingDelivery(record.server, record.requestId)) throw new TransportError('DELIVERY_STORAGE', 'deliveryStorage', false, record.requestId);
      onPendingDelivery?.(await loadPendingDelivery(record.server));
      if (current.current.target === target) {
        readAbort.current?.abort();
        ++readSequence.current;
        setLoading(null);
        setReadyTarget(target);
      }
      setContexts((previous) => new Map(previous).set(target, outcome.value));
      return outcome.value;
    } catch (error) {
      const problem = error instanceof Error ? error : new Error(String(error));
      setFailure({ target, error: problem });
      try {
        const pending = await loadPendingDelivery(client.transport.connection.server);
        if (pending) {
          onPendingDelivery?.(pending);
          if (isConfirmedHostRefusal(problem) && pending.requestId === problem.requestId && await clearPendingDelivery(pending.server, pending.requestId)) onPendingDelivery?.(await loadPendingDelivery(pending.server));
        }
      } catch { setFailure({ target, error: new TransportError('DELIVERY_STORAGE', 'deliveryStorage') }); }
      return null;
    } finally { running.current = false; setBusy(false); }
  }, [client, target, onPendingDelivery]);

  const openEntry = async (entry: Entry) => {
    if (!data || !projectKey) return;
    const capturedTarget = target;
    const sequence = ++openSequence.current;
    const readVersion = readSequence.current;
    const savedKey = projectDraftKey({ server: transport.connection.server, owner: data.owner, kind: entry.kind, id: entry.id });
    const existing = draftRef.current.get(savedKey);
    if (existing && existing.text !== existing.baseText) { setChoice({ owner: projectKey, entry }); return; }
    try {
      const source = entry.kind === 'plan' ? await client.readPlan(entry.id, data.owner.id) : data;
      if (current.current.target !== capturedTarget || current.current.section !== section || openSequence.current !== sequence || readSequence.current !== readVersion) return;
      const value = entry.kind === 'note' ? source.context.notes.find((item) => item.id === entry.id)?.body : entry.kind === 'todo' ? source.context.todos.find((item) => item.id === entry.id)?.text : source.plan?.raw;
      if (value === undefined) throw new Error('project_entry_missing');
      setContexts((previous) => new Map(previous).set(target, source));
      setDrafts((previous) => new Map(previous).set(savedKey, { server: transport.connection.server, owner: source.owner, revision: source.revision, kind: entry.kind, id: entry.id, text: value, baseText: value }));
      setChoice({ owner: projectKey, entry });
    } catch (error) { setFailure({ target, error: error instanceof Error ? error : new Error(String(error)) }); }
  };

  const saveDraft = async () => {
    if (!draft || !data || blocked) return;
    const sent = draft;
    const key = projectDraftKey(sent);
    const request = projectDraftMutation(sent, transport.connection.server, data.owner, blocked);
    const response = await execute(request);
    if (response) setDrafts((previous) => {
      const latest = previous.get(key);
      return latest ? new Map(previous).set(key, confirmProjectDraft(latest, sent, response)) : previous;
    });
  };

  const pins = data ? { expectedOwner: data.owner.id, expectedRevision: data.revision } : null;
  const add = async () => {
    if (!pins || !projectKey || blocked || !addText.trim()) return;
    const value = addText.trim();
    const response = await execute(section === 'notes' ? { ...pins, operation: 'context.note.create', body: value } : section === 'todos' ? { ...pins, operation: 'context.todo.create', text: value } : { ...pins, operation: 'context.plan.create', title: value, body: '' });
    if (!response) return;
    setAddDrafts((previous) => previous.get(addKey)?.trim() === value ? new Map(previous).set(addKey, '') : previous);
    if (section === 'plans' && response.plan && current.current.target === target) {
      const saved = response.plan;
      const entry: Entry = { kind: 'plan', id: saved.id, title: saved.title };
      const created: ProjectEntryDraft = { server: transport.connection.server, owner: response.owner, revision: response.revision, kind: 'plan', id: saved.id, text: saved.raw, baseText: saved.raw };
      setDrafts((previous) => new Map(previous).set(projectDraftKey(created), created));
      setChoice({ owner: projectKey ?? '', entry });
    }
  };

  const remove = async (entry: Entry) => {
    if (!pins || blocked) return;
    const response = await execute(entry.kind === 'note' ? { ...pins, operation: 'context.note.delete', noteId: entry.id } : entry.kind === 'todo' ? { ...pins, operation: 'context.todo.delete', todoId: entry.id } : { ...pins, operation: 'context.plan.delete', planId: entry.id });
    if (response && data) {
      const key = projectDraftKey({ server: transport.connection.server, owner: data.owner, kind: entry.kind, id: entry.id });
      setDrafts((previous) => { const next = new Map(previous); next.delete(key); return next; });
      setChoice((previous) => previous?.owner === projectKey && previous.entry.id === entry.id ? null : previous);
    }
  };

  const requestReload = () => {
    const dirty = Array.from(drafts.values()).some((entry) => entry.server === transport.connection.server && entry.owner.id === data?.owner.id && entry.text !== entry.baseText);
    if (dirty) setConfirm({ target, kind: 'reload' });
    else setRefresh((value) => value + 1);
  };
  const reload = () => {
    setDrafts((previous) => new Map(Array.from(previous).filter(([, entry]) => entry.server !== transport.connection.server || entry.owner.id !== data?.owner.id)));
    setChoice(null);
    setRefresh((value) => value + 1);
  };
  const reorder = (id: string, direction: number) => {
    if (!data || !pins || blocked) return;
    const ids = data.context.todos.map((entry) => entry.id);
    const index = ids.indexOf(id);
    const next = index + direction;
    if (index < 0 || next < 0 || next >= ids.length) return;
    [ids[index], ids[next]] = [ids[next], ids[index]];
    void execute({ ...pins, operation: 'context.todo.reorder', todoIds: ids });
  };

  const error = failure?.target === target ? failure.error : null;
  const errorText = error instanceof TransportError && error.uncertain ? h('hostUnknown') : error instanceof TransportError && error.code === 'DELIVERY_STORAGE' ? h('deliveryStorage') : error instanceof TransportError && error.code === 'project_root_unavailable' ? text('rootUnavailable') : error instanceof TransportError && ['project_context_changed', 'project_todos_changed'].includes(error.code) ? text('changed') : error instanceof TransportError && error.code === 'project_owner_changed' ? text('ownerChanged') : text('failed');
  const sections = [
    { id: 'notes', label: t('rightSidebar.contextNotesTodo.tabs.notes'), count: data?.context.notes.length ?? 0 },
    { id: 'todos', label: t('rightSidebar.contextNotesTodo.tabs.todos'), count: data?.context.todos.length ?? 0 },
    { id: 'plans', label: t('rightSidebar.contextNotesTodo.tabs.plans'), count: data?.context.plans.length ?? 0 },
  ] satisfies { id: Section; label: string; count: number }[];
  const placeholder = section === 'notes' ? t('rightSidebar.contextNotesTodo.notes.placeholder') : section === 'todos' ? t('rightSidebar.contextNotesTodo.todo.inputPlaceholder') : t('rightSidebar.contextNotesTodo.plan.defaultTitle');
  const addLabel = section === 'notes' ? t('rightSidebar.contextNotesTodo.notes.addAria') : section === 'todos' ? t('rightSidebar.contextNotesTodo.todo.addAria') : t('chat.messageBody.actions.saveAsPlan');
  const deleteAction = (entry: Entry) => <Button variant="ghost" size="sm" disabled={blocked} onClick={() => setConfirm({ target, kind: 'delete', entry })} aria-label={t('filesView.dialog.delete.title')}><Icon name="delete-bin" className="size-4" /></Button>;

  return <section className="flex h-full min-h-0 flex-col gap-3 p-3" aria-label={t('rightSidebar.contextNotesTodo.sections.label')}>
    <div className="flex flex-wrap items-center gap-1" role="group" aria-label={t('rightSidebar.contextNotesTodo.sections.label')}>
      {sections.map((item) => <Button key={item.id} size="sm" variant="chip" aria-pressed={section === item.id} onClick={() => { ++openSequence.current; setSection(item.id); setChoice(null); }}>{item.label} {item.count}</Button>)}
      <Button className="ms-auto" variant="ghost" size="sm" disabled={busy || loading === target || disabled || !paneId} onClick={requestReload} aria-label={t('sidebarFilesTree.actions.refreshTitle')}><Icon name="refresh" className="size-4" /></Button>
    </div>
    {data ? <p className="truncate typography-micro text-muted-foreground" dir="ltr" title={data.owner.root}>{data.owner.machine} · {data.owner.root}</p> : null}
    {error ? <p role="alert" className="typography-meta text-[var(--status-error-text)]">{errorText}</p> : null}
    {loading === target ? <p role="status" className="typography-meta text-muted-foreground">{t('common.loading')}</p> : null}
    {draft ? <KnowledgeEntryView backLabel={t('onboarding.common.actions.back')} meta={<span className="typography-ui-label" dir="auto">{selected?.title}</span>} onClose={() => { ++openSequence.current; setChoice(null); }} actions={<>
      {draft.text !== draft.baseText ? <span className="typography-micro text-muted-foreground">{t('filesView.unsaved.title')}</span> : null}
      <Button size="sm" disabled={blocked || draft.text === draft.baseText || (draft.kind !== 'plan' && !draft.text.trim())} onClick={() => void saveDraft()}>{t('inlineComment.actions.save')}</Button>
      {selected ? deleteAction(selected) : null}
    </>}><NoteEditor key={selectedDraftKey} value={draft.text} maxLength={draft.kind === 'note' ? 3000 : draft.kind === 'todo' ? 1000 : 200000} ariaLabel={selected?.title ?? placeholder} onBlur={noBlur} onChange={(value) => {
      const key = projectDraftKey(draft);
      setDrafts((previous) => { const current = previous.get(key); return current ? new Map(previous).set(key, { ...current, text: value }) : previous; });
    }} /></KnowledgeEntryView> : <div className="min-h-0 flex-1 overflow-y-auto space-y-3">
      <div className="flex items-end gap-2">
        {section === 'notes' ? <Textarea simple disabled={!projectKey} value={addText} rows={2} maxLength={3000} placeholder={placeholder} aria-label={placeholder} onChange={(event) => setAddDrafts((previous) => new Map(previous).set(addKey, event.target.value))} /> : <Input disabled={!projectKey} value={addText} maxLength={section === 'todos' ? 1000 : 160} placeholder={placeholder} aria-label={placeholder} onChange={(event) => setAddDrafts((previous) => new Map(previous).set(addKey, event.target.value))} onKeyDown={(event) => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); void add(); } }} />}
        <Button size="sm" disabled={blocked || !addText.trim()} onClick={() => void add()} aria-label={addLabel}><Icon name="add" className="size-4" /></Button>
      </div>
      {section === 'notes' ? <ul className="space-y-2">{data?.context.notes.map((note) => {
        const { title, rest } = splitNoteTitle(note.body);
        const entry: Entry = { kind: 'note', id: note.id, title };
        return <KnowledgeCard key={note.id} entryId={note.id} label={title} onOpen={() => void openEntry(entry)} header={<span className="truncate typography-ui-label" dir="auto">{title}</span>} actions={deleteAction(entry)} footer={<span className="typography-micro text-muted-foreground">{formatKnowledgeDate(note.updatedAt)}</span>}><p className="line-clamp-2 typography-meta text-muted-foreground" dir="auto">{rest}</p></KnowledgeCard>;
      })}</ul> : null}
      {section === 'todos' ? <ul className="space-y-2">{data?.context.todos.map((todo, index) => {
        const entry: Entry = { kind: 'todo', id: todo.id, title: todo.text };
        return <li key={todo.id} className="flex items-center gap-2 rounded-lg border border-border p-2">
          <Checkbox checked={todo.completed} disabled={blocked} ariaLabel={t('rightSidebar.contextNotesTodo.todo.actions.markComplete', { text: todo.text })} onChange={(completed) => { if (pins) void execute({ ...pins, operation: 'context.todo.update', todoId: todo.id, completed }); }} />
          <Button variant="ghost" size="sm" className={`min-w-0 flex-1 justify-start whitespace-normal text-start ${todo.completed ? 'line-through text-muted-foreground' : ''}`} onClick={() => void openEntry(entry)}><span dir="auto">{todo.text}</span></Button>
          <Button variant="ghost" size="sm" disabled={blocked || index === 0} aria-label={t('mobile.sessions.moveUpAria', { label: todo.text })} onClick={() => reorder(todo.id, -1)}><Icon name="arrow-up-s" className="size-4" /></Button>
          <Button variant="ghost" size="sm" disabled={blocked || index === (data.context.todos.length - 1)} aria-label={t('mobile.sessions.moveDownAria', { label: todo.text })} onClick={() => reorder(todo.id, 1)}><Icon name="arrow-down-s" className="size-4" /></Button>
          {deleteAction(entry)}
        </li>;
      })}</ul> : null}
      {section === 'plans' ? <ul className="space-y-2">{data?.context.plans.map((plan) => {
        const entry: Entry = { kind: 'plan', id: plan.id, title: plan.title };
        return <KnowledgeCard key={plan.id} entryId={plan.id} label={plan.title} onOpen={() => void openEntry(entry)} header={<span className="truncate typography-ui-label" dir="auto">{plan.title}</span>} actions={deleteAction(entry)} footer={<span className="typography-micro text-muted-foreground">{formatKnowledgeDate(plan.createdAt)}</span>} />;
      })}</ul> : null}
    </div>}
    <Dialog open={confirm?.target === target} onOpenChange={(open) => { if (!open) setConfirm(null); }}>
      <DialogContent><DialogHeader><DialogTitle>{confirm?.kind === 'delete' ? t('filesView.dialog.delete.title') : t('filesView.unsaved.title')}</DialogTitle><DialogDescription>{confirm?.kind === 'delete' ? t('filesView.dialog.delete.description', { name: confirm.entry.title }) : t('filesView.unsaved.description')}</DialogDescription></DialogHeader>
        <DialogFooter><Button variant="outline" onClick={() => setConfirm(null)}>{t('dialog.common.actions.cancel')}</Button><Button variant="destructive" disabled={blocked} onClick={() => { const action = confirm; setConfirm(null); if (action?.target !== target) return; if (action.kind === 'delete') void remove(action.entry); else reload(); }}>{confirm?.kind === 'delete' ? t('filesView.dialog.delete.confirm') : t('filesView.unsaved.discard')}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </section>;
}
