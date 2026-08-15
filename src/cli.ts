import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

/** GitHub repo that publishes buddy CLI release assets. */
export const CLI_REPO = "virtualpeter/buddy";

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

interface GitHubAsset {
  id: number;
  name: string;
  size: number;
  browser_download_url: string;
}

interface GitHubRelease {
  tag_name: string;
  assets: GitHubAsset[];
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

export function preferredAssetName(os: string, arch: string): string {
  return os === "windows" ? `buddy-${os}-${arch}.exe` : `buddy-${os}-${arch}`;
}

export function pickReleaseAsset(assets: GitHubAsset[], os: string, arch: string): GitHubAsset | undefined {
  const preferred = preferredAssetName(os, arch);
  const exact = assets.find((a) => a.name === preferred);
  if (exact) {
    return exact;
  }
  return assets.find((a) => {
    const n = a.name.toLowerCase();
    if (n.includes("sha256") || n.endsWith(".sbom") || n.endsWith(".sig") || n.endsWith(".pem")) {
      return false;
    }
    if (n.endsWith(".tar.gz") || n.endsWith(".tgz") || n.endsWith(".zip")) {
      return false;
    }
    const archOk = n.includes(arch) || (arch === "amd64" && (n.includes("x86_64") || n.includes("x64")));
    return n.includes(os) && archOk;
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

/**
 * Resolve the buddy executable: explicit `buddy.path`, then PATH, then a
 * GitHub Release downloaded into extension global storage.
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
      void vscode.window.showErrorMessage(`Buddy CLI not found at "${configured}". Check buddy.path or run Buddy: Download CLI.`);
      return undefined;
    }
    log.appendLine("buddy.path is \"buddy\" but it is not on PATH; trying GitHub Releases.");
  } else {
    const onPath = findOnPath("buddy");
    if (onPath && !options.force) {
      log.appendLine(`Using buddy on PATH: ${onPath}`);
      return onPath;
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
    log.appendLine(`GitHub CLI install failed: ${message}`);
    void vscode.window.showErrorMessage(`Could not install buddy from GitHub Releases. ${message}`);
    return undefined;
  }
}

async function ensureManagedCli(
  context: vscode.ExtensionContext,
  log: vscode.OutputChannel,
  options: ResolveOptions
): Promise<string> {
  const triple = targetTriple();
  if (!triple) {
    throw new Error(`No buddy build for ${process.platform}-${process.arch}. Set buddy.path to a local binary.`);
  }

  const versionSetting = (vscode.workspace.getConfiguration("buddy").get<string>("cli.version") || "latest").trim() || "latest";
  const storageRoot = context.globalStorageUri.fsPath;
  await fs.promises.mkdir(storageRoot, { recursive: true });

  const state = readState(storageRoot);
  const now = Date.now();
  const wantLatest = versionSetting === "latest";

  if (!options.force && state && managedBinaryExists(storageRoot, state.tag, triple.exe)) {
    const pinOk = !wantLatest && tagsMatch(state.tag, versionSetting);
    const latestFresh = wantLatest && now - state.lastCheck < CHECK_INTERVAL_MS;
    if (pinOk || latestFresh) {
      await pruneOldCli(storageRoot, [state.tag, state.previousTag], log);
      return managedBinaryPath(storageRoot, state.tag, triple.exe);
    }
  }

  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Buddy",
      cancellable: false,
    },
    async (progress) => {
      progress.report({ message: "Fetching buddy CLI release…" });
      const { release, token } = await fetchRelease(versionSetting, options.interactiveAuth === true, log);
      const asset = pickReleaseAsset(release.assets, triple.os, triple.arch);
      if (!asset) {
        const names = release.assets.map((a) => a.name).join(", ") || "(none)";
        throw new Error(
          `${CLI_REPO} ${release.tag_name} has no ${preferredAssetName(triple.os, triple.arch)} asset. Found: ${names}`
        );
      }

      const dest = managedBinaryPath(storageRoot, release.tag_name, triple.exe);
      if (!options.force && fs.existsSync(dest)) {
        const next = nextCliState(state, release.tag_name, asset.name, now);
        writeState(storageRoot, next);
        await pruneOldCli(storageRoot, [next.tag, next.previousTag], log);
        return dest;
      }

      const mb = asset.size > 0 ? `${(asset.size / (1024 * 1024)).toFixed(1)} MB` : "";
      progress.report({ message: `Downloading ${asset.name}${mb ? ` (${mb})` : ""}…` });
      log.appendLine(`Downloading ${asset.name} from ${CLI_REPO} ${release.tag_name}`);
      await downloadAsset(asset, dest, token);
      const next = nextCliState(state, release.tag_name, asset.name, now);
      writeState(storageRoot, next);
      await pruneOldCli(storageRoot, [next.tag, next.previousTag], log);
      log.appendLine(`Installed ${dest}`);
      return dest;
    }
  );
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
  keepTags: Array<string | undefined>,
  log: vscode.OutputChannel
): Promise<void> {
  const cliRoot = path.join(storageRoot, "cli");
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

function managedBinaryPath(storageRoot: string, tag: string, exe: string): string {
  return path.join(storageRoot, "cli", sanitizeTag(tag), exe);
}

function managedBinaryExists(storageRoot: string, tag: string, exe: string): boolean {
  return fs.existsSync(managedBinaryPath(storageRoot, tag, exe));
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

function statePath(storageRoot: string): string {
  return path.join(storageRoot, STATE_FILE);
}

function readState(storageRoot: string): CliState | undefined {
  try {
    const raw = fs.readFileSync(statePath(storageRoot), "utf8");
    const parsed = JSON.parse(raw) as CliState;
    if (parsed && typeof parsed.tag === "string" && typeof parsed.lastCheck === "number") {
      return parsed;
    }
  } catch {
    // missing or invalid
  }
  return undefined;
}

function writeState(storageRoot: string, state: CliState): void {
  fs.writeFileSync(statePath(storageRoot), JSON.stringify(state, null, 2) + "\n");
}

async function fetchRelease(
  version: string,
  interactiveAuth: boolean,
  log: vscode.OutputChannel
): Promise<{ release: GitHubRelease; token?: string }> {
  const token = await githubToken(interactiveAuth);
  const tryTags = version === "latest" ? ["latest"] : uniqueTags(version);
  let lastErr: Error | undefined;

  for (const tag of tryTags) {
    const url =
      tag === "latest"
        ? `https://api.github.com/repos/${CLI_REPO}/releases/latest`
        : `https://api.github.com/repos/${CLI_REPO}/releases/tags/${encodeURIComponent(tag)}`;
    try {
      const release = await githubJson<GitHubRelease>(url, token);
      return { release, token };
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      log.appendLine(lastErr.message);
    }
  }

  if (!token) {
    throw new Error(
      `No GitHub release for ${CLI_REPO} (${version}). If the repo is private, sign in to GitHub (Buddy: Download CLI) or set GITHUB_TOKEN. ${lastErr?.message ?? ""}`.trim()
    );
  }
  throw lastErr ?? new Error(`No GitHub release for ${CLI_REPO} (${version})`);
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

async function githubToken(interactive: boolean): Promise<string | undefined> {
  const env = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (env) {
    return env;
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

async function githubJson<T>(url: string, token?: string): Promise<T> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": USER_AGENT,
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const body = (await res.text()).slice(0, 240);
    throw new Error(`GitHub ${res.status} ${url}: ${body}`);
  }
  return (await res.json()) as T;
}

async function downloadAsset(asset: GitHubAsset, dest: string, token?: string): Promise<void> {
  const url = token
    ? `https://api.github.com/repos/${CLI_REPO}/releases/assets/${asset.id}`
    : asset.browser_download_url;
  const headers: Record<string, string> = {
    "User-Agent": USER_AGENT,
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
    headers.Accept = "application/octet-stream";
  }

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
