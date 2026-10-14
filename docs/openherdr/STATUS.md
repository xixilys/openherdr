# OpenHerdr status

## Current state

The first working OpenHerdr implementation is present. Original request and
decisions are in `OPENHERDR.md`; usage and feature coverage are in `README.md`.

- Upstream cloned, MIT license retained; branch `openherdr/main` starts at `c5b690df9`.
- Dedicated authenticated server, responsive UI, PWA assets and native Herdr
  workflow plugin are implemented. The upstream application remains intact.
- Actual local HTTP and phone-sized browser input/output passed in an owned test
  session. Files opened through the rendered UI. Closing its selected pane kept
  the draft and disabled sending; choosing a sibling manually restored control.
- Cloudflare public HTTPS health, unauthenticated rejection, authenticated input,
  output and a full terminal frame passed. The test command executed once.
- Saved WSL SSH profile input/read passed with multiline text and quotes. Native
  revision/truncation fields survived. The corrected remote observer returned an
  actual 60x20 full terminal frame. Owned remote workspaces were closed.
- Final web assets built. iOS Simulator and Android debug builds succeeded.
  The final iOS app was installed and launched in the owned iPhone 17 Pro iOS 27
  simulator. The connection screen and safe area were visually checked.
- Independent review covered target selection, uncertain mutation delivery,
  SSH quoting/session compatibility, observer cleanup and CLI shutdown.
- Final focused checks passed: 31 server/bridge/content tests and 13 client
  transport tests. `bun run check:changed` passed type-check, lint, dead-code and
  the anti-slop comparison. The final web and both native builds succeeded.
- Dot received MCP delivery callbacks, but no substantive agreement or cloud
  dispatch reply has arrived. Callback acceptance is not an agreement.

## Active ownership

- Main owns integration, final checks, Git iteration and the user-facing app.
- Backend/UI/native implementation tasks have returned their bounded work.
- Architect supplied independent targeted reviews. Dot coordination is pending.

## Next

The integrated implementation is committed on `openherdr/main`. The owned
default bridge is running on `http://127.0.0.1:4318`; port 4310 belongs to QQ and
was preserved. Its current Quick Tunnel is
`https://adjusted-republican-golden-literature.trycloudflare.com`. Final default
session HTTPS input/read and full-frame observation passed, and the test client
was revoked. `openherdr connect --qr` creates a fresh device pairing.

The symlinked `openherdr` command was exercised directly, including version,
status and import without CLI side effects. Validation details are saved in
`validation.json`. Deliver a source snapshot to dot for independent cloud review.

Physical-phone input/output, Android runtime, native credential write/relaunch
and install-to-home-screen behavior have not been exercised. Remote files/Git
and provider-independent OpenCode chat features are unsupported as detailed in
the feature table. Complete upstream feature parity is not established.
