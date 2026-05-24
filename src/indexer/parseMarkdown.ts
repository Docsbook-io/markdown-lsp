import { unified } from "unified"
import remarkParse from "remark-parse"
import remarkGfm from "remark-gfm"
import { toString as mdastToString } from "mdast-util-to-string"
import type { Root, Heading, Link, LinkReference, Definition, Node, Parent } from "mdast"

const parser = unified().use(remarkParse).use(remarkGfm)

export interface ParsedSection {
  headingPath: string[]
  anchor: string | null
  level: number
  content: string
  charCount: number
  positionStartLine: number
  positionStartCol: number
  positionEndLine: number
  positionEndCol: number
}

export interface ParsedLink {
  toPath: string
  toAnchor: string | null
  kind: "inline" | "reference" | "wiki" | "autolink"
  textAtLink: string | null
  fromSectionIndex: number | null
  positionStartLine: number
  positionStartCol: number
  positionEndLine: number
  positionEndCol: number
}

export interface ParsedDocument {
  title: string | null
  sections: ParsedSection[]
  links: ParsedLink[]
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
}

function getPosition(node: Node) {
  const p = node.position
  if (!p) return { startLine: 0, startCol: 0, endLine: 0, endCol: 0 }
  return {
    startLine: p.start.line - 1,
    startCol: p.start.column - 1,
    endLine: p.end.line - 1,
    endCol: p.end.column - 1,
  }
}

function isParent(node: Node): node is Parent {
  return "children" in node && Array.isArray((node as Parent).children)
}

function visit(node: Node, fn: (n: Node) => void) {
  fn(node)
  if (isParent(node)) {
    for (const child of node.children) visit(child, fn)
  }
}

function extractWikiLinksFromText(text: string, baseLine: number, baseCol: number): ParsedLink[] {
  const re = /\[\[([^\]|#]+)(?:#([^\]|]+))?(?:\|([^\]]+))?\]\]/g
  const out: ParsedLink[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    out.push({
      toPath: m[1]!.trim(),
      toAnchor: m[2]?.trim() ?? null,
      kind: "wiki",
      textAtLink: m[3]?.trim() ?? m[1]!.trim(),
      fromSectionIndex: null,
      positionStartLine: baseLine,
      positionStartCol: baseCol + m.index,
      positionEndLine: baseLine,
      positionEndCol: baseCol + m.index + m[0].length,
    })
  }
  return out
}

function parseLinkTarget(raw: string): { path: string; anchor: string | null } {
  const hashAt = raw.indexOf("#")
  if (hashAt === -1) return { path: raw, anchor: null }
  return { path: raw.slice(0, hashAt), anchor: raw.slice(hashAt + 1) || null }
}

export function parseMarkdown(source: string): ParsedDocument {
  const tree = parser.parse(source) as Root

  const definitions = new Map<string, string>()
  visit(tree, (n) => {
    if (n.type === "definition") {
      const d = n as Definition
      definitions.set(d.identifier.toLowerCase(), d.url)
    }
  })

  let title: string | null = null
  const sections: ParsedSection[] = []
  const lines = source.split(/\r?\n/)

  const headings: { node: Heading; index: number }[] = []
  for (let i = 0; i < tree.children.length; i++) {
    const child = tree.children[i]!
    if (child.type === "heading") headings.push({ node: child as Heading, index: i })
  }

  if (headings.length === 0) {
    const pos = getPosition(tree)
    sections.push({
      headingPath: [],
      anchor: null,
      level: 0,
      content: source,
      charCount: source.length,
      positionStartLine: 0,
      positionStartCol: 0,
      positionEndLine: lines.length - 1,
      positionEndCol: lines[lines.length - 1]?.length ?? 0,
      ...pos,
    } as ParsedSection)
  } else {
    const headingStack: { text: string; level: number }[] = []

    for (let h = 0; h < headings.length; h++) {
      const { node: hNode, index: childIndex } = headings[h]!
      const text = mdastToString(hNode).trim()
      const level = hNode.depth

      while (headingStack.length > 0 && headingStack[headingStack.length - 1]!.level >= level) {
        headingStack.pop()
      }
      headingStack.push({ text, level })
      const headingPath = headingStack.map((s) => s.text)

      if (title === null && level === 1) title = text

      const hPos = getPosition(hNode)
      const nextHeadingIndex = headings[h + 1]?.index ?? tree.children.length
      const endNode = tree.children[nextHeadingIndex - 1] ?? hNode
      const endPos = getPosition(endNode)

      const startLine = hPos.startLine
      const endLine = endPos.endLine
      const startCol = hPos.startCol
      const endCol = endPos.endCol

      const content = lines.slice(startLine, endLine + 1).join("\n")

      sections.push({
        headingPath,
        anchor: slugify(text),
        level,
        content,
        charCount: content.length,
        positionStartLine: startLine,
        positionStartCol: startCol,
        positionEndLine: endLine,
        positionEndCol: endCol,
      })

      void childIndex
    }
  }

  const linksOut: ParsedLink[] = []

  const findSectionForPos = (line: number): number | null => {
    for (let i = sections.length - 1; i >= 0; i--) {
      if (sections[i]!.positionStartLine <= line) return i
    }
    return sections.length > 0 ? 0 : null
  }

  visit(tree, (n) => {
    if (n.type === "link") {
      const l = n as Link
      const url = l.url
      if (!url || url.startsWith("http://") || url.startsWith("https://") || url.startsWith("mailto:")) return
      const pos = getPosition(l)
      const { path, anchor } = parseLinkTarget(url)
      linksOut.push({
        toPath: path,
        toAnchor: anchor,
        kind: "inline",
        textAtLink: mdastToString(l) || null,
        fromSectionIndex: findSectionForPos(pos.startLine),
        positionStartLine: pos.startLine,
        positionStartCol: pos.startCol,
        positionEndLine: pos.endLine,
        positionEndCol: pos.endCol,
      })
    } else if (n.type === "linkReference") {
      const lr = n as LinkReference
      const url = definitions.get(lr.identifier.toLowerCase())
      if (!url) return
      if (url.startsWith("http://") || url.startsWith("https://") || url.startsWith("mailto:")) return
      const pos = getPosition(lr)
      const { path, anchor } = parseLinkTarget(url)
      linksOut.push({
        toPath: path,
        toAnchor: anchor,
        kind: "reference",
        textAtLink: mdastToString(lr) || null,
        fromSectionIndex: findSectionForPos(pos.startLine),
        positionStartLine: pos.startLine,
        positionStartCol: pos.startCol,
        positionEndLine: pos.endLine,
        positionEndCol: pos.endCol,
      })
    } else if (n.type === "text") {
      const txt = (n as unknown as { value: string }).value
      if (!txt.includes("[[")) return
      const pos = getPosition(n)
      const wikiLinks = extractWikiLinksFromText(txt, pos.startLine, pos.startCol)
      for (const wl of wikiLinks) {
        wl.fromSectionIndex = findSectionForPos(wl.positionStartLine)
        linksOut.push(wl)
      }
    }
  })

  return { title, sections, links: linksOut }
}
