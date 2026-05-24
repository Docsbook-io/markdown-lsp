import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { eq } from "drizzle-orm"
import { ensureWorkspace, indexFile, indexWorkspace, removeFile, type WorkspaceRef } from "../src/indexer/indexer.js"
import { db } from "../src/db/client.js"
import { documents, sections, links, workspaces as workspacesTbl } from "../src/db/schema.js"

let root: string
let ws: WorkspaceRef

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "mdlsp-test-"))
  await mkdir(join(root, "docs"), { recursive: true })
  await writeFile(join(root, "index.md"), "# Home\n\nGo to [API](./docs/api.md) and [[guide]].")
  await writeFile(join(root, "docs/api.md"), "# API\n\nSee [home](../index.md).\n\n## Endpoints\n\nList here.")
  await writeFile(join(root, "guide.md"), "# Guide\n\nSee [[index]] and [api](./docs/api.md).")
  ws = await ensureWorkspace(root, "indexer-test")
})

afterAll(async () => {
  await db.delete(workspacesTbl).where(eq(workspacesTbl.id, ws.id))
  await rm(root, { recursive: true, force: true })
})

describe("indexer", () => {
  it("indexes a workspace and resolves links", async () => {
    const result = await indexWorkspace(ws)
    expect(result.filesIndexed).toBe(3)
    expect(result.filesUnchanged).toBe(0)
    const allDocs = await db.select().from(documents).where(eq(documents.workspaceId, ws.id))
    expect(allDocs.map((d) => d.path).sort()).toEqual(["docs/api.md", "guide.md", "index.md"])
    const allLinks = await db.select().from(links).where(eq(links.workspaceId, ws.id))
    expect(allLinks.length).toBeGreaterThan(0)
    const resolved = allLinks.filter((l) => l.toDocumentId !== null).length
    expect(resolved).toBe(allLinks.length)
  })

  it("creates sections for headings", async () => {
    const allSections = await db.select().from(sections).where(eq(sections.workspaceId, ws.id))
    const apiDoc = (await db.select().from(documents).where(eq(documents.workspaceId, ws.id))).find((d) => d.path === "docs/api.md")!
    const apiSecs = allSections.filter((s) => s.documentId === apiDoc.id)
    expect(apiSecs.length).toBe(2)
  })

  it("skips re-indexing when content unchanged", async () => {
    const result = await indexWorkspace(ws)
    expect(result.filesIndexed).toBe(0)
    expect(result.filesUnchanged).toBe(3)
  })

  it("re-indexes on content change", async () => {
    await writeFile(join(root, "index.md"), "# Home v2\n\nGo to [API](./docs/api.md) and [[guide]] and [[broken]].")
    const result = await indexFile(ws, join(root, "index.md"))
    expect(result.changed).toBe(true)

    const indexDoc = (await db.select().from(documents).where(eq(documents.workspaceId, ws.id))).find((d) => d.path === "index.md")!
    expect(indexDoc.title).toBe("Home v2")
  })

  it("removes stale documents from the index", async () => {
    await rm(join(root, "guide.md"))
    const result = await indexWorkspace(ws)
    expect(result.filesRemoved).toBe(1)
    const remaining = await db.select().from(documents).where(eq(documents.workspaceId, ws.id))
    expect(remaining.map((d) => d.path).sort()).toEqual(["docs/api.md", "index.md"])
  })

  it("removeFile drops a single document", async () => {
    await writeFile(join(root, "temp.md"), "# Temp")
    await indexFile(ws, join(root, "temp.md"))
    const removed = await removeFile(ws, join(root, "temp.md"))
    expect(removed).toBe(true)
    const stillThere = (await db.select().from(documents).where(eq(documents.workspaceId, ws.id))).find((d) => d.path === "temp.md")
    expect(stillThere).toBeUndefined()
  })
})
