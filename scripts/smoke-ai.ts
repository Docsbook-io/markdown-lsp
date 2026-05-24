import { config as loadEnv } from "dotenv"
import { resolve } from "node:path"
loadEnv({ path: resolve(process.cwd(), ".env.local") })
loadEnv()

import { embedTexts } from "../src/ai/embeddings.js"
import { extractSectionTerms } from "../src/ai/extract.js"
import { EMBEDDING_DIM } from "../src/ai/gateway.js"

console.log("--- Embeddings smoke ---")
const e = await embedTexts(["OAuth flow", "user authentication", "billing"])
console.log(`vectors: ${e.vectors.length}, dim: ${e.vectors[0]!.length} (expected ${EMBEDDING_DIM}), tokens: ${e.tokensUsed}`)
if (e.vectors[0]!.length !== EMBEDDING_DIM) {
  console.error("dimension mismatch")
  process.exit(1)
}

console.log("\n--- Extract smoke ---")
const extracted = await extractSectionTerms({
  documentPath: "docs/auth.md",
  headingPath: ["Authentication"],
  content: "Users sign in via OAuth 2.0. The session is stored as a JWT cookie. The login flow redirects to an external provider and exchanges a code for tokens.",
  existingCanonicals: [],
})
console.log("terms:")
for (const t of extracted.terms) console.log(`  - ${t.surface}  →  canonical=${t.canonical}  kind=${t.kind}`)
console.log(`summary: ${extracted.summary}`)
console.log(`tokens: in=${extracted.tokensIn}, out=${extracted.tokensOut}`)

const canons = new Set(extracted.terms.map((t) => t.canonical))
console.log(`distinct canonicals: ${canons.size}`)
const hasAuth = [...canons].some((c) => c.includes("auth"))
const hasOauth = [...canons].some((c) => c.includes("oauth"))
console.log(`has auth-ish canonical: ${hasAuth}, has oauth-ish: ${hasOauth}`)
if (!hasAuth && !hasOauth) {
  console.error("expected at least one auth/oauth canonical")
  process.exit(1)
}
console.log("\nOK")
