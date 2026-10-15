# OpenHerdr conversation driver

`packages/web/server/herdr/conversations/service.js` exports the asynchronous
`createConversationService({ bridge, stateDir, opencodeBinary? })` factory. The
service accepts domain requests. The HTTP owner supplies bearer authentication,
enterprise exposure policy, origin checks, abort signals and durable mutation
receipts. No browser request supplies an OpenCode URL, provider configuration,
SSH command, absolute file path or credentials.

## Target and API

Every operation receives a target. Resolve a pane before creating a session or
changing one. Preserve the returned target exactly through selection and send.

```js
const source = await service.resolve({ target: { machine: 'local', paneId: 'w1:p1' }, signal });
const created = await service.create({ target: source.target, title: 'New conversation', signal });
const sent = await service.act({
  target: source.target,
  sessionId: created.session.id,
  action: 'prompt',
  input: { text: 'Explain this project', delivery: 'queue' },
  signal,
});
```

The resolved target has `{ machine, paneId, expectedAgentSession, identity }`.
`expectedAgentSession` preserves Herdr's real `{source,agent,kind,value}` or
`null`. `identity` hashes the authoritative machine, pane, terminal,
workspace, tab, canonical cwd, agent and native reference. Terminal revisions
are excluded because output changes them. Every call reads `pane.get` and
checks this identity again before returning. Mutations check it immediately
before dispatch too. A changed native reference or cwd returns a 409 without
sending input. A target change after dispatch leaves an unknown outcome.

Request schemas are exported from `conversations/contracts.js`:

| Export | Additional fields beside `target` |
| --- | --- |
| `conversationResolveRequest` | none |
| `conversationListRequest` | `cursor?`, `limit?` from 1 to 100 |
| `conversationReadRequest` | `sessionId`, `cursor?`, `limit?` |
| `conversationCatalogRequest` | none |
| `conversationRegistryRequest` | `sessionId`, `kind:'commands'|'skills'` |
| `conversationCreateRequest` | `title?` |
| `conversationActionRequest` | `sessionId`, `action`, `input` |
| `conversationEventsRequest` | `sessionId` |

Saved conversations have separate operations that remain usable after their
Herdr pane closes. `historyList({machine:'local',cursor?,limit?,signal?})` uses
`conversationHistoryListRequest`. It returns
`{protocol,conversations,complete,failures,cursor}`. Each item contains the real
`session`, `history:{machine,sessionId,directory,lastPaneId?}`, `access:'read-only'`,
`needsBinding:true` and read-only capabilities. Session IDs come only from the
private ownership journal. Clients cannot supply a directory to select history.

`historyRead({sessionId,cursor?,limit?,signal?})` uses
`conversationHistoryReadRequest` and returns
`{protocol,history,session,messages,permissions:null,forms:null,activity:null,
access:'read-only',needsBinding:true,capabilities,pendingState}`. The null fields
mean live approvals/activity were not requested, and must stay unknown in the
UI. History reads verify the saved source kind, directory and ownership marker.
They do not depend on a surviving pane or silently start a registered source
for records that belong to a private coordinator.

`rebind({target,sessionId,signal?})` uses `conversationRebindRequest` and is an
explicit mutation. Resolve the intended live pane first. Its canonical root
must exactly equal the saved directory, the ownership marker must still match,
and no pane in the authoritative Herdr snapshot may report the session as its
native OpenCode agent. A successful rebind fsyncs the new pane identity and
returns the same shape as `create`. The old pane binding loses control.

The service also accepts `signal` beside these serialized fields. Schemas
reject unknown fields. Root routes can parse their envelope and pass `signal`
separately. `ApiError` uses the existing `{status,code,message}` convention.
`confirmedNoEffect` is true for failures before SDK mutation dispatch. Once a
mutation dispatch starts, failure retains an unknown outcome and is never
automatically retried.

## Responses

All successful responses name `protocol: 'opencode-v2'` and the selected target.
The upstream session/message/event records retain their actual IDs and fields.
No usage, timestamps, providers, reasoning or tool results are synthesized.

