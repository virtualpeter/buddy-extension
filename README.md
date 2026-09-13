# BuddyScript (VS Code / Cursor)

<img src="images/buddy.png" alt="buddy" width="128" height="128">

Thin editor client for buddyscript (`.buddy` files): syntax highlighting plus an LSP client that starts `buddy lsp`.

The language server lives in the [buddy](https://github.com/virtualpeter/buddy) CLI (`buddy lsp`). This package does not embed that binary. On activate it uses `buddy.path`, then `buddy` on `PATH`, then downloads a GitHub Release from `virtualpeter/buddy` into extension storage.

## Package

```sh
make                 # npm install + vsce package → ./buddy-<git-tag>.vsix
make package PUBLISHER=otherorg   # optional alternate publisher id
make package VERSION=0.2.0        # override git tag
make package CLI_REPO=other/buddy # default release source (owner/name or URL)
make package CLI_REPO=https://git.example.com/org/buddy CLI_PROVIDER=gitlab
make compile         # esbuild only
make check           # tsc --noEmit
make clean
```

Default extension id: `virtualpete.buddy`.

## Install

Download `buddy-<version>.vsix` from [Releases](https://github.com/virtualpeter/buddy-extension/releases), then:

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
4. Latest (or `buddy.cli.version`) release from `buddy.cli.repo` (github.com `owner/name`, GitHub Enterprise URL, or GitLab URL) for this OS/arch, cached under the extension global storage

Command Palette → **Buddy: Download CLI** forces a re-download. Private github.com repos can use GitHub sign-in or `GITHUB_TOKEN`. GitHub Enterprise uses `GITHUB_TOKEN` / `GH_TOKEN` / `GHE_TOKEN`. GitLab uses `GITLAB_TOKEN` / `GL_TOKEN`. If the host name is not obviously GitHub or GitLab, set `buddy.cli.provider`.

In Cursor, **Buddy: Register MCP in Cursor** runs `buddy mcp setup` with that resolved binary and writes `~/.cursor/mcp.json`. `buddy.mcp.setup` is `off` (default), `prompt`, or `on`. VS Code ignores this.

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
| `buddy.cli.repo` | `virtualpeter/buddy` | `owner/name` or GitHub/GitLab URL; `CLI_REPO=` at package time sets the VSIX default |
| `buddy.cli.provider` | `auto` | `auto` / `github` / `gitlab` when the host is ambiguous; `CLI_PROVIDER=` at package time |
| `buddy.mcp.setup` | `off` | Cursor only: `off` / `prompt` / `on` to register `buddy mcp` |
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

## License

[MIT](LICENSE) © 2026 Peter Viertel.

## Release

Push a version tag. GitHub Actions runs `make package` and attaches `buddy-<version>.vsix` to the GitHub Release.

```sh
git tag v0.2.0
git push origin v0.2.0
```
