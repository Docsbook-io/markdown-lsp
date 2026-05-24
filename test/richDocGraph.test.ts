import { describe, it, expect } from "vitest"
import {
  RichDocGraph,
  searchSymbols,
  searchText,
  searchPaths,
  searchByAnchor,
  listPages,
  resolveToGithubUrl,
  buildGithubBlobUrl,
} from "../src/bridge/index.js"

const sampleFiles = [
  { path: "index.md", content: "# Home\n\nSee [auth](./docs/auth.md) and [billing](./docs/billing.md).\n\n## Quick links\n\n- [[guide]]\n" },
  { path: "guide.md", content: "# Guide\n\nIntroduction. Read about [authentication](./docs/auth.md#oauth-flow).\n" },
  { path: "docs/auth.md", content: "# Authentication\n\nUsers sign in.\n\n## OAuth flow\n\nRedirect → callback → token.\n\n## Sessions\n\nSee [home](../index.md)." },
  { path: "docs/billing.md", content: "# Billing\n\nPaddle.\n\n## Webhooks\n\nConfigured in admin." },
  { path: "docs/orphan.md", content: "# Orphan\n\nNo one links here." },
]

const graph = RichDocGraph.fromFiles(sampleFiles)

describe("RichDocGraph — indices", () => {
  it("pageByPath / pageByRef", () => {
    expect(graph.pageByPath("docs/auth.md")?.title).toBe("Authentication")
    expect(graph.pageByRef("docs/auth.md#oauth-flow")?.path).toBe("docs/auth.md")
    expect(graph.pageByPath("nope.md")).toBeNull()
  })

  it("outlineOf builds nested heading tree", () => {
    const outline = graph.outlineOf("docs/auth.md")
    expect(outline).toHaveLength(1)
    expect(outline[0]!.name).toBe("Authentication")
    expect(outline[0]!.children.map((c) => c.name)).toEqual(["OAuth flow", "Sessions"])
  })

  it("incomingLinks / outgoingLinks", () => {
    const incoming = graph.incomingLinks("docs/auth.md")
    expect(incoming.map((l) => l.fromPath).sort()).toEqual(["guide.md", "index.md"])
    const outgoing = graph.outgoingLinks("docs/auth.md")
    expect(outgoing.find((l) => l.toResolvedPath === "index.md")).toBeTruthy()
  })

  it("orphans()", () => {
    const orphans = graph.orphans().map((p) => p.path).sort()
    expect(orphans).toContain("docs/orphan.md")
    expect(orphans).not.toContain("docs/auth.md")
  })

  it("findByAnchor", () => {
    const hits = graph.findByAnchor("oauth-flow")
    expect(hits).toHaveLength(1)
    expect(hits[0]!.pagePath).toBe("docs/auth.md")
  })

  it("neighborsOf returns prev/next/parent/children correctly", () => {
    const target = { pagePath: "docs/auth.md", anchor: "oauth-flow", headingPath: ["Authentication", "OAuth flow"] }
    const n = graph.neighborsOf(target)
    expect(n.parent?.headingPath).toEqual(["Authentication"])
    expect(n.prev).toBeNull()
    expect(n.next?.headingPath).toEqual(["Authentication", "Sessions"])
  })

  it("toJSON / fromJSON round-trip", () => {
    const json = graph.toJSON()
    const restored = RichDocGraph.fromJSON(json)
    expect(restored.pageByPath("docs/auth.md")?.title).toBe("Authentication")
    expect(restored.orphans().some((p) => p.path === "docs/orphan.md")).toBe(true)
  })
})

describe("search", () => {
  it("searchSymbols subsequence-matches", () => {
    const hits = searchSymbols(graph, "oaf")
    expect(hits.some((h) => h.name === "OAuth flow")).toBe(true)
  })

  it("searchText finds matches across files", () => {
    const hits = searchText(graph, "Paddle")
    expect(hits).toHaveLength(1)
    expect(hits[0]!.pagePath).toBe("docs/billing.md")
    expect(hits[0]!.snippet).toContain("Paddle")
  })

  it("searchText supports regex", () => {
    const hits = searchText(graph, "sign\\s+in", { regex: true })
    expect(hits.length).toBeGreaterThan(0)
  })

  it("searchText respects pathPrefix", () => {
    const hits = searchText(graph, "Authentication", { pathPrefix: "guide" })
    expect(hits.every((h) => h.pagePath.startsWith("guide"))).toBe(true)
  })

  it("searchPaths glob", () => {
    const result = searchPaths(graph, "docs/*.md")
    const paths = result.map((p) => p.path).sort()
    expect(paths).toEqual(["docs/auth.md", "docs/billing.md", "docs/orphan.md"])
  })

  it("searchPaths recursive **", () => {
    const result = searchPaths(graph, "**/auth.md")
    expect(result.map((p) => p.path)).toEqual(["docs/auth.md"])
  })

  it("searchByAnchor", () => {
    const hits = searchByAnchor(graph, "oauth-flow")
    expect(hits[0]!.pagePath).toBe("docs/auth.md")
  })

  it("listPages with prefix", () => {
    const result = listPages(graph, { prefix: "docs/" })
    expect(result.map((p) => p.path).sort()).toEqual(["docs/auth.md", "docs/billing.md", "docs/orphan.md"])
  })
})

describe("resolveToGithubUrl", () => {
  it("converts relative link to absolute GitHub URL", () => {
    const res = resolveToGithubUrl(graph, {
      fromPagePath: "index.md",
      linkText: "./docs/auth.md",
      repo: "acme/docs",
      branch: "main",
    })
    expect(res?.pagePath).toBe("docs/auth.md")
    expect(res?.url).toBe("https://github.com/acme/docs/blob/main/docs/auth.md")
  })

  it("preserves anchor", () => {
    const res = resolveToGithubUrl(graph, {
      fromPagePath: "index.md",
      linkText: "./docs/auth.md#oauth-flow",
      repo: "acme/docs",
      branch: "main",
    })
    expect(res?.url.endsWith("#oauth-flow")).toBe(true)
  })

  it("resolves ../ paths", () => {
    const res = resolveToGithubUrl(graph, {
      fromPagePath: "docs/auth.md",
      linkText: "../index.md",
      repo: "acme/docs",
      branch: "main",
    })
    expect(res?.pagePath).toBe("index.md")
  })

  it("returns null for http(s) links", () => {
    const res = resolveToGithubUrl(graph, {
      fromPagePath: "index.md",
      linkText: "https://example.com",
      repo: "acme/docs",
      branch: "main",
    })
    expect(res).toBeNull()
  })

  it("anchor-only link points to same page", () => {
    const res = resolveToGithubUrl(graph, {
      fromPagePath: "docs/auth.md",
      linkText: "#sessions",
      repo: "acme/docs",
      branch: "main",
    })
    expect(res?.pagePath).toBe("docs/auth.md")
    expect(res?.anchor).toBe("sessions")
  })

  it("buildGithubBlobUrl encodes branch with special chars", () => {
    const url = buildGithubBlobUrl("acme/docs", "release/1.0", "docs/a.md", null)
    expect(url).toContain("release%2F1.0")
  })
})
