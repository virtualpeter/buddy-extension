import * as vscode from "vscode";
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind,
} from "vscode-languageclient/node";
import { resolveBuddyPath } from "./cli";
import { isCursor, maybeSetupCursorMcp, registerCursorMcp } from "./mcp";

let client: LanguageClient | undefined;
let output: vscode.OutputChannel | undefined;
let resolvedBuddy: string | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  output = vscode.window.createOutputChannel("Buddy");
  context.subscriptions.push(output);
  await vscode.commands.executeCommand("setContext", "buddy.isCursor", isCursor());

  context.subscriptions.push(
    vscode.commands.registerCommand("buddy.installCli", async () => {
      const buddyPath = await resolveBuddyPath(context, output!, { force: true, interactiveAuth: true });
      if (!buddyPath) {
        return;
      }
      resolvedBuddy = buddyPath;
      void vscode.window.showInformationMessage(`Buddy CLI ready: ${buddyPath}`);
      await startLanguageClient(buddyPath);
      await maybeSetupCursorMcp(buddyPath, output!);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("buddy.registerMcp", async () => {
      if (!isCursor()) {
        void vscode.window.showInformationMessage("Buddy MCP registration is only available in Cursor.");
        return;
      }
      const buddyPath =
        resolvedBuddy ?? (await resolveBuddyPath(context, output!, { interactiveAuth: true }));
      if (!buddyPath) {
        return;
      }
      resolvedBuddy = buddyPath;
      await registerCursorMcp(buddyPath, output!);
    })
  );

  context.subscriptions.push({
    dispose: () => {
      void client?.stop();
    },
  });

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("buddy.mcp.setup")) {
        if (resolvedBuddy) {
          void maybeSetupCursorMcp(resolvedBuddy, output!);
        }
        return;
      }
      if (e.affectsConfiguration("buddy")) {
        void vscode.window.showInformationMessage(
          "Buddy settings changed. Reload the window to apply language server options."
        );
      }
    })
  );

  const config = vscode.workspace.getConfiguration("buddy");
  const lspOverride = (config.get<string>("lsp.path") || "").trim();

  if (lspOverride) {
    const parts = lspOverride.split(/\s+/).filter(Boolean);
    output.appendLine(`Using buddy.lsp.path: ${parts.join(" ")}`);
    await startLanguageClient(parts[0], parts.slice(1));
  } else {
    const buddyPath = await resolveBuddyPath(context, output);
    if (!buddyPath) {
      output.appendLine(
        "Buddy CLI not resolved; syntax highlighting still works. Run Buddy: Install CLI or set buddy.path."
      );
    } else {
      resolvedBuddy = buddyPath;
      await startLanguageClient(buddyPath);
    }
  }

  if (isCursor()) {
    const mcpBuddy = resolvedBuddy ?? (await resolveBuddyPath(context, output));
    if (mcpBuddy) {
      resolvedBuddy = mcpBuddy;
      await maybeSetupCursorMcp(mcpBuddy, output);
    }
  }
}

async function startLanguageClient(command: string, args: string[] = ["lsp"]): Promise<void> {
  if (client) {
    await client.stop();
    client = undefined;
  }

  const cellMode = vscode.workspace.getConfiguration("buddy").get<boolean>("cellMode") === true;
  const serverOptions: ServerOptions = {
    command,
    args,
    transport: TransportKind.stdio,
  };
  const clientOptions: LanguageClientOptions = {
    documentSelector: [{ scheme: "file", language: "buddy" }],
    synchronize: {
      configurationSection: "buddy",
    },
    initializationOptions: {
      cellMode,
    },
  };

  client = new LanguageClient("buddy", "BuddyScript", serverOptions, clientOptions);
  await client.start();
}

export async function deactivate(): Promise<void> {
  if (client) {
    await client.stop();
  }
}
