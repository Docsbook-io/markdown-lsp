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

// ── Ranked full-text search ────────────────────────────────────────────────────
//
// `searchText` above is a verbatim (or regex) matcher — it only fires when the
// query string appears literally in a page. That's right for grep, but wrong for
// natural-language questions ("how to create docs", "what formats can I use"):
// the exact phrase rarely exists, so it returns nothing and a chat agent answers
// "the documentation does not cover that".
//
// `searchTextRanked` fixes that: it tokenizes the query into words, finds pages
// that contain those words (not the literal phrase), and ranks them by how many
// distinct query words they cover, frequency, whether words land in a heading,
// and how tightly the words cluster (a near-phrase match scores higher). The
// returned snippet is centred on the best-matching window. Stop words are
// dropped so "how to create docs" effectively searches for "create" + "docs".

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "can", "do", "does", "for",
  "from", "how", "i", "in", "is", "it", "its", "me", "my", "of", "on", "or",
  "our", "that", "the", "their", "them", "this", "to", "use", "using", "was",
  "we", "what", "when", "where", "which", "who", "why", "will", "with", "you",
  "your",
])

/** Split free text into lowercased word tokens (letters/digits, length ≥ 2). */
function tokenizeText(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? [])
}

/** Query tokens: dedup, drop stop words. If every token is a stop word (a very
 *  short query like "do it"), keep them so the search still has something to do. */
function queryTokens(query: string): string[] {
  const all = Array.from(new Set(tokenizeText(query)))
  const meaningful = all.filter((t) => !STOP_WORDS.has(t))
  return meaningful.length > 0 ? meaningful : all
}

interface TokenOccurrence {
  token: string
  index: number // char offset in page content
}

/** All occurrences of any query token in a page, in document order. */
function tokenOccurrences(content: string, tokens: string[]): TokenOccurrence[] {
  const occ: TokenOccurrence[] = []
  const lower = content.toLowerCase()
  for (const token of tokens) {
    let from = 0
    for (;;) {
      const at = lower.indexOf(token, from)
      if (at === -1) break
      // word-ish boundary check so "doc" doesn't match inside "docker" only when
      // it's clearly a substring of a longer word on BOTH sides; we still allow
      // prefix/suffix matches (plurals, "docs" ⊃ "doc") for recall.
      occ.push({ token, index: at })
      from = at + token.length
    }
  }
  occ.sort((a, b) => a.index - b.index)
  return occ
}

/**
 * Find the tightest window (by char span) that covers the most DISTINCT query
 * tokens. Returns the covered token set and the [start,end] char span of that
 * window, used both for scoring (proximity) and for centring the snippet.
 */
function bestWindow(
  occ: TokenOccurrence[],
  tokenCount: number,
): { covered: Set<string>; start: number; end: number; span: number } | null {
  if (occ.length === 0) return null
  let best: { covered: Set<string>; start: number; end: number; span: number } | null = null
  // Sliding window over occurrences ordered by position.
  let left = 0
  const counts = new Map<string, number>()
  let distinct = 0
  for (let right = 0; right < occ.length; right++) {
    const tk = occ[right]!.token
    const c = counts.get(tk) ?? 0
    counts.set(tk, c + 1)
    if (c === 0) distinct++
    // Shrink from the left while we still keep all distinct tokens in window.
    while (left < right) {
      const lt = occ[left]!.token
      const lc = counts.get(lt) ?? 0
      if (lc <= 1) break
      counts.set(lt, lc - 1)
      left++
    }
    const start = occ[left]!.index
    const end = occ[right]!.index + occ[right]!.token.length
    const span = end - start
    if (
      !best ||
      distinct > best.covered.size ||
      (distinct === best.covered.size && span < best.span)
    ) {
      best = {
        covered: new Set([...counts.entries()].filter(([, n]) => n > 0).map(([t]) => t)),
        start,
        end,
        span,
      }
    }
    if (distinct === tokenCount && span === 0) break
  }
  return best
}

export interface RankedSearchHit extends SearchHit {
  matchScore: number
}

/**
 * Tokenized, ranked full-text search across the graph. Unlike `searchText`, this
 * matches on individual query WORDS (after stop-word removal) rather than the
 * literal phrase, then ranks pages by coverage / frequency / heading hits /
 * proximity. Best for natural-language questions from an AI chat. One hit per
 * page (the best window), highest score first.
 */
export function searchTextRanked(
  graph: RichDocGraph,
  query: string,
  opts: SearchTextOptions = {},
): RankedSearchHit[] {
  const tokens = queryTokens(query)
  if (tokens.length === 0) return []
  const limit = opts.limit ?? 20
  const ctx = opts.contextChars ?? 120

  const hits: RankedSearchHit[] = []
  for (const p of graph.pages) {
    if (opts.pathPrefix && !p.path.startsWith(opts.pathPrefix)) continue
    const occ = tokenOccurrences(p.content, tokens)
    if (occ.length === 0) continue

    const win = bestWindow(occ, tokens.length)
    if (!win) continue

    const coverage = win.covered.size / tokens.length // 0..1 fraction of query words present
    const frequency = occ.length // total token occurrences (capped in score)

    // Heading bonus: any query token appearing in a page heading or title.
    const headingHay = (
      (p.title ?? "") + " " + p.sections.map((s) => s.headingPath.join(" ")).join(" ")
    ).toLowerCase()
    const headingHits = tokens.filter((t) => headingHay.includes(t)).length

    // Proximity bonus: tighter windows (near-phrase) score higher. A window that
    // spans roughly the matched tokens' own length is ~phrase-adjacent.
    const idealSpan = win.covered.size * 12
    const proximity = win.span <= 0 ? 1 : Math.max(0, 1 - win.span / Math.max(idealSpan * 8, 1))

    const matchScore =
      coverage * 100 + // dominant: how much of the query is present
      headingHits * 8 + // strong signal: the words are in a heading/title
      proximity * 12 + // near-phrase matches beat scattered words
      Math.min(frequency, 10) * 0.5 // mild frequency nudge, capped

    // Snippet centred on the best window.
    const snippetStart = Math.max(0, win.start - ctx)
    const snippetEnd = Math.min(p.content.length, win.end + ctx)
    const snippet =
      (snippetStart > 0 ? "…" : "") +
      p.content.slice(snippetStart, snippetEnd).replace(/\s+/g, " ").trim() +
      (snippetEnd < p.content.length ? "…" : "")

    const { line: startLine, col: startCol } = offsetToLineCol(p.content, win.start)
    const { line: endLine, col: endCol } = offsetToLineCol(p.content, win.end)
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
      matchScore,
    })
  }

  hits.sort((a, b) => b.matchScore - a.matchScore)
  return hits.slice(0, limit)
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
