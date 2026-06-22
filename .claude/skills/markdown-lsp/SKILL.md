---
name: markdown-lsp
description: >
  Teaches any agent to search, navigate, and visualise markdown folders using the markdown-lsp CLI.
  Use when searching docs/ or about/, getting doc outlines, navigating markdown, finding sections,
  traversing the doc link graph, exporting a graph, doing full-text / symbol / path / semantic search
  over any markdown directory, or building a persistent semantic index to save API tokens.
  Also covers granular semantic search (heading/line level), the turnkey semantic graph, and
  how to keep the index fresh automatically via git hooks, a debounced watch script, or CI caching.
  Includes interactive onboarding: guides the user through docs folder setup, API key, granularity
  choice, first index build, git hook installation, and semantic graph generation.
  Triggers: "markdown-lsp", "search docs/about", "doc outline", "navigate markdown", "doc graph",
  "links between pages", "find section in docs", "graph export", "semantic search docs",
  "embeddings search", "semantic graph", "turnkey graph", "index docs", "heading search",
  "granularity", "token-saving search", "incremental reindex", "watch docs", "git hook index",
  "auto-update embeddings", "debounce index",
  "set up markdown-lsp", "configure markdown-lsp", "onboard markdown-lsp",
  "configure semantic search", "setup semantic search", "install markdown-lsp skill",
  "get started with markdown-lsp", "markdown-lsp setup".
---

# markdown-lsp CLI — Markdown search, navigation & semantic graph (v1.4.0)

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

## Enabling AI features (REQUIRED for semantic commands)

As of v1.4.0 AI is **off by default**. Every AI command (`index`, `semantic-search`,
`graph --semantic`) needs **both** env vars or it fails with
`AI features are disabled. Set MARKDOWN_LSP_AI_ENABLED=1`:

```bash
export OPENROUTER_API_KEY=sk-or-...     # your key
export MARKDOWN_LSP_AI_ENABLED=1        # opt in to embeddings
```

Set both once per shell (or inline before each command). All AI examples below assume
`MARKDOWN_LSP_AI_ENABLED=1` is exported — they show only `OPENROUTER_API_KEY=...` for brevity,
but the flag is still required.

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

## Keeping the index fresh (incremental re-index)

### How incremental re-index works

`index ./docs` is already incremental — you can call it as often as you like without fear of wasted
API tokens. Internally, `embedTexts()` checks `sha256(model + text)` against `.markdown-lsp-cache/embeddings/`
before every unit. If the text is unchanged, the vector is loaded from disk; no API call is made.
Only new or changed units are sent to the API.

Concretely:
- **Unchanged docs:** 0 API calls for doc units on every re-index. Only a query vector is ever
  sent (1 call per `semantic-search`).
- **One page changed:** only the units of that page are re-embedded; all other pages are cache hits.
- **Deleted pages:** their cached vectors are never loaded again (units come from current files
  only) — they become orphaned files on disk but have zero impact on search results.

**You can call `index` regularly on a cron, in CI, or via a git hook — you pay only for what changed.**

### Cache size reference

| Granularity | Approx. cache size (78-page docs) |
|---|---|
| `page` | ~470 KB |
| `heading` | ~3.7 MB |
| `line` (paragraphs) | ~18.7 MB |

These are fine for a local dev tool. If you want to reclaim disk space, `rm -rf .markdown-lsp-cache/`
is safe — the cache will be rebuilt on next index/search (one API round-trip for all units).

### Anti-pattern: do NOT call index in a tight loop

Calling `index` on every keystroke or file-save without debouncing wastes time even when the API
cost is zero (disk I/O + startup per call). Use one of the integration patterns below instead.

---

## Auto-update on changes

Choose the pattern that matches your workflow, from simplest to most flexible.

### RECOMMENDED: git hooks (post-merge / post-checkout / post-commit)

Git hooks fire at natural batch boundaries — after a merge, branch switch, or commit — so no
debounce logic is needed. The index is always fresh after you pull or change branches.

