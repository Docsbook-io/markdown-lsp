import {
  buildInMemoryGraph,
  slugify,
  joinPath,
  type InMemoryFile,
  type InMemoryGraph,
  type GraphPage,
  type GraphSection,
  type GraphLink,
} from "./inMemoryGraph.js"

export interface Position {
  line: number
  col: number
}
export interface Range {
  start: Position
  end: Position
}

export interface SectionRef {
  pagePath: string
  anchor: string | null
  headingPath: string[]
}

export interface SearchHit {
  pagePath: string
  pageTitle: string | null
  headingPath: string[]
  anchor: string | null
  snippet: string
  range: Range
  matchScore?: number
}

export interface SymbolHit {
  name: string
  containerName: string | null
  pagePath: string
  anchor: string | null
  range: Range
}

export interface OutlineNode {
  name: string
  level: number
  anchor: string | null
  range: Range
  children: OutlineNode[]
}

export interface NeighborInfo {
  parent: SectionRef | null
  prev: SectionRef | null
  next: SectionRef | null
  children: SectionRef[]
}

export interface ResolvedGithubLink {
  repo: string
  branch: string
  pagePath: string
  anchor: string | null
  url: string
}

export class RichDocGraph {
  readonly raw: InMemoryGraph
  private readonly pagesByPath = new Map<string, GraphPage>()
  private readonly incoming = new Map<string, GraphLink[]>()
  private readonly outgoing = new Map<string, GraphLink[]>()
  private readonly anchorIndex = new Map<string, SectionRef[]>()

  constructor(raw: InMemoryGraph) {
    this.raw = raw
    for (const p of raw.pages) {
      this.pagesByPath.set(p.path, p)
      this.outgoing.set(p.path, [])
      for (const s of p.sections) {
        if (!s.anchor) continue
        const arr = this.anchorIndex.get(s.anchor) ?? []
        arr.push({ pagePath: p.path, anchor: s.anchor, headingPath: s.headingPath })
        this.anchorIndex.set(s.anchor, arr)
      }
    }
    for (const l of raw.links) {
      const out = this.outgoing.get(l.fromPath) ?? []
      out.push(l)
      this.outgoing.set(l.fromPath, out)
      if (l.toResolvedPath) {
        const inc = this.incoming.get(l.toResolvedPath) ?? []
        inc.push(l)
        this.incoming.set(l.toResolvedPath, inc)
      }
    }
  }

  static fromFiles(files: InMemoryFile[]): RichDocGraph {
    return new RichDocGraph(buildInMemoryGraph(files))
  }

  static fromJSON(json: InMemoryGraph): RichDocGraph {
    return new RichDocGraph(json)
  }

  toJSON(): InMemoryGraph {
    return this.raw
  }

  get pages(): GraphPage[] {
    return this.raw.pages
  }

  pageByPath(path: string): GraphPage | null {
    return this.pagesByPath.get(path) ?? null
  }

  pageByRef(ref: string): GraphPage | null {
    const hashAt = ref.indexOf("#")
    const path = hashAt === -1 ? ref : ref.slice(0, hashAt)
    return this.pageByPath(path)
  }

  outlineOf(pagePath: string): OutlineNode[] {
    const page = this.pageByPath(pagePath)
    if (!page) return []
    const root: OutlineNode[] = []
    const stack: OutlineNode[] = []
    for (const s of page.sections) {
      if (s.level === 0) continue
      const name = s.headingPath[s.headingPath.length - 1] ?? "(untitled)"
      const node: OutlineNode = {
        name,
        level: s.level,
        anchor: s.anchor,
        range: sectionRange(s),
        children: [],
      }
      while (stack.length > 0 && stack[stack.length - 1]!.level >= s.level) stack.pop()
      if (stack.length === 0) root.push(node)
      else stack[stack.length - 1]!.children.push(node)
      stack.push(node)
    }
    return root
  }

  breadcrumbsOf(sectionRef: SectionRef): string[] {
    return [...sectionRef.headingPath]
  }