`resolve` returns `{protocol,target,directory,native,nativeAccess,capabilities}`.
A proven native OpenCode ID also returns `session`. Native access is
`read-only`, `unavailable` or `path-reader-pending`. A terminal-only pane can
still create a separate OpenHerdr conversation. Missing native evidence does
not become an empty successful native transcript.

`list` returns the native session and sessions created for this exact target:

```json
{
  "protocol": "opencode-v2",
  "target": {"machine":"local","paneId":"w1:p1","expectedAgentSession":null,"identity":"<sha256>"},
  "sessions": [{"session":{"id":"<actual OpenCode ID>","location":{"directory":"<pane cwd>"}},"access":"owned","capabilities":{"prompt":true}}],
  "complete": true,
  "failures": [],
  "cursor": {"next":null}
}
```

The example abbreviates actual session and capability fields. A failed item
appears in `failures` and sets `complete:false`; other sessions remain
available. Consumers preserve unresolved entries on partial lists. The list
cursor is the last returned session ID in this target's creation order.

`read` returns
`{protocol,target,session,messages,permissions,forms,activity,access,capabilities}`.
`messages` is OpenCode's `{data,cursor:{previous?,next?}}`, newest page first.
Pass its upstream cursor unchanged to load another page. Permissions and forms
come from the selected session. Their empty arrays are returned only after
successful authoritative reads. `activity` is the matching live active record
or `null` after a successful global active read.

`catalog` returns `{protocol,target,models,agents,authoritative:false,completeness}`.
The models retain IDs, variants, capabilities, costs and limits. Provider
headers, model headers/body/settings and agent request/system/permissions are
excluded. `authoritative:false` identifies the known OpenCode cold-agent
catalog behavior. Read it again when the same location announces a catalog
event. No provider configuration is written.

`registry` returns `{protocol,target,sessionId,kind,commands}` or
`{protocol,target,sessionId,kind,skills}`. The authenticated HTTP read is
`POST /api/herdr/conversations/registry` with the usual `{request}` envelope.
Commands expose native `name` and optional `description`. Skills expose native
`id`, `name` and optional `description`; their paths and contents are excluded.
The read uses the selected session's registered or private coordinator and its
verified directory, then checks the target again before returning. A failed or
malformed lookup throws. It never becomes a successful empty registry.

Load this registry only when opening the slash or skills picker, classifying a
slash submission, or validating selected skill mentions before sending.
OpenCode's directory-scoped command read can initialize that
directory's MCP servers, so it is excluded from the initial model/agent catalog.

`create` returns `{protocol,target,session,access:'owned',capabilities}`.
`act` returns `{protocol,target,sessionId,action,result}`. The prompt result is
the real OpenCode inbox item. It confirms enqueue, while live execution and
assistant messages establish completion. Void operations return `result:null`.

## Actions and attachments

| `action` | `input` |
| --- | --- |
| `prompt` | `{text,files?:[{uri,name}],delivery?:'steer'|'queue',skills?:[{id}]}` |
| `abort` | `{}` |
| `rename` | `{title}` |
| `delete` | `{}` |
| `model` | `{id,providerID,variant?}` from the current catalog |
| `agent` | `{agent}` naming a visible primary agent |
| `permission` | `{requestId,decision:'once'|'always'|'reject',message?}` |
| `form_reply` | `{formId,answer}` matching the genuine form fields |
| `form_cancel` | `{formId}` |
| `fork` | `{messageId?}`; an optional ID selects the upstream `before` boundary |
| `revert_stage` | `{messageId}` |
| `revert_clear`, `revert_commit`, `compact` | `{}` |
| `command` | `{command,arguments?,files?:[{uri,name}],delivery?:'steer'|'queue',skills?:[{id}]}` |
| `skill` | `{skill}` |

Permissions and forms must still be pending in the same session. OpenCode
validates form answers. Model and agent selection changes only the selected
owned session. It does not change global defaults or configure providers.