**post-merge** (fires after `git pull` / `git merge`):

```bash
#!/bin/sh
# .git/hooks/post-merge
set -e
cd "$(git rev-parse --show-toplevel)"
# AI is off by default (v1.4.0+) — pull the key from .env* and opt in.
KEY=$(grep -h '^OPENROUTER_API_KEY=' .env.local .env 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"'\''')
[ -n "$KEY" ] || { echo "[markdown-lsp] no OPENROUTER_API_KEY — skipping reindex"; exit 0; }
export OPENROUTER_API_KEY="$KEY" MARKDOWN_LSP_AI_ENABLED=1
echo "[markdown-lsp] Re-indexing docs after merge..."
npx markdown-lsp index ./docs --granularity heading
echo "[markdown-lsp] Done."
```

**post-checkout** (fires after `git checkout` / `git switch`; `$3 = 1` means branch switch):

```bash
#!/bin/sh
# .git/hooks/post-checkout
PREV_HEAD="$1"
NEW_HEAD="$2"
BRANCH_SWITCH="$3"
if [ "$BRANCH_SWITCH" = "1" ]; then
  cd "$(git rev-parse --show-toplevel)"
  KEY=$(grep -h '^OPENROUTER_API_KEY=' .env.local .env 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"'\''')
  [ -n "$KEY" ] || { echo "[markdown-lsp] no OPENROUTER_API_KEY — skipping reindex"; exit 0; }
  export OPENROUTER_API_KEY="$KEY" MARKDOWN_LSP_AI_ENABLED=1
  echo "[markdown-lsp] Branch switched, re-indexing docs..."
  npx markdown-lsp index ./docs --granularity heading
fi
```

**post-commit** (optional — use if you want the index updated after every local commit):

```bash
#!/bin/sh
# .git/hooks/post-commit
set -e
cd "$(git rev-parse --show-toplevel)"
npx markdown-lsp index ./docs --granularity heading
```

**Installation:**

```bash
# Make hooks executable
chmod +x .git/hooks/post-merge .git/hooks/post-checkout

# Optional: post-commit
chmod +x .git/hooks/post-commit
```

**Using husky or lefthook?** Add to your existing config instead of editing `.git/hooks` directly:

```bash
# husky (package.json → "husky": { "hooks": { "post-merge": "npx markdown-lsp index ./docs --granularity heading" } })
npx husky add .husky/post-merge "npx markdown-lsp index ./docs --granularity heading"

# lefthook (lefthook.yml)
# post-merge:
#   commands:
#     index-docs:
#       run: npx markdown-lsp index ./docs --granularity heading
```

---

### Watch script with debounce (real-time, no git required)

For real-time updates while writing docs, use a debounced file-watcher. The debounce is essential
— without it, every auto-save would trigger a separate `index` call.

`chokidar` is not a dependency of `markdown-lsp` — install it in your own project if you want it,
or use the stdlib `fs.watch` snippet below (zero deps):

**Option A — stdlib `fs.watch` (zero extra dependencies):**

```js
// scripts/watch-index.mjs
import { watch } from "node:fs"
import { execSync } from "node:child_process"

const DOCS_DIR = process.argv[2] ?? "./docs"
const DEBOUNCE_MS = 3000  // wait 3 s after last change before re-indexing

let timer = null

watch(DOCS_DIR, { recursive: true }, (event, filename) => {
  if (!filename?.endsWith(".md")) return
  clearTimeout(timer)
  timer = setTimeout(() => {
    console.log(`[watch-index] ${filename} changed — re-indexing ${DOCS_DIR}...`)
    try {
      execSync(`npx markdown-lsp index ${DOCS_DIR} --granularity heading`, { stdio: "inherit" })
    } catch (e) {
      console.error("[watch-index] index failed:", e.message)
    }
  }, DEBOUNCE_MS)
})

console.log(`[watch-index] Watching ${DOCS_DIR} — debounce ${DEBOUNCE_MS}ms`)
```

