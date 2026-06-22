---
name: markdown-lsp
description: >
  Teaches any agent to search, navigate, and visualise markdown folders using the markdown-lsp CLI.
  Use when searching docs/ or about/, getting doc outlines, navigating markdown, finding sections,
  traversing the doc link graph, exporting a graph, doing full-text / symbol / path / semantic search
  over any markdown directory. Triggers: "markdown-lsp", "search docs/about", "doc outline",
  "navigate markdown", "doc graph", "links between pages", "find section in docs", "graph export",
  "semantic search docs", "embeddings search".
---

# markdown-lsp CLI — Markdown search, navigation & graph

Fast structural search, navigation, link-graph export, and AI semantic search over any markdown
folder via the `markdown-lsp` CLI (v1.1.0+).

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
| Export link graph | `graph` | `[--format json\|dot\|mermaid\|html] [--out file]` |
| AI semantic search | `semantic-search` | `<query> [--limit n] [--model <model>]` |

For full argument details and JSON return shapes, see `reference.md`.

## Graph export

Export the full page link graph in multiple formats:

```bash
# JSON (nodes + edges, default)
node_modules/.bin/markdown-lsp graph ./docs --format json --pretty

# Graphviz DOT
node_modules/.bin/markdown-lsp graph ./docs --format dot

# Mermaid flowchart
node_modules/.bin/markdown-lsp graph ./docs --format mermaid

# Self-contained interactive HTML (D3 force graph, drag/zoom/hover)
node_modules/.bin/markdown-lsp graph ./docs --format html --out graph.html
```

JSON output shape: `{ nodes: [{id, title, charCount, sectionsCount}], edges: [{source, target, kind, label?}], unresolvedCount }`.

## Semantic search

AI-powered search using text embeddings. Requires `OPENROUTER_API_KEY` (OpenRouter) or
`AI_GATEWAY_API_KEY` (Vercel AI Gateway). Results are cached in `.markdown-lsp-cache/` — second
run is instant.

```bash
OPENROUTER_API_KEY=sk-or-... node_modules/.bin/markdown-lsp semantic-search ./docs "how to set up webhooks" --limit 5

# Override embedding model (default: openai/text-embedding-3-small)
node_modules/.bin/markdown-lsp semantic-search ./docs "authentication flow" --model openai/text-embedding-3-small --limit 3
```

Returns: `[{ pagePath, pageTitle, score, snippet }]` sorted by cosine similarity (highest first).

CRITICAL: If no API key is set, the command exits with a clear error message — it does not crash.

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

**Visualise the link graph:**
```bash
node_modules/.bin/markdown-lsp graph ./docs --format html --out /tmp/graph.html
```

For full JSON return shapes and all flags, see `reference.md`.
