import { createHash } from "node:crypto"
import { readFile, stat } from "node:fs/promises"
import { readdir } from "node:fs/promises"
import { join, relative, resolve, dirname, extname } from "node:path"
import { eq, and, inArray, sql } from "drizzle-orm"
import { db } from "../db/client.js"
import { workspaces, documents, sections, links } from "../db/schema.js"
import { parseMarkdown, slugify, type ParsedLink } from "./parseMarkdown.js"

const MARKDOWN_EXTS = new Set([".md", ".mdx", ".markdown"])
const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".vercel",
  ".turbo",
  "coverage",
])

export interface WorkspaceRef {
  id: string
  rootPath: string
}

export async function ensureWorkspace(rootPath: string, name?: string): Promise<WorkspaceRef> {
  const absolute = resolve(rootPath)
  const existing = await db.select().from(workspaces).where(eq(workspaces.rootPath, absolute)).limit(1)
  if (existing.length > 0) {
    return { id: existing[0]!.id, rootPath: absolute }
  }
  const inserted = await db
    .insert(workspaces)
    .values({ rootPath: absolute, name: name ?? absolute.split("/").pop() ?? "workspace" })
    .returning()
  return { id: inserted[0]!.id, rootPath: absolute }
}

async function* walkMarkdownFiles(root: string): AsyncGenerator<string> {
  const entries = await readdir(root, { withFileTypes: true })
  for (const entry of entries) {
    if (IGNORED_DIRS.has(entry.name) || entry.name.startsWith(".")) continue
    const full = join(root, entry.name)
    if (entry.isDirectory()) {
      yield* walkMarkdownFiles(full)
    } else if (entry.isFile() && MARKDOWN_EXTS.has(extname(entry.name).toLowerCase())) {
      yield full
    }
  }
}

function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex")
}

export interface IndexFileResult {
  documentId: string
  sectionsCount: number
  linksCount: number
  changed: boolean
}

export async function indexFile(
  workspace: WorkspaceRef,
  absolutePath: string,
  contentOverride?: string,
): Promise<IndexFileResult> {
  const relPath = relative(workspace.rootPath, absolutePath)
  const content = contentOverride ?? (await readFile(absolutePath, "utf-8"))
  const contentHash = hashContent(content)

  const existing = await db
    .select()
    .from(documents)
    .where(and(eq(documents.workspaceId, workspace.id), eq(documents.path, relPath)))
    .limit(1)

  if (existing.length > 0 && existing[0]!.contentHash === contentHash && !contentOverride) {
    const counts = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(sections)
      .where(eq(sections.documentId, existing[0]!.id))
    return {
      documentId: existing[0]!.id,
      sectionsCount: counts[0]?.count ?? 0,
      linksCount: 0,
      changed: false,
    }
  }

  const parsed = parseMarkdown(content)

  const documentId = existing.length > 0 ? existing[0]!.id : undefined

  let docRowId: string
  if (documentId) {
    await db
      .update(documents)
      .set({
        contentHash,
        title: parsed.title,
        lastIndexedAt: new Date(),
      })
      .where(eq(documents.id, documentId))
    await db.delete(links).where(eq(links.fromDocumentId, documentId))
    await db.delete(sections).where(eq(sections.documentId, documentId))
    docRowId = documentId
  } else {
    const inserted = await db
      .insert(documents)
      .values({
        workspaceId: workspace.id,
        path: relPath,
        contentHash,
        title: parsed.title,
      })
      .returning()
    docRowId = inserted[0]!.id
  }

  const insertedSections =
    parsed.sections.length > 0
      ? await db
          .insert(sections)
          .values(
            parsed.sections.map((s) => ({
              documentId: docRowId,
              workspaceId: workspace.id,
              headingPath: s.headingPath,
              anchor: s.anchor,
              level: s.level,
              content: s.content,
              charCount: s.charCount,
              positionStartLine: s.positionStartLine,
              positionStartCol: s.positionStartCol,
              positionEndLine: s.positionEndLine,
              positionEndCol: s.positionEndCol,
            })),
          )
          .returning({ id: sections.id })
      : []

  if (parsed.links.length > 0) {
    await db.insert(links).values(
      parsed.links.map((l) => ({
        workspaceId: workspace.id,
        fromDocumentId: docRowId,
        fromSectionId: l.fromSectionIndex !== null ? insertedSections[l.fromSectionIndex]?.id ?? null : null,
        toPath: l.toPath,
        toDocumentId: null,
        toAnchor: l.toAnchor,
        kind: l.kind,
        textAtLink: l.textAtLink,
      })),
    )
  }

  return {
    documentId: docRowId,
    sectionsCount: parsed.sections.length,
    linksCount: parsed.links.length,
    changed: true,
  }
}

