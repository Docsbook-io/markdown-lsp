import postgres from "postgres"

const dbUrl = process.env.DATABASE_URL
if (!dbUrl) {
  console.error("DATABASE_URL is not set")
  process.exit(1)
}

const sql = postgres(dbUrl, { max: 1 })

try {
  const tables = await sql<{ table_name: string }[]>`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name LIKE 'mdlsp_%'
    ORDER BY table_name
  `
  console.log("Tables:")
  for (const t of tables) console.log("  -", t.table_name)

  const ext = await sql<{ extname: string }[]>`SELECT extname FROM pg_extension WHERE extname = 'vector'`
  console.log("\npgvector extension:", ext.length ? "installed" : "MISSING")

  const idx = await sql<{ indexname: string }[]>`
    SELECT indexname FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'mdlsp_terms_embedding_idx'
  `
  console.log("HNSW vector index on terms.embedding:", idx.length ? "present" : "MISSING")
} catch (e) {
  console.error("FAILED:", e instanceof Error ? e.message : e)
  process.exitCode = 1
} finally {
  await sql.end()
}