  neighborsOf(sectionRef: SectionRef): NeighborInfo {
    const page = this.pageByPath(sectionRef.pagePath)
    if (!page) return { parent: null, prev: null, next: null, children: [] }

    const target = page.sections.find(
      (s) =>
        s.anchor === sectionRef.anchor &&
        headingPathEq(s.headingPath, sectionRef.headingPath),
    )
    if (!target) return { parent: null, prev: null, next: null, children: [] }

    const parent =
      target.headingPath.length > 1
        ? findSection(page, target.headingPath.slice(0, -1))
        : null

    let prev: GraphSection | null = null
    let next: GraphSection | null = null
    for (let i = 0; i < page.sections.length; i++) {
      const s = page.sections[i]!
      if (s === target) {
        for (let j = i - 1; j >= 0; j--) {
          if (page.sections[j]!.level === target.level) {
            prev = page.sections[j]!
            break
          }
          if (page.sections[j]!.level < target.level) break
        }
        for (let j = i + 1; j < page.sections.length; j++) {
          if (page.sections[j]!.level === target.level) {
            next = page.sections[j]!
            break
          }
          if (page.sections[j]!.level < target.level) break
        }
        break
      }
    }

    const children = page.sections.filter(
      (s) =>
        s.level === target.level + 1 &&
        s.headingPath.length === target.headingPath.length + 1 &&
        headingPathEq(s.headingPath.slice(0, -1), target.headingPath),
    )

    return {
      parent: parent ? sectionToRef(page.path, parent) : null,
      prev: prev ? sectionToRef(page.path, prev) : null,
      next: next ? sectionToRef(page.path, next) : null,
      children: children.map((c) => sectionToRef(page.path, c)),
    }
  }

  incomingLinks(pagePath: string): GraphLink[] {
    return this.incoming.get(pagePath) ?? []
  }

  outgoingLinks(pagePath: string): GraphLink[] {
    return this.outgoing.get(pagePath) ?? []
  }

  findByAnchor(slug: string): SectionRef[] {
    return this.anchorIndex.get(slug) ?? []
  }

  orphans(): GraphPage[] {
    return this.raw.pages.filter((p) => (this.incoming.get(p.path)?.length ?? 0) === 0)
  }

  unresolved(): GraphLink[] {
    return this.raw.unresolved
  }
}

function sectionRange(s: GraphSection): Range {
  return {
    start: { line: s.positionStartLine, col: s.positionStartCol },
    end: { line: s.positionEndLine, col: s.positionEndCol },
  }
}

function sectionToRef(pagePath: string, s: GraphSection): SectionRef {
  return { pagePath, anchor: s.anchor, headingPath: [...s.headingPath] }
}

function headingPathEq(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

function findSection(page: GraphPage, headingPath: string[]): GraphSection | null {
  return (
    page.sections.find((s) => headingPathEq(s.headingPath, headingPath)) ?? null
  )
}

function subsequenceMatch(query: string, target: string): boolean {
  if (!query) return true
  const q = query.toLowerCase()
  const t = target.toLowerCase()
  let qi = 0
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++
  }
  return qi === q.length
}

export function searchSymbols(graph: RichDocGraph, query: string, limit = 100): SymbolHit[] {
  const out: SymbolHit[] = []
  for (const p of graph.pages) {
    for (const s of p.sections) {
      if (s.level === 0) continue
      const name = s.headingPath[s.headingPath.length - 1] ?? ""
      if (!subsequenceMatch(query, name)) continue
      out.push({
        name,
        containerName: s.headingPath.length > 1 ? s.headingPath.slice(0, -1).join(" / ") : null,
        pagePath: p.path,
        anchor: s.anchor,
        range: sectionRange(s),
      })
      if (out.length >= limit) return out
    }
  }
  for (const p of graph.pages) {
    const title = p.title ?? p.path
    if (!subsequenceMatch(query, title)) continue
    out.push({
      name: title,
      containerName: p.path,
      pagePath: p.path,
      anchor: null,
      range: { start: { line: 0, col: 0 }, end: { line: 0, col: 0 } },
    })
    if (out.length >= limit) return out
  }
  return out
}

export interface SearchTextOptions {
  regex?: boolean
  caseSensitive?: boolean
  limit?: number
  contextChars?: number
  pathPrefix?: string
}

