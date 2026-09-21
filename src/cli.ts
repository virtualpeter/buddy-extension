import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";

const DECLINED_TAG_KEY = "buddy.declinedCliTag";

/** Well-known paths from the notarized macOS package. */
const MAC_PKG_INSTALL_PATHS = [
  "/usr/local/bin/buddy",
  "/Applications/Buddy.app/Contents/Helpers/buddy",
];

/** Fallback when `buddy.cli.repo` is empty or invalid. */
export const DEFAULT_CLI_REPO = "virtualpeter/buddy";

export type CliProvider = "github" | "gitlab";

export interface ReleaseSource {
  provider: CliProvider;
  /** Cache / log id, e.g. github.com/owner/name or git.example.com/group/proj */
  id: string;
  host: string;
  project: string;
  apiBase: string;
}

export function cliReleaseSource(): ReleaseSource {
  const config = vscode.workspace.getConfiguration("buddy");
  const raw = (config.get<string>("cli.repo") || "").trim() || DEFAULT_CLI_REPO;
  const hint = (config.get<string>("cli.provider") || "auto").trim().toLowerCase();
  const source = parseReleaseSource(raw, hint);
  if (!source) {
    throw new Error(
      `buddy.cli.repo must be owner/name or a GitHub/GitLab URL (got "${raw}"). Set buddy.cli.provider if the host is not obvious.`
    );
  }
  return source;
}

