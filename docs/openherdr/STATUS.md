# OpenHerdr status

## Current state

Implementation in progress. Original request and decisions are in `OPENHERDR.md`.

- Upstream cloned, MIT license retained; branch `openherdr/main` starts at `c5b690df9`.
- Frozen dependencies installed successfully with local Bun 1.3.14 and Node 25.8.2.
- Herdr installed 0.9.3, schema private protocol 22. Native plugin commands exist.
- Independent architecture review recommends a dedicated Herdr entrypoint and reused UI/auth primitives. Full upstream application stays intact.
- Dot notified through MCP; its agreement and cloud dispatch are pending.
- No feature is currently accepted as implemented or remotely verified.

## Active ownership

- Main: CLI/plugin lifecycle, transport integration, application packaging, actual local/remote verification, Git integration.
- Backend worker: pending assignment.
- UI worker: pending assignment, coordination with dot pending.
- Architect: read-only architecture review in progress.

## Next

Implement server and responsive client against the recorded API contract, integrate a real Herdr workflow plugin, then run an isolated session to verify actual input and output. Record feature support and unresolved gaps explicitly.
