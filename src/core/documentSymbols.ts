import { eq, and } from "drizzle-orm"
import { db } from "../db/client.js"
import { documents, sections } from "../db/schema.js"
import type { WorkspaceRef } from "../indexer/indexer.js"

export interface SymbolNode {
  name: string
  level: number
  anchor: string | null
  range: { startLine: number; startCol: number; endLine: number; endCol: number }
  selectionRange: { startLine: number; startCol: number; endLine: number; endCol: number }
  children: SymbolNode[]
}

export async function getDocumentSymbols(workspace: WorkspaceRef, relPath: string): Promise<SymbolNode[]> {
  const doc = await db
    .select()
    .from(documents)
    .where(and(eq(documents.workspaceId, workspace.id), eq(documents.path, relPath)))
    .limit(1)
  if (doc.length === 0) return []

  const secs = await db
    .select()
    .from(sections)
    .where(eq(sections.documentId, doc[0]!.id))

  secs.sort((a, b) => a.positionStartLine - b.positionStartLine)

  const root: SymbolNode[] = []
  const stack: SymbolNode[] = []

  for (const s of secs) {
    if (s.level === 0) continue
    const name = s.headingPath[s.headingPath.length - 1] ?? "(untitled)"
    const node: SymbolNode = {
      name,
      level: s.level,
      anchor: s.anchor,
      range: {
        startLine: s.positionStartLine,
        startCol: s.positionStartCol,
        endLine: s.positionEndLine,
        endCol: s.positionEndCol,
      },
      selectionRange: {
        startLine: s.positionStartLine,
        startCol: s.positionStartCol,
        endLine: s.positionStartLine,
        endCol: s.positionStartCol + name.length + s.level + 1,
      },
      children: [],
    }
    while (stack.length > 0 && stack[stack.length - 1]!.level >= s.level) stack.pop()
    if (stack.length === 0) root.push(node)
    else stack[stack.length - 1]!.children.push(node)
    stack.push(node)
  }

  return root
}

export interface WorkspaceSymbol {
  name: string
  containerName: string | null
  documentPath: string
  range: { startLine: number; startCol: number; endLine: number; endCol: number }
}

function subsequenceMatch(query: string, target: string): boolean {
  if (!query) return true
  const q = query.toLowerCase()
  const t = target.toLowerCase()
  let qi = 0
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++
  }
  return qi === q.length
}

export async function getWorkspaceSymbols(workspace: WorkspaceRef, query: string, limit = 100): Promise<WorkspaceSymbol[]> {
  const allDocs = await db
    .select()
    .from(documents)
    .where(eq(documents.workspaceId, workspace.id))
  const docById = new Map(allDocs.map((d) => [d.id, d]))

  const allSections = await db
    .select()
    .from(sections)
    .where(eq(sections.workspaceId, workspace.id))

  const out: WorkspaceSymbol[] = []
  for (const s of allSections) {
    if (s.level === 0) continue
    const name = s.headingPath[s.headingPath.length - 1] ?? ""
    if (!subsequenceMatch(query, name)) continue
    const doc = docById.get(s.documentId)
    if (!doc) continue
    const container = s.headingPath.length > 1 ? s.headingPath.slice(0, -1).join(" / ") : null
    out.push({
      name,
      containerName: container,
      documentPath: doc.path,
      range: {
        startLine: s.positionStartLine,
        startCol: s.positionStartCol,
        endLine: s.positionEndLine,
        endCol: s.positionEndCol,
      },
    })
    if (out.length >= limit) break
  }

  for (const d of allDocs) {
    const title = d.title ?? d.path
    if (!subsequenceMatch(query, title)) continue
    out.push({
      name: title,
      containerName: d.path,
      documentPath: d.path,
      range: { startLine: 0, startCol: 0, endLine: 0, endCol: 0 },
    })
    if (out.length >= limit) break
  }

  return out
}
