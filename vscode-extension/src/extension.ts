import * as path from "path"
import { ExtensionContext, workspace, commands, window } from "vscode"
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind,
} from "vscode-languageclient/node"

let client: LanguageClient | undefined

function buildServerOptions(context: ExtensionContext): ServerOptions {
  const cfg = workspace.getConfiguration("markdownLsp")
  const configured = cfg.get<string>("serverPath")?.trim() || ""
  const bundled = path.resolve(context.extensionPath, "..", "dist", "server.js")
  const serverModule = configured.length > 0 ? configured : bundled

  const env: NodeJS.ProcessEnv = { ...process.env }
  const dbUrl = cfg.get<string>("databaseUrl")?.trim()
  if (dbUrl) env.DATABASE_URL = dbUrl
  const aiKey = cfg.get<string>("aiGatewayApiKey")?.trim()
  if (aiKey) env.AI_GATEWAY_API_KEY = aiKey

  return {
    run: { module: serverModule, transport: TransportKind.ipc, options: { env } },
    debug: { module: serverModule, transport: TransportKind.ipc, options: { env, execArgv: ["--inspect=6009"] } },
  }
}

async function startClient(context: ExtensionContext) {
  const serverOptions = buildServerOptions(context)
  const clientOptions: LanguageClientOptions = {
    documentSelector: [{ scheme: "file", language: "markdown" }],
    synchronize: {
      fileEvents: workspace.createFileSystemWatcher("**/*.{md,mdx,markdown}"),
    },
    outputChannelName: "Markdown LSP",
  }
  client = new LanguageClient("markdownLsp", "Markdown LSP", serverOptions, clientOptions)
  await client.start()
  window.showInformationMessage("Markdown LSP: started")
}

export async function activate(context: ExtensionContext) {
  await startClient(context)

  context.subscriptions.push(
    commands.registerCommand("markdownLsp.reindex", async () => {
      if (!client) return window.showWarningMessage("Markdown LSP is not running")
      try {
        const result = await client.sendRequest("workspace/executeCommand", {
          command: "markdownLsp/reindex",
          arguments: [],
        })
        window.showInformationMessage(`Reindex done: ${JSON.stringify(result)}`)
      } catch (e) {
        window.showErrorMessage(`Reindex failed: ${e instanceof Error ? e.message : e}`)
      }
    }),
    commands.registerCommand("markdownLsp.restart", async () => {
      if (client) {
        await client.stop()
        client = undefined
      }
      await startClient(context)
    }),
  )
}

export async function deactivate() {
  if (!client) return undefined
  await client.stop()
  client = undefined
}
