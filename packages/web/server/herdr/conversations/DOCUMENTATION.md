# Conversations

`service.js` owns structured OpenHerdr conversation identity, session ownership,
history, catalogs, actions and source events. `contracts.js` owns strict request
schemas and the parsed record boundaries. `runtime.js` owns SDK discovery and
the optional private OpenCode child. HTTP authentication, enterprise exposure
policy, receipts, routes and rendering belong to the parent modules.

The public contract, examples and runtime coverage are in
[`docs/openherdr/CONVERSATION_DRIVER.md`](../../../../../docs/openherdr/CONVERSATION_DRIVER.md).

Only real OpenCode 2 sessions are accepted. Native pane sessions remain
read-only. Writable sessions must have a matching private ownership record,
metadata marker and current authoritative Herdr target. Arbitrary client paths,
endpoint URLs and credential writes are absent. Failed reads throw; partial
session lists name failed entries and mark completeness explicitly.
Saved history uses journal ownership independently of a live pane. Writing
requires a current verified binding; moving that binding is an explicit rebind
operation with exact canonical directory and native-writer conflict checks.

`POST /api/herdr/conversations/registry` is an authenticated read with
`{request:{target,sessionId,kind}}`, where `kind` is `commands` or `skills`.
It needs no mutation request ID or receipt. The service verifies the selected
session, uses its registered or private coordinator, and reads only the pane's
canonical directory through the SDK's `location.directory`. It verifies the
pane identity again after the read. These lists are read on demand and are
absent from startup model/agent catalogs.

The response carries `protocol`, `target`, `sessionId`, `kind` and the matching
`commands` or `skills` array. Commands contain `name` and optional `description`.
Skills contain their native `id`, `name` and optional `description`. Skill paths,
content and unrelated upstream fields are excluded. Failed or malformed lists
remain errors; a successful empty array means the source listed no entries.

The `command` action accepts optional `files` and `delivery`, with the same
10-file and 12 MiB aggregate data-URI limits as a prompt. The service confirms
that the command name still exists in the session's directory before dispatch,
then maps `command` to native `name` and `arguments` to `text`. Missing arguments
remain an empty string. Command names accept native string characters, including
namespaces, slashes and Unicode, with a 4096-character bound. Membership in the
current source list authorizes dispatch. The native command result is void, so
the action result is `null`.

Prompts may include up to 10 unique native skill references as `skills:[{id}]`.
The service confirms each ID in the same source and directory before dispatch.
The full prompt text, attachments and delivery reach `session.prompt` unchanged,
and the response retains the source's inbox admission. Slash skills use this
prompt path; the separate explicit `skill` action keeps its original meaning.
Stale names or IDs fail before dispatch. No failed lookup or unknown mutation
is retried automatically. After a command or skill lookup, the service checks
again that no native pane has claimed the session before the final target check
and dispatch.

Web/PWA, hosted mobile and Capacitor use this same authenticated HTTP contract.
The upstream Electron and VS Code apps remain unchanged and have no dedicated
OpenHerdr registry integration.

Run focused tests with
`node --test packages/web/server/herdr/conversations/service.test.js`.
Lifecycle checks use
`node --test packages/web/server/herdr/conversations/runtime.test.js`.
The coordinator owns broader server, UI and Android validation.
