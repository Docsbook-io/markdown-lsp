import { describe, it, expect } from "vitest"
import { buildInMemoryGraph } from "../src/bridge/inMemoryGraph.js"

describe("buildInMemoryGraph", () => {
  it("parses pages, sections, and resolves links across files", () => {
    const graph = buildInMemoryGraph([
      { path: "index.md", content: "# Home\n\nGo to [API](./docs/api.md) and [[guide]]." },
      { path: "docs/api.md", content: "# API\n\nSee [home](../index.md).\n\n## Endpoints\n\n- foo" },
      { path: "guide.md", content: "# Guide\n\nSee [[index]]." },
    ])

    expect(graph.pages.map((p) => p.path).sort()).toEqual(["docs/api.md", "guide.md", "index.md"])

    const api = graph.pages.find((p) => p.path === "docs/api.md")!
    expect(api.title).toBe("API")
    expect(api.sections.map((s) => s.headingPath).sort()).toEqual([["API"], ["API", "Endpoints"]])

    const allResolved = graph.links.filter((l) => l.toResolvedPath !== null)
    expect(allResolved).toHaveLength(graph.links.length)
    expect(graph.unresolved).toHaveLength(0)

    const wiki = graph.links.find((l) => l.kind === "wiki" && l.toPath === "guide")!
    expect(wiki.toResolvedPath).toBe("guide.md")
  })

  it("reports unresolved links", () => {
    const graph = buildInMemoryGraph([
      { path: "index.md", content: "# Home\n\nGo to [[broken]] and [missing](./none.md)." },
    ])
    expect(graph.unresolved).toHaveLength(2)
    const targets = graph.unresolved.map((u) => u.toPath).sort()
    expect(targets).toEqual(["./none.md", "broken"])
  })

  it("ignores http(s) and mailto links", () => {
    const graph = buildInMemoryGraph([
      { path: "a.md", content: "# A\n\n[ext](https://example.com) and [mail](mailto:x@y.com)" },
    ])
    expect(graph.links).toHaveLength(0)
  })
})