export function parseReleaseSource(raw: string, providerHint = "auto"): ReleaseSource | undefined {
  const trimmed = raw.trim().replace(/\/+$/, "").replace(/\.git$/i, "");
  if (!trimmed) {
    return undefined;
  }

  let host = "github.com";
  let project = "";
  if (/^https?:\/\//i.test(trimmed)) {
    let url: URL;
    try {
      url = new URL(trimmed);
    } catch {
      return undefined;
    }
    host = url.hostname.toLowerCase();
    project = url.pathname
      .replace(/^\//, "")
      .replace(/\/+$/, "")
      .replace(/\.git$/i, "")
      .replace(/\/(releases|tags|tree|blob)(\/.*)?$/i, "");
  } else if (/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.test(trimmed)) {
    project = trimmed;
  } else {
    return undefined;
  }
  if (!project || project.includes(" ")) {
    return undefined;
  }

  const provider = detectProvider(host, providerHint);
  if (!provider) {
    return undefined;
  }
  return {
    provider,
    id: `${host}/${project}`,
    host,
    project,
    apiBase: apiBaseFor(provider, host),
  };
}

function detectProvider(host: string, hint: string): CliProvider | undefined {
  if (hint === "github" || hint === "gitlab") {
    return hint;
  }
  if (host.includes("gitlab")) {
    return "gitlab";
  }
  if (host.includes("github") || host === "gist.github.com") {
    return "github";
  }
  if (host === "github.com" || host === "api.github.com") {
    return "github";
  }
  // owner/name shorthand already forced host github.com; unknown URL hosts need a hint.
  return host === "github.com" ? "github" : undefined;
}

function apiBaseFor(provider: CliProvider, host: string): string {
  if (provider === "gitlab") {
    return `https://${host}/api/v4`;
  }
  if (host === "github.com" || host === "api.github.com") {
    return "https://api.github.com";
  }
  return `https://${host}/api/v3`;
}

function cacheKey(source: ReleaseSource): string {
  return source.id.replace(/[^A-Za-z0-9._-]/g, "_");
}

const USER_AGENT = "virtualpete.buddy";
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const STATE_FILE = "cli-state.json";

export interface CliState {
  tag: string;
  /** Previous managed tag, kept on disk so only two copies accumulate. */
  previousTag?: string;
  asset: string;
  lastCheck: number;
}

interface ReleaseAsset {
  name: string;
  size: number;
  downloadUrl: string;
  /** GitHub private-asset API URL when a token is present. */
  apiDownloadUrl?: string;
}

interface Release {
  tag_name: string;
  assets: ReleaseAsset[];
}

export interface ResolveOptions {
  /** Re-download even if a cached binary exists. */
  force?: boolean;
  /** Prompt for GitHub sign-in when the repo is private. */
  interactiveAuth?: boolean;
}

export function targetTriple(): { os: string; arch: string; exe: string } | undefined {
  const os =
    process.platform === "darwin" ? "darwin" : process.platform === "linux" ? "linux" : process.platform === "win32" ? "windows" : undefined;
  const arch = process.arch === "arm64" ? "arm64" : process.arch === "x64" ? "amd64" : undefined;
  if (!os || !arch) {
    return undefined;
  }
  return { os, arch, exe: os === "windows" ? "buddy.exe" : "buddy" };
}

export function preferredAssetName(osName: string, arch: string): string {
  return osName === "windows" ? `buddy-${osName}-${arch}.exe` : `buddy-${osName}-${arch}`;
}

export function preferredPkgName(tag: string): string {
  return `buddy-${tag.replace(/^v/i, "")}.pkg`;
}

export function pickPkgAsset(assets: ReleaseAsset[], tag: string): ReleaseAsset | undefined {
  const preferred = preferredPkgName(tag);
  const exact = assets.find((a) => a.name === preferred);
  if (exact) {
    return exact;
  }
  return assets.find((a) => {
    const n = a.name.toLowerCase();
    return n.endsWith(".pkg") && !n.includes("sha256") && n.startsWith("buddy");
  });
}

export function pickReleaseAsset(assets: ReleaseAsset[], osName: string, arch: string): ReleaseAsset | undefined {
  const preferred = preferredAssetName(osName, arch);
  const exact = assets.find((a) => a.name === preferred);
  if (exact) {
    return exact;
  }
  return assets.find((a) => {
    const n = a.name.toLowerCase();
    if (n.includes("sha256") || n.endsWith(".sbom") || n.endsWith(".sig") || n.endsWith(".pem")) {
      return false;
    }
    if (n.endsWith(".tar.gz") || n.endsWith(".tgz") || n.endsWith(".zip") || n.endsWith(".pkg")) {
      return false;
    }
    const archOk = n.includes(arch) || (arch === "amd64" && (n.includes("x86_64") || n.includes("x64")));
    return n.includes(osName) && archOk;
  });
}

export function findOnPath(command: string): string | undefined {
  if (!command) {
    return undefined;
  }
  if (command.includes("/") || command.includes("\\")) {
    return fs.existsSync(command) ? command : undefined;
  }
  const dirs = (process.env.PATH || "").split(path.delimiter);
  const names = [command];
  if (process.platform === "win32" && !path.extname(command)) {
    for (const ext of (process.env.PATHEXT || ".EXE;.CMD;.BAT").split(";")) {
      names.push(command + ext);
    }
  }
  for (const dir of dirs) {
    if (!dir) {
      continue;
    }
    for (const name of names) {
      const candidate = path.join(dir, name);
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  }
  return undefined;
}

/** PATH, then the macOS package locations (`/usr/local/bin/buddy`, Buddy.app helper). */
export function findInstalledBuddy(): string | undefined {
  const onPath = findOnPath("buddy");
  if (onPath) {
    return onPath;
  }
  if (process.platform === "darwin") {
    for (const candidate of MAC_PKG_INSTALL_PATHS) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  }
  return undefined;
}

/**
 * Resolve the buddy executable: explicit `buddy.path`, then PATH / the macOS
 * package install, then a prompted release install (pkg on macOS, binary elsewhere).
 */
export async function resolveBuddyPath(
  context: vscode.ExtensionContext,
  log: vscode.OutputChannel,
  options: ResolveOptions = {}
): Promise<string | undefined> {
  const config = vscode.workspace.getConfiguration("buddy");
  const configured = (config.get<string>("path") || "").trim();

  if (configured) {
    const local = findOnPath(configured);
    if (local) {
      log.appendLine(`Using buddy.path: ${local}`);
      return local;
    }
    if (configured.includes("/") || configured.includes("\\") || configured !== "buddy") {
      void vscode.window.showErrorMessage(`Buddy CLI not found at "${configured}". Check buddy.path or run Buddy: Install CLI.`);
      return undefined;
    }
    log.appendLine("buddy.path is \"buddy\" but it is not on PATH; looking for a release install.");
  } else {
    const installed = findInstalledBuddy();
    if (installed && !options.force) {
      log.appendLine(`Using installed buddy: ${installed}`);
      return installed;
    }
  }

  try {
    const managed = await ensureManagedCli(context, log, options);
    if (managed) {
      log.appendLine(`Using managed buddy: ${managed}`);
    }
    return managed;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.appendLine(`CLI install failed: ${message}`);
    void vscode.window.showErrorMessage(`Could not install buddy from releases. ${message}`);
    return undefined;
  }
}

async function ensureManagedCli(
  context: vscode.ExtensionContext,
  log: vscode.OutputChannel,
  options: ResolveOptions
): Promise<string | undefined> {
  const triple = targetTriple();
  if (!triple) {
    throw new Error(`No buddy build for ${process.platform}-${process.arch}. Set buddy.path to a local binary.`);
  }

  const versionSetting = (vscode.workspace.getConfiguration("buddy").get<string>("cli.version") || "latest").trim() || "latest";
  const source = cliReleaseSource();
  const key = cacheKey(source);
  const storageRoot = context.globalStorageUri.fsPath;
  await fs.promises.mkdir(storageRoot, { recursive: true });

  const state = readState(storageRoot, key);
  const now = Date.now();
  const wantLatest = versionSetting === "latest";

  if (!options.force && state && managedBinaryExists(storageRoot, key, state.tag, triple.exe)) {
    const pinOk = !wantLatest && tagsMatch(state.tag, versionSetting);
    const latestFresh = wantLatest && now - state.lastCheck < CHECK_INTERVAL_MS;
    if (pinOk || latestFresh) {
      await pruneOldCli(storageRoot, key, [state.tag, state.previousTag], log);
      return managedBinaryPath(storageRoot, key, state.tag, triple.exe);
    }
  }

  const { release, token } = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Buddy",
      cancellable: false,
    },
    async (progress) => {
      progress.report({ message: "Checking buddy releases…" });
      return fetchRelease(source, versionSetting, options.interactiveAuth === true, log);
    }
  );

  const pkg = triple.os === "darwin" ? pickPkgAsset(release.assets, release.tag_name) : undefined;
  const binary = pickReleaseAsset(release.assets, triple.os, triple.arch);
  const chosen = pkg
    ? { asset: pkg, kind: "pkg" as const }
    : binary
      ? { asset: binary, kind: "binary" as const }
      : undefined;
  if (!chosen) {
    const names = release.assets.map((a) => a.name).join(", ") || "(none)";
    const wanted =
      triple.os === "darwin"
        ? `${preferredPkgName(release.tag_name)} or ${preferredAssetName(triple.os, triple.arch)}`
        : preferredAssetName(triple.os, triple.arch);
    throw new Error(`${source.id} ${release.tag_name} has no ${wanted} asset. Found: ${names}`);
  }

  if (chosen.kind === "binary") {
    const dest = managedBinaryPath(storageRoot, key, release.tag_name, triple.exe);
    if (!options.force && fs.existsSync(dest)) {
      const next = nextCliState(state, release.tag_name, chosen.asset.name, now);
      writeState(storageRoot, key, next);
      await pruneOldCli(storageRoot, key, [next.tag, next.previousTag], log);
      return dest;
    }
  }

  if (!options.force && context.globalState.get(DECLINED_TAG_KEY) === release.tag_name) {
    log.appendLine(`Skipping buddy ${release.tag_name} (previously declined)`);
    return undefined;
  }

  const approved = await confirmInstall(release.tag_name, chosen.asset, chosen.kind, pkg ? false : triple.os === "darwin");
  if (!approved) {
    await context.globalState.update(DECLINED_TAG_KEY, release.tag_name);
    log.appendLine(`User declined buddy ${release.tag_name}`);
    return undefined;
  }
  await context.globalState.update(DECLINED_TAG_KEY, undefined);

  if (chosen.kind === "pkg") {
    return installMacPkg(context, source, chosen.asset, release.tag_name, token, log);
  }

  const dest = managedBinaryPath(storageRoot, key, release.tag_name, triple.exe);
  const mb = chosen.asset.size > 0 ? `${(chosen.asset.size / (1024 * 1024)).toFixed(1)} MB` : "";
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Buddy",
      cancellable: false,
    },
    async (progress) => {
      progress.report({ message: `Downloading ${chosen.asset.name}${mb ? ` (${mb})` : ""}…` });
      log.appendLine(`Downloading ${chosen.asset.name} from ${source.id} ${release.tag_name}`);
      await downloadAsset(source, chosen.asset, dest, token);
    }
  );
  const next = nextCliState(state, release.tag_name, chosen.asset.name, now);
  writeState(storageRoot, key, next);
  await pruneOldCli(storageRoot, key, [next.tag, next.previousTag], log);
  log.appendLine(`Installed ${dest}`);
  return dest;
}

