# OpenHerdr workflow plugin

Build the OpenHerdr web app before linking the plugin. The actions use this checkout's CLI and reuse the session socket provided by Herdr.

```sh
bun run build:herdr
herdr plugin link /absolute/path/to/openherdr/plugins/openherdr
herdr plugin action invoke start --plugin openherdr
herdr plugin pane open --plugin openherdr --entrypoint connect --placement overlay
```

`start` creates an OpenHerdr bridge and its own Cloudflare Quick Tunnel. The `connect` action opens an overlay pane that displays the one-time pairing QR code. Pairing secrets stay out of action stdout logs. A link expires after 10 minutes and redeems once. The bridge requires authentication for all workspace and terminal data, even on localhost.

`stop` stops only OpenHerdr and its tunnel. It preserves Herdr, its workspaces and running agents. `herdr plugin unlink openherdr` removes the plugin link.

The bridge uses one Herdr session per running instance. Use separate `--state-dir` and `--port` values from the CLI when several sessions need simultaneous mobile access. Saved SSH machines are selected inside the app.

The Start action keeps the Quick Tunnel default. To configure a fixed HTTPS
origin, use the explicit managed-mode CLI instructions in
[the connection guide](../../docs/openherdr/README.md#fixed-cloudflare-origin).
The plugin does not discover or copy Cloudflare credentials. Connect, status
and stop address the existing bridge; changing a running tunnel's mode requires
an explicit lifecycle operation through the CLI.