Run in background: `node scripts/watch-index.mjs ./docs &`

**Option B — chokidar (install separately: `npm install --save-dev chokidar`):**

```js
// scripts/watch-index-chokidar.mjs
import chokidar from "chokidar"
import { execSync } from "node:child_process"

const DOCS_DIR = process.argv[2] ?? "./docs"
const DEBOUNCE_MS = 3000

let timer = null

chokidar.watch(`${DOCS_DIR}/**/*.md`, { ignoreInitial: true }).on("all", (event, path) => {
  clearTimeout(timer)
  timer = setTimeout(() => {
    console.log(`[watch-index] ${path} changed — re-indexing...`)
    try {
      execSync(`npx markdown-lsp index ${DOCS_DIR} --granularity heading`, { stdio: "inherit" })
    } catch (e) {
      console.error("[watch-index] index failed:", e.message)
    }
  }, DEBOUNCE_MS)
})

console.log(`[watch-index] Watching ${DOCS_DIR}/**/*.md — debounce ${DEBOUNCE_MS}ms`)
```

**Why 3-5 s debounce?** If you save multiple files quickly (e.g. a refactor across 10 pages), the
timer resets on each save, and only one `index` call fires after you stop. With a 3 s debounce,
bursts of up to ~3 s are coalesced into a single re-index.

---

### CI pattern: cache the index across runs

For teams using GitHub Actions, cache `.markdown-lsp-cache/` keyed on the hash of your markdown
files + the embedding model. The index survives across CI runs — only changed files are re-embedded.

```yaml
# .github/workflows/index-docs.yml
name: Re-index docs
on:
  push:
    paths:
      - 'docs/**/*.md'
      - 'about/**/*.md'

jobs:
  index:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Restore embedding cache
        uses: actions/cache@v4
        with:
          path: .markdown-lsp-cache
          key: mlsp-${{ hashFiles('docs/**/*.md', 'about/**/*.md') }}-${{ env.EMBEDDING_MODEL || 'default' }}
          restore-keys: |
            mlsp-

      - name: Re-index docs (incremental — only changed files cost tokens)
        run: npx markdown-lsp index ./docs --granularity heading
        env:
          OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}
```

On a cache hit (no markdown files changed), the `index` step runs with 0 API calls. On a partial
hit (some files changed), only those are re-embedded. On a full miss (first run or model change),
the full index is built and saved for the next run.

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

---

## Setup (interactive onboarding)

When the user says "set up markdown-lsp", "configure", "onboard", "install markdown-lsp", or
"get started with markdown-lsp" — run this 6-step interactive flow. Ask questions one at a time
and wait for the answer before proceeding. Be concise: one question per message.

### Step 1 — Locate the docs folder

Ask: "Where is your docs folder? (e.g. `./docs`, `./content`, `./pages`)"

Then verify it works:
```bash
npx markdown-lsp workspace-outline <docs-dir> --limit 5
```
If the command fails or returns 0 pages, help the user fix the path before continuing.
If it succeeds, show the page count and move on.

### Step 2 — Check OPENROUTER_API_KEY

Ask: "Do you want semantic search and the semantic graph? They use an embedding model via
OpenRouter (free tier available at openrouter.ai)."

If yes:
```bash
echo $OPENROUTER_API_KEY
```
If the variable is empty, explain: "Get a free key at https://openrouter.ai/keys, then run:
`export OPENROUTER_API_KEY=sk-or-...` (or add it to your `.env` file — never commit the key)."
Also export `MARKDOWN_LSP_AI_ENABLED=1` — AI is off by default since v1.4.0 and every AI command
fails without it. Wait until the user confirms both are set before continuing.

If no: skip Steps 3–6 and summarise what works without a key (structural search, link graph).

### Step 3 — Choose granularity

Ask: "How granular do you want semantic search?

- **page** (fastest, default) — matches whole pages; cheapest first run
- **heading** — matches individual sections; best precision for most docs
- **line** — matches paragraph blocks; finest but slowest first run

