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

Run focused tests with
`node --test packages/web/server/herdr/conversations/service.test.js`.
Lifecycle checks use
`node --test packages/web/server/herdr/conversations/runtime.test.js`.
The coordinator owns broader server, UI and Android validation.
