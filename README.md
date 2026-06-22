# markdown-lsp

[![npm version](https://img.shields.io/npm/v/markdown-lsp.svg?style=flat-square)](https://www.npmjs.com/package/markdown-lsp)
[![npm downloads](https://img.shields.io/npm/dm/markdown-lsp.svg?style=flat-square)](https://www.npmjs.com/package/markdown-lsp)
[![CI](https://img.shields.io/github/actions/workflow/status/Docsbook-io/markdown-lsp/ci.yml?branch=main&label=ci&style=flat-square)](https://github.com/Docsbook-io/markdown-lsp/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/markdown-lsp.svg?style=flat-square)](https://github.com/Docsbook-io/markdown-lsp/blob/main/LICENSE)
[![node](https://img.shields.io/node/v/markdown-lsp.svg?style=flat-square)](https://www.npmjs.com/package/markdown-lsp)

CLI and library for querying Markdown documentation graphs. Point it at a folder of `.md` files and get instant full-text search, outline, link analysis, symbol lookup, interactive HTML graphs, and AI-powered semantic search at page, heading, or paragraph granularity — all as JSON.

<img width="1709" height="980" alt="Screenshot 2026-06-22 at 13 37 53" src="https://github.com/user-attachments/assets/5c540cd3-d5c0-48ca-90fa-645a266cb0f7" />


**Status: v1.4.0. CLI is the default interface. LSP stdio mode available as a subcommand.**

---

## Quick Start

```bash
# List all pages
npx markdown-lsp workspace-outline ./docs

# Heading outline of a page
npx markdown-lsp outline ./docs introduction.md

# Full-text search (natural-language, ranked)
npx markdown-lsp search-text ./docs "getting started"

# Fuzzy heading search
npx markdown-lsp search-symbols ./docs "auth" --limit 10

# Find pages by glob
npx markdown-lsp search-paths ./docs "ai/*.md"

# Backlinks and outgoing links
npx markdown-lsp links-to ./docs quick-start.md
npx markdown-lsp links-from ./docs README.md

# Resolve a link text / read a section
npx markdown-lsp resolve-link ./docs README.md "Getting Started"
npx markdown-lsp get-section ./docs overview.md "quick-links"

# Interactive link graph (HTML, JSON, DOT, Mermaid)
npx markdown-lsp graph ./docs --format html --out graph.html
npx markdown-lsp graph ./docs --format json --pretty
npx markdown-lsp graph ./docs --format dot | dot -Tsvg > graph.svg
npx markdown-lsp graph ./docs --format mermaid

# ── Token-saving workflow: index once, search cheap ──────────────────────────

# Step 1: build the semantic index once (embeds all heading-level sections)
OPENROUTER_API_KEY=sk-or-... npx markdown-lsp index ./docs --granularity heading

# Step 2: search is now cheap — only the query is embedded (1 API round-trip)
OPENROUTER_API_KEY=sk-or-... npx markdown-lsp semantic-search ./docs "how to configure webhooks" --granularity heading
OPENROUTER_API_KEY=sk-or-... npx markdown-lsp semantic-search ./docs "rate limit error" --granularity line

# Semantic graph — heading-level nodes (sections as graph nodes)
OPENROUTER_API_KEY=sk-or-... npx markdown-lsp graph ./docs --format html --semantic --granularity heading --out graph-headings.html

# Page-level semantic graph (classic)
OPENROUTER_API_KEY=sk-or-... npx markdown-lsp graph ./docs --format html --semantic --out graph.html

# LSP server (for editors)
npx markdown-lsp lsp --stdio
```

---

## Quick Start with Claude Code (skill)

Install the skill once — then ask Claude Code natural-language questions about your docs directly in chat:

```bash
npx skills add Docsbook-io/markdown-lsp
```

After installation, Claude Code will guide you through setup interactively. Just ask:

```
set up markdown-lsp for my project
```

The skill will ask you questions step by step — docs folder, API key, granularity — and configure everything in chat. Other things you can ask once installed:

```
build a semantic index of ./docs
search my docs semantically for "how to configure webhooks"
show me which pages link to getting-started.md
find sections about rate limiting (heading-level search)
show me a semantic graph of my docs
set up a git hook to keep the index fresh after each merge
```

For semantic search and the graph, you need a free [OpenRouter](https://openrouter.ai/keys) key:

```bash
export OPENROUTER_API_KEY=sk-or-...
```

The skill sets everything up in chat — index, git hooks, and the interactive graph.

---

## Installation

```bash
npm install -g markdown-lsp
# or per-project
npm install markdown-lsp
```

Node.js >= 20 required.

---

## Subcommands

All subcommands accept a **`--pretty`** flag for indented JSON output (compact by default).

| Subcommand | Arguments | Description |
|---|---|---|
| `workspace-outline` | `<docs-dir> [--prefix p] [--limit n]` | List all pages with metadata |
| `outline` | `<docs-dir> <page>` | Heading outline of a single page |
| `search-text` | `<docs-dir> <query> [--mode ranked\|verbatim] [--regex] [--case-sensitive] [--prefix p] [--limit n] [--context n]` | Full-text search |
| `search-symbols` | `<docs-dir> <query> [--limit n]` | Fuzzy subsequence search across headings |
| `search-paths` | `<docs-dir> <glob>` | List pages matching a glob pattern |
| `links-to` | `<docs-dir> <page>` | All pages that link to `<page>` |
| `links-from` | `<docs-dir> <page>` | All links originating from `<page>` |
| `resolve-link` | `<docs-dir> <from-page> <link-text>` | Resolve a specific link text from a page |
| `get-section` | `<docs-dir> <page> <anchor>` | Get a section by anchor slug |
| `index` | `<docs-dir> [--granularity page\|heading\|line] [--model m]` | Build persistent semantic index (cache all embeddings once) |
| `graph` | `<docs-dir> [--format json\|dot\|mermaid\|html] [--out file] [--semantic] [--granularity page\|heading] [--sim-threshold n] [--sim-top-k n] [--model m]` | Export doc link graph; `--semantic` adds AI similarity edges |
| `semantic-search` | `<docs-dir> <query> [--limit n] [--model m] [--granularity page\|heading\|line]` | AI semantic search via embeddings |
| `lsp` / `serve` | `[--stdio]` | Start the LSP stdio server |

### search-text modes

- **ranked** (default) — tokenizes query, drops stop words, ranks by coverage/heading/proximity. Best for natural-language questions.
- **verbatim** (`--mode verbatim`) — literal substring match. Use `--regex` for regex.

### Output format

All subcommands print JSON to stdout. Use `--pretty` for human-readable output:

```bash
markdown-lsp search-text ./docs "authentication" --limit 5 --pretty
```

---

## Examples

```bash
# Workspace overview
markdown-lsp workspace-outline ./docs --limit 20 --pretty

# Find pages about authentication
markdown-lsp search-text ./docs "authentication flow" --pretty

# What links to README.md?
markdown-lsp links-to ./docs README.md

# Glob search: all files under api/
markdown-lsp search-paths ./docs "api/**"

# Outline of a specific page
markdown-lsp outline ./docs quick-start.md --pretty

# Find headings containing "auth"
markdown-lsp search-symbols ./docs "auth" --limit 10

# Resolve a link from a page
markdown-lsp resolve-link ./docs README.md "Getting Started"

# Get a specific section by anchor
markdown-lsp get-section ./docs overview.md quick-links --pretty
```

---

## Graph export

Export the full page link graph — nodes are pages, edges are markdown links.

```bash
# JSON (nodes + edges — machine-readable)
markdown-lsp graph ./docs --format json --pretty

# Graphviz DOT
markdown-lsp graph ./docs --format dot > graph.dot

# Mermaid flowchart (embed in markdown)
markdown-lsp graph ./docs --format mermaid

# Self-contained interactive HTML with D3 force-directed graph
# (drag, zoom, hover highlights neighbours, click to inspect side-panel)
markdown-lsp graph ./docs --format html --out graph.html
```

JSON output shape:
```json
{
  "nodes": [{"id": "README.md", "title": "Docsbook", "charCount": 2634, "sectionsCount": 10,
              "sections": [...], "outgoing": [...], "incoming": [...], "topSimilar": []}],
  "edges": [{"source": "README.md", "target": "quick-start.md", "kind": "inline", "label": "Get started"}],
  "semanticEdges": [],
  "unresolvedCount": 3
}
```

---

## Token-saving workflow: index once, search cheap

The `index` command pre-builds and caches all document embeddings at the chosen granularity.
After indexing, `semantic-search` and `graph --semantic` only need to embed the query — **1 API round-trip** instead of N.

```bash
# Build the index once (heading = section-level, best precision)
OPENROUTER_API_KEY=sk-or-... markdown-lsp index ./docs --granularity heading

# Now search is cheap — only the query is sent to the API
OPENROUTER_API_KEY=sk-or-... markdown-lsp semantic-search ./docs "how does auth work" --granularity heading
OPENROUTER_API_KEY=sk-or-... markdown-lsp semantic-search ./docs "rate limit error" --granularity line
```

**Why it works:** embeddings are cached by `sha256(model + text)` in `.markdown-lsp-cache/embeddings/`.
On the second run, every doc unit is a cache hit — only the query vector is fetched from the API.
If a file changes, its hash changes, so it is re-embedded automatically (no stale results).

**Token cost comparison:**

| Scenario | API round-trips | Relative cost |
|---|---|---|
| First `semantic-search` (78 pages, cold cache) | 2 (batch docs + query) | baseline |
| Repeat `semantic-search` after warm cache | 1 (query only) | ~1/78 |
| After `index --granularity heading` (~1190 sections) | 1 (query only) | ~1/1190 |
| `index` re-run with no changes | 0 | free |

### Incremental & token-saving: re-run `index` anytime

`index ./docs` is incremental by design — only changed units are re-embedded, unchanged ones are
served from the local cache (`.markdown-lsp-cache/embeddings/`). You can call it as frequently as
you like without wasting API tokens on content that hasn't changed.

To automate re-indexing, the recommended approach is a **git hook** (no extra deps, no debounce
complexity): a `post-merge` or `post-checkout` hook runs `npx markdown-lsp index ./docs` automatically
after pulls and branch switches. For real-time updates while writing docs, a debounced watch script
(stdlib `fs.watch` with a 3-5 s debounce) works well. CI users can cache `.markdown-lsp-cache/`
via `actions/cache` so the index survives across runs. See the [skill file](.claude/skills/markdown-lsp/SKILL.md)
for ready-to-use snippets for all three patterns.

---

## Semantic search with granularity

AI-powered semantic search using text embeddings — finds conceptually related content even if it
doesn't contain the exact query words.

```bash
# Page-level (default) — searches whole pages
OPENROUTER_API_KEY=sk-or-... markdown-lsp semantic-search ./docs "how to configure webhooks" --limit 5

# Heading-level — searches within sections (returns anchor + headingPath)
OPENROUTER_API_KEY=sk-or-... markdown-lsp semantic-search ./docs "webhook authentication" \
  --granularity heading --limit 10

# Line-level — searches paragraph blocks (returns line number)
OPENROUTER_API_KEY=sk-or-... markdown-lsp semantic-search ./docs "set OPENROUTER_API_KEY" \
  --granularity line --limit 5

# Override embedding model
markdown-lsp semantic-search ./docs "authentication" --model openai/text-embedding-3-small --limit 3
```

**Result shape by granularity:**

- `page`: `[{ level: "page", pagePath, pageTitle, score, snippet }]`
- `heading`: `[{ level: "heading", pagePath, pageTitle, anchor, headingPath, score, snippet }]`
- `line`: `[{ level: "line", pagePath, pageTitle, line, score, snippet }]`

**Environment variables:**

| Variable | Purpose |
|---|---|
| `OPENROUTER_API_KEY` | OpenRouter API key (takes priority if set) |
| `AI_GATEWAY_API_KEY` | Vercel AI Gateway key (fallback) |
| `EMBEDDING_MODEL` | Override default embedding model |

---

## Semantic graph (v1.2+)

Overlay AI-powered semantic similarity edges on top of the link graph.

```bash
# Page-level semantic graph (classic)
OPENROUTER_API_KEY=sk-or-... markdown-lsp graph ./docs --format html --semantic --out graph.html

# Heading-level: graph nodes = sections, semantic edges between sections
OPENROUTER_API_KEY=sk-or-... markdown-lsp graph ./docs --format html --semantic \
  --granularity heading --sim-threshold 0.75 --sim-top-k 5 --out graph-headings.html
```

**What you get in the HTML:**

- Two types of edges — **solid lines** (explicit markdown links) and **dashed amber lines** (semantic similarity)
- **Checkboxes** in the toolbar to toggle each edge type independently
- **Click any node** to open a side-panel showing: title, path, sections, outgoing links, incoming links, and top semantically similar pages/sections with scores
- Clicking a linked page in the side-panel focuses the graph on that node
- Background click closes the panel and clears selection

**Semantic flags:**

| Flag | Default | Description |
|---|---|---|
| `--semantic` | off | Enable AI similarity edges |
| `--granularity` | `page` | `page` (nodes = pages) or `heading` (nodes = sections) |
| `--sim-threshold` | `0.75` | Minimum cosine similarity score to draw an edge |
| `--sim-top-k` | `5` | Max semantic neighbours per node |
| `--model` | `openai/text-embedding-3-small` | Embedding model override |

**Note:** `--granularity line` is not supported for `graph` (too many nodes). Use `page` or `heading`.

**Caching:** embeddings are cached in `.markdown-lsp-cache/embeddings/` — the second run is instant with 0 API calls.

**OpenRouter model naming:** when using `OPENROUTER_API_KEY`, the model name requires the `openai/` prefix (e.g. `openai/text-embedding-3-small`). When using `AI_GATEWAY_API_KEY` (Vercel AI Gateway), use the bare name (`text-embedding-3-small`). If the model is rejected, the CLI outputs a clear hint to try the other form.

---

## LSP mode (editor integration)

`markdown-lsp` also works as a Language Server Protocol server for editors (VS Code, Zed, Neovim, etc.).

```bash
# Recommended (v1.0.0+)
npx markdown-lsp lsp --stdio

# Back-compat — old LSP flag style still works so existing editor configs don't break
npx markdown-lsp --stdio
```

The LSP server speaks the standard protocol over stdio. It requires a Postgres database for the structural index (see Setup below).

### Editor configuration example (VS Code)

In your `settings.json`:

```json
{
  "markdown-lsp.serverPath": "markdown-lsp",
  "markdown-lsp.args": ["lsp", "--stdio"]
}
```

---

## Use as a library

```ts
import { buildGraph, loadDocsAsFiles } from "markdown-lsp/graph"
import { searchTextRanked, searchSymbols, listPages } from "markdown-lsp/bridge"

const graph = buildGraph("./docs")
const hits = searchTextRanked(graph, "authentication flow")
const pages = listPages(graph, { limit: 50 })
```

Available entry points:
- `markdown-lsp/bridge` — search functions + `RichDocGraph`, `buildInMemoryGraph`, types
- `markdown-lsp/graph` — `buildGraph(docsRoot)`, `loadDocsAsFiles(docsRoot)`
- `markdown-lsp/indexer` — SQLite/Postgres workspace indexer (for LSP use)
- `markdown-lsp/core` — document symbols and references (for LSP use)
- `markdown-lsp/parser` — raw Markdown parser

---

## LSP Setup (for editor / structural indexer use)

The CLI subcommands work **without any database** — they build an in-memory graph on the fly.

The LSP server requires Postgres (for the incremental index):

```bash
pnpm install
cp .env.example .env.local        # fill DATABASE_URL; AI_GATEWAY_API_KEY only if you want the AI layer
pnpm migrate                       # runs scripts/apply-migration.ts against DATABASE_URL
pnpm build
```

Optional AI layer (semantic synonym resolution):

```bash
export MARKDOWN_LSP_AI_ENABLED=1
export AI_GATEWAY_API_KEY=...   # Vercel AI Gateway
```

---

## Architecture

- **CLI** — `node:util parseArgs`, zero extra deps, reads `.md` files into an in-memory graph
- **Graph** — pure TypeScript, no DB needed; `buildGraph(docsRoot)` walks the directory tree
- **Granular semantics** — `unitize(pages, granularity)` splits docs into page/heading/line units; `splitParagraphs()` groups by blank lines
- **Persistent index** — `index` command pre-caches all embeddings; `embedTexts()` checks sha256 cache per unit before hitting the API
- **Semantic graph** — in-memory cosine similarity; heading mode replaces page-nodes with section-nodes; embeddings via OpenRouter or Vercel AI Gateway; disk-cached per sha256(model+text)
- **LSP** — `vscode-languageserver/node` over stdio; requires Postgres (Drizzle ORM, `mdlsp_` prefix)
- **AI layer** (opt-in) — pgvector cosine search on canonical-term embeddings; `text-embedding-3-small` via Vercel AI Gateway
- **Bridge** — pure in-memory search (searchText, searchTextRanked, searchSymbols, searchPaths, listPages)

---

## Tests

```bash
pnpm test
```

27 tests cover the parser, indexer, core handlers, and bridge search functions.

---

## Milestones

- **M0 — Scaffold** ✅
- **M1 — Structural layer** ✅
- **M2 — Semantic extract** (opt-in, code present, awaiting live AI Gateway credit)
- **M3 — CLI-first interface** ✅ (v1.0.0)
- **M4 — Graph export + HTML D3 visualisation** ✅ (v1.1.0)
- **M5 — Turnkey semantic graph (graph --semantic)** ✅ (v1.2.0)
- **M6 — Granular semantics + persistent index** ✅ (v1.3.0)
- M7 — User overrides for the glossary (merge / split / rename / add_synonym)
- M8 — Docsbook integration

---

## License

MIT
