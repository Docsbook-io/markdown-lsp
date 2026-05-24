# @docsbook/markdown-lsp

Language Server Protocol implementation for Markdown documentation. Optional AI-powered semantic layer on top.

**Status: M1 complete, M2 (AI layer) opt-in.**

## Two layers

### Structural (default, no AI)

Out of the box — like Marksman, but persisted in Postgres and addressable from a service.

- `textDocument/documentSymbol` — heading outline
- `workspace/symbol` — fuzzy subsequence search across all headings (e.g. `oaf` matches `OAuth flow`)
- `textDocument/definition` — jump from a link to its target document
- `textDocument/references` — find every page linking to the current document
- `textDocument/completion` — wiki-link completion `[[...]]`
- `textDocument/publishDiagnostics` — warnings for unresolved link targets
- `workspace.executeCommand("markdownLsp/reindex")` — force re-index of the workspace
- Incremental indexing via content-hash diff; watched-files cleanup

This layer is fully deterministic, free, and runs offline against your Postgres.

### Semantic (optional, AI-powered)

Off by default. When enabled, an extract pass identifies canonical concepts per section so that
references survive synonym variation (`auth` ≡ `authentication` ≡ `OAuth` ≡ `login`).

Enable with:

```bash
export MARKDOWN_LSP_AI_ENABLED=1
export AI_GATEWAY_API_KEY=...   # Vercel AI Gateway
```

If the flag is not set, no AI calls are ever made. The server starts and behaves as a
pure-structural LSP — no key required.

## Architecture

- LSP over stdio (`vscode-languageserver/node`) — works in any editor
- pgvector (Neon serverless) for cosine search on canonical-term embeddings (only when AI layer is enabled)
- Drizzle ORM; all tables prefixed `mdlsp_`
- Vercel AI Gateway (`text-embedding-3-small` for embeddings, `gpt-4o-mini` for extraction) — when AI on
- An optional MCP HTTP facade (M3) over the same handlers — for AI agents like Claude Code

## Setup

```bash
pnpm install
cp .env.example .env.local        # fill DATABASE_URL; AI_GATEWAY_API_KEY only if you want the AI layer
pnpm migrate                       # runs scripts/apply-migration.ts against DATABASE_URL
pnpm build
```

## Run

LSP via stdio (for editor integration):

```bash
node dist/server.js --stdio
```

`bin/markdown-lsp` wraps the same entry point as a CLI.

## Use from Docsbook

The structural layer is what Docsbook's "Source of Truth" feature wants. Wire it in like this:

```ts
import { ensureWorkspace, indexWorkspace } from "@docsbook/markdown-lsp/indexer"
import { getDocumentSymbols, getWorkspaceSymbols } from "@docsbook/markdown-lsp/core"

// after cloning a workspace repo into ./tmp/<workspace-id>/
const ws = await ensureWorkspace("./tmp/42")
await indexWorkspace(ws)

// MCP tools then call:
await getWorkspaceSymbols(ws, "auth")
await findReferencesToDocument(ws, authDocId)
```

No AI required.

## Tests

```bash
pnpm test
```

27 tests cover the parser, indexer, and core handlers (plus a small suite for the AI feature flag).

## Milestones

- **M0 — Scaffold** ✅
- **M1 — Structural layer** ✅
- M2 — Semantic extract (opt-in, code present, awaiting live AI Gateway credit)
- M3 — MCP HTTP facade
- M4 — User overrides for the glossary (merge / split / rename / add_synonym)
- M5 — Docsbook integration

## License

MIT
