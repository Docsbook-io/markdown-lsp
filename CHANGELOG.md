# Changelog

## 1.4.0 — 2026-06-22

### New: Claude Code skill install via `npx skills add`

Install the markdown-lsp Claude Code skill directly from GitHub:

```bash
npx skills add Docsbook-io/markdown-lsp
```

The skill is now installable by the `vercel-labs/skills` CLI — it finds the skill in
`.claude/skills/markdown-lsp/` automatically. Tested and verified: SKILL.md and reference.md
are copied into `.claude/skills/markdown-lsp/` in the target project.

### New: Interactive onboarding in SKILL.md

Added `## Setup (interactive onboarding)` section to SKILL.md — a 6-step guided flow the AI
runs in chat when the user says "set up markdown-lsp" or similar:

1. Locate and verify the docs folder
2. Check / explain `OPENROUTER_API_KEY`
3. Choose granularity (page / heading / line) with trade-off explanation
4. Build the first semantic index (warm the cache)
5. Install git hooks for auto-reindex (post-merge / post-checkout)
6. Generate the interactive semantic graph as a wow moment

### Updated: README Quick Start

Added "Quick Start with Claude Code (skill)" section to README immediately after the CLI Quick
Start — install command, example prompts, and pointer to the interactive setup flow.

### Updated: Frontmatter triggers

Added setup/onboarding triggers to SKILL.md frontmatter so the skill activates on natural
phrases like "set up markdown-lsp", "configure semantic search", "onboard markdown-lsp".

## 0.2.0 — 2026-05-24

### New: RichDocGraph in `markdown-lsp/bridge`

A read-only, indexed view over the in-memory graph for downstream tools (Docsbook, agents via MCP).

- `RichDocGraph.fromFiles(files)` / `.fromJSON(json)` / `.toJSON()` — round-trippable for caching
- `.pageByPath(p)` / `.pageByRef("p#anchor")` — O(1) lookups
- `.outlineOf(page)` — nested heading tree
- `.breadcrumbsOf(section)` / `.neighborsOf(section)` — structural navigation
- `.incomingLinks(page)` / `.outgoingLinks(page)` — link graph
- `.findByAnchor(slug)` — slug-to-section index
- `.orphans()` / `.unresolved()` — quality checks

### Search helpers
- `searchSymbols(graph, query)` — LSP `workspace/symbol`-style fuzzy subsequence
- `searchText(graph, query, opts)` — full-text with snippets, supports regex / case / path-prefix
- `searchPaths(graph, glob)` — glob filter (`docs/*.md`, `**/auth.md`)
- `searchByAnchor(graph, slug)`
- `listPages(graph, { prefix })`

### Resolve helper
- `resolveToGithubUrl(graph, { fromPagePath, linkText, repo, branch })` — converts a relative or wiki-style link into an absolute `https://github.com/owner/repo/blob/branch/path#anchor` URL, suitable for surfacing to humans

### Sections now carry their full content
Already-public `GraphSection` shape gains `content` + position columns. Drop-in compatible: old consumers reading sections ignore the new fields.

## 0.1.2 — 2026-05-24

- fix(ci): `prepublishOnly` runs only DB-less tests (parser, bridge, AI-gating); full DB-backed tests still run locally with `pnpm test`

## 0.1.1 — 2026-05-24

- chore: sync pnpm-lock.yaml; remove unused `nanoid` dependency
- ci: add CI and publish workflows (npm publish with provenance on `v*` tag)

## 0.1.0 — 2026-05-24

Initial release.

### Structural layer (default, no AI)
- LSP server over stdio with `documentSymbol`, `workspaceSymbol` (subsequence-fuzzy), `definition`, `references`, `completion` (wiki-link), diagnostics for unresolved links
- Postgres + pgvector schema with content-hash diff and incremental indexing
- `buildInMemoryGraph` — zero-DB bridge for embedding into other tools (used by Docsbook source-of-truth)

### Optional AI layer
- Off by default; enable with `MARKDOWN_LSP_AI_ENABLED=1`
- Vercel AI Gateway integration for embeddings (`text-embedding-3-small`) and term extraction (`gpt-4o-mini`)

### Tests
- 35 tests across parser, indexer, core handlers, in-memory bridge, AI gating
