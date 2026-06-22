---
name: markdown-lsp
description: >
  Teaches any agent to search, navigate, and visualise markdown folders using the markdown-lsp CLI.
  Use when searching docs/ or about/, getting doc outlines, navigating markdown, finding sections,
  traversing the doc link graph, exporting a graph, doing full-text / symbol / path / semantic search
  over any markdown directory. Also covers the turnkey semantic graph (graph --semantic).
  Triggers: "markdown-lsp", "search docs/about", "doc outline", "navigate markdown", "doc graph",
  "links between pages", "find section in docs", "graph export", "semantic search docs",
  "embeddings search", "semantic graph", "turnkey graph".
---

# markdown-lsp CLI — Markdown search, navigation & semantic graph

Fast structural search, navigation, link-graph export, turnkey semantic graph, and AI semantic
search over any markdown folder via the `markdown-lsp` CLI (v1.2.0+).

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
| Semantic graph (turnkey) | `graph --semantic` | `--format html --semantic [--sim-threshold n] [--sim-top-k n] [--model m] [--out file]` |
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

# Self-contained interactive HTML (D3 force graph, drag/zoom/click side-panel)
node_modules/.bin/markdown-lsp graph ./docs --format html --out graph.html
```

JSON output shape (v1.2):
```json
{
  "nodes": [{"id": "README.md", "title": "...", "charCount": 2634, "sectionsCount": 10,
             "sections": [...], "outgoing": [...], "incoming": [...], "topSimilar": []}],
  "edges": [{"source": "README.md", "target": "quick-start.md", "kind": "inline"}],
  "semanticEdges": [],
  "unresolvedCount": 3
}
```

## Turnkey semantic graph (v1.2 — NEW)

One command builds embeddings and renders an interactive HTML graph with BOTH link and semantic
similarity edges. Requires `OPENROUTER_API_KEY` or `AI_GATEWAY_API_KEY`.

```bash
# Turnkey: one command
OPENROUTER_API_KEY=sk-or-... node_modules/.bin/markdown-lsp graph ./docs --format html --semantic --out graph.html

# With explicit thresholds
OPENROUTER_API_KEY=sk-or-... node_modules/.bin/markdown-lsp graph ./docs --format html --semantic \
  --sim-threshold 0.75 --sim-top-k 5 --out graph.html
```

**What the HTML graph shows:**
- Solid lines = explicit markdown links (link edges)
- Dashed amber lines = semantic similarity (semantic edges)
- Checkboxes in toolbar: toggle each edge type independently
- Click any node: opens side-panel with title, path, sections list, outgoing links, incoming links,
  and top semantically similar pages with scores
- Clicking a page in the side-panel focuses the graph on that node
- Background click: closes panel + clears highlight
- Drag and zoom: preserved

**Semantic flags:**
- `--sim-threshold 0.75` — minimum cosine similarity (default: 0.75)
- `--sim-top-k 5` — max semantic neighbours per node (default: 5)
- `--model openai/text-embedding-3-small` — embedding model (default)

**Caching:** embeddings cached in `.markdown-lsp-cache/embeddings/` — second run is instant (0 API calls).

**Model naming:** OpenRouter requires the `openai/` prefix (`openai/text-embedding-3-small`).
Vercel AI Gateway uses bare names (`text-embedding-3-small`). CLI gives a clear hint on mismatch.

**No API key:** `--semantic` without a key exits with a clear error message (no stack trace).

## Semantic search

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

**Visualise link graph (no AI):**
```bash
node_modules/.bin/markdown-lsp graph ./docs --format html --out /tmp/graph.html
```

**Visualise link + semantic graph (AI, turnkey):**
```bash
OPENROUTER_API_KEY=sk-or-... node_modules/.bin/markdown-lsp graph ./docs --format html --semantic --out /tmp/sgraph.html
```

For full JSON return shapes and all flags, see `reference.md`.