export function searchText(graph: RichDocGraph, query: string, opts: SearchTextOptions = {}): SearchHit[] {
  const limit = opts.limit ?? 50
  const ctx = opts.contextChars ?? 60
  const matcher: RegExp = opts.regex
    ? new RegExp(query, opts.caseSensitive ? "g" : "gi")
    : new RegExp(escapeRegex(query), opts.caseSensitive ? "g" : "gi")
  const hits: SearchHit[] = []

  for (const p of graph.pages) {
    if (opts.pathPrefix && !p.path.startsWith(opts.pathPrefix)) continue
    let m: RegExpExecArray | null
    matcher.lastIndex = 0
    while ((m = matcher.exec(p.content)) !== null) {
      const start = m.index
      const end = m.index + m[0].length
      const { line: startLine, col: startCol } = offsetToLineCol(p.content, start)
      const { line: endLine, col: endCol } = offsetToLineCol(p.content, end)
      const snippetStart = Math.max(0, start - ctx)
      const snippetEnd = Math.min(p.content.length, end + ctx)
      const snippet = (snippetStart > 0 ? "…" : "") + p.content.slice(snippetStart, snippetEnd) + (snippetEnd < p.content.length ? "…" : "")
      const containingSection = p.sections.find(
        (s) => s.positionStartLine <= startLine && s.positionEndLine >= startLine,
      )
      hits.push({
        pagePath: p.path,
        pageTitle: p.title,
        headingPath: containingSection?.headingPath ?? [],
        anchor: containingSection?.anchor ?? null,
        snippet,
        range: { start: { line: startLine, col: startCol }, end: { line: endLine, col: endCol } },
      })
      if (hits.length >= limit) return hits
      if (m[0].length === 0) matcher.lastIndex++
    }
  }
  return hits
}

export interface PageSummary {
  path: string
  title: string | null
  headingsCount: number
  charCount: number
}

export function listPages(graph: RichDocGraph, opts: { prefix?: string; limit?: number } = {}): PageSummary[] {
  const limit = opts.limit ?? 1000
  const out: PageSummary[] = []
  for (const p of graph.pages) {
    if (opts.prefix && !p.path.startsWith(opts.prefix)) continue
    out.push({
      path: p.path,
      title: p.title,
      headingsCount: p.sections.filter((s) => s.level >= 1).length,
      charCount: p.content.length,
    })
    if (out.length >= limit) break
  }
  return out
}

export function searchPaths(graph: RichDocGraph, glob: string): GraphPage[] {
  const re = globToRegex(glob)
  return graph.pages.filter((p) => re.test(p.path))
}

export function searchByAnchor(graph: RichDocGraph, slug: string): SectionRef[] {
  return graph.findByAnchor(slug)
}

export interface ResolveLinkArgs {
  fromPagePath: string
  linkText: string
  repo: string
  branch: string
}

export function resolveToGithubUrl(graph: RichDocGraph, args: ResolveLinkArgs): ResolvedGithubLink | null {
  const fromPage = graph.pageByPath(args.fromPagePath)
  if (!fromPage) return null

  let target = args.linkText.trim()
  let anchor: string | null = null
  const hashAt = target.indexOf("#")
  if (hashAt !== -1) {
    anchor = target.slice(hashAt + 1) || null
    target = target.slice(0, hashAt)
  }
  if (!target) {
    return {
      repo: args.repo,
      branch: args.branch,
      pagePath: fromPage.path,
      anchor,
      url: buildGithubBlobUrl(args.repo, args.branch, fromPage.path, anchor),
    }
  }

  if (/^https?:\/\//.test(target) || target.startsWith("mailto:")) return null

  const fromDir = fromPage.path.includes("/") ? fromPage.path.slice(0, fromPage.path.lastIndexOf("/")) : ""
  const joined = joinPath(fromDir, target)
  const existing = graph.pageByPath(joined) ?? graph.pageByPath(target)
  const resolvedPath = existing?.path ?? joined
  return {
    repo: args.repo,
    branch: args.branch,
    pagePath: resolvedPath,
    anchor,
    url: buildGithubBlobUrl(args.repo, args.branch, resolvedPath, anchor),
  }
}

export function buildGithubBlobUrl(repo: string, branch: string, path: string, anchor: string | null): string {
  const safePath = path.split("/").map((seg) => encodeURIComponent(seg)).join("/")
  const base = `https://github.com/${repo}/blob/${encodeURIComponent(branch)}/${safePath}`
  return anchor ? `${base}#${slugify(anchor)}` : base
}

function offsetToLineCol(text: string, offset: number): { line: number; col: number } {
  let line = 0
  let lastNl = -1
  for (let i = 0; i < offset; i++) {
    if (text.charCodeAt(i) === 10) {
      line++
      lastNl = i
    }
  }
  return { line, col: offset - lastNl - 1 }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function globToRegex(glob: string): RegExp {
  let re = "^"
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!
    if (c === "*") {
      if (glob[i + 1] === "*") {
        re += ".*"
        i++
      } else {
        re += "[^/]*"
      }
    } else if (c === "?") {
      re += "[^/]"
    } else if (".+^${}()|[]\\".includes(c)) {
      re += "\\" + c
    } else {
      re += c
    }
  }
  re += "$"
  return new RegExp(re)
}
