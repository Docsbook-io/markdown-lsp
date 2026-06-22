import { createHash } from "node:crypto"
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs"
import { join } from "node:path"

const CACHE_DIR = ".markdown-lsp-cache/embeddings"

function cacheKey(text: string, model: string): string {
  return createHash("sha256").update(model + "\x00" + text).digest("hex")
}

export function cachedEmbedding(text: string, model: string): number[] | null {
  const key = cacheKey(text, model)
  const filePath = join(CACHE_DIR, `${key}.json`)
  if (existsSync(filePath)) {
    try {
      return JSON.parse(readFileSync(filePath, "utf8")) as number[]
    } catch {
      return null
    }
  }
  return null
}

export function saveEmbedding(text: string, model: string, vec: number[]): void {
  mkdirSync(CACHE_DIR, { recursive: true })
  const key = cacheKey(text, model)
  const filePath = join(CACHE_DIR, `${key}.json`)
  writeFileSync(filePath, JSON.stringify(vec), "utf8")
}