Slash submission follows the original order. A current command-name match sends
one `command` action. Otherwise a successful skill-name lookup sends one prompt
with the full `/skill arguments` text and its real skill ID. Only successful
nonmatches from both registries allow an ordinary prompt. A required lookup
failure retains the draft and sends nothing. The independent `skill` action
does not replace a skill attached to a prompt.

Command names accept native strings up to 4096 characters and must still exist
in the current registry before dispatch. Prompts and commands accept at most
10 unique skill IDs and check them against the same directory's current
registry. Both paths preserve attachments and delivery. After these awaited
lookups, the service rechecks whether another Herdr pane owns the session, then
verifies the selected target immediately before dispatch.

A command with skills follows the shared OpenChamber command sender. The
service uses the validated IDs' real skill names to build the same instruction
as `buildSkillMentionInstruction`, then sends it through
`session.synthetic({sessionID,text,delivery,resume:false})`. It rechecks native
writers and the target after that admission before sending the original
arguments, files and delivery through `session.command`. The client supplies
only native skill IDs; arbitrary skill names and synthetic context are refused.
Commands without skills issue no skill lookup or synthetic write. Prompts keep
their direct native skill attachments and real inbox result.

All command and skill list validation completes before the first mutation.
Dispatch tracking starts before synthetic context is sent. That instruction
can remain in session history if a later check or command fails, so every error
after synthetic dispatch retains an unknown mutation receipt, including a later
confirmed command refusal. No synthetic context is deleted or replayed, and no
command is retried automatically. Inspect the receipt and actual session before
choosing another operation.

Attachments use the official prompt `files` data URI protocol. Accepted MIME
types are `text/plain`, PNG, JPEG, GIF, WebP and PDF. Names cannot contain path
separators. There are at most 10 attachments and at most 12 MiB of encoded
content across the request. Browser-supplied `file://`, HTTP URLs and absolute
paths are refused. Android file preparation and selected-model modality
warnings remain with the owning composer. Host uploads can be delivered as
inline data after an authenticated confined read. File upload alone does not
prove provider ingestion.

## Live changes

`service.events({target,sessionId,signal})` is an async iterable. The route
streams each yielded JSON object using its authenticated fetch transport.

```json
{"protocol":"opencode-v2","type":"conversation.resync","target":{},"sessionId":"<actual ID>"}
{"protocol":"opencode-v2","type":"conversation.event","target":{},"sessionId":"<actual ID>","event":{"id":"<upstream event ID>","type":"session.text.delta","data":{"sessionID":"<actual ID>","assistantMessageID":"<actual message ID>","ordinal":0,"delta":"Hello"}}}
```

The example abbreviates the repeated target. `conversation.resync` requires an
authoritative `read`; reconnecting does not replay transient deltas. The v2
global stream includes real text/reasoning/tool transitions, permissions,
forms, session activity and same-directory catalog changes. Events for other
sessions and directories are discarded. Duplicate upstream event IDs are
discarded within a bounded 2048-ID window. Ordering follows the upstream
stream. Every emitted source event revalidates the pane. Disconnect and
service close abort the upstream subscription. There is no automatic reconnect
or prompt retry inside the service.

OpenCode 2 text and reasoning content has a message ID plus an `ordinal`;
those parts have no upstream part ID. Tool content has its real tool `id`.
The original OpenChamber projection can derive UI row keys using the same
message/ordinal mechanism. UI-derived keys must not be labeled native part IDs.

## Coordinator ownership and lifecycle

The driver uses the SDK's read-only `Service.discover` to locate a healthy
OpenCode 2 coordinator. The SDK checks the registered PID against `/api/info`.
The existing OpenChamber compatibility check requires 2.0.20 or newer within
major version 2. Older and future-major coordinators are explicitly refused,
and this driver never upgrades them.
The adapter additionally requires an HTTP numeric loopback URL. Existing
native sessions require Herdr's authoritative OpenCode agent and `kind:'id'`
reference, plus a matching real session location. Their mutations are refused.
Native path references are never opened.

