# BuddyScript (VS Code / Cursor)

Thin editor client for buddyscript (`.buddy` files): syntax highlighting plus an LSP client that starts `buddy lsp`.

The language server lives in the [buddy](https://github.com/virtualpeter/buddy) CLI (`buddy lsp`). This package does not embed that binary. On activate it uses `buddy.path`, then `buddy` on `PATH`, then downloads a GitHub Release from `virtualpeter/buddy` into extension storage.

## Package

```sh
make                 # npm install + vsce package → ./buddy-<git-tag>.vsix
make package PUBLISHER=otherorg   # optional alternate publisher id
make package VERSION=0.2.0        # override git tag
make compile         # esbuild only
make check           # tsc --noEmit
make clean
```

Default extension id: `virtualpete.buddy`.

## Install

```sh
cursor --install-extension buddy-0.2.0.vsix
# or: code --install-extension buddy-0.2.0.vsix
```

Or Command Palette → **Extensions: Install from VSIX…**

Open a `.buddy` file — the status bar language should show **BuddyScript**. Completions and diagnostics need a buddy CLI (`buddy lsp`).

## Buddy CLI

Resolution order:

1. `buddy.lsp.path` — full language-server command override
2. `buddy.path` — explicit executable
3. `buddy` on `PATH`
4. Latest (or `buddy.cli.version`) [buddy](https://github.com/virtualpeter/buddy) GitHub Release for this OS/arch, cached under the extension global storage

Command Palette → **Buddy: Download CLI** forces a re-download (and GitHub sign-in when the repo is private). `GITHUB_TOKEN` / `GH_TOKEN` also work.

Expected release asset names (bare binaries, not archives):

| Platform | Asset |
|----------|--------|
| macOS Apple silicon | `buddy-darwin-arm64` |
| macOS Intel | `buddy-darwin-amd64` |
| Linux x64 | `buddy-linux-amd64` |
| Linux arm64 | `buddy-linux-arm64` |
| Windows x64 | `buddy-windows-amd64.exe` |
| Windows arm64 | `buddy-windows-arm64.exe` |

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `buddy.path` | _(empty)_ | Path to the buddy executable; empty uses PATH then GitHub Releases |
| `buddy.cli.version` | `latest` | Release tag to download when managing the CLI |
| `buddy.lsp.path` | _(empty)_ | Override LSP command |
| `buddy.cellMode` | `false` | Notebook/`-e` dialect in the language server |
| `buddy.trace.server` | `off` | LSP client/server trace level |

## Development

```sh
npm install
npm run compile
```

Open this folder in VS Code or Cursor and press **F5** to launch an Extension Development Host.

Buddy LSP notes: [buddy docs/editor.md](https://github.com/virtualpeter/buddy/blob/main/docs/editor.md).
