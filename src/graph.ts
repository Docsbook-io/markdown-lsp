import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative, resolve } from "node:path"
import {
  RichDocGraph,
  buildInMemoryGraph,
  type InMemoryFile,
} from "./bridge/index.js"

const MD_EXTENSIONS = new Set([".md", ".mdx", ".markdown"])
const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  ".vercel",
  "dist",
  "build",
  ".cache",
  ".turbo",
])

export function loadDocsAsFiles(docsRoot: string): InMemoryFile[] {
  const absRoot = resolve(docsRoot)
  const files: InMemoryFile[] = []
  walk(absRoot, absRoot, files)
  return files
}

function walk(absRoot: string, dir: string, out: InMemoryFile[]) {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }

  for (const name of entries) {
    if (name.startsWith(".") && name !== ".") continue
    if (IGNORED_DIRS.has(name)) continue

    const full = join(dir, name)
    let st
    try {
      st = statSync(full)
    } catch {
      continue
    }

    if (st.isDirectory()) {
      walk(absRoot, full, out)
      continue
    }

    if (!st.isFile()) continue
    const dotIdx = name.lastIndexOf(".")
    if (dotIdx < 0) continue
    const ext = name.slice(dotIdx).toLowerCase()
    if (!MD_EXTENSIONS.has(ext)) continue

    const rel = relative(absRoot, full).split("\\").join("/")
    let content: string
    try {
      content = readFileSync(full, "utf8")
    } catch {
      continue
    }
    out.push({ path: rel, content })
  }
}

export function buildGraph(docsRoot: string): RichDocGraph {
  const files = loadDocsAsFiles(docsRoot)
  const raw = buildInMemoryGraph(files)
  return new RichDocGraph(raw)
}