async function confirmInstall(
  tag: string,
  asset: ReleaseAsset,
  kind: "pkg" | "binary",
  darwinBinaryFallback: boolean
): Promise<boolean> {
  const mb = asset.size > 0 ? ` (${(asset.size / (1024 * 1024)).toFixed(1)} MB)` : "";
  const detail =
    kind === "pkg"
      ? `This downloads the macOS installer package ${asset.name}${mb} and opens it.`
      : darwinBinaryFallback
        ? `No installer package on this release; this downloads the ${asset.name} binary${mb} into extension storage.`
        : `This downloads ${asset.name}${mb} into extension storage.`;
  const choice = await vscode.window.showInformationMessage(
    `Install buddy ${tag}?`,
    { modal: true, detail },
    "Install"
  );
  return choice === "Install";
}

async function installMacPkg(
  context: vscode.ExtensionContext,
  source: ReleaseSource,
  asset: ReleaseAsset,
  tag: string,
  token: string | undefined,
  log: vscode.OutputChannel
): Promise<string | undefined> {
  const pkgPath = path.join(os.tmpdir(), asset.name.replace(/[^A-Za-z0-9._-]/g, "_"));
  const mb = asset.size > 0 ? `${(asset.size / (1024 * 1024)).toFixed(1)} MB` : "";
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Buddy",
      cancellable: false,
    },
    async (progress) => {
      progress.report({ message: `Downloading ${asset.name}${mb ? ` (${mb})` : ""}…` });
      log.appendLine(`Downloading ${asset.name} from ${source.id} ${tag}`);
      await downloadAsset(source, asset, pkgPath, token);
    }
  );
  log.appendLine(`Opening installer ${pkgPath}`);
  await vscode.env.openExternal(vscode.Uri.file(pkgPath));
  const reload = await vscode.window.showInformationMessage(
    `The buddy ${tag} installer is open. Reload the window after it finishes so the language server can start.`,
    "Reload Window",
    "Later"
  );
  const installed = findInstalledBuddy();
  if (installed) {
    log.appendLine(`Using buddy from package install: ${installed}`);
    return installed;
  }
  if (reload === "Reload Window") {
    await vscode.commands.executeCommand("workbench.action.reloadWindow");
  }
  return undefined;
}

