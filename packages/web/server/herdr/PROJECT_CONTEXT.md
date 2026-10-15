# Herdr project context

`project-context.js` adapts the existing `lib/project-context/runtime.js` for
OpenHerdr personal notes, todos and plans. It stores everything beneath
`<OpenHerdr stateDir>/project-context/`. It reads no OpenChamber project registry
or provider configuration and writes no files into the user's project.

## Ownership

`createHerdrProjectContext({ bridge, stateDir, resolveWorkspaceRoot? })` returns
`{ execute(request) }`. Every request names a saved machine and explicit pane.
The service reads the actual `session.snapshot` through the bridge, finds that
pane's workspace and chooses its project root on the server.

Native `workspace.worktree.repo_root` is authoritative. Linked worktrees share
the parent repository's notes, todos and personal plans. The pane's `cwd` and
`foreground_cwd` never select a context owner.

For ordinary workspaces, an optional trusted callback receives
`{ machine, workspaceId }` and returns a previously verified absolute root or
`null`. Its caller owns provenance and lifetime validation. A mapping captured
from a workspace creation must bind the configured Herdr session and the native
workspace lifetime, so recycled workspace IDs after a server restart cannot
inherit another project's registration. Persisting only `w1 -> /project` is
insufficient. A missing registration returns `409 project_root_unavailable`.
There is no registration UI or cwd-based fallback in this module.

Local roots must resolve to existing directories. Remote native roots come from
Herdr on the selected machine and are never resolved against this server's
filesystem. The context ID hashes `[machine, canonicalRoot]`; equal path strings
on different machines have different owners. Server identity is provided by the
separate OpenHerdr state directory.

## Requests and responses

`parseProjectContextRequest` validates the operation-specific request.
`isProjectContextMutation` identifies writes after parsing.

| Operation | Additional fields |
| --- | --- |
| `context.read` | None |
| `context.plan.read` | `planId` |
| `context.note.create` | `body` |
| `context.note.update` | `noteId`, `body` |
| `context.note.delete` | `noteId` |
| `context.todo.create` | `text` |
| `context.todo.update` | `todoId`, `text` and/or `completed` |
| `context.todo.delete` | `todoId` |
| `context.todo.reorder` | `todoIds`, an exact permutation of the existing IDs |
| `context.plan.create` | `title`, optional `body` |
| `context.plan.update` | `planId`, complete verbatim `raw` Markdown |
| `context.plan.delete` | `planId` |

Every operation also takes `{ machine, pane_id }`. Every mutation requires
`expectedOwner` and `expectedRevision` from a successful read. The response is
`{ owner: { id, machine, root, workspaceId, paneId }, revision,
context: { notes, todos, plans }, plan? }`. Plan reads and create/update responses
include `plan.raw`. Private storage paths never enter the response.

The revision hashes all context entries and personal plan bodies. Changes to an
unrelated entry also invalidate an older revision. Reads and writes serialize
per state directory and project owner across service instances within this
process. The OpenHerdr server owns the single runtime for a state directory;
this adapter is not a multiprocess filesystem lock. Owner resolution runs again
after waiting for the lock. A mismatched owner or revision returns a confirmed
no-effect `409` before writing.

The upstream runtime retains its atomic manifest writes and partial-plan
behavior. This adapter also atomically replaces personal Markdown files. A
failure after a committed write is an unknown mutation outcome for the owning
HTTP route and receipt mechanism. Malformed stored JSON is an error, not an
empty context. Missing referenced plan files also fail the read.

## Client

`ProjectContextPanel.tsx` uses the original `KnowledgeCard`,
`KnowledgeEntryView` and `NoteEditor` presentation without OpenCode state hooks.
The client validates owner, revision and operation results before confirming
delivery. Mutations use the shared authenticated transport and durable pending
request records. Those records contain request metadata, never note or plan
contents.

Saving is explicit. Drafts retain server, machine, project owner, entry ID and
the revision they opened against. Switching panes or machines preserves drafts;
another project never displays them. A late save preserves text typed after
dispatch. A conflict keeps the draft and requires an explicit refresh/discard
before adopting the saved version. Hiding the panel stops its reads.

This is available in the dedicated browser, hosted mobile and Capacitor
OpenHerdr client. The original Electron and VS Code OpenChamber entrypoints keep
their existing project-context owners and APIs.

## Validation

- `node --test packages/web/server/herdr/project-context.test.js` covers
  persistence/restart, all CRUD families, raw Markdown, native-worktree sharing,
  machine isolation, stale/concurrent saves, trusted-root absence, unavailable
  local roots, reorder integrity and malformed storage.
- `bun test packages/web/src/herdr/project-context-client.test.ts` covers target
  parsing, bearer requests, failed reads, single dispatch, unknown delivery,
  metadata-only pending storage and draft preservation.
- The coordinator owns HTTP authentication/receipt integration, combined static
  checks, builds and actual Android interactions. Unit and headless component
  checks do not establish Android runtime acceptance or ordinary-workspace
  registration.
