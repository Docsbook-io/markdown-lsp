/**
 * Granular semantic units — splits doc pages into heading-level or paragraph-level units
 * for fine-grained semantic search and heading-level graph nodes.
 */

import type { GraphPage, GraphSection } from "../bridge/inMemoryGraph.js"

// ── Types ─────────────────────────────────────────────────────────────────────

export type GranularityLevel = "page" | "heading" | "line"

export interface SemanticUnit {
  level: GranularityLevel
  /** Stable unique ID. page: pagePath. heading: pagePath#anchor. line: pagePath#L<startLine> */
  id: string
  pagePath: string
  /** Page title (null if page has no title) */
  pageTitle: string | null
  /** heading/line only */
  anchor?: string | null
  /** heading only — breadcrumb path e.g. ["Parent", "Child"] */
  headingPath?: string[]
  /** line only — 0-based start line of the paragraph block */
  line?: number
  /** The text to embed */
  text: string
}

// ── Page-level units (current behaviour) ─────────────────────────────────────

export function unitizePages(page: GraphPage): SemanticUnit[] {
  const titlePart = page.title ? page.title + "\n\n" : ""
  return [
    {
      level: "page",
      id: page.path,
      pagePath: page.path,
      pageTitle: page.title,
      text: (titlePart + page.content).slice(0, 6000),
    },
  ]
}

// ── Heading-level units ───────────────────────────────────────────────────────

export function unitizeHeadings(page: GraphPage): SemanticUnit[] {
  if (page.sections.length === 0) {
    // Fallback to page unit if no sections
    return unitizePages(page)
  }

  return page.sections.map((s: GraphSection): SemanticUnit => {
    const anchor = s.anchor ?? slugifyHeading(s.headingPath[s.headingPath.length - 1] ?? "section")
    const id = `${page.path}#${anchor}`
    const breadcrumb = s.headingPath.join(" > ")
    const text = (breadcrumb ? breadcrumb + "\n\n" : "") + s.content
    return {
      level: "heading",
      id,
      pagePath: page.path,
      pageTitle: page.title,
      anchor: s.anchor,
      headingPath: s.headingPath,
      text: text.slice(0, 6000),
    }
  })
}

// ── Line-level units (paragraph blocks) ──────────────────────────────────────

/** Split page content into paragraph blocks (groups of lines separated by blank lines). */
export function splitParagraphs(content: string): Array<{ text: string; startLine: number }> {
  const lines = content.split("\n")
  const paras: Array<{ text: string; startLine: number }> = []
  let buf: string[] = []
  let startLine = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (line.trim() === "") {
      if (buf.length > 0) {
        paras.push({ text: buf.join("\n").trim(), startLine })
        buf = []
      }
    } else {
      if (buf.length === 0) startLine = i
      buf.push(line)
    }
  }
  if (buf.length > 0) {
    paras.push({ text: buf.join("\n").trim(), startLine })
  }

  // Filter out very short paragraphs (titles only, fences, etc.)
  return paras.filter((p) => p.text.length > 20)
}

export function unitizeLines(page: GraphPage): SemanticUnit[] {
  const paras = splitParagraphs(page.content)
  if (paras.length === 0) return unitizePages(page)

  return paras.map((para): SemanticUnit => {
    const id = `${page.path}#L${para.startLine}`
    return {
      level: "line",
      id,
      pagePath: page.path,
      pageTitle: page.title,
      line: para.startLine,
      text: para.text.slice(0, 6000),
    }
  })
}

// ── Dispatcher ────────────────────────────────────────────────────────────────

export function unitize(pages: GraphPage[], granularity: GranularityLevel): SemanticUnit[] {
  const units: SemanticUnit[] = []
  for (const page of pages) {
    switch (granularity) {
      case "page":
        units.push(...unitizePages(page))
        break
      case "heading":
        units.push(...unitizeHeadings(page))
        break
      case "line":
        units.push(...unitizeLines(page))
        break
    }
  }
  return units
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
}