Which do you prefer? (default: heading)"

Default to `heading` if unsure. Explain trade-offs only if asked.

### Step 4 — Build the first semantic index

Run:
```bash
MARKDOWN_LSP_AI_ENABLED=1 OPENROUTER_API_KEY=<key> npx markdown-lsp index <docs-dir> --granularity <choice>
```
Show the output. Explain: "This caches all embeddings locally in `.markdown-lsp-cache/`.
Every re-run is free if docs haven't changed — you only pay for what's new or modified."

### Step 5 — Offer a git hook for auto-reindex

Ask: "Set up a git hook to automatically re-index after `git pull` or branch switches?
I'll show you exactly what will be created."

If yes, write these two files (replace `<docs-dir>` with the actual path):

`.git/hooks/post-merge`:
```bash
#!/bin/sh
# .git/hooks/post-merge — auto-reindex docs after git pull / git merge
set -e
cd "$(git rev-parse --show-toplevel)"
# AI is off by default (v1.4.0+) — pull the key from .env* and opt in.
KEY=$(grep -h '^OPENROUTER_API_KEY=' .env.local .env 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"'\''')
[ -n "$KEY" ] || { echo "[markdown-lsp] no OPENROUTER_API_KEY — skipping reindex"; exit 0; }
export OPENROUTER_API_KEY="$KEY" MARKDOWN_LSP_AI_ENABLED=1
echo "[markdown-lsp] Re-indexing docs after merge..."
npx markdown-lsp index <docs-dir> --granularity <choice>
echo "[markdown-lsp] Done."
```

`.git/hooks/post-checkout`:
```bash
#!/bin/sh
# .git/hooks/post-checkout — auto-reindex docs after branch switch
# $3 = 1 means branch switch, 0 = file checkout
BRANCH_SWITCH="$3"
if [ "$BRANCH_SWITCH" = "1" ]; then
  cd "$(git rev-parse --show-toplevel)"
  KEY=$(grep -h '^OPENROUTER_API_KEY=' .env.local .env 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"'\''')
  [ -n "$KEY" ] || { echo "[markdown-lsp] no OPENROUTER_API_KEY — skipping reindex"; exit 0; }
  export OPENROUTER_API_KEY="$KEY" MARKDOWN_LSP_AI_ENABLED=1
  echo "[markdown-lsp] Branch switched, re-indexing docs..."
  npx markdown-lsp index <docs-dir> --granularity <choice>
  echo "[markdown-lsp] Done."
fi
```

Then make them executable:
```bash
chmod +x .git/hooks/post-merge .git/hooks/post-checkout
```

Confirm to the user what was created and that the hooks will fire automatically going forward.

### Step 6 — Generate the semantic graph (wow moment)

Ask: "Want to generate an interactive semantic graph of your docs? It shows links AND semantic
similarity between pages — opens in your browser."

If yes:
```bash
MARKDOWN_LSP_AI_ENABLED=1 OPENROUTER_API_KEY=<key> npx markdown-lsp graph <docs-dir> --format html --semantic \
  --granularity <heading|page> --out docs-graph.html
```
Then open it:
```bash
open docs-graph.html        # macOS
# or: xdg-open docs-graph.html  # Linux
```
Explain: "Solid lines = explicit markdown links. Dashed amber = semantic similarity.
Click any node to see its sections, links, and top similar pages."

### After onboarding — summary

Once all steps are done, summarise what was set up:
- Docs folder confirmed: `<docs-dir>`
- Semantic index built at `<granularity>` granularity
- Git hooks installed (if chosen): auto-reindex on merge/checkout
- Semantic graph generated (if chosen): `docs-graph.html`

Then suggest first things to try:
```
"search my docs semantically for 'how to configure webhooks'"
"find which pages link to getting-started.md"
"show me a heading-level semantic search for 'rate limiting'"
"rebuild the semantic graph after I update my docs"
```
