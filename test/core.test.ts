import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { eq } from "drizzle-orm"
import { ensureWorkspace, indexWorkspace, type WorkspaceRef } from "../src/indexer/indexer.js"
import { getDocumentSymbols, getWorkspaceSymbols } from "../src/core/documentSymbols.js"
import {
  findReferencesToDocument,
  findUnresolvedLinks,
  getDocumentByPath,
  resolveLinkByTarget,
} from "../src/core/findReferences.js"
import { db } from "../src/db/client.js"
import { workspaces as workspacesTbl } from "../src/db/schema.js"

let root: string
let ws: WorkspaceRef

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "mdlsp-core-"))
  await mkdir(join(root, "sub"), { recursive: true })
  await writeFile(
    join(root, "index.md"),
    "# Home\n\n- [[auth]]\n- [[missing]]\n- [api](./sub/api.md)\n",
  )
  await writeFile(
    join(root, "auth.md"),
    "# Authentication\n\nOAuth flow lives here.\n\n## OAuth flow\n\nSteps.\n\n## Sessions\n\nJWT.",
  )
  await writeFile(join(root, "sub/api.md"), "# API reference\n\nSee [[auth]].")
  ws = await ensureWorkspace(root, "core-test")
  await indexWorkspace(ws)
})

afterAll(async () => {
  await db.delete(workspacesTbl).where(eq(workspacesTbl.id, ws.id))
  await rm(root, { recursive: true, force: true })
})

describe("documentSymbols", () => {
  it("builds nested heading tree", async () => {
    const nodes = await getDocumentSymbols(ws, "auth.md")
    expect(nodes).toHaveLength(1)
    expect(nodes[0]!.name).toBe("Authentication")
    expect(nodes[0]!.children.map((c) => c.name)).toEqual(["OAuth flow", "Sessions"])
  })

  it("returns empty when document is unknown", async () => {
    const nodes = await getDocumentSymbols(ws, "nonexistent.md")
    expect(nodes).toEqual([])
  })
})

describe("workspaceSymbols", () => {
  it("subsequence-matches across the workspace", async () => {
    const hits = await getWorkspaceSymbols(ws, "oaf", 20)
    const names = hits.map((h) => h.name)
    expect(names.some((n) => n.toLowerCase().includes("oauth flow"))).toBe(true)
  })

  it("returns everything when query is empty", async () => {
    const hits = await getWorkspaceSymbols(ws, "", 50)
    expect(hits.length).toBeGreaterThan(0)
  })
})

describe("references & resolution", () => {
  it("finds all incoming references to a document", async () => {
    const authDoc = (await getDocumentByPath(ws, "auth.md"))!
    const refs = await findReferencesToDocument(ws, authDoc.id)
    const fromPaths = refs.map((r) => r.documentPath).sort()
    expect(fromPaths).toEqual(["index.md", "sub/api.md"])
  })

  it("resolves a wiki link by base-name", async () => {
    const res = await resolveLinkByTarget(ws, "auth")
    expect(res?.documentPath).toBe("auth.md")
  })

  it("reports unresolved links", async () => {
    const unresolved = await findUnresolvedLinks(ws)
    const broken = unresolved.find((u) => u.toPath === "missing")
    expect(broken).toBeDefined()
    expect(broken!.kind).toBe("wiki")
  })

  it("scopes unresolved links per document", async () => {
    const scoped = await findUnresolvedLinks(ws, "index.md")
    expect(scoped.every((u) => u.fromDocumentPath === "index.md")).toBe(true)
  })
})
