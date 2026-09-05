import { describe, it, expect } from "vitest"
import {
  RichDocGraph,
  searchSymbols,
  searchText,
  searchTextRanked,
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

describe("search — frontmatter is never exposed", () => {
  // Regression: the closing `---` right after non-blank YAML (including a
  // colon inside a quoted string) used to parse as a Setext heading, so the
  // frontmatter body leaked into headingPath, and the raw page content
  // (frontmatter included) was what searchText/searchTextRanked scanned,
  // so it also bled into snippets.
  const frontmatterFiles = [
    {
      path: "concepts.md",
      content: [
        "---",
        'title: "Как устроен NN Agent: клиент, аккаунт, кампания, диалог"',
        'description: "Разбор сущностей NN Agent, из которых строится всё остальное."',
        "---",
        "# Как устроен NN Agent",
        "",
        "Клиент создаёт аккаунт мессенджера и запускает кампанию.",
      ].join("\n"),
    },
  ]
  const fmGraph = RichDocGraph.fromFiles(frontmatterFiles)

  it("headingPath from a matched section never contains frontmatter keys or delimiters", () => {
    const hits = searchText(fmGraph, "аккаунт")
    expect(hits.length).toBeGreaterThan(0)
    for (const h of hits) {
      const joined = h.headingPath.join(" ")
      expect(joined).not.toContain("title:")
      expect(joined).not.toContain("description:")
      expect(joined).not.toContain("---")
    }
  })

  it("snippet from searchText never bleeds frontmatter body or its delimiters", () => {
    const hits = searchText(fmGraph, "мессенджера")
    expect(hits.length).toBeGreaterThan(0)
    for (const h of hits) {
      expect(h.snippet).not.toContain("title:")
      expect(h.snippet).not.toContain("description:")
      expect(h.snippet).not.toContain("---")
    }
  })

  it("snippet from searchTextRanked never bleeds frontmatter body or its delimiters", () => {
    const ranked = searchTextRanked(fmGraph, "аккаунт кампания")
    expect(ranked.length).toBeGreaterThan(0)
    for (const h of ranked) {
      expect(h.snippet).not.toContain("title:")
      expect(h.snippet).not.toContain("description:")
      expect(h.snippet).not.toContain("---")
    }
  })

  it("page title comes from the real H1, not a frontmatter key", () => {
    expect(fmGraph.pageByPath("concepts.md")?.title).toBe("Как устроен NN Agent")
  })

  it("listPages headingsCount matches the real headings on the page, not real+1", () => {
    // Regression: get_doc_outline (backed by listPages) reported exactly one
    // extra heading on every frontmattered page — the frontmatter block
    // counted as heading #1 ahead of the actual "# Как устроен NN Agent".
    const [summary] = listPages(fmGraph, { prefix: "concepts.md" })
    expect(summary!.headingsCount).toBe(1)
  })

  it("listPages charCount reflects visible content, not frontmatter-inflated length", () => {
    const [summary] = listPages(fmGraph, { prefix: "concepts.md" })
    const rawLength = frontmatterFiles[0]!.content.length
    // The frontmatter block occupies real characters in the raw file; a
    // reader-facing char count should not include markup they never see.
    expect(summary!.charCount).toBeLessThan(rawLength)
  })
})

describe("searchTextRanked", () => {
  it("matches individual words, not the literal phrase (the searchText gap)", () => {
    // The phrase "OAuth token redirect" appears nowhere verbatim, so the legacy
    // verbatim searchText finds nothing — ranked search still locates the page.
    expect(searchText(graph, "OAuth token redirect")).toHaveLength(0)
    const ranked = searchTextRanked(graph, "OAuth token redirect")
    expect(ranked.length).toBeGreaterThan(0)
    expect(ranked[0]!.pagePath).toBe("docs/auth.md")
  })

  it("drops stop words and matches on the meaningful tokens", () => {
    // "how do users sign in" → real tokens: users, sign (in/do/how are stop words)
    const ranked = searchTextRanked(graph, "how do users sign in")
    expect(ranked.length).toBeGreaterThan(0)
    expect(ranked[0]!.pagePath).toBe("docs/auth.md")
  })

  it("ranks heading/title hits above scattered body matches", () => {
    const ranked = searchTextRanked(graph, "billing webhooks")
    expect(ranked[0]!.pagePath).toBe("docs/billing.md")
  })

  it("returns more coverage = higher score", () => {
    const ranked = searchTextRanked(graph, "authentication oauth sessions")
    expect(ranked[0]!.pagePath).toBe("docs/auth.md")
    // auth.md covers all three concepts, so it must outscore any single-word page.
    expect(ranked[0]!.matchScore).toBeGreaterThan(ranked[1]?.matchScore ?? 0)
  })

  it("respects pathPrefix", () => {
    const ranked = searchTextRanked(graph, "authentication", { pathPrefix: "guide" })
    expect(ranked.every((h) => h.pagePath.startsWith("guide"))).toBe(true)
  })

  it("returns [] when no query token appears anywhere", () => {
    expect(searchTextRanked(graph, "kubernetes terraform")).toEqual([])
  })

  // Regression: on real (multi-thousand-char) docs pages, the old proximity
  // formula (`1 - span / (idealSpan * 8)`) hit its floor of exactly 0 for any
  // span past ~288 chars (3-token query: 3 * 12 * 8) — which real docs pages
  // blow past routinely, since a full-sentence question's tokens rarely
  // cluster inside a couple hundred characters. Two pages whose matched
  // window is 800 chars and 4000 chars therefore scored IDENTICALLY on
  // proximity under the old formula (both 0), even though one is clearly a
  // tighter, more relevant match — the ranking then fell back to array/file
  // order, not relevance, to decide which ranked higher. This is exactly how
  // a page containing the right answer (docs/quick-start.md, in this repo's
  // own docs/) lost to unrelated pages purely because of iteration order.
  // Both fixture spans below are well past the old floor, so a pre-fix run
  // must score them equal (this test is red on the pre-fix code).
  it("does not flatten proximity to a hard-tied floor on long, spread-out matches", () => {
    const longFiles = [
      {
        path: "medium-spread.md",
        content:
          "# Medium Spread\n\n" +
          "alpha " +
          "x ".repeat(400) +
          "beta " +
          "y ".repeat(400) +
          "gamma\n",
      },
      {
        path: "very-spread.md",
        // Same three tokens, spread roughly 5x further apart than the page
        // above — representative of a real docs page where a question's
        // words land in different, unrelated sections.
        content:
          "# Very Spread\n\n" +
          "alpha " +
          "x ".repeat(2000) +
          "beta " +
          "y ".repeat(2000) +
          "gamma\n",
      },
    ]
    const longGraph = RichDocGraph.fromFiles(longFiles)
    const ranked = searchTextRanked(longGraph, "alpha beta gamma", { limit: 10 })
    expect(ranked).toHaveLength(2)
    const medium = ranked.find((h) => h.pagePath === "medium-spread.md")!
    const veryspread = ranked.find((h) => h.pagePath === "very-spread.md")!
    // Both have 100% coverage and zero heading hits, so the ONLY thing that
    // can (and must) separate them is proximity — it must not have collapsed
    // to the same floor for both, even though both spans are already well
    // past the point where the old formula flattened to 0.
    expect(medium.matchScore).toBeGreaterThan(veryspread.matchScore)
    expect(medium.matchScore - veryspread.matchScore).toBeGreaterThan(0.1)
  })

  // Regression: a query word repeated inside fenced/inline code (a URL pasted
  // into several install snippets, a CLI flag, a config key) counted as real
  // occurrences exactly like a prose discussion of that word would, so a page
  // that only pastes the term into code samples — never actually discussing
  // it — could out-rank, or spuriously tie with, a page that genuinely
  // explains it in prose. Confirmed on this repo's own docs/: ai/mcp.md (12
  // "URL" hits, all inside per-client install code blocks) out-scored
  // quick-start.md (which explains the URL pattern in prose) for "What URL
  // pattern does Docsbook use to serve my documentation site?".
  it("does not count a query word repeated only inside code spans as a match", () => {
    const codeFiles = [
      {
        path: "prose.md",
        content:
          "# Docs\n\n" +
          "Your site is served at a predictable URL pattern based on your account and repo name.\n",
      },
      {
        path: "code-only.md",
        // Both query words appear ONLY inside fenced code, repeated across
        // six client-install snippets — never once in actual prose.
        content:
          "# Server Setup\n\n" +
          "Paste this into each of your six clients:\n\n" +
          "```\nurl pattern: https://example.com/a\n```\n" +
          "```\nurl pattern: https://example.com/b\n```\n" +
          "```\nurl pattern: https://example.com/c\n```\n" +
          "```\nurl pattern: https://example.com/d\n```\n" +
          "```\nurl pattern: https://example.com/e\n```\n" +
          "```\nurl pattern: https://example.com/f\n```\n" +
          "Setup complete once all clients are configured.\n",
      },
    ]
    const codeGraph = RichDocGraph.fromFiles(codeFiles)
    const ranked = searchTextRanked(codeGraph, "URL pattern", { limit: 10 })
    // code-only.md's tokens exist nowhere outside code, so masking must drop
    // it from the results entirely rather than let the code occurrences count.
    expect(ranked.map((h) => h.pagePath)).toEqual(["prose.md"])
  })

  // Regression: `tokenOccurrences`/heading-hit matching used to be a bare
  // `indexOf`/`.includes()` substring search, no word-boundary check at all —
  // despite a comment claiming one existed. A query word matched inside any
  // longer word that merely contains it as a substring, crediting a page with
  // occurrences (and heading hits, if it landed in a title) it never earned.
  // Word-boundary checking only rejects a MID-WORD sandwich (a letter on BOTH
  // sides, like "cat" inside "concatenate"); a match with a boundary on just
  // one side (a prefix like "url" ⊂ "urls", or a suffix like "doc" ⊂ "docs")
  // still counts — that half of the trade-off is deliberate (see the next
  // test) and not something a boundary check alone can resolve without real
  // stemming.
  it("does not match a query word sandwiched inside a longer word on both sides", () => {
    const files = [
      {
        path: "concat-only.md",
        // "cat" only ever appears as a mid-word substring of "concatenate"
        // here — never as the standalone word.
        content: "# String Utilities\n\nUse this helper to concatenate multiple strings efficiently.\n",
      },
      {
        path: "real-cat-page.md",
        content: "# Pets\n\nOur cat sleeps most of the day.\n",
      },
    ]
    const g = RichDocGraph.fromFiles(files)
    const ranked = searchTextRanked(g, "cat", { limit: 10 })
    // concat-only.md has zero standalone occurrences of "cat" (only as a
    // mid-word substring of "concatenate"), so it must not appear at all.
    expect(ranked.map((h) => h.pagePath)).toEqual(["real-cat-page.md"])
  })

  it("still allows a genuine prefix/suffix match (plurals, stems)", () => {
    const files = [{ path: "p.md", content: "# Docs\n\nWe support multiple docs sites and doc formats.\n" }]
    const g = RichDocGraph.fromFiles(files)
    // "doc" is a real prefix of "docs" — this recall trade-off must still work
    // after the word-boundary fix (only mid-word sandwiching is rejected).
    const ranked = searchTextRanked(g, "doc", { limit: 10 })
    expect(ranked.map((h) => h.pagePath)).toEqual(["p.md"])
  })

  // Regression: `coverage` used to be a flat fraction of distinct query words
  // present, treating every word as equally informative. On a real docs
  // corpus, a common word ("common", present on 7/8 pages here) carries far
  // less relevance signal than a rare, discriminating one ("rare", present on
  // only 1/8) — so two pages that each cover the SAME NUMBER of query words
  // (2 of "shared rare common") are not equally relevant depending on WHICH
  // words those are, and the old flat fraction couldn't tell them apart.
  //
  // The two candidate pages below use an identical template (only the single
  // rare/common word differs, in the same sentence position), so coverage
  // fraction, frequency, proximity, and heading hits are all equal between
  // them — isolating IDF as the only thing that can (and must) separate them.
  // On the pre-fix code this pair still happens to differ, but only by
  // ~0.1 points of proximity-span noise from the differing word length —
  // confirmed via `git stash` on this file, margin 78.729 vs 78.604. The
  // `> 10` threshold below is well above that noise floor, so this only
  // passes when IDF is deliberately weighting the rare word, not by luck.
  it("weights a rare, discriminating query word above a common one shared by most pages", () => {
    const filler = "This filler page exists only to make common appear frequently across the corpus.\n"
    const files = [
      { path: "filler-1.md", content: `# F1\n\n${filler}` },
      { path: "filler-2.md", content: `# F2\n\n${filler}` },
      { path: "filler-3.md", content: `# F3\n\n${filler}` },
      { path: "filler-4.md", content: `# F4\n\n${filler}` },
      { path: "filler-5.md", content: `# F5\n\n${filler}` },
      { path: "filler-6.md", content: `# F6\n\n${filler}` },
      { path: "covers-common.md", content: "# Match\n\nThis page discusses shared and common topics together.\n" },
      { path: "covers-rare.md", content: "# Match\n\nThis page discusses shared and rare topics together.\n" },
    ]
    const g = RichDocGraph.fromFiles(files)
    const ranked = searchTextRanked(g, "shared rare common", { limit: 10 })
    const rareHit = ranked.find((h) => h.pagePath === "covers-rare.md")!
    const commonHit = ranked.find((h) => h.pagePath === "covers-common.md")!
    expect(ranked[0]?.pagePath).toBe("covers-rare.md")
    expect(rareHit.matchScore - commonHit.matchScore).toBeGreaterThan(10)
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
