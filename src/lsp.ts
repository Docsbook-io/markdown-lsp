import { config as loadEnv } from "dotenv"
import { resolve as pathResolve } from "node:path"
import { fileURLToPath as fileToPath } from "node:url"
const __filename = fileToPath(import.meta.url)
const __dirname = pathResolve(__filename, "..")
loadEnv({ path: pathResolve(__dirname, "..", ".env.local") })
loadEnv({ path: pathResolve(__dirname, "..", ".env") })
loadEnv()

process.on("uncaughtException", (e) => {
  console.error("[markdown-lsp] uncaughtException:", e instanceof Error ? e.stack || e.message : e)
})
process.on("unhandledRejection", (e) => {
  console.error("[markdown-lsp] unhandledRejection:", e instanceof Error ? e.stack || e.message : e)
})

import {
  createConnection,
  ProposedFeatures,
  TextDocuments,
  TextDocumentSyncKind,
  InitializeResult,
  WorkspaceFolder,
  DocumentSymbol,
  SymbolKind,
  Location,
  Range,
  Position,
  Diagnostic,
  DiagnosticSeverity,
  CompletionItem,
  CompletionItemKind,
  WorkspaceSymbol,
  SymbolInformation,
  TextEdit,
} from "vscode-languageserver/node.js"
import { TextDocument } from "vscode-languageserver-textdocument"
import { URI } from "vscode-uri"
import { fileURLToPath } from "node:url"
import { relative, resolve, dirname, join } from "node:path"
import { readdir } from "node:fs/promises"
import {
  ensureWorkspace,
  indexFile,
  indexWorkspace,
  removeFile,
  resolveLinkTargets,
  type WorkspaceRef,
} from "./indexer/indexer.js"
import { parseMarkdown } from "./indexer/parseMarkdown.js"
import { getDocumentSymbols, getWorkspaceSymbols } from "./core/documentSymbols.js"
import { findReferencesToDocument, findUnresolvedLinks, getDocumentByPath, resolveLinkByTarget } from "./core/findReferences.js"
import { db } from "./db/client.js"
import { documents } from "./db/schema.js"
import { eq } from "drizzle-orm"

const connection = createConnection(ProposedFeatures.all)
const docs = new TextDocuments(TextDocument)

let workspace: WorkspaceRef | null = null

function uriToPath(uri: string): string {
  return fileURLToPath(uri)
}
function pathToUri(p: string): string {
  return URI.file(p).toString()
}
function relPath(absolute: string): string {
  if (!workspace) return absolute
  return relative(workspace.rootPath, absolute)
}
function rangeToLsp(r: { startLine: number; startCol: number; endLine: number; endCol: number }): Range {
  return Range.create(Position.create(r.startLine, r.startCol), Position.create(r.endLine, r.endCol))
}

function symbolKindForLevel(level: number): SymbolKind {
  if (level <= 1) return SymbolKind.File
  if (level === 2) return SymbolKind.Namespace
  if (level === 3) return SymbolKind.Class
  return SymbolKind.Field
}

connection.onInitialize(async (params): Promise<InitializeResult> => {
  const folders: WorkspaceFolder[] = params.workspaceFolders ?? []
  if (folders.length === 0 && params.rootUri) {
    folders.push({ uri: params.rootUri, name: "root" })
  }
  if (folders.length > 0) {
    const root = uriToPath(folders[0]!.uri)
    try {
      workspace = await ensureWorkspace(root, folders[0]!.name)
      connection.console.info(`Workspace initialized: ${workspace.rootPath} (id=${workspace.id})`)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      connection.console.error(`Failed to initialize workspace: ${msg}`)
      connection.window.showErrorMessage(`Markdown LSP: ${msg}`)
    }
  } else {
    connection.console.warn("No workspace folder provided")
  }

  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      documentSymbolProvider: true,
      workspaceSymbolProvider: true,
      definitionProvider: true,
      referencesProvider: true,
      hoverProvider: false,
      completionProvider: { triggerCharacters: ["[", "(", "#"] },
      renameProvider: false,
      executeCommandProvider: { commands: ["markdownLsp/reindex"] },
    },
    serverInfo: { name: "markdown-lsp", version: "0.0.1" },
  }
})

connection.onInitialized(async () => {
  if (!workspace) return
  connection.console.info("Starting initial workspace index…")
  try {
    const result = await indexWorkspace(workspace)
    connection.console.info(
      `Index complete: ${result.filesIndexed} indexed, ${result.filesUnchanged} unchanged, ${result.filesRemoved} removed`,
    )
    await publishWorkspaceDiagnostics()
  } catch (e) {
    connection.console.error(`Index failed: ${e instanceof Error ? e.message : String(e)}`)
  }
})