function nextCliState(prev: CliState | undefined, tag: string, asset: string, lastCheck: number): CliState {
  const previousTag = prev && !tagsMatch(prev.tag, tag) ? prev.tag : prev?.previousTag;
  const state: CliState = { tag, asset, lastCheck };
  if (previousTag && !tagsMatch(previousTag, tag)) {
    state.previousTag = previousTag;
  }
  return state;
}

/** Keep the current and previous managed binaries; delete older tag folders. */
async function pruneOldCli(
  storageRoot: string,
  repo: string,
  keepTags: Array<string | undefined>,
  log: vscode.OutputChannel
): Promise<void> {
  const cliRoot = managedCliRoot(storageRoot, repo);
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(cliRoot, { withFileTypes: true });
  } catch {
    return;
  }
  const keep = new Set(keepTags.filter((t): t is string => !!t).map(sanitizeTag));
  for (const entry of entries) {
    if (!entry.isDirectory() || keep.has(entry.name)) {
      continue;
    }
    const dir = path.join(cliRoot, entry.name);
    try {
      await fs.promises.rm(dir, { recursive: true, force: true });
      log.appendLine(`Removed old buddy CLI ${dir}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.appendLine(`Could not remove ${dir}: ${message}`);
    }
  }
}

function managedCliRoot(storageRoot: string, key: string): string {
  return path.join(storageRoot, "cli", key);
}

function managedBinaryPath(storageRoot: string, repo: string, tag: string, exe: string): string {
  return path.join(managedCliRoot(storageRoot, repo), sanitizeTag(tag), exe);
}

function managedBinaryExists(storageRoot: string, repo: string, tag: string, exe: string): boolean {
  return fs.existsSync(managedBinaryPath(storageRoot, repo, tag, exe));
}

function sanitizeTag(tag: string): string {
  return tag.replace(/[^A-Za-z0-9._-]/g, "_");
}

function normalizeTag(tag: string): string {
  return tag.startsWith("v") ? tag : `v${tag}`;
}

function tagsMatch(a: string, b: string): boolean {
  return a === b || normalizeTag(a) === normalizeTag(b);
}

function statePath(storageRoot: string, repo: string): string {
  return path.join(managedCliRoot(storageRoot, repo), STATE_FILE);
}

function readState(storageRoot: string, repo: string): CliState | undefined {
  try {
    const raw = fs.readFileSync(statePath(storageRoot, repo), "utf8");
    const parsed = JSON.parse(raw) as CliState;
    if (parsed && typeof parsed.tag === "string" && typeof parsed.lastCheck === "number") {
      return parsed;
    }
  } catch {
    // missing or invalid
  }
  return undefined;
}

function writeState(storageRoot: string, repo: string, state: CliState): void {
  const dest = statePath(storageRoot, repo);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, JSON.stringify(state, null, 2) + "\n");
}

async function fetchRelease(
  source: ReleaseSource,
  version: string,
  interactiveAuth: boolean,
  log: vscode.OutputChannel
): Promise<{ release: Release; token?: string }> {
  const token = await releaseToken(source, interactiveAuth);
  const tryTags = version === "latest" ? ["latest"] : uniqueTags(version);
  let lastErr: Error | undefined;

  for (const tag of tryTags) {
    try {
      const release =
        source.provider === "gitlab"
          ? await fetchGitLabRelease(source, tag, token)
          : await fetchGitHubRelease(source, tag, token);
      return { release, token };
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      log.appendLine(lastErr.message);
    }
  }

  if (!token) {
    const hint =
      source.provider === "gitlab"
        ? "Set GITLAB_TOKEN or GL_TOKEN."
        : source.host === "github.com"
          ? "Sign in to GitHub (Buddy: Install CLI) or set GITHUB_TOKEN."
          : "Set GITHUB_TOKEN or GH_TOKEN for this GitHub Enterprise host.";
    throw new Error(`No release for ${source.id} (${version}). If the repo is private, ${hint} ${lastErr?.message ?? ""}`.trim());
  }
  throw lastErr ?? new Error(`No release for ${source.id} (${version})`);
}

async function fetchGitHubRelease(source: ReleaseSource, tag: string, token?: string): Promise<Release> {
  const url =
    tag === "latest"
      ? `${source.apiBase}/repos/${source.project}/releases/latest`
      : `${source.apiBase}/repos/${source.project}/releases/tags/${encodeURIComponent(tag)}`;
  const raw = await apiJson<{
    tag_name: string;
    assets: Array<{ id: number; name: string; size: number; browser_download_url: string }>;
  }>(url, source, token);
  return {
    tag_name: raw.tag_name,
    assets: (raw.assets || []).map((a) => ({
      name: a.name,
      size: a.size,
      downloadUrl: a.browser_download_url,
      apiDownloadUrl: `${source.apiBase}/repos/${source.project}/releases/assets/${a.id}`,
    })),
  };
}

async function fetchGitLabRelease(source: ReleaseSource, tag: string, token?: string): Promise<Release> {
  const project = encodeURIComponent(source.project);
  const url =
    tag === "latest"
      ? `${source.apiBase}/projects/${project}/releases/permalink/latest`
      : `${source.apiBase}/projects/${project}/releases/${encodeURIComponent(tag)}`;
  try {
    return gitlabReleaseFromJson(await apiJson<GitLabReleaseJson>(url, source, token));
  } catch (err) {
    if (tag !== "latest") {
      throw err;
    }
    const list = await apiJson<GitLabReleaseJson[]>(`${source.apiBase}/projects/${project}/releases`, source, token);
    if (!Array.isArray(list) || list.length === 0) {
      throw err;
    }
    return gitlabReleaseFromJson(list[0]);
  }
}

interface GitLabReleaseJson {
  tag_name: string;
  assets?: { links?: Array<{ name?: string; url?: string; direct_asset_url?: string }>; sources?: unknown[] };
}

function gitlabReleaseFromJson(raw: GitLabReleaseJson): Release {
  const links = raw.assets?.links || [];
  return {
    tag_name: raw.tag_name,
    assets: links
      .map((link) => ({
        name: (link.name || "").trim(),
        size: 0,
        downloadUrl: (link.direct_asset_url || link.url || "").trim(),
      }))
      .filter((a) => a.name && a.downloadUrl),
  };
}

function uniqueTags(version: string): string[] {
  const tags = [version];
  if (version.startsWith("v")) {
    tags.push(version.slice(1));
  } else {
    tags.push(`v${version}`);
  }
  return [...new Set(tags)];
}

async function releaseToken(source: ReleaseSource, interactive: boolean): Promise<string | undefined> {
  if (source.provider === "gitlab") {
    return process.env.GITLAB_TOKEN || process.env.GL_TOKEN || process.env.PRIVATE_TOKEN;
  }
  const env = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || process.env.GHE_TOKEN;
  if (env) {
    return env;
  }
  if (source.host !== "github.com") {
    return undefined;
  }
  try {
    const session = await vscode.authentication.getSession(
      "github",
      ["repo"],
      interactive ? { createIfNone: true } : { silent: true }
    );
    return session?.accessToken;
  } catch {
    return undefined;
  }
}

function apiHeaders(source: ReleaseSource, token?: string, download = false): Record<string, string> {
  const headers: Record<string, string> = { "User-Agent": USER_AGENT };
  if (source.provider === "gitlab") {
    headers.Accept = download ? "application/octet-stream" : "application/json";
    if (token) {
      headers["PRIVATE-TOKEN"] = token;
    }
    return headers;
  }
  headers.Accept = download ? "application/octet-stream" : "application/vnd.github+json";
  if (!download) {
    headers["X-GitHub-Api-Version"] = "2022-11-28";
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

async function apiJson<T>(url: string, source: ReleaseSource, token?: string): Promise<T> {
  const res = await fetch(url, { headers: apiHeaders(source, token) });
  if (!res.ok) {
    const body = (await res.text()).slice(0, 240);
    throw new Error(`${source.provider} ${res.status} ${url}: ${body}`);
  }
  return (await res.json()) as T;
}

async function downloadAsset(
  source: ReleaseSource,
  asset: ReleaseAsset,
  dest: string,
  token?: string
): Promise<void> {
  const url = token && asset.apiDownloadUrl ? asset.apiDownloadUrl : asset.downloadUrl;
  const headers = apiHeaders(source, token, true);

  const res = await fetch(url, { headers, redirect: "follow" });
  if (!res.ok) {
    throw new Error(`Download failed (${res.status}) for ${asset.name}`);
  }

  await fs.promises.mkdir(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.download`;
  try {
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 16) {
      throw new Error(`Downloaded ${asset.name} is empty or truncated`);
    }
    await fs.promises.writeFile(tmp, buf);
    await fs.promises.chmod(tmp, 0o755);
    await fs.promises.rename(tmp, dest);
  } catch (err) {
    await fs.promises.unlink(tmp).catch(() => undefined);
    throw err;
  }
}
