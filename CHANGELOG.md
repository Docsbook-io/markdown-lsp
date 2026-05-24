# Changelog

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