async function publishWorkspaceDiagnostics() {
  if (!workspace) return
  const unresolved = await findUnresolvedLinks(workspace)
  const byDoc = new Map<string, typeof unresolved>()
  for (const u of unresolved) {
    const arr = byDoc.get(u.fromDocumentPath) ?? []
    arr.push(u)
    byDoc.set(u.fromDocumentPath, arr)
  }
  for (const [docPath, list] of byDoc) {
    const absolute = workspace ? resolve(workspace.rootPath, docPath) : docPath
    const diagnostics: Diagnostic[] = list.map((u) => ({
      severity: DiagnosticSeverity.Warning,
      range: Range.create(0, 0, 0, 1),
      message: `Unresolved link target: ${u.toPath}`,
      source: "markdown-lsp",
      code: "unresolved-link",
    }))
    connection.sendDiagnostics({ uri: pathToUri(absolute), diagnostics })
  }
}

docs.onDidChangeContent(async (event) => {
  if (!workspace) return
  const absolute = uriToPath(event.document.uri)
  if (!absolute.startsWith(workspace.rootPath)) return
  try {
    await indexFile(workspace, absolute, event.document.getText())
    await resolveLinkTargets(workspace)
    await publishDocumentDiagnostics(absolute)
  } catch (e) {
    connection.console.error(`indexFile failed for ${absolute}: ${e instanceof Error ? e.message : e}`)
  }
})

docs.onDidClose((event) => {
  connection.sendDiagnostics({ uri: event.document.uri, diagnostics: [] })
})

async function publishDocumentDiagnostics(absolute: string) {
  if (!workspace) return
  const rel = relPath(absolute)
  const unresolved = await findUnresolvedLinks(workspace, rel)
  const diagnostics: Diagnostic[] = unresolved.map((u) => ({
    severity: DiagnosticSeverity.Warning,
    range: Range.create(0, 0, 0, 1),
    message: `Unresolved link target: ${u.toPath}`,
    source: "markdown-lsp",
    code: "unresolved-link",
  }))
  connection.sendDiagnostics({ uri: pathToUri(absolute), diagnostics })
}

connection.onDocumentSymbol(async (params) => {
  if (!workspace) return []
  const absolute = uriToPath(params.textDocument.uri)
  const nodes = await getDocumentSymbols(workspace, relPath(absolute))

  const toLsp = (n: ReturnType<typeof getDocumentSymbols> extends Promise<infer T> ? T extends Array<infer U> ? U : never : never): DocumentSymbol => ({
    name: n.name,
    kind: symbolKindForLevel(n.level),
    range: rangeToLsp(n.range),
    selectionRange: rangeToLsp(n.selectionRange),
    children: n.children.map(toLsp),
  })
  return nodes.map(toLsp)
})

connection.onWorkspaceSymbol(async (params): Promise<WorkspaceSymbol[] | SymbolInformation[]> => {
  if (!workspace) return []
  const hits = await getWorkspaceSymbols(workspace, params.query ?? "", 100)
  return hits.map((h) => ({
    name: h.name,
    kind: SymbolKind.String,
    location: Location.create(pathToUri(resolve(workspace!.rootPath, h.documentPath)), rangeToLsp(h.range)),
    containerName: h.containerName ?? undefined,
  }))
})

