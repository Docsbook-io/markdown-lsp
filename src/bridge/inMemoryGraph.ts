import { parseMarkdown, type ParsedSection, type ParsedLink } from "../indexer/parseMarkdown.js"

export interface InMemoryFile {
  path: string
  content: string
}

export interface GraphSection {
  headingPath: string[]
  anchor: string | null
  level: number
  charCount: number
  positionStartLine: number
  positionStartCol: number
  positionEndLine: number
  positionEndCol: number
  content: string
}

export interface GraphPage {
  path: string
  title: string | null
  content: string
  sections: GraphSection[]
}

export interface GraphLink {
  fromPath: string
  toPath: string
  toResolvedPath: string | null
  toAnchor: string | null
  kind: ParsedLink["kind"]
  textAtLink: string | null
  positionStartLine: number
  positionStartCol: number
  positionEndLine: number
  positionEndCol: number
}

export interface InMemoryGraph {
  pages: GraphPage[]
  links: GraphLink[]
  unresolved: GraphLink[]
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
}

function normalizePath(p: string): string {
  return p.replace(/\.(md|mdx|markdown)$/i, "").replace(/^\.?\//, "")
}

export function joinPath(baseDir: string, rel: string): string {
  if (!baseDir) return rel.replace(/^\.?\//, "")
  if (rel.startsWith("/")) return rel.slice(1)
  const parts = baseDir.split("/").filter(Boolean)
  for (const segment of rel.split("/")) {
    if (segment === "." || segment === "") continue
    if (segment === "..") parts.pop()
    else parts.push(segment)
  }
  return parts.join("/")
}

export function buildInMemoryGraph(files: InMemoryFile[]): InMemoryGraph {
  const pages: GraphPage[] = []
  const allLinks: GraphLink[] = []

  const pathLookup = new Map<string, string>()
  const baseNameLookup = new Map<string, string>()
  const titleSlugLookup = new Map<string, string>()

  const parsedByPath = new Map<string, { sections: ParsedSection[]; links: ParsedLink[]; title: string | null }>()

  for (const f of files) {
    const parsed = parseMarkdown(f.content)
    parsedByPath.set(f.path, parsed)
    const norm = normalizePath(f.path)
    pathLookup.set(norm, f.path)
    pathLookup.set(f.path, f.path)
    const baseName = (norm.split("/").pop() ?? norm).toLowerCase()
    baseNameLookup.set(baseName, f.path)
    if (parsed.title) titleSlugLookup.set(slugify(parsed.title), f.path)
  }

  for (const f of files) {
    const parsed = parsedByPath.get(f.path)!
    pages.push({
      path: f.path,
      title: parsed.title,
      content: f.content,
      sections: parsed.sections.map(
        (s): GraphSection => ({
          headingPath: s.headingPath,
          anchor: s.anchor,
          level: s.level,
          charCount: s.charCount,
          positionStartLine: s.positionStartLine,
          positionStartCol: s.positionStartCol,
          positionEndLine: s.positionEndLine,
          positionEndCol: s.positionEndCol,
          content: s.content,
        }),
      ),
    })

    for (const l of parsed.links) {
      let toResolved: string | null = null
      if (l.kind === "wiki") {
        toResolved =
          baseNameLookup.get(l.toPath.toLowerCase()) ??
          titleSlugLookup.get(slugify(l.toPath)) ??
          pathLookup.get(normalizePath(l.toPath)) ??
          null
      } else {
        const fromDir = f.path.includes("/") ? f.path.slice(0, f.path.lastIndexOf("/")) : ""
        const joined = joinPath(fromDir, l.toPath)
        const candidates = [l.toPath, l.toPath.replace(/^\.\//, ""), joined]
        for (const c of candidates) {
          const norm = normalizePath(c)
          toResolved = pathLookup.get(norm) ?? pathLookup.get(c) ?? null
          if (toResolved) break
        }
      }

      allLinks.push({
        fromPath: f.path,
        toPath: l.toPath,
        toResolvedPath: toResolved,
        toAnchor: l.toAnchor,
        kind: l.kind,
        textAtLink: l.textAtLink,
        positionStartLine: l.positionStartLine,
        positionStartCol: l.positionStartCol,
        positionEndLine: l.positionEndLine,
        positionEndCol: l.positionEndCol,
      })
    }
  }

  const unresolved = allLinks.filter((l) => l.toResolvedPath === null)
  return { pages, links: allLinks, unresolved }
}
