import { eq, and, isNull } from "drizzle-orm"
import { db } from "../db/client.js"
import { documents, sections, links } from "../db/schema.js"
import type { WorkspaceRef } from "../indexer/indexer.js"

export interface ReferenceHit {
  documentPath: string
  range: { startLine: number; startCol: number; endLine: number; endCol: number }
  text: string | null
}

export async function findReferencesToDocument(
  workspace: WorkspaceRef,
  toDocId: string,
): Promise<ReferenceHit[]> {
  const rows = await db
    .select({ link: links, doc: documents })
    .from(links)
    .innerJoin(documents, eq(documents.id, links.fromDocumentId))
    .where(and(eq(links.workspaceId, workspace.id), eq(links.toDocumentId, toDocId)))

  return rows.map((r) => ({
    documentPath: r.doc.path,
    range: { startLine: 0, startCol: 0, endLine: 0, endCol: 0 },
    text: r.link.textAtLink,
  }))
}

export interface ResolvedLinkTarget {
  documentPath: string
  anchor: string | null
}

export async function resolveLinkByTarget(
  workspace: WorkspaceRef,
  toPath: string,
): Promise<ResolvedLinkTarget | null> {
  const rows = await db
    .select({ link: links, doc: documents })
    .from(links)
    .leftJoin(documents, eq(documents.id, links.toDocumentId))
    .where(and(eq(links.workspaceId, workspace.id), eq(links.toPath, toPath)))
    .limit(1)
  if (rows.length === 0 || !rows[0]!.doc) return null
  return { documentPath: rows[0]!.doc.path, anchor: rows[0]!.link.toAnchor }
}

export interface UnresolvedLink {
  fromDocumentPath: string
  toPath: string
  range: { startLine: number; startCol: number; endLine: number; endCol: number } | null
  kind: "inline" | "reference" | "wiki" | "autolink"
}

export async function findUnresolvedLinks(
  workspace: WorkspaceRef,
  forDocPath?: string,
): Promise<UnresolvedLink[]> {
  const whereClauses = [eq(links.workspaceId, workspace.id), isNull(links.toDocumentId)]
  if (forDocPath) {
    const docRow = await db
      .select({ id: documents.id })
      .from(documents)
      .where(and(eq(documents.workspaceId, workspace.id), eq(documents.path, forDocPath)))
      .limit(1)
    if (docRow.length === 0) return []
    whereClauses.push(eq(links.fromDocumentId, docRow[0]!.id))
  }

  const rows = await db
    .select({ link: links, doc: documents })
    .from(links)
    .innerJoin(documents, eq(documents.id, links.fromDocumentId))
    .where(and(...whereClauses))

  return rows.map((r) => ({
    fromDocumentPath: r.doc.path,
    toPath: r.link.toPath,
    range: null,
    kind: r.link.kind,
  }))
}

export async function getDocumentByPath(workspace: WorkspaceRef, relPath: string) {
  const rows = await db
    .select()
    .from(documents)
    .where(and(eq(documents.workspaceId, workspace.id), eq(documents.path, relPath)))
    .limit(1)
  return rows[0] ?? null
}

