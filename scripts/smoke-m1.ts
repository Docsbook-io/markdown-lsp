import { config as loadEnv } from "dotenv"
loadEnv({ path: ".env.local" })
loadEnv()

import { resolve } from "node:path"
import { eq } from "drizzle-orm"
import { ensureWorkspace, indexWorkspace } from "../src/indexer/indexer.js"
import { getDocumentSymbols, getWorkspaceSymbols } from "../src/core/documentSymbols.js"
import { findReferencesToDocument, findUnresolvedLinks, getDocumentByPath, resolveLinkByTarget } from "../src/core/findReferences.js"
import { db } from "../src/db/client.js"
import { documents, sections, links, workspaces as workspacesTbl } from "../src/db/schema.js"

const root = resolve("test/fixtures/sample-vault")
console.log(`Smoke-test M1 on ${root}\n`)

const ws = await ensureWorkspace(root, "sample-vault")

await db.delete(workspacesTbl).where(eq(workspacesTbl.id, ws.id))
const ws2 = await ensureWorkspace(root, "sample-vault")

const r = await indexWorkspace(ws2)
console.log(`Indexed: ${r.filesIndexed}, unchanged: ${r.filesUnchanged}, removed: ${r.filesRemoved}\n`)

const allDocs = await db.select().from(documents).where(eq(documents.workspaceId, ws2.id))
console.log(`Documents (${allDocs.length}):`)
for (const d of allDocs) console.log(`  - ${d.path}  title=${JSON.stringify(d.title)}`)

const allSections = await db.select().from(sections).where(eq(sections.workspaceId, ws2.id))
console.log(`\nTotal sections: ${allSections.length}`)

const allLinks = await db.select().from(links).where(eq(links.workspaceId, ws2.id))
console.log(`Total links: ${allLinks.length}`)
const resolved = allLinks.filter((l) => l.toDocumentId).length
const unresolved = allLinks.length - resolved
console.log(`  resolved: ${resolved}, unresolved: ${unresolved}`)

console.log("\n--- documentSymbol for auth.md ---")
const authSymbols = await getDocumentSymbols(ws2, "auth.md")
function dump(nodes: any[], indent = 0) {
  for (const n of nodes) {
    console.log(" ".repeat(indent * 2) + `${"#".repeat(n.level)} ${n.name}  [L${n.range.startLine}-L${n.range.endLine}]`)
    if (n.children?.length) dump(n.children, indent + 1)
  }
}
dump(authSymbols)

console.log("\n--- workspace/symbol query='oauth' ---")
const wsSyms = await getWorkspaceSymbols(ws2, "oauth", 20)
for (const s of wsSyms) console.log(`  - ${s.name}  (${s.documentPath})`)

console.log("\n--- references to auth.md ---")
const authDoc = await getDocumentByPath(ws2, "auth.md")
if (authDoc) {
  const refs = await findReferencesToDocument(ws2, authDoc.id)
  for (const r of refs) console.log(`  - from ${r.documentPath}  text=${JSON.stringify(r.text)}`)
}

console.log("\n--- resolve wiki link 'getting-started' ---")
const wikiRes = await resolveLinkByTarget(ws2, "getting-started")
console.log("  →", wikiRes)

console.log("\n--- unresolved links ---")
const unr = await findUnresolvedLinks(ws2)
for (const u of unr) console.log(`  - ${u.fromDocumentPath}  →  ${u.toPath}  (${u.kind})`)

console.log("\n--- M1 acceptance ---")
const asserts: { name: string; ok: boolean }[] = [
  { name: "5 documents indexed", ok: allDocs.length === 5 },
  { name: "auth.md has 3 sections (top + OAuth flow + Sessions)", ok: allSections.filter((s) => allDocs.find((d) => d.id === s.documentId)?.path === "auth.md").length === 3 },
  { name: "auth.md is referenced by ≥3 docs", ok: authDoc ? (await findReferencesToDocument(ws2, authDoc.id)).length >= 3 : false },
  { name: "broken-link is reported as unresolved", ok: unr.some((u) => u.toPath === "broken-link") },
  { name: "wiki link 'getting-started' resolves to getting-started.md", ok: wikiRes?.documentPath === "getting-started.md" },
  { name: "workspace/symbol 'oauth' finds OAuth flow", ok: wsSyms.some((s) => s.name.toLowerCase().includes("oauth")) },
]
let allOk = true
for (const a of asserts) {
  console.log(`  ${a.ok ? "✓" : "✗"} ${a.name}`)
  if (!a.ok) allOk = false
}

process.exit(allOk ? 0 : 1)
