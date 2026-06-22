---
name: markdown-lsp
description: >
  Teaches any agent to search, navigate, and visualise markdown folders using the markdown-lsp CLI.
  Use when searching docs/ or about/, getting doc outlines, navigating markdown, finding sections,
  traversing the doc link graph, exporting a graph, doing full-text / symbol / path / semantic search
  over any markdown directory, or building a persistent semantic index to save API tokens.
  Also covers granular semantic search (heading/line level) and the turnkey semantic graph.
  Triggers: "markdown-lsp", "search docs/about", "doc outline", "navigate markdown", "doc graph",
  "links between pages", "find section in docs", "graph export", "semantic search docs",
  "embeddings search", "semantic graph", "turnkey graph", "index docs", "heading search",
  "granularity", "token-saving search".
---

# markdown-lsp CLI — Markdown search, navigation & semantic graph (v1.3.0)

Fast structural search, navigation, link-graph export, turnkey semantic graph, granular AI semantic
search (page / heading / line), and persistent index for token-saving search over any markdown
folder via the `markdown-lsp` CLI (v1.3.0+).

## How to run

```bash
# Preferred: local bin (resolves from project root)
node_modules/.bin/markdown-lsp <subcommand> <docs-dir> [args]

# Alternative: dist entry point
node node_modules/markdown-lsp/dist/cli.js <subcommand> <docs-dir> [args]

# npx (auto-installs if not present):
npx markdown-lsp <subcommand> <docs-dir> [args]
```

All subcommands print JSON to stdout. Add `--pretty` for indented output.

## Subcommands — intent table

| Intent | Subcommand | Key args |
|---|---|---|
| Overview — all pages | `workspace-outline` | `[--prefix p] [--limit n]` |
| Heading outline of one page | `outline` | `<page>` |
| Full-text / NL search | `search-text` | `<query> [--mode ranked\|verbatim] [--regex] [--limit n]` |
| Fuzzy heading / concept | `search-symbols` | `<query> [--limit n]` |
| Find page by filename pattern | `search-paths` | `<glob>` |
| Who links TO a page | `links-to` | `<page>` |
| What a page links out to | `links-from` | `<page>` |
| Resolve a specific link text | `resolve-link` | `<from-page> <link-text>` |
| Read a section by anchor | `get-section` | `<page> <anchor>` |
| Build persistent index (token-saving) | `index` | `[--granularity page\|heading\|line] [--model m]` |
| Export link graph | `graph` | `[--format json\|dot\|mermaid\|html] [--out file]` |
| Semantic graph (turnkey) | `graph --semantic` | `--format html --semantic [--granularity page\|heading] [--sim-threshold n] [--sim-top-k n] [--model m] [--out file]` |
| AI semantic search | `semantic-search` | `<query> [--limit n] [--granularity page\|heading\|line] [--model m]` |

For full argument details and JSON return shapes, see `reference.md`.

## Token-saving workflow: index once, search cheap

The `index` command pre-builds and caches all doc embeddings. After indexing, `semantic-search`
and `graph --semantic` only embed the **query** — 1 API round-trip instead of N.

```bash
# Step 1: index once (heading granularity = best precision, ~1190 sections for 78-page docs)
OPENROUTER_API_KEY=sk-or-... node_modules/.bin/markdown-lsp index ./docs --granularity heading

# Step 2: search is now cheap (only query is sent to API)
OPENROUTER_API_KEY=sk-or-... node_modules/.bin/markdown-lsp semantic-search ./docs "how auth works" \
  --granularity heading --limit 10

# Step 3: re-index is free if docs haven't changed (all cache hits, 0 API tokens)
OPENROUTER_API_KEY=sk-or-... node_modules/.bin/markdown-lsp index ./docs --granularity heading
```

**Cache:** `sha256(model + text)` key in `.markdown-lsp-cache/embeddings/`. Changed file = new key = auto re-embed.

## Granular semantic search (v1.3 — NEW)

Three granularity levels for semantic search:

```bash
# Page-level (default) — searches whole pages
OPENROUTER_API_KEY=sk-or-... node_modules/.bin/markdown-lsp semantic-search ./docs "webhook auth" --limit 5

# Heading-level — searches within sections (returns anchor + headingPath)
OPENROUTER_API_KEY=sk-or-... node_modules/.bin/markdown-lsp semantic-search ./docs "webhook auth" \
  --granularity heading --limit 10

# Line-level — searches paragraph blocks (returns line number)
OPENROUTER_API_KEY=sk-or-... node_modules/.bin/markdown-lsp semantic-search ./docs "set OPENROUTER_API_KEY" \
  --granularity line --limit 5
```

**Result shapes:**
- `page`: `[{ level, pagePath, pageTitle, score, snippet }]`
- `heading`: `[{ level, pagePath, pageTitle, anchor, headingPath, score, snippet }]`
- `line`: `[{ level, pagePath, pageTitle, line, score, snippet }]`

## Graph export

```bash
# JSON (nodes + edges, default)
node_modules/.bin/markdown-lsp graph ./docs --format json --pretty

# Graphviz DOT / Mermaid
node_modules/.bin/markdown-lsp graph ./docs --format dot
node_modules/.bin/markdown-lsp graph ./docs --format mermaid

# Self-contained interactive HTML
node_modules/.bin/markdown-lsp graph ./docs --format html --out graph.html
```

## Semantic graph (v1.2+ with granularity support)

```bash
# Page-level (classic)
OPENROUTER_API_KEY=sk-or-... node_modules/.bin/markdown-lsp graph ./docs --format html --semantic --out graph.html

# Heading-level: graph NODES = sections (more granular, more nodes)
OPENROUTER_API_KEY=sk-or-... node_modules/.bin/markdown-lsp graph ./docs --format html --semantic \
  --granularity heading --sim-threshold 0.75 --sim-top-k 5 --out graph-headings.html
```

**Note:** `--granularity line` is NOT supported for `graph` (too many nodes — use `page` or `heading`).

HTML graph features:
- Solid lines = explicit markdown links; dashed amber = semantic similarity
- Checkboxes to toggle each edge type
- Click node: side-panel with title, path/heading-path, outgoing/incoming links, top similar
- Background click: closes panel

**Caching:** embeddings cached in `.markdown-lsp-cache/` — second run = 0 API calls.

## Key recipes

**Explore an unfamiliar folder:**
```bash
node_modules/.bin/markdown-lsp workspace-outline ./docs --limit 50
```

**Find where a topic is documented:**
```bash
node_modules/.bin/markdown-lsp search-text ./docs "webhook authentication" --limit 5
node_modules/.bin/markdown-lsp search-symbols ./docs "webhook signing" --limit 5
```

**Read a section without the whole page:**
```bash
node_modules/.bin/markdown-lsp outline ./docs "webhooks.md"
node_modules/.bin/markdown-lsp get-section ./docs "webhooks.md" "webhook-signing"
```

**Visualise link graph (no AI):**
```bash
node_modules/.bin/markdown-lsp graph ./docs --format html --out /tmp/graph.html
```

**Visualise link + semantic graph, heading-level (AI, turnkey):**
```bash
OPENROUTER_API_KEY=sk-or-... node_modules/.bin/markdown-lsp graph ./docs --format html \
  --semantic --granularity heading --out /tmp/sgraph-headings.html
```

For full JSON return shapes and all flags, see `reference.md`.
