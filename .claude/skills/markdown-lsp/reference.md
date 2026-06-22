# markdown-lsp CLI — Full Reference

CLI entry: `node_modules/.bin/markdown-lsp` (or `node node_modules/markdown-lsp/dist/cli.js`).
All subcommands write JSON to stdout. Use `--pretty` for human-readable indentation.

## Subcommands

### `workspace-outline <docs-dir> [--prefix p] [--limit n]`
List all pages with metadata.
```bash
node_modules/.bin/markdown-lsp workspace-outline ./docs --limit 5
```
Returns: `PageSummary[]`
```json
[{"path":"README.md","title":"Docsbook — Documentation","headingsCount":10,"charCount":2634}]
```

### `outline <docs-dir> <page>`
Heading outline of a single page. Use to discover anchor slugs before calling `get-section`.
```bash
node_modules/.bin/markdown-lsp outline ./docs "README.md"
```
Returns: `OutlineNode[]` (nested, each has `name`, `level`, `anchor`, `range`, `children`)

### `search-text <docs-dir> <query> [options]`
Full-text search. Default mode: `ranked` (natural-language scoring). Use `--mode verbatim` for
exact phrase match, `--regex` for regex patterns.
```bash
node_modules/.bin/markdown-lsp search-text ./docs "getting started" --limit 3
node_modules/.bin/markdown-lsp search-text ./docs "quick start" --mode verbatim --limit 3
node_modules/.bin/markdown-lsp search-text ./docs "auth\w+" --regex --limit 3
```
Options: `--mode ranked|verbatim` (default: ranked), `--regex`, `--case-sensitive`,
`--prefix <p>` (filter by path prefix), `--limit n`, `--context n` (chars of snippet context)

Returns: `SearchHit[]`
```json
[{"pagePath":"overview.md","pageTitle":"Docsbook Overview","headingPath":["Overview","Quick Links"],
  "anchor":"quick-links","snippet":"...Getting Started...","matchScore":129}]
```

### `search-symbols <docs-dir> <query> [--limit n]`
Fuzzy subsequence search across all headings.
```bash
node_modules/.bin/markdown-lsp search-symbols ./docs "webhook" --limit 5
```
Returns: `SymbolHit[]`

### `search-paths <docs-dir> <glob>`
List pages whose paths match a glob pattern.
```bash
node_modules/.bin/markdown-lsp search-paths ./docs "ai/*.md"
```
Returns: `PageSummary[]`

### `links-to <docs-dir> <page>`
Show all pages that link TO `<page>` (backlinks).
Returns: `Link[]`

### `links-from <docs-dir> <page>`
Show all links that originate FROM `<page>`.
Returns: `Link[]`

### `resolve-link <docs-dir> <from-page> <link-text>`
Find the target of a specific link text within a page.
Returns: single `Link` object or `null`

### `get-section <docs-dir> <page> <anchor>`
Read a specific section by its anchor slug. Get anchors from `outline` first.
Returns: `Section` object

### `graph <docs-dir> [--format json|dot|mermaid|html] [--out <file>] [--semantic] [--sim-threshold n] [--sim-top-k n] [--model m]`

Export the full page link graph, optionally with AI-powered semantic similarity edges.

**Base flags:**
- `--format json` (default): machine-readable `{ nodes, edges, semanticEdges, unresolvedCount }`
- `--format dot`: Graphviz DOT format
- `--format mermaid`: Mermaid flowchart for embedding in markdown
- `--format html`: Self-contained interactive HTML (D3 force graph, drag/zoom/click side-panel)
- `--out <file>`: write to file instead of stdout (recommended for html)

**Semantic flags (v1.2):**
- `--semantic`: enable AI similarity edges (requires `OPENROUTER_API_KEY` or `AI_GATEWAY_API_KEY`)
- `--sim-threshold <float>`: minimum cosine similarity to draw an edge (default: `0.75`)
- `--sim-top-k <int>`: max semantic neighbours per node (default: `5`)
- `--model <string>`: embedding model override (default: `openai/text-embedding-3-small`)

```bash
# Link graph only
node_modules/.bin/markdown-lsp graph ./docs --format json --pretty
node_modules/.bin/markdown-lsp graph ./docs --format dot > graph.dot
node_modules/.bin/markdown-lsp graph ./docs --format mermaid
node_modules/.bin/markdown-lsp graph ./docs --format html --out graph.html

# Turnkey semantic graph (v1.2)
OPENROUTER_API_KEY=sk-or-... node_modules/.bin/markdown-lsp graph ./docs --format html --semantic --out sg.html
OPENROUTER_API_KEY=sk-or-... node_modules/.bin/markdown-lsp graph ./docs --format html --semantic \
  --sim-threshold 0.75 --sim-top-k 5 --model openai/text-embedding-3-small --out sg.html
```

**HTML graph features (v1.2):**
- Solid lines = explicit markdown link edges; dashed amber lines = semantic similarity edges
- Toolbar checkboxes to toggle each edge type on/off
- Click a node: opens side-panel with title, path, char count, sections, outgoing links,
  incoming links, and top semantically similar pages (with scores)
- Click a page in the side-panel: focuses the graph on that node
- Background click: closes panel + clears highlight
- Drag and zoom preserved

