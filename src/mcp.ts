import { execFile } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";

const execFileAsync = promisify(execFile);

export function isCursor(): boolean {
  const scheme = (vscode.env.uriScheme || "").toLowerCase();
  if (scheme === "cursor") {
    return true;
  }
  if (scheme === "vscode" || scheme === "vscode-insiders") {
    return false;
  }
  return /cursor/i.test(vscode.env.appName || "");
}

export function cursorUserMcpPath(): string {
  return path.join(os.homedir(), ".cursor", "mcp.json");
}

function configuredBuddyCommand(mcpPath: string): string | undefined {
  try {
    const raw = JSON.parse(fs.readFileSync(mcpPath, "utf8")) as {
      mcpServers?: { buddy?: { command?: unknown } };
    };
    const cmd = raw.mcpServers?.buddy?.command;
    return typeof cmd === "string" && cmd.trim() ? cmd.trim() : undefined;
  } catch {
    return undefined;
  }
}

function sameBuddyPath(configured: string, resolved: string): boolean {
  return path.normalize(path.resolve(configured)) === path.normalize(path.resolve(resolved));
}

/** Write ~/.cursor/mcp.json via `buddy mcp setup` (CLI owns the merge). */
export async function registerCursorMcp(buddyPath: string, log: vscode.OutputChannel): Promise<boolean> {
  const dest = cursorUserMcpPath();
  const args = ["-y", "mcp", "setup", "--write", "--create", "--path", dest];
  log.appendLine(`Running ${buddyPath} ${args.join(" ")}`);
  try {
    const { stdout, stderr } = await execFileAsync(buddyPath, args, { timeout: 30_000 });
    if (stdout) {
      log.appendLine(stdout.trimEnd());
    }
    if (stderr) {
      log.appendLine(stderr.trimEnd());
    }
  } catch (err) {
    const execErr = err as { message?: string; stdout?: string; stderr?: string };
    if (execErr.stdout) {
      log.appendLine(execErr.stdout.trimEnd());
    }
    if (execErr.stderr) {
      log.appendLine(execErr.stderr.trimEnd());
    }
    const message = execErr.message || String(err);
    log.appendLine(`buddy mcp setup failed: ${message}`);
    void vscode.window.showErrorMessage(`Could not register buddy MCP. ${message}`);
    return false;
  }

  const choice = await vscode.window.showInformationMessage(
    `Buddy MCP registered in ${dest}. Reload the window so Cursor picks it up.`,
    "Reload Window",
    "Later"
  );
  if (choice === "Reload Window") {
    await vscode.commands.executeCommand("workbench.action.reloadWindow");
  }
  return true;
}

export async function maybeSetupCursorMcp(buddyPath: string, log: vscode.OutputChannel): Promise<void> {
  if (!isCursor()) {
    return;
  }
  const mode = (vscode.workspace.getConfiguration("buddy").get<string>("mcp.setup") || "off").trim();
  if (mode === "off") {
    return;
  }

  const dest = cursorUserMcpPath();
  const existing = configuredBuddyCommand(dest);
  const already = existing ? sameBuddyPath(existing, buddyPath) : false;

  if (mode === "on") {
    if (already) {
      log.appendLine(`Cursor MCP already points at ${existing}`);
      return;
    }
    await registerCursorMcp(buddyPath, log);
    return;
  }

  if (existing) {
    log.appendLine(`Cursor MCP already has buddy (${existing}); not prompting`);
    return;
  }

  const choice = await vscode.window.showInformationMessage(
    "Register buddy as a Cursor MCP server? This uses your local buddy Jamf session.",
    "Register",
    "Not now",
    "Don't ask"
  );
  if (choice === "Don't ask") {
    await vscode.workspace.getConfiguration("buddy").update("mcp.setup", "off", vscode.ConfigurationTarget.Global);
    return;
  }
  if (choice === "Register") {
    await registerCursorMcp(buddyPath, log);
  }
}