connection.onDefinition(async (params) => {
  if (!workspace) return null
  const absolute = uriToPath(params.textDocument.uri)
  const doc = docs.get(params.textDocument.uri)
  if (!doc) return null
  const parsed = parseMarkdown(doc.getText())
  const line = params.position.line
  const col = params.position.character
  const hit = parsed.links.find(
    (l) =>
      l.positionStartLine <= line &&
      l.positionEndLine >= line &&
      (l.positionStartLine !== line || l.positionStartCol <= col) &&
      (l.positionEndLine !== line || l.positionEndCol >= col),
  )
  if (!hit) return null

  if (hit.kind === "wiki") {
    const resolved = await resolveLinkByTarget(workspace, hit.toPath)
    if (!resolved) return null
    const targetAbs = resolve(workspace.rootPath, resolved.documentPath)
    return Location.create(pathToUri(targetAbs), Range.create(0, 0, 0, 0))
  }

  const fromDir = dirname(relPath(absolute))
  const candidates = [
    hit.toPath,
    hit.toPath.replace(/^\.\//, ""),
    join(fromDir, hit.toPath),
    join(fromDir, hit.toPath.replace(/^\.\//, "")),
  ]
  for (const c of candidates) {
    const normalized = c.replace(/\.(md|mdx|markdown)$/i, "")
    const doc = await db
      .select()
      .from(documents)
      .where(eq(documents.workspaceId, workspace.id))
    const match = doc.find((d) => d.path === c || d.path.replace(/\.(md|mdx|markdown)$/i, "") === normalized)
    if (match) {
      const targetAbs = resolve(workspace.rootPath, match.path)
      return Location.create(pathToUri(targetAbs), Range.create(0, 0, 0, 0))
    }
  }
  return null
})

connection.onReferences(async (params) => {
  if (!workspace) return []
  const absolute = uriToPath(params.textDocument.uri)

  let targetDocId: string | null = null

  const liveDoc = docs.get(params.textDocument.uri)
  if (liveDoc) {
    const parsed = parseMarkdown(liveDoc.getText())
    const line = params.position.line
    const col = params.position.character
    const hit = parsed.links.find(
      (l) =>
        l.positionStartLine <= line &&
        l.positionEndLine >= line &&
        (l.positionStartLine !== line || l.positionStartCol <= col) &&
        (l.positionEndLine !== line || l.positionEndCol >= col),
    )
    if (hit) {
      if (hit.kind === "wiki") {
        const resolved = await resolveLinkByTarget(workspace, hit.toPath)
        if (resolved) {
          const target = await getDocumentByPath(workspace, resolved.documentPath)
          if (target) targetDocId = target.id
        }
      } else {
        const fromDir = dirname(relPath(absolute))
        const candidates = [
          hit.toPath,
          hit.toPath.replace(/^\.\//, ""),
          join(fromDir, hit.toPath),
          join(fromDir, hit.toPath.replace(/^\.\//, "")),
        ]
        const allDocs = await db.select().from(documents).where(eq(documents.workspaceId, workspace.id))
        for (const c of candidates) {
          const normalized = c.replace(/\.(md|mdx|markdown)$/i, "")
          const match = allDocs.find(
            (d) => d.path === c || d.path.replace(/\.(md|mdx|markdown)$/i, "") === normalized,
          )
          if (match) {
            targetDocId = match.id
            break
          }
        }
      }
    }
  }

  if (!targetDocId) {
    const doc = await getDocumentByPath(workspace, relPath(absolute))
    if (!doc) return []
    targetDocId = doc.id
  }

  const hits = await findReferencesToDocument(workspace, targetDocId)
  return hits.map((h) =>
    Location.create(pathToUri(resolve(workspace!.rootPath, h.documentPath)), rangeToLsp(h.range)),
  )
})

connection.onCompletion(async (params): Promise<CompletionItem[]> => {
  if (!workspace) return []
  const doc = docs.get(params.textDocument.uri)
  if (!doc) return []
  const line = doc.getText({
    start: Position.create(params.position.line, 0),
    end: params.position,
  })
  const wikiMatch = line.match(/\[\[([^\]]*)$/)
  if (!wikiMatch) return []
  const prefix = wikiMatch[1]!.toLowerCase()

  const allDocs = await db.select().from(documents).where(eq(documents.workspaceId, workspace.id))
  return allDocs
    .filter((d) => {
      const base = (d.path.split("/").pop() ?? "").replace(/\.(md|mdx|markdown)$/i, "").toLowerCase()
      return base.startsWith(prefix) || (d.title?.toLowerCase().startsWith(prefix) ?? false)
    })
    .slice(0, 50)
    .map((d) => {
      const base = (d.path.split("/").pop() ?? "").replace(/\.(md|mdx|markdown)$/i, "")
      return {
        label: base,
        kind: CompletionItemKind.File,
        detail: d.path,
        insertText: base,
      } satisfies CompletionItem
    })
})

connection.onExecuteCommand(async (params) => {
  if (params.command === "markdownLsp/reindex" && workspace) {
    connection.console.info("Manual reindex requested")
    const result = await indexWorkspace(workspace)
    await publishWorkspaceDiagnostics()
    return result
  }
  return null
})

connection.onDidChangeWatchedFiles(async (params) => {
  if (!workspace) return
  for (const change of params.changes) {
    const absolute = uriToPath(change.uri)
    if (!absolute.startsWith(workspace.rootPath)) continue
    if (change.type === 3) {
      await removeFile(workspace, absolute)
    } else {
      try {
        await indexFile(workspace, absolute)
      } catch (e) {
        connection.console.error(`watched file index error ${absolute}: ${e instanceof Error ? e.message : e}`)
      }
    }
  }
  await resolveLinkTargets(workspace)
  await publishWorkspaceDiagnostics()
})

void readdir
void TextEdit

docs.listen(connection)
connection.listen()
