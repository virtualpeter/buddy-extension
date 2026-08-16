# Agent guide: buddy-extension

VS Code / Cursor extension for **`.buddy`** files (BuddyScript). This repo is a **thin LSP client + TextMate grammar**. It does not embed the buddy binary and does not implement completions, diagnostics, or hover.

Language features come from **`buddy lsp`** in the sibling CLI repo: [`../buddy`](../buddy) ([docs/editor.md](https://github.com/virtualpeter/buddy/blob/main/docs/editor.md)). The client resolves that binary from `buddy.path`, `PATH`, or a GitHub Release on `virtualpeter/buddy` (`src/cli.ts`).

## Layout

| Path | Role |
|------|------|
| `src/extension.ts` | Activate: resolve buddy, start `buddy lsp` (or `buddy.lsp.path`) over stdio |
| `src/cli.ts` | PATH / `buddy.path` / GitHub Releases install into global storage |
| `src/mcp.ts` | Cursor-only: `buddy mcp setup` into `~/.cursor/mcp.json` |
| `syntaxes/buddy.tmLanguage.json` | TextMate grammar |
| `language-configuration.json` | Comments, brackets, etc. |
| `scripts/esbuild.js` | Bundle → `out/extension.js` |
| `scripts/package.js` | `vsce package`; version from git tag; `PUBLISHER` / `VERSION` / `CLI_REPO` override |
| `Makefile` | `make` / `package` / `compile` / `check` / `clean` |
| `.github/workflows/release.yml` | On `v*` tag: package VSIX and attach to the GitHub Release |

## Build

```sh
make                 # npm install + VSIX → ./buddy-*.vsix
make package PUBLISHER=otherorg CLI_REPO=other/buddy
make compile         # esbuild only
make check           # tsc --noEmit
```

Default extension id: `virtualpete.buddy`. VSIX version is the git tag (`v0.2.0` → `buddy-0.2.0.vsix`), or `VERSION=`. Install: `cursor --install-extension buddy-<version>.vsix`.

## Rules

- Do **not** reimplement LSP features here. Change `buddy lsp` in `../buddy/internal/lsp` (then `make buddy` in that repo).
- Settings: `buddy.path` (empty → PATH, then releases), `buddy.cli.version` (`latest` or a tag), `buddy.cli.repo` (`owner/name` or GitHub/GitLab URL; `CLI_REPO=` at package time), `buddy.cli.provider` (`auto` / `github` / `gitlab`; `CLI_PROVIDER=`), `buddy.lsp.path` (full command override), `buddy.mcp.setup` (`off` / `prompt` / `on`, Cursor only), `buddy.cellMode` (passed as `initializationOptions.cellMode`), `buddy.trace.server`.
- MCP: call the resolved CLI (`buddy -y mcp setup --write --create --path ~/.cursor/mcp.json`). Do not merge `mcp.json` here.
- Release assets on `virtualpeter/buddy` must be bare binaries named `buddy-{os}-{arch}[.exe]` (`darwin`/`linux`/`windows` × `amd64`/`arm64`).
- Keep the client thin. Grammar updates only when `.buddy` syntax changes.
- No Jamf/tenant/auth work in this repo.
- Publisher/repo URLs: `virtualpete` / `virtualpeter/buddy-extension`. Do not put org-specific tenant names in docs.