New sessions are separate from existing Herdr CLI sessions and receive an
unpredictable ownership marker in OpenCode metadata. A private append-only
`stateDir/conversations/sessions.jsonl` journal records session ID, target
identity, canonical directory, runtime kind and ownership marker. It stores no
prompt or credentials. Each new ownership record is fsynced before success.
The service checks the marker and directory on every action. It also reads the
authoritative Herdr snapshot before a mutation. If any pane reports that same
session as its native OpenCode agent, the service refuses control. Saved
ownership survives pane changes; a live control binding is temporary.

If no registered coordinator is available when creating a session, the driver
starts its own `opencode serve --hostname 127.0.0.1 --port 0` child with an
ephemeral server password. The administrator's pinned `opencodeBinary` takes
precedence over the server option or PATH. Startup output supplies the actual port and
`/api/info` must report the owned child PID. Its working directory is
`stateDir/conversations/runtime`. It does not start, stop, upgrade or replace
the user's service and never writes provider configuration. Created sessions
continue to use OpenCode's actual session storage and configured providers.

Private records automatically restore their coordinator on an explicit history
read or subsequent operation. A child exit invalidates its endpoint. A failed
turn is never replayed when a later request restores the coordinator.

`close()` aborts this service's active operations/subscriptions, waits for its
ownership writes, closes its journal, and terminates only its own private child
if one exists. It does not stop a discovered service or a Herdr agent. Session
records remain on disk. A later service instance reloads the ownership journal
and verifies each record against OpenCode before granting control.
Shutdown recognizes both exit codes and signals. An unresponsive owned child
gets SIGKILL after 2 seconds, and a missing exit confirmation returns an error
after a further second.

## Runtime coverage

| Runtime | Behavior |
| --- | --- |
| Web | Root's authenticated OpenHerdr routes consume this driver |
| Hosted mobile | Same routes through the selected HTTPS transport |
| Capacitor Android/iOS | Same header-authenticated HTTP stream contract |
| Electron | Original entrypoint remains unchanged; separate OpenHerdr app can use the driver |
| VS Code | Original entrypoint remains unchanged; OpenHerdr adapter integration is pending |

The driver adds no public listener, relay, telemetry or provider-entry route.
Its optional coordinator binds only loopback. The root server owns remote
exposure policy. Remote-machine conversation drivers, native Codex/Claude
readers, provider settings, MCP/plugin configuration and archive persistence
remain separate work. These limits do not establish complete Android parity.

## Verification

The focused `service.test.js` cases cover actual SDK request serialization,
native read-only enforcement, stale identity before/after dispatch, no retries
after unknown prompt delivery, skill-command synthetic ordering and partial
failures, native takeover during registry reads or synthetic admission,
credential stripping, pending form/permission
ownership, private cold recovery, partial lists, persisted deletion, saved
history and explicit rebind, event isolation/deduplication, strict attachments
and endpoint refusal. `runtime.test.js` covers signal termination, bounded
shutdown, explicit private recovery without turn replay, administrator binary
pinning and incompatible-version rejection.

The 2026-10-15 Mac fixture used the installed OpenCode 2.0.27 with client
2.0.28, a private loopback child and a fixture authority bridge. Actual create,
rename, history, model catalog and idle abort succeeded. One previously
authorized short prompt produced the actual requested assistant text and real
`session.text.delta` events. Subsequent checks used no model prompts. They
restored the saved private session without creating another one, read its
messages, created and replied to a real form, then created an `ask` permission
on that owned fixture session and replied `once`. The private children stopped.
Receipts are `.tmp/conversation-driver-live/receipt.json` and
`.tmp/conversation-driver-live/recovery-receipt.json`.

The live fixture did not prove Herdr pane association, HTTP root authentication,
Android rendering, physical-phone use, remote sources or model attachment
ingestion. Existing user OpenCode pane discovery showed no `agent_session`, so
its native transcript was deliberately not associated using its title or cwd.
