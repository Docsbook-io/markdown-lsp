# markdown-lsp

[![npm version](https://img.shields.io/npm/v/markdown-lsp.svg?style=flat-square)](https://www.npmjs.com/package/markdown-lsp)
[![npm downloads](https://img.shields.io/npm/dm/markdown-lsp.svg?style=flat-square)](https://www.npmjs.com/package/markdown-lsp)
[![CI](https://img.shields.io/github/actions/workflow/status/Docsbook-io/markdown-lsp/ci.yml?branch=main&label=ci&style=flat-square)](https://github.com/Docsbook-io/markdown-lsp/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/markdown-lsp.svg?style=flat-square)](https://github.com/Docsbook-io/markdown-lsp/blob/main/LICENSE)
[![node](https://img.shields.io/node/v/markdown-lsp.svg?style=flat-square)](https://www.npmjs.com/package/markdown-lsp)

CLI and library for querying Markdown documentation graphs. Point it at a folder of `.md` files and get instant full-text search, outline, link analysis, and symbol lookup — all as JSON.

**Status: v1.1.0. CLI is the default interface. LSP stdio mode available as a subcommand.**

---

## Quick Start

```bash
# List all pages
npx markdown-lsp workspace-outline ./docs

# Full-text search (natural-language, ranked)
npx markdown-lsp search-text ./docs "getting started"

# Fuzzy heading search
npx markdown-lsp search-symbols ./docs "auth" --limit 10
```

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
| `lsp` / `serve` | `[--stdio]` | Start the LSP stdio server |
| `graph` | `<docs-dir> [--format json\|dot\|mermaid\|html] [--out file]` | Export the doc link graph |
| `semantic-search` | `<docs-dir> <query> [--limit n] [--model model]` | AI semantic search via embeddings |

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
# (drag, zoom, hover highlights neighbours, click to inspect)
markdown-lsp graph ./docs --format html --out graph.html
```

JSON output shape:
```json
{
  "nodes": [{"id": "README.md", "title": "Docsbook", "charCount": 2634, "sectionsCount": 10}],
  "edges": [{"source": "README.md", "target": "quick-start.md", "kind": "inline", "label": "Get started"}],
  "unresolvedCount": 3
}
```

---

## Semantic search

AI-powered semantic search using text embeddings — finds conceptually related pages even if they
don't contain the exact query words.

```bash
# Requires OPENROUTER_API_KEY (OpenRouter) or AI_GATEWAY_API_KEY (Vercel AI Gateway)
OPENROUTER_API_KEY=sk-or-... markdown-lsp semantic-search ./docs "how to configure webhooks" --limit 5

# Override embedding model
markdown-lsp semantic-search ./docs "authentication" --model openai/text-embedding-3-small --limit 3
```

- Default embedding model: `openai/text-embedding-3-small` (via OpenRouter — model prefix required)
- Results cached in `.markdown-lsp-cache/embeddings/` — second run is instant, no API call
- Returns `[{ pagePath, pageTitle, score, snippet }]` sorted by cosine similarity

**Environment variables:**

| Variable | Purpose |
|---|---|
| `OPENROUTER_API_KEY` | OpenRouter API key (takes priority if set) |
| `AI_GATEWAY_API_KEY` | Vercel AI Gateway key (fallback) |
| `EMBEDDING_MODEL` | Override default embedding model |

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
- M4 — User overrides for the glossary (merge / split / rename / add_synonym)
- M5 — Docsbook integration

---

## License

MIT
