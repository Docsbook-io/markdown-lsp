import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import postgres from "postgres"

const dbUrl = process.env.DATABASE_URL
if (!dbUrl) {
  console.error("DATABASE_URL is not set")
  process.exit(1)
}

const sqlFile = process.argv[2] ?? "src/db/migrations/0000_init.sql"
const sqlContent = readFileSync(resolve(sqlFile), "utf-8")

const sql = postgres(dbUrl, { max: 1 })

try {
  console.log(`Applying ${sqlFile}…`)
  await sql.unsafe(sqlContent)
  console.log("OK")
} catch (e) {
  console.error("FAILED:", e instanceof Error ? e.message : e)
  process.exitCode = 1
} finally {
  await sql.end()
}
