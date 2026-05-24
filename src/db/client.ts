import postgres from "postgres"
import { drizzle } from "drizzle-orm/postgres-js"
import * as schema from "./schema.js"

type DbClient = ReturnType<typeof drizzle<typeof schema>>

let _db: DbClient | null = null
let _queryClient: ReturnType<typeof postgres> | null = null

function init(): DbClient {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Configure markdownLsp.databaseUrl in VS Code settings, or set DATABASE_URL in the environment.",
    )
  }
  _queryClient = postgres(connectionString, { max: 5 })
  return drizzle(_queryClient, { schema })
}

export const db: DbClient = new Proxy({} as DbClient, {
  get(_target, prop) {
    if (!_db) _db = init()
    return (_db as any)[prop]
  },
}) as DbClient

export { schema }