export async function resolveLinkTargets(workspace: WorkspaceRef): Promise<{ resolved: number; unresolved: number }> {
  const allDocs = await db
    .select({ id: documents.id, path: documents.path, title: documents.title })
    .from(documents)
    .where(eq(documents.workspaceId, workspace.id))

  const byPath = new Map<string, string>()
  const byBaseName = new Map<string, string>()
  const byTitleSlug = new Map<string, string>()
  for (const d of allDocs) {
    byPath.set(d.path, d.id)
    const base = d.path.replace(/\.(md|mdx|markdown)$/i, "")
    byPath.set(base, d.id)
    const baseName = base.split("/").pop() ?? base
    byBaseName.set(baseName.toLowerCase(), d.id)
    if (d.title) byTitleSlug.set(slugify(d.title), d.id)
  }

  const allLinks = await db
    .select()
    .from(links)
    .where(eq(links.workspaceId, workspace.id))

  let resolved = 0
  let unresolved = 0

  for (const l of allLinks) {
    const fromDoc = allDocs.find((d) => d.id === l.fromDocumentId)
    if (!fromDoc) continue

    const fromDir = dirname(fromDoc.path)
    let toDocId: string | null = null

    if (l.kind === "wiki") {
      const candidate = l.toPath
      toDocId = byBaseName.get(candidate.toLowerCase()) ?? byTitleSlug.get(slugify(candidate)) ?? null
      if (!toDocId) {
        const normalized = candidate.replace(/\.(md|mdx|markdown)$/i, "")
        toDocId = byPath.get(normalized) ?? null
      }
    } else {
      const target = l.toPath
      const candidates = [
        target,
        target.replace(/^\.\//, ""),
        join(fromDir, target),
        join(fromDir, target.replace(/^\.\//, "")),
      ]
      for (const c of candidates) {
        const normalized = c.replace(/\.(md|mdx|markdown)$/i, "")
        toDocId = byPath.get(normalized) ?? byPath.get(c) ?? null
        if (toDocId) break
      }
    }

    if (toDocId) resolved++
    else unresolved++

    await db
      .update(links)
      .set({ toDocumentId: toDocId })
      .where(eq(links.id, l.id))
  }

  return { resolved, unresolved }
}

export async function indexWorkspace(workspace: WorkspaceRef): Promise<{
  filesIndexed: number
  filesUnchanged: number
  filesRemoved: number
}> {
  const onDisk = new Set<string>()
  for await (const file of walkMarkdownFiles(workspace.rootPath)) {
    onDisk.add(file)
  }

  let filesIndexed = 0
  let filesUnchanged = 0
  for (const file of onDisk) {
    const result = await indexFile(workspace, file)
    if (result.changed) filesIndexed++
    else filesUnchanged++
  }

  const allDocs = await db
    .select({ id: documents.id, path: documents.path })
    .from(documents)
    .where(eq(documents.workspaceId, workspace.id))

  const stale = allDocs.filter((d) => !onDisk.has(join(workspace.rootPath, d.path)))
  if (stale.length > 0) {
    await db.delete(documents).where(inArray(documents.id, stale.map((s) => s.id)))
  }

  await resolveLinkTargets(workspace)

  return {
    filesIndexed,
    filesUnchanged,
    filesRemoved: stale.length,
  }
}

export async function removeFile(workspace: WorkspaceRef, absolutePath: string): Promise<boolean> {
  const relPath = relative(workspace.rootPath, absolutePath)
  const existing = await db
    .select({ id: documents.id })
    .from(documents)
    .where(and(eq(documents.workspaceId, workspace.id), eq(documents.path, relPath)))
    .limit(1)
  if (existing.length === 0) return false
  await db.delete(documents).where(eq(documents.id, existing[0]!.id))
  return true
}

export async function fileExists(absolutePath: string): Promise<boolean> {
  try {
    await stat(absolutePath)
    return true
  } catch {
    return false
  }
}
