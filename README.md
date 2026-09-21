# BuddyScript (VS Code / Cursor)

<img src="images/buddy.png" alt="buddy" width="128" height="128">

Language support for **BuddyScript** (`.buddy` files): syntax highlighting, completions, hover, and diagnostics.

Completions and diagnostics come from the [buddy](https://github.com/virtualpeter/buddy) CLI (`buddy lsp`). This extension is the editor client; it does not embed that binary.

## Use

Open a `.buddy` file. The status bar language should show **BuddyScript**.

Language features need a working `buddy` on this machine.

- **macOS:** install the notarized package from [buddy releases](https://github.com/virtualpeter/buddy/releases) (`buddy-<version>.pkg`). That puts Buddy.app in `/Applications` and `buddy` at `/usr/local/bin/buddy`.
- **Linux and Windows:** use the release binary for your OS, or put `buddy` on `PATH`.

If buddy is not found, the extension asks before installing a release (it shows the version). On macOS that opens the `.pkg`; elsewhere it downloads the platform binary.

**Buddy: Install CLI** in the Command Palette offers that again. Set `buddy.path` if you keep the binary somewhere else.

## Cursor MCP

In Cursor, **Buddy: Register MCP in Cursor** writes `buddy mcp` into `~/.cursor/mcp.json` using the same CLI the editor found, then offers a window reload.

`buddy.mcp.setup` can be `off` (default), `prompt`, or `on`. VS Code ignores this.

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `buddy.path` | _(empty)_ | Path to the buddy executable |
| `buddy.mcp.setup` | `off` | Cursor: register `buddy mcp` (`off` / `prompt` / `on`) |
| `buddy.cellMode` | `false` | Notebook / `-e` dialect in the language server |
| `buddy.cli.version` | `latest` | Release tag to offer when buddy is not installed |
| `buddy.cli.repo` | `virtualpeter/buddy` | `owner/name` or GitHub/GitLab URL for CLI releases |
| `buddy.trace.server` | `off` | LSP client/server trace |

Buddy LSP notes: [buddy docs/editor.md](https://github.com/virtualpeter/buddy/blob/main/docs/editor.md).

## License

[MIT](LICENSE) © 2026 Peter Viertel.
