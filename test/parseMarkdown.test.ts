import { describe, it, expect } from "vitest"
import { parseMarkdown, slugify } from "../src/indexer/parseMarkdown.js"

describe("slugify", () => {
  it("lowercases and replaces spaces", () => {
    expect(slugify("Getting Started")).toBe("getting-started")
  })
  it("strips punctuation", () => {
    expect(slugify("OAuth 2.0 Flow!")).toBe("oauth-20-flow")
  })
})

describe("parseMarkdown — structure", () => {
  it("extracts title from first H1", () => {
    const { title } = parseMarkdown("# Hello\n\nbody")
    expect(title).toBe("Hello")
  })

  it("returns null title when no H1", () => {
    const { title } = parseMarkdown("## Sub\nbody")
    expect(title).toBeNull()
  })

  it("builds a single section when there are no headings", () => {
    const { sections } = parseMarkdown("just text\nno headings")
    expect(sections).toHaveLength(1)
    expect(sections[0]!.level).toBe(0)
  })

  it("creates a section per heading with correct heading path", () => {
    const md = `# A\n\nintro\n\n## A.1\n\ntext\n\n### A.1.a\n\nleaf\n\n## A.2\n\nother`
    const { sections } = parseMarkdown(md)
    expect(sections.map((s) => s.headingPath)).toEqual([
      ["A"],
      ["A", "A.1"],
      ["A", "A.1", "A.1.a"],
      ["A", "A.2"],
    ])
  })

  it("computes anchors via slugify", () => {
    const { sections } = parseMarkdown("# OAuth 2.0 Flow")
    expect(sections[0]!.anchor).toBe("oauth-20-flow")
  })

  it("includes correct line positions", () => {
    const md = "# A\nline1\n## B\nline2"
    const { sections } = parseMarkdown(md)
    expect(sections[0]!.positionStartLine).toBe(0)
    expect(sections[1]!.headingPath).toEqual(["A", "B"])
    expect(sections[1]!.positionStartLine).toBe(2)
  })
})

describe("parseMarkdown — links", () => {
  it("extracts inline links and ignores externals", () => {
    const md = "# T\n\nSee [api](./api.md) and [google](https://google.com)."
    const { links } = parseMarkdown(md)
    expect(links).toHaveLength(1)
    expect(links[0]!.toPath).toBe("./api.md")
    expect(links[0]!.kind).toBe("inline")
    expect(links[0]!.textAtLink).toBe("api")
  })

  it("captures anchors after #", () => {
    const md = "# T\n\nSee [paddle](./billing.md#paddle)."
    const { links } = parseMarkdown(md)
    expect(links[0]!.toPath).toBe("./billing.md")
    expect(links[0]!.toAnchor).toBe("paddle")
  })

  it("extracts wiki links with anchor + alias", () => {
    const md = "# T\n\nGo to [[auth#sessions|Sessions]]."
    const { links } = parseMarkdown(md)
    expect(links).toHaveLength(1)
    expect(links[0]!.kind).toBe("wiki")
    expect(links[0]!.toPath).toBe("auth")
    expect(links[0]!.toAnchor).toBe("sessions")
    expect(links[0]!.textAtLink).toBe("Sessions")
  })

  it("resolves reference-style links via definitions", () => {
    const md = "# T\n\nSee [the api][api-ref].\n\n[api-ref]: ./api.md"
    const { links } = parseMarkdown(md)
    expect(links).toHaveLength(1)
    expect(links[0]!.kind).toBe("reference")
    expect(links[0]!.toPath).toBe("./api.md")
  })

  it("attributes link to its enclosing section", () => {
    const md = `# A\n\n[x](./x.md)\n\n## B\n\n[y](./y.md)`
    const { links } = parseMarkdown(md)
    const x = links.find((l) => l.toPath === "./x.md")!
    const y = links.find((l) => l.toPath === "./y.md")!
    expect(x.fromSectionIndex).toBe(0)
    expect(y.fromSectionIndex).toBe(1)
  })
})