JSON shape (v1.2):
```json
{
  "nodes": [{"id":"README.md","title":"Docsbook","charCount":2634,"sectionsCount":10,
             "sections":[{"anchor":"intro","headingPath":["Intro"],"level":2}],
             "outgoing":[{"target":"guide.md","label":"Guide","kind":"inline"}],
             "incoming":[],
             "topSimilar":[{"path":"guide.md","title":"Guide","score":0.8123}]}],
  "edges": [{"source":"README.md","target":"quick-start.md","kind":"inline","label":"Get started"}],
  "semanticEdges": [{"source":"README.md","target":"guide.md","score":0.8123,"kind":"semantic"}],
  "unresolvedCount": 3
}
```

### `semantic-search <docs-dir> <query> [--limit n] [--model <model>]`
AI-powered semantic search using text embeddings. Computes cosine similarity in-memory.
Results cached in `.markdown-lsp-cache/embeddings/` (sha256 keyed per text+model).

```bash
OPENROUTER_API_KEY=sk-or-... node_modules/.bin/markdown-lsp semantic-search ./docs "webhook setup" --limit 5
node_modules/.bin/markdown-lsp semantic-search ./docs "authentication" --model openai/text-embedding-3-small --limit 3
```

- `--limit n`: number of results (default: 10)
- `--model <model>`: embedding model override (default: `openai/text-embedding-3-small`)
- Requires: `OPENROUTER_API_KEY` (OpenRouter) OR `AI_GATEWAY_API_KEY` (Vercel AI Gateway)
- Without a key: exits with a clear error message (no stack trace)

Returns: `SemanticHit[]`
```json
[
  {"pagePath": "webhooks.md", "pageTitle": "Webhooks", "score": 0.8923, "snippet": "Webhooks let you..."},
  {"pagePath": "api/auth.md", "pageTitle": "Authentication", "score": 0.7611, "snippet": "To authenticate..."}
]
```

## Key return types

```
PageSummary   { path, title, headingsCount, charCount }
OutlineNode   { name, level, anchor, range, children: OutlineNode[] }
SearchHit     { pagePath, pageTitle, headingPath[], anchor, snippet, range, matchScore? }
SymbolHit     { name, containerName, pagePath, anchor, range }
Link          { fromPath, toPath, toResolvedPath, toAnchor, kind, textAtLink,
                positionStartLine, positionStartCol, positionEndLine, positionEndCol }
Section       { headingPath[], anchor, level, charCount, content, positionStartLine, positionEndLine }
Range         { start: {line, col}, end: {line, col} }
GraphNode     { id, title, charCount, sectionsCount,
                sections: [{anchor, headingPath[], level}],
                outgoing: [{target, label, kind}],
                incoming: [{source, label, kind}],
                topSimilar: [{path, title, score}] }
GraphEdge     { source, target, kind, label? }
SemanticEdge  { source, target, score, kind: "semantic" }
GraphExport   { nodes: GraphNode[], edges: GraphEdge[], semanticEdges: SemanticEdge[], unresolvedCount }
SemanticHit   { pagePath, pageTitle, score, snippet }
```

## Environment variables

| Variable | Purpose |
|---|---|
| `OPENROUTER_API_KEY` | OpenRouter API key — enables `semantic-search` and `graph --semantic` (takes priority) |
| `AI_GATEWAY_API_KEY` | Vercel AI Gateway key — fallback for AI features |
| `AI_GATEWAY_BASE_URL` | Override gateway base URL (default depends on which key is set) |
| `EMBEDDING_MODEL` | Default embedding model (default: `openai/text-embedding-3-small`) |
| `MARKDOWN_LSP_AI_ENABLED` | Set to `1` to enable full LSP AI features (embeddings + extraction) |

## OpenRouter embeddings

OpenRouter supports the embeddings endpoint at `https://openrouter.ai/api/v1/embeddings`.
Model names **must include the provider prefix**: `openai/text-embedding-3-small` (not bare `text-embedding-3-small`).
This is already the default in markdown-lsp v1.2.0+.

When using Vercel AI Gateway (`AI_GATEWAY_API_KEY`), use bare names: `text-embedding-3-small`.

If the model name is rejected, the CLI outputs a clear hint to try the other form.

## MCP-to-CLI correspondence

| Old MCP tool (docs-lsp / about-lsp) | CLI equivalent |
|---|---|
| `doc_workspace_outline` | `workspace-outline <dir> [--prefix p] [--limit n]` |
| `doc_outline` | `outline <dir> <page>` |
| `doc_search_text` (mode: ranked) | `search-text <dir> <query> --limit n` |
| `doc_search_text` (mode: verbatim) | `search-text <dir> <query> --mode verbatim` |
| `doc_search_symbols` | `search-symbols <dir> <query> --limit n` |
| `doc_search_paths` | `search-paths <dir> <glob>` |
| `doc_search_links_to` | `links-to <dir> <page>` |
| `doc_search_links_from` | `links-from <dir> <page>` |
| `doc_resolve_link` | `resolve-link <dir> <from-page> <link-text>` |
| `doc_get_section` | `get-section <dir> <page> <anchor>` |
