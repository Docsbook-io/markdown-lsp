import { parseArgs } from "node:util"
import * as fs from "node:fs"
import { buildGraph } from "./graph.js"
import {
  listPages,
  searchText,
  searchTextRanked,
  searchSymbols,
  searchPaths,
} from "./bridge/index.js"

const USAGE = `
markdown-lsp v1.3.0 — CLI for querying Markdown documentation graphs

USAGE
  markdown-lsp <subcommand> [options]

SUBCOMMANDS
  workspace-outline <docs-dir> [--prefix <p>] [--limit <n>]
      List all pages in the workspace with metadata.

  outline <docs-dir> <page>
      Show the heading outline of a single page.

  search-text <docs-dir> <query> [--mode ranked|verbatim] [--regex]
              [--case-sensitive] [--prefix <p>] [--limit <n>] [--context <n>]
      Full-text search. Default mode: ranked (natural-language). Use
      --mode verbatim (or --regex) for exact/regex matching.

  search-symbols <docs-dir> <query> [--limit <n>]
      Fuzzy subsequence search across all headings.

  search-paths <docs-dir> <glob>
      List pages whose paths match a glob pattern (*, **, ?).

  links-to <docs-dir> <page>
      Show all pages that link to <page>.

  links-from <docs-dir> <page>
      Show all links that originate from <page>.

  resolve-link <docs-dir> <from-page> <link-text>
      Resolve a specific link text from a given page.

  get-section <docs-dir> <page> <anchor>
      Retrieve a section by its anchor slug.

  index <docs-dir> [--granularity page|heading|line] [--model <m>]
      Build the persistent semantic index once — embeds all units at the
      chosen granularity and writes them to .markdown-lsp-cache/.
      Subsequent semantic-search / graph --semantic calls reuse the cache,
      so they only embed the query (1 API round-trip instead of N).
      Idempotent: re-running without doc changes costs 0 API calls.
      Requires OPENROUTER_API_KEY or AI_GATEWAY_API_KEY.

  graph <docs-dir> [--format json|dot|mermaid|html] [--out <file>]
        [--semantic] [--granularity page|heading] [--sim-threshold <0-1>]
        [--sim-top-k <n>] [--model <embedding-model>]
      Export the doc link graph. Default format: json (nodes/edges).
      Use --format html for a self-contained interactive D3 visualisation.
      Use --out <file> to write to disk instead of stdout.
      Add --semantic to overlay AI-powered similarity edges (requires
      OPENROUTER_API_KEY or AI_GATEWAY_API_KEY). Both link edges and
      semantic edges are shown in the HTML graph with checkboxes to
      toggle each type. Clicking a node opens a side-panel with full
      info and highlights all its connections.
        --granularity    page (default) or heading (nodes = sections)
        --sim-threshold  Minimum cosine similarity for a semantic edge (default: 0.75)
        --sim-top-k      Maximum semantic neighbours per node (default: 5)
        --model          Embedding model override (default: openai/text-embedding-3-small)
      Note: --granularity line is NOT supported for graph (too many nodes).

  semantic-search <docs-dir> <query> [--limit <n>] [--model <embedding-model>]
                  [--granularity page|heading|line]
      AI-powered semantic search using embeddings. Requires OPENROUTER_API_KEY
      (or AI_GATEWAY_API_KEY). Results are cached in .markdown-lsp-cache/.
      Default embedding model: openai/text-embedding-3-small
        --granularity page    Search whole pages (default, fast)
        --granularity heading Search within sections (returns anchor + headingPath)
        --granularity line    Search paragraph blocks (returns line number)

  lsp [--stdio]
  serve [--stdio]
      Start the LSP stdio server (for editor integration).
      Back-compat: --stdio | --node-ipc | --socket=<n> as first arg also
      starts the LSP server.

GLOBAL FLAGS
  --pretty      Pretty-print JSON output (default: compact)
  --text        Human-readable output (where implemented)
  -h, --help    Print this help

OUTPUT
  All subcommands print JSON to stdout (compact by default, use --pretty
  for indented output). The LSP subcommand speaks the Language Server Protocol
  over stdio — it does NOT print JSON.

EXAMPLES
  # Overview of all pages
  markdown-lsp workspace-outline ./docs

  # Heading outline of one page
  markdown-lsp outline ./docs introduction.md

  # Full-text search (natural-language, ranked)
  markdown-lsp search-text ./docs "getting started"
  markdown-lsp search-text ./docs "webhook signing" --mode verbatim --limit 5

  # Fuzzy heading search
  markdown-lsp search-symbols ./docs "webhook" --limit 10

  # Find pages by filename glob
  markdown-lsp search-paths ./docs "ai/*.md"

  # Build the semantic index once (saves tokens on every later search)
  markdown-lsp index ./docs --granularity heading

  # Semantic search — heading level (returns anchor + section)
  markdown-lsp semantic-search ./docs "how does auth work" --granularity heading --limit 10

  # Semantic search — paragraph level (returns line number)
  markdown-lsp semantic-search ./docs "rate limit error" --granularity line --limit 5

  # Link graph
  markdown-lsp graph ./docs --format json --pretty
  markdown-lsp graph ./docs --format html --out graph.html
  markdown-lsp graph ./docs --format dot | dot -Tsvg > graph.svg
  markdown-lsp graph ./docs --format mermaid

  # Semantic graph — heading-level nodes (sections as nodes)
  markdown-lsp graph ./docs --format html --semantic --granularity heading --out graph-headings.html
  markdown-lsp graph ./docs --format html --semantic --sim-threshold 0.75 --sim-top-k 5 --out graph.html

  # Backlinks / outgoing links
  markdown-lsp links-to ./docs quick-start.md
  markdown-lsp links-from ./docs README.md

  # Resolve / read
  markdown-lsp resolve-link ./docs README.md "Getting Started"
  markdown-lsp get-section ./docs overview.md "quick-links"

  # LSP server
  markdown-lsp lsp --stdio
`.trim()

function die(msg: string): never {
  process.stderr.write(msg + "\n")
  process.exit(1)
}

function out(value: unknown, pretty: boolean): void {
  process.stdout.write((pretty ? JSON.stringify(value, null, 2) : JSON.stringify(value)) + "\n")
}

// ── Graph export helpers ──────────────────────────────────────────────────────

interface GraphNode {
  id: string
  title: string
  charCount: number
  sectionsCount: number
  /** "page" (default) or "heading" (this node represents a section) */
  nodeType?: "page" | "heading"
  /** For heading-nodes: the full heading breadcrumb path */
  headingPath?: string[]
  /** For heading-nodes: the page this section belongs to */
  pagePath?: string
  // Side-panel data
  sections: Array<{ anchor: string | null; headingPath: string[]; level: number }>
  outgoing: Array<{ target: string; label: string | null; kind: string }>
  incoming: Array<{ source: string; label: string | null; kind: string }>
  topSimilar: Array<{ path: string; title: string | null; score: number }>
}

interface GraphEdge {
  source: string
  target: string
  kind: string
  label?: string
}

interface SemanticEdge {
  source: string
  target: string
  score: number
  kind: "semantic"
}

interface GraphExport {
  nodes: GraphNode[]
  edges: GraphEdge[]
  semanticEdges: SemanticEdge[]
  unresolvedCount: number
}

function buildGraphExport(raw: ReturnType<ReturnType<typeof buildGraph>["toJSON"]>): GraphExport {
  // Build node map with full side-panel data
  const nodeMap = new Map<string, GraphNode>()
  for (const p of raw.pages) {
    nodeMap.set(p.path, {
      id: p.path,
      title: p.title ?? p.path,
      charCount: p.content.length,
      sectionsCount: p.sections.length,
      sections: p.sections.map((s) => ({
        anchor: s.anchor,
        headingPath: s.headingPath,
        level: s.level,
      })),
      outgoing: [],
      incoming: [],
      topSimilar: [],
    })
  }

  const edges: GraphEdge[] = []
  for (const l of raw.links) {
    if (l.toResolvedPath === null) continue
    edges.push({
      source: l.fromPath,
      target: l.toResolvedPath,
      kind: l.kind,
      ...(l.textAtLink ? { label: l.textAtLink } : {}),
    })
    nodeMap.get(l.fromPath)?.outgoing.push({
      target: l.toResolvedPath,
      label: l.textAtLink,
      kind: l.kind,
    })
    nodeMap.get(l.toResolvedPath)?.incoming.push({
      source: l.fromPath,
      label: l.textAtLink,
      kind: l.kind,
    })
  }

  return {
    nodes: Array.from(nodeMap.values()),
    edges,
    semanticEdges: [],
    unresolvedCount: raw.unresolved.length,
  }
}

// ── Cosine similarity (no deps) ───────────────────────────────────────────────

function cosineSim(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!
    na += a[i]! * a[i]!
    nb += b[i]! * b[i]!
  }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

// ── Semantic edge computation ─────────────────────────────────────────────────

async function addSemanticEdges(
  data: GraphExport,
  pages: ReturnType<ReturnType<typeof buildGraph>["toJSON"]>["pages"],
  modelOverride: string | undefined,
  simThreshold: number,
  simTopK: number,
  granularity: "page" | "heading" = "page",
): Promise<void> {
  const { assertApiKey } = await import("./ai/config.js")
  assertApiKey()

  const { embedTexts } = await import("./ai/embeddings.js")
  const { unitize } = await import("./ai/granular.js")

  const units = unitize(pages, granularity)

  process.stderr.write(
    `[markdown-lsp] Embedding ${units.length} units at granularity="${granularity}"` +
    ` (model: ${modelOverride ?? "openai/text-embedding-3-small"})...\n`
  )
  const unitTexts = units.map((u) => u.text)
  const { vectors, tokensUsed } = await embedTexts(unitTexts, modelOverride, true)
  if (tokensUsed > 0) {
    process.stderr.write(`[markdown-lsp] Embeddings computed (${tokensUsed} tokens used).\n`)
  } else {
    process.stderr.write(`[markdown-lsp] Embeddings loaded from cache (0 API tokens).\n`)
  }

  const semanticEdges: SemanticEdge[] = []

  if (granularity === "heading") {
    // Heading mode: nodes are sections, semantic edges between sections
    // data.nodes at this point are page-nodes — for heading mode we REPLACE them with section-nodes
    const sectionNodes: GraphNode[] = []
    const sectionNodeMap = new Map<string, GraphNode>()

    for (const page of pages) {
      for (const s of page.sections) {
        const anchor = s.anchor ?? "section"
        const nodeId = `${page.path}#${anchor}`
        const label = s.headingPath[s.headingPath.length - 1] ?? anchor
        const sectionNode: GraphNode = {
          id: nodeId,
          title: label,
          charCount: s.charCount,
          sectionsCount: 0,
          nodeType: "heading",
          headingPath: s.headingPath,
          pagePath: page.path,
          sections: [],
          outgoing: [],
          incoming: [],
          topSimilar: [],
        }
        sectionNodes.push(sectionNode)
        sectionNodeMap.set(nodeId, sectionNode)
      }
    }

    // Rebuild link edges at page level (project page links onto their first section)
    const sectionEdges: GraphEdge[] = []
    for (const e of data.edges) {
      // find first section of source and target pages
      const srcPage = pages.find((p) => p.path === e.source)
      const tgtPage = pages.find((p) => p.path === e.target)
      if (!srcPage || !tgtPage) continue
      const srcSec = srcPage.sections[0]
      const tgtSec = tgtPage.sections[0]
      if (!srcSec || !tgtSec) continue
      const srcId = `${srcPage.path}#${srcSec.anchor ?? "section"}`
      const tgtId = `${tgtPage.path}#${tgtSec.anchor ?? "section"}`
      sectionEdges.push({ source: srcId, target: tgtId, kind: e.kind, label: e.label })
      sectionNodeMap.get(srcId)?.outgoing.push({ target: tgtId, label: e.label ?? null, kind: e.kind })
      sectionNodeMap.get(tgtId)?.incoming.push({ source: srcId, label: e.label ?? null, kind: e.kind })
    }

    data.nodes = sectionNodes
    data.edges = sectionEdges

    // Compute semantic edges between section-units
    for (let i = 0; i < units.length; i++) {
      const vecI = vectors[i]
      if (!vecI) continue

      const sims: Array<{ j: number; score: number }> = []
      for (let j = 0; j < units.length; j++) {
        if (j === i) continue
        const vecJ = vectors[j]
        if (!vecJ) continue
        const score = cosineSim(vecI, vecJ)
        if (score >= simThreshold) {
          sims.push({ j, score })
        }
      }

      const topSimilar = [...sims]
        .sort((a, b) => b.score - a.score)
        .slice(0, simTopK)
        .map(({ j, score }) => ({
          path: units[j]!.id,
          title: units[j]!.headingPath?.join(" > ") ?? units[j]!.id,
          score: Math.round(score * 10000) / 10000,
        }))

      const node = sectionNodeMap.get(units[i]!.id)
      if (node) node.topSimilar = topSimilar

      for (const { j, score } of sims) {
        if (j > i) {
          semanticEdges.push({
            source: units[i]!.id,
            target: units[j]!.id,
            score: Math.round(score * 10000) / 10000,
            kind: "semantic",
          })
        }
      }
    }
  } else {
    // Page mode: original behaviour
    for (let i = 0; i < units.length; i++) {
      const vecI = vectors[i]
      if (!vecI) continue

      const sims: Array<{ j: number; score: number }> = []
      for (let j = 0; j < units.length; j++) {
        if (j === i) continue
        const vecJ = vectors[j]
        if (!vecJ) continue
        const score = cosineSim(vecI, vecJ)
        if (score >= simThreshold) {
          sims.push({ j, score })
        }
      }

      const topSimilar = [...sims]
        .sort((a, b) => b.score - a.score)
        .slice(0, simTopK)
        .map(({ j, score }) => ({
          path: pages[j]!.path,
          title: pages[j]!.title,
          score: Math.round(score * 10000) / 10000,
        }))

      const node = data.nodes.find((n) => n.id === pages[i]!.path)
      if (node) node.topSimilar = topSimilar

      for (const { j, score } of sims) {
        if (j > i) {
          semanticEdges.push({
            source: pages[i]!.path,
            target: pages[j]!.path,
            score: Math.round(score * 10000) / 10000,
            kind: "semantic",
          })
        }
      }
    }
  }

  data.semanticEdges = semanticEdges
  process.stderr.write(
    `[markdown-lsp] ${semanticEdges.length} semantic edges` +
    ` (threshold=${simThreshold}, topK=${simTopK}, granularity=${granularity}).\n`
  )
}

// ── Graph renderers ───────────────────────────────────────────────────────────

function renderGraphJson(data: GraphExport, pretty: boolean): string {
  return pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data)
}

function renderGraphDot(data: GraphExport): string {
  const lines: string[] = ['digraph G {', '  rankdir=LR;']
  for (const n of data.nodes) {
    const label = n.title.replace(/"/g, '\\"')
    const id = n.id.replace(/"/g, '\\"')
    lines.push(`  "${id}" [label="${label}"];`)
  }
  for (const e of data.edges) {
    const src = e.source.replace(/"/g, '\\"')
    const tgt = e.target.replace(/"/g, '\\"')
    lines.push(`  "${src}" -> "${tgt}";`)
  }
  for (const e of data.semanticEdges) {
    const src = e.source.replace(/"/g, '\\"')
    const tgt = e.target.replace(/"/g, '\\"')
    lines.push(`  "${src}" -> "${tgt}" [style=dashed color="#f59e0b" label="${e.score}"];`)
  }
  lines.push('}')
  return lines.join('\n')
}

function renderGraphMermaid(data: GraphExport): string {
  const lines: string[] = ['graph TD']
  for (const e of data.edges) {
    const src = e.source.replace(/"/g, '\\"')
    const tgt = e.target.replace(/"/g, '\\"')
    lines.push(`  "${src}" --> "${tgt}"`)
  }
  for (const e of data.semanticEdges) {
    const src = e.source.replace(/"/g, '\\"')
    const tgt = e.target.replace(/"/g, '\\"')
    lines.push(`  "${src}" -. ${e.score} .-> "${tgt}"`)
  }
  return lines.join('\n')
}

function renderGraphHtml(data: GraphExport, docsDir: string, hasSemantic: boolean, granularity: "page" | "heading" = "page"): string {
  const title = docsDir.split('/').filter(Boolean).pop() ?? docsDir
  const granularityLabel = granularity === "heading" ? " (sections)" : ""
  const jsonData = JSON.stringify(data)
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Doc Graph — ${title}${granularityLabel}</title>
<script src="https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js"></script>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: system-ui, sans-serif; background: #0f1117; color: #e2e8f0; overflow: hidden; }
  #toolbar { position: fixed; top: 0; left: 0; right: 0; height: 44px; background: #1a1d27;
             border-bottom: 1px solid #2d3148; display: flex; align-items: center; padding: 0 16px;
             z-index: 10; gap: 16px; font-size: 13px; }
  #toolbar h1 { font-size: 14px; font-weight: 600; color: #a5b4fc; }
  #toolbar span { color: #64748b; }
  .toggle-label { display: flex; align-items: center; gap: 6px; cursor: pointer; user-select: none; font-size: 12px; }
  .toggle-label input[type=checkbox] { accent-color: #a5b4fc; width: 14px; height: 14px; cursor: pointer; }
  .toggle-links { color: #a5b4fc; }
  .toggle-semantic { color: #f59e0b; }
  .toggle-label.disabled { opacity: 0.4; cursor: not-allowed; pointer-events: none; }
  #graph-wrap { position: fixed; top: 44px; left: 0; bottom: 0; right: 0; transition: right 0.25s; }
  #graph-wrap.panel-open { right: 320px; }
  svg#graph { width: 100%; height: 100%; display: block; }
  #tooltip { position: fixed; pointer-events: none; background: #1e2130; border: 1px solid #3b4168;
             border-radius: 6px; padding: 8px 12px; font-size: 12px; line-height: 1.5;
             max-width: 280px; z-index: 20; display: none; }
  #tooltip .title { font-weight: 600; color: #c7d2fe; margin-bottom: 2px; }
  #tooltip .path { color: #64748b; font-size: 11px; }
  #tooltip .stats { color: #94a3b8; font-size: 11px; margin-top: 4px; }
  #panel { position: fixed; top: 44px; right: 0; width: 320px; bottom: 0;
           background: #1a1d27; border-left: 1px solid #2d3148; z-index: 15;
           overflow-y: auto; display: none; }
  #panel.open { display: block; }
  #panel-header { padding: 14px 16px 10px; border-bottom: 1px solid #2d3148;
                  display: flex; align-items: flex-start; gap: 8px; }
  #panel-close { background: none; border: none; color: #64748b; cursor: pointer;
                 font-size: 18px; line-height: 1; padding: 2px; flex-shrink: 0; margin-left: auto; }
  #panel-close:hover { color: #e2e8f0; }
  #panel-title { font-weight: 700; font-size: 14px; color: #c7d2fe; margin-bottom: 2px; word-break: break-all; }
  #panel-path { font-size: 11px; color: #64748b; word-break: break-all; }
  #panel-stats { font-size: 11px; color: #94a3b8; margin-top: 4px; }
  #panel-body { padding: 12px 16px; }
  .panel-section { margin-bottom: 16px; }
  .panel-section h3 { font-size: 11px; font-weight: 600; color: #64748b; text-transform: uppercase;
                      letter-spacing: 0.05em; margin-bottom: 8px; }
  .panel-section ul { list-style: none; }
  .panel-section ul li { font-size: 12px; color: #94a3b8; padding: 3px 0; border-bottom: 1px solid #1e2130; }
  .panel-section ul li:last-child { border-bottom: none; }
  .panel-section ul li a { color: #a5b4fc; text-decoration: none; cursor: pointer; }
  .panel-section ul li a:hover { text-decoration: underline; }
  .panel-section ul li .score { font-size: 11px; color: #64748b; margin-left: 6px; }
  .panel-section ul li .kind { font-size: 10px; color: #475569; margin-left: 4px; background: #1e2130;
                                padding: 1px 4px; border-radius: 3px; }
  .panel-section .empty { color: #475569; font-size: 12px; font-style: italic; }
  .node circle { cursor: pointer; transition: r 0.15s; }
  .node text { pointer-events: none; font-size: 10px; fill: #cbd5e1; }
  .link { stroke: #3b4168; stroke-opacity: 0.6; fill: none; }
  .link.highlighted { stroke: #a5b4fc; stroke-opacity: 1; stroke-width: 1.5; }
  .link-semantic { stroke: #f59e0b; stroke-opacity: 0.35; stroke-dasharray: 5,3; fill: none; }
  .link-semantic.highlighted { stroke-opacity: 0.9; stroke-dasharray: none; }
  .node.dimmed circle { opacity: 0.12; }
  .node.dimmed text { opacity: 0.06; }
  .node.highlighted circle { stroke: #a5b4fc !important; stroke-width: 2px !important; }
  .node.selected circle { stroke: #f59e0b !important; stroke-width: 2.5px !important; }
</style>
</head>
<body>
<div id="toolbar">
  <h1>Doc Graph — ${title}${granularityLabel}</h1>
  <span id="stats"></span>
  <label class="toggle-label toggle-links" title="Toggle link edges (solid lines)">
    <input type="checkbox" id="chk-links" checked> Links
  </label>
  <label class="toggle-label toggle-semantic${hasSemantic ? '' : ' disabled'}"
         title="${hasSemantic ? 'Toggle semantic similarity edges (dashed lines)' : 'Run graph --semantic to enable'}">
    <input type="checkbox" id="chk-semantic"${hasSemantic ? ' checked' : ' disabled'}> Semantic
  </label>
</div>
<div id="graph-wrap">
  <svg id="graph"></svg>
</div>
<div id="panel">
  <div id="panel-header">
    <div>
      <div id="panel-title"></div>
      <div id="panel-path"></div>
      <div id="panel-stats"></div>
    </div>
    <button id="panel-close" title="Close panel">&#x2715;</button>
  </div>
  <div id="panel-body"></div>
</div>
<div id="tooltip"></div>
<script>
const DATA = ${jsonData};
const HAS_SEMANTIC = ${hasSemantic};

// Node map for fast lookup
const nodeById = new Map(DATA.nodes.map(n => [n.id, n]));

// Build adjacency maps for highlight
const adjLink = new Map();
const adjSemantic = new Map();
for (const n of DATA.nodes) { adjLink.set(n.id, new Set()); adjSemantic.set(n.id, new Set()); }
for (const e of DATA.edges) {
  if (adjLink.has(e.source)) adjLink.get(e.source).add(e.target);
  if (adjLink.has(e.target)) adjLink.get(e.target).add(e.source);
}
for (const e of DATA.semanticEdges) {
  if (adjSemantic.has(e.source)) adjSemantic.get(e.source).add(e.target);
  if (adjSemantic.has(e.target)) adjSemantic.get(e.target).add(e.source);
}

const linkCount = DATA.edges.length;
const semCount = DATA.semanticEdges.length;
document.getElementById('stats').textContent =
  DATA.nodes.length + ' pages · ' + linkCount + ' links' +
  (semCount > 0 ? ' · ' + semCount + ' semantic' : '') +
  ' · ' + DATA.unresolvedCount + ' unresolved';

const graphWrap = document.getElementById('graph-wrap');
function wrapW() { return graphWrap.offsetWidth || window.innerWidth; }
function wrapH() { return graphWrap.offsetHeight || (window.innerHeight - 44); }

const svg = d3.select('svg#graph');

const g = svg.append('g');

// Zoom + click-on-background
svg.call(d3.zoom()
  .scaleExtent([0.05, 4])
  .on('zoom', (event) => g.attr('transform', event.transform)));

svg.on('click', (event) => {
  if (event.target.tagName === 'svg' || event.target.tagName === 'rect') {
    clearHighlight();
    closePanel();
  }
});

// Arrow markers
const defs = svg.append('defs');
defs.append('marker').attr('id','arrow')
  .attr('viewBox','0 -4 8 8').attr('refX',14).attr('refY',0)
  .attr('markerWidth',6).attr('markerHeight',6).attr('orient','auto')
  .append('path').attr('d','M0,-4L8,0L0,4').attr('fill','#3b4168');
defs.append('marker').attr('id','arrow-sem')
  .attr('viewBox','0 -4 8 8').attr('refX',14).attr('refY',0)
  .attr('markerWidth',6).attr('markerHeight',6).attr('orient','auto')
  .append('path').attr('d','M0,-4L8,0L0,4').attr('fill','#f59e0b');

// Semantic edges (behind links)
const semanticLinkSel = g.append('g').selectAll('line')
  .data(DATA.semanticEdges)
  .join('line')
  .attr('class','link-semantic')
  .attr('stroke-width', d => Math.max(0.8, d.score * 2.5))
  .attr('marker-end','url(#arrow-sem)');

// Link edges
const linkSel = g.append('g').selectAll('line')
  .data(DATA.edges)
  .join('line')
  .attr('class','link')
  .attr('marker-end','url(#arrow)');

// Color by first path segment
const color = d3.scaleOrdinal(d3.schemeTableau10);
const segColor = id => color(id.split('/')[0] ?? '');

let selectedNodeId = null;

// Nodes
const nodeSel = g.append('g').selectAll('g')
  .data(DATA.nodes)
  .join('g')
  .attr('class','node')
  .call(d3.drag()
    .on('start',(ev,d)=>{ if(!ev.active) sim.alphaTarget(0.3).restart(); d.fx=d.x; d.fy=d.y; })
    .on('drag',(ev,d)=>{ d.fx=ev.x; d.fy=ev.y; })
    .on('end',(ev,d)=>{ if(!ev.active) sim.alphaTarget(0); d.fx=null; d.fy=null; }));

nodeSel.append('circle')
  .attr('r', d => Math.max(5, Math.min(14, Math.sqrt(d.charCount/120))))
  .attr('fill', d => segColor(d.id))
  .attr('fill-opacity', 0.85)
  .attr('stroke', d => segColor(d.id))
  .attr('stroke-width', 1);

nodeSel.append('text')
  .attr('dx', d => Math.max(5, Math.min(14, Math.sqrt(d.charCount/120))) + 3)
  .attr('dy', '0.35em')
  .text(d => d.title.length > 24 ? d.title.slice(0,22) + '\\u2026' : d.title);

// Tooltip
const tooltip = document.getElementById('tooltip');
nodeSel
  .on('mouseover', (ev,d) => {
    tooltip.style.display = 'block';
    tooltip.innerHTML =
      '<div class="title">'+esc(d.title)+'</div>'+
      '<div class="path">'+esc(d.id)+'</div>'+
      '<div class="stats">'+d.charCount.toLocaleString()+' chars · '+d.sectionsCount+' sections</div>';
    if (!selectedNodeId) highlightNode(d);
  })
  .on('mousemove', ev => {
    tooltip.style.left = (ev.clientX+14)+'px';
    tooltip.style.top  = (ev.clientY+14)+'px';
  })
  .on('mouseout', () => {
    tooltip.style.display='none';
    if (!selectedNodeId) clearHighlight();
  })
  .on('click', (ev,d) => {
    ev.stopPropagation();
    if (selectedNodeId === d.id) {
      selectedNodeId = null;
      clearHighlight();
      closePanel();
    } else {
      selectedNodeId = d.id;
      highlightNode(d);
      openPanel(d);
    }
  });

function esc(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function highlightNode(d) {
  const ln = adjLink.get(d.id) ?? new Set();
  const sn = adjSemantic.get(d.id) ?? new Set();
  const all = new Set([...ln, ...sn]);
  nodeSel
    .classed('dimmed',     n => n.id !== d.id && !all.has(n.id))
    .classed('highlighted',n => n.id !== d.id && all.has(n.id))
    .classed('selected',   n => n.id === d.id);
  linkSel.classed('highlighted',
    e => e.source.id === d.id || e.target.id === d.id);
  semanticLinkSel.classed('highlighted',
    e => e.source.id === d.id || e.target.id === d.id);
}

function clearHighlight() {
  selectedNodeId = null;
  nodeSel.classed('dimmed',false).classed('highlighted',false).classed('selected',false);
  linkSel.classed('highlighted',false);
  semanticLinkSel.classed('highlighted',false);
}

// ── Side panel ────────────────────────────────────────────────────────────────

const panel      = document.getElementById('panel');
const panelTitle = document.getElementById('panel-title');
const panelPath  = document.getElementById('panel-path');
const panelStats = document.getElementById('panel-stats');
const panelBody  = document.getElementById('panel-body');

document.getElementById('panel-close').addEventListener('click', () => {
  clearHighlight(); closePanel();
});

function openPanel(d) {
  panelTitle.textContent = d.title;
  panelPath.textContent  = d.nodeType === 'heading'
    ? (d.headingPath && d.headingPath.length > 1 ? d.headingPath.join(' › ') : d.id)
    : d.id;
  panelStats.textContent = d.nodeType === 'heading'
    ? (d.pagePath ? 'section of: '+d.pagePath+' · '+d.charCount.toLocaleString()+' chars' : d.charCount.toLocaleString()+' chars')
    : d.charCount.toLocaleString()+' chars · '+d.sectionsCount+' sections';
  panelBody.innerHTML = '';

  // Sections
  if (d.sections && d.sections.length > 0) {
    const sec = ps('Sections ('+d.sections.length+')');
    const ul = document.createElement('ul');
    const shown = d.sections.slice(0,10);
    for (const s of shown) {
      const li = document.createElement('li');
      const label = s.headingPath.length > 0
        ? s.headingPath[s.headingPath.length-1]
        : (s.anchor ?? '(section)');
      li.innerHTML = esc(label)+(s.anchor ? ' <span class="kind">#'+esc(s.anchor)+'</span>' : '');
      ul.appendChild(li);
    }
    if (d.sections.length > 10) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = '… and '+(d.sections.length-10)+' more';
      ul.appendChild(li);
    }
    sec.appendChild(ul); panelBody.appendChild(sec);
  }

  // Outgoing links
  {
    const out = d.outgoing || [];
    const sec = ps('Links from this page'+(out.length ? ' ('+out.length+')' : ''));
    if (out.length > 0) {
      const ul = document.createElement('ul');
      for (const o of out.slice(0,15)) {
        const li = document.createElement('li');
        const a = document.createElement('a');
        a.textContent = (o.label && o.label !== o.target) ? o.label : o.target;
        a.title = o.target;
        a.addEventListener('click', ()=>focusNode(o.target));
        li.appendChild(a);
        const sp = document.createElement('span');
        sp.className = 'kind'; sp.textContent = o.kind;
        li.appendChild(sp);
        ul.appendChild(li);
      }
      if (out.length > 15) {
        const li = document.createElement('li');
        li.className = 'empty';
        li.textContent = '… and '+(out.length-15)+' more';
        ul.appendChild(li);
      }
      sec.appendChild(ul);
    } else {
      sec.appendChild(empty('None'));
    }
    panelBody.appendChild(sec);
  }

  // Incoming links
  {
    const inc = d.incoming || [];
    const sec = ps('Pages linking here'+(inc.length ? ' ('+inc.length+')' : ''));
    if (inc.length > 0) {
      const ul = document.createElement('ul');
      for (const i of inc.slice(0,15)) {
        const li = document.createElement('li');
        const a = document.createElement('a');
        a.textContent = i.source; a.title = i.source;
        a.addEventListener('click', ()=>focusNode(i.source));
        li.appendChild(a);
        ul.appendChild(li);
      }
      if (inc.length > 15) {
        const li = document.createElement('li');
        li.className = 'empty';
        li.textContent = '… and '+(inc.length-15)+' more';
        ul.appendChild(li);
      }
      sec.appendChild(ul);
    } else {
      sec.appendChild(empty('None (orphan page)'));
    }
    panelBody.appendChild(sec);
  }

  // Semantic similar
  if (HAS_SEMANTIC) {
    const sim2 = d.topSimilar || [];
    const sec = ps('Semantically similar'+(sim2.length ? ' ('+sim2.length+')' : ''));
    if (sim2.length > 0) {
      const ul = document.createElement('ul');
      for (const s of sim2) {
        const li = document.createElement('li');
        const a = document.createElement('a');
        a.textContent = s.title ?? s.path; a.title = s.path;
        a.addEventListener('click', ()=>focusNode(s.path));
        li.appendChild(a);
        const sp = document.createElement('span');
        sp.className = 'score'; sp.textContent = s.score.toFixed(3);
        li.appendChild(sp);
        ul.appendChild(li);
      }
      sec.appendChild(ul);
    } else {
      sec.appendChild(empty('No pages above threshold'));
    }
    panelBody.appendChild(sec);
  }

  panel.classList.add('open');
  graphWrap.classList.add('panel-open');
  if (sim) sim.force('center', d3.forceCenter(wrapW()/2, wrapH()/2)).alpha(0.1).restart();
}

function closePanel() {
  panel.classList.remove('open');
  graphWrap.classList.remove('panel-open');
  if (sim) sim.force('center', d3.forceCenter(wrapW()/2, wrapH()/2)).alpha(0.1).restart();
}

function focusNode(nodeId) {
  const node = DATA.nodes.find(n => n.id === nodeId);
  if (!node) return;
  selectedNodeId = nodeId;
  highlightNode(node);
  openPanel(node);
}

function ps(heading) {
  const div = document.createElement('div'); div.className = 'panel-section';
  const h3 = document.createElement('h3'); h3.textContent = heading;
  div.appendChild(h3); return div;
}
function empty(text) {
  const p = document.createElement('p'); p.className = 'empty'; p.textContent = text; return p;
}

// ── Checkbox toggles ──────────────────────────────────────────────────────────

document.getElementById('chk-links').addEventListener('change', ev => {
  linkSel.style('display', ev.target.checked ? null : 'none');
});
document.getElementById('chk-semantic').addEventListener('change', ev => {
  semanticLinkSel.style('display', ev.target.checked ? null : 'none');
});

// ── Force simulation ──────────────────────────────────────────────────────────

const allSimEdges = [...DATA.edges, ...DATA.semanticEdges];

const sim = d3.forceSimulation(DATA.nodes)
  .force('link', d3.forceLink(allSimEdges).id(d => d.id)
    .distance(80).strength(e => e.kind === 'semantic' ? 0.2 : 0.5))
  .force('charge', d3.forceManyBody().strength(-180))
  .force('center', d3.forceCenter(wrapW()/2, wrapH()/2))
  .force('collide', d3.forceCollide(18))
  .on('tick', () => {
    linkSel
      .attr('x1', d => d.source.x).attr('y1', d => d.source.y)
      .attr('x2', d => d.target.x).attr('y2', d => d.target.y);
    semanticLinkSel
      .attr('x1', d => d.source.x).attr('y1', d => d.source.y)
      .attr('x2', d => d.target.x).attr('y2', d => d.target.y);
    nodeSel.attr('transform', d => 'translate('+d.x+','+d.y+')');
  });
</script>
</body>
</html>`
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function startLspServer(): Promise<void> {
  await import("./lsp.js")
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)

  // Back-compat: if the first argument looks like an old LSP flag, start LSP.
  if (
    argv.length === 0 ||
    argv[0] === "--stdio" ||
    argv[0] === "--node-ipc" ||
    (argv[0] !== undefined && argv[0].startsWith("--socket"))
  ) {
    if (argv.length === 0) {
      // No args: print usage and exit cleanly (not the old LSP crash).
      process.stdout.write(USAGE + "\n")
      process.exit(0)
    }
    // Old LSP invocation style — keep working so editor configs don't break.
    await startLspServer()
    return
  }

  const subcommand = argv[0]!
  const rest = argv.slice(1)

  // Help shortcuts
  if (subcommand === "--help" || subcommand === "-h") {
    process.stdout.write(USAGE + "\n")
    process.exit(0)
  }

  // LSP subcommand — check for --help/-h before starting the server
  if (subcommand === "lsp" || subcommand === "serve") {
    if (rest.includes("--help") || rest.includes("-h")) {
      process.stdout.write(`lsp [--stdio]\nserve [--stdio]\n\n  Start the LSP stdio server for editor integration.\n\n  Options:\n    --stdio         Use stdio transport (default and recommended)\n\n  Note: back-compat — --stdio | --node-ipc | --socket=<n> as first arg\n  also starts the LSP server.\n\n  Examples:\n    markdown-lsp lsp --stdio\n    markdown-lsp serve --stdio\n`)
      process.exit(0)
    }
    await startLspServer()
    return
  }

  // Per-subcommand help strings
  const SUB_USAGE: Record<string, string> = {
    "workspace-outline": `
workspace-outline <docs-dir> [--prefix <p>] [--limit <n>]

  List all pages in the workspace with metadata.

  Arguments:
    <docs-dir>      Path to the documentation directory

  Options:
    --prefix <p>    Filter pages whose path starts with <p>
    --limit <n>     Return at most <n> results
    --pretty        Pretty-print JSON output

  Examples:
    markdown-lsp workspace-outline ./docs
    markdown-lsp workspace-outline ./docs --prefix api/ --limit 20
`.trim(),

    "outline": `
outline <docs-dir> <page>

  Show the heading outline of a single page.

  Arguments:
    <docs-dir>      Path to the documentation directory
    <page>          Relative path to the page (e.g. introduction.md)

  Options:
    --pretty        Pretty-print JSON output

  Examples:
    markdown-lsp outline ./docs introduction.md
`.trim(),

    "search-text": `
search-text <docs-dir> <query> [--mode ranked|verbatim] [--regex]
            [--case-sensitive] [--prefix <p>] [--limit <n>] [--context <n>]

  Full-text search across all pages.

  Arguments:
    <docs-dir>           Path to the documentation directory
    <query>              Search query (natural language or pattern)

  Options:
    --mode ranked        Natural-language ranked search (default)
    --mode verbatim      Exact substring search
    --regex              Treat query as a regular expression
    --case-sensitive     Case-sensitive matching
    --prefix <p>         Filter pages whose path starts with <p>
    --limit <n>          Return at most <n> results
    --context <n>        Characters of context around each match
    --pretty             Pretty-print JSON output

  Examples:
    markdown-lsp search-text ./docs "getting started"
    markdown-lsp search-text ./docs "webhook signing" --mode verbatim --limit 5
    markdown-lsp search-text ./docs "auth.*token" --regex
`.trim(),

    "search-symbols": `
search-symbols <docs-dir> <query> [--limit <n>]

  Fuzzy subsequence search across all headings.

  Arguments:
    <docs-dir>      Path to the documentation directory
    <query>         Heading search query

  Options:
    --limit <n>     Return at most <n> results
    --pretty        Pretty-print JSON output

  Examples:
    markdown-lsp search-symbols ./docs "webhook" --limit 10
`.trim(),

    "search-paths": `
search-paths <docs-dir> <glob>

  List pages whose paths match a glob pattern (*, **, ?).

  Arguments:
    <docs-dir>      Path to the documentation directory
    <glob>          Glob pattern to match against page paths

  Options:
    --pretty        Pretty-print JSON output

  Examples:
    markdown-lsp search-paths ./docs "ai/*.md"
    markdown-lsp search-paths ./docs "**/*auth*"
`.trim(),

    "links-to": `
links-to <docs-dir> <page>

  Show all pages that link to <page>.

  Arguments:
    <docs-dir>      Path to the documentation directory
    <page>          Relative path to the target page

  Options:
    --pretty        Pretty-print JSON output

  Examples:
    markdown-lsp links-to ./docs quick-start.md
`.trim(),

    "links-from": `
links-from <docs-dir> <page>

  Show all links that originate from <page>.

  Arguments:
    <docs-dir>      Path to the documentation directory
    <page>          Relative path to the source page

  Options:
    --pretty        Pretty-print JSON output

  Examples:
    markdown-lsp links-from ./docs README.md
`.trim(),

    "resolve-link": `
resolve-link <docs-dir> <from-page> <link-text>

  Resolve a specific link text from a given page.

  Arguments:
    <docs-dir>      Path to the documentation directory
    <from-page>     Relative path to the source page
    <link-text>     Exact link text to resolve

  Options:
    --pretty        Pretty-print JSON output

  Examples:
    markdown-lsp resolve-link ./docs README.md "Getting Started"
`.trim(),

    "get-section": `
get-section <docs-dir> <page> <anchor>

  Retrieve a section by its anchor slug.

  Arguments:
    <docs-dir>      Path to the documentation directory
    <page>          Relative path to the page
    <anchor>        Section anchor slug (e.g. "quick-links")

  Options:
    --pretty        Pretty-print JSON output

  Examples:
    markdown-lsp get-section ./docs overview.md "quick-links"
`.trim(),

    "graph": `
graph <docs-dir> [--format json|dot|mermaid|html] [--out <file>]
      [--semantic] [--granularity page|heading] [--sim-threshold <0-1>]
      [--sim-top-k <n>] [--model <embedding-model>]

  Export the documentation link graph.

  Arguments:
    <docs-dir>              Path to the documentation directory

  Options:
    --format json           JSON output with nodes/edges (default)
    --format dot            Graphviz DOT format
    --format mermaid        Mermaid diagram format
    --format html           Self-contained interactive D3 visualisation
    --out <file>            Write output to file instead of stdout
    --semantic              Overlay AI-powered similarity edges
    --granularity page      Graph nodes = pages (default)
    --granularity heading   Graph nodes = sections (heading-level)
    --sim-threshold <0-1>   Minimum cosine similarity (default: 0.75)
    --sim-top-k <n>         Max semantic neighbours per node (default: 5)
    --model <model>         Embedding model override
    --pretty                Pretty-print JSON output

  Note: --semantic requires OPENROUTER_API_KEY or AI_GATEWAY_API_KEY.
  Note: --granularity line is NOT supported for graph (too many nodes);
        use page or heading.

  Examples:
    markdown-lsp graph ./docs --format json --pretty
    markdown-lsp graph ./docs --format html --out graph.html
    markdown-lsp graph ./docs --format dot | dot -Tsvg > graph.svg
    markdown-lsp graph ./docs --format html --semantic --out graph.html
    markdown-lsp graph ./docs --format html --semantic --granularity heading --out graph-headings.html
`.trim(),

    "semantic-search": `
semantic-search <docs-dir> <query> [--limit <n>] [--model <embedding-model>]
                [--granularity page|heading|line]

  AI-powered semantic search using embeddings.

  Arguments:
    <docs-dir>      Path to the documentation directory
    <query>         Natural-language search query

  Options:
    --limit <n>           Return at most <n> results (default: 10)
    --model <m>           Embedding model override
    --granularity page    Search whole pages (default)
    --granularity heading Search within sections (returns anchor + headingPath)
    --granularity line    Search paragraph blocks (returns line number)
    --pretty              Pretty-print JSON output

  Note: requires OPENROUTER_API_KEY or AI_GATEWAY_API_KEY.
  Default embedding model: openai/text-embedding-3-small.
  Results are cached in .markdown-lsp-cache/.
  Run "index" first to pre-warm the cache (saves tokens on repeated searches).

  Examples:
    markdown-lsp semantic-search ./docs "how to set up webhooks" --limit 5
    markdown-lsp semantic-search ./docs "authentication" --model openai/text-embedding-3-small
    markdown-lsp semantic-search ./docs "webhook auth" --granularity heading --limit 10
    markdown-lsp semantic-search ./docs "rate limit error" --granularity line --limit 5
`.trim(),

    "index": `
index <docs-dir> [--granularity page|heading|line] [--model <embedding-model>]

  Build the persistent semantic index — embeds all doc units at the chosen
  granularity and caches them to .markdown-lsp-cache/. Subsequent
  semantic-search and graph --semantic calls reuse the cache and only
  embed the query (1 API call instead of N).

  Idempotent: re-running without doc changes costs 0 API calls (all hits).
  Changed files are re-embedded automatically (cache key = sha256(model+text)).

  Arguments:
    <docs-dir>      Path to the documentation directory

  Options:
    --granularity page     Index whole pages (default)
    --granularity heading  Index sections (recommended for precision)
    --granularity line     Index paragraph blocks
    --model <m>            Embedding model override
    --pretty               Pretty-print progress JSON

  Note: requires OPENROUTER_API_KEY or AI_GATEWAY_API_KEY.

  Examples:
    markdown-lsp index ./docs --granularity heading
    markdown-lsp index ./docs --granularity line --model openai/text-embedding-3-small
`.trim(),

    "lsp": `
lsp [--stdio]
serve [--stdio]

  Start the LSP stdio server for editor integration.

  Options:
    --stdio         Use stdio transport (default and recommended)

  Note: back-compat — --stdio | --node-ipc | --socket=<n> as first arg
  also starts the LSP server.

  Examples:
    markdown-lsp lsp --stdio
    markdown-lsp serve --stdio
`.trim(),
  }
  // Aliases
  SUB_USAGE["serve"] = SUB_USAGE["lsp"]!

  // Parse global flags from the remaining args
  let pretty = false
  const filteredRest: string[] = []
  for (const arg of rest) {
    if (arg === "--pretty") pretty = true
    else filteredRest.push(arg)
  }

  // Per-subcommand --help / -h: intercept before parseArgs sees it
  if (filteredRest.includes("--help") || filteredRest.includes("-h")) {
    const subUsage = SUB_USAGE[subcommand]
    if (subUsage) {
      process.stdout.write(subUsage + "\n")
    } else {
      process.stdout.write(USAGE + "\n")
    }
    process.exit(0)
  }

  switch (subcommand) {
    case "workspace-outline": {
      const { values, positionals } = parseArgs({
        args: filteredRest,
        options: {
          prefix: { type: "string" },
          limit: { type: "string" },
        },
        allowPositionals: true,
      })
      const docsDir = positionals[0] ?? die("workspace-outline requires <docs-dir>")
      const graph = buildGraph(docsDir)
      const result = listPages(graph, {
        prefix: values.prefix,
        limit: values.limit !== undefined ? parseInt(values.limit, 10) : undefined,
      })
      out(result, pretty)
      break
    }

    case "outline": {
      const { positionals } = parseArgs({
        args: filteredRest,
        options: {},
        allowPositionals: true,
      })
      const docsDir = positionals[0] ?? die("outline requires <docs-dir>")
      const page = positionals[1] ?? die("outline requires <page>")
      const graph = buildGraph(docsDir)
      const result = graph.outlineOf(page)
      out(result, pretty)
      break
    }

    case "search-text": {
      const { values, positionals } = parseArgs({
        args: filteredRest,
        options: {
          mode: { type: "string" },
          regex: { type: "boolean" },
          "case-sensitive": { type: "boolean" },
          prefix: { type: "string" },
          limit: { type: "string" },
          context: { type: "string" },
        },
        allowPositionals: true,
      })
      const docsDir = positionals[0] ?? die("search-text requires <docs-dir>")
      const query = positionals[1] ?? die("search-text requires <query>")
      const graph = buildGraph(docsDir)
      const opts = {
        regex: values.regex,
        caseSensitive: values["case-sensitive"],
        pathPrefix: values.prefix,
        limit: values.limit !== undefined ? parseInt(values.limit, 10) : undefined,
        contextChars: values.context !== undefined ? parseInt(values.context, 10) : undefined,
      }
      const mode = values.mode ?? "ranked"
      const result = mode === "verbatim" || values.regex
        ? searchText(graph, query, opts)
        : searchTextRanked(graph, query, opts)
      out(result, pretty)
      break
    }

    case "search-symbols": {
      const { values, positionals } = parseArgs({
        args: filteredRest,
        options: {
          limit: { type: "string" },
        },
        allowPositionals: true,
      })
      const docsDir = positionals[0] ?? die("search-symbols requires <docs-dir>")
      const query = positionals[1] ?? die("search-symbols requires <query>")
      const graph = buildGraph(docsDir)
      const limit = values.limit !== undefined ? parseInt(values.limit, 10) : undefined
      const result = searchSymbols(graph, query, limit)
      out(result, pretty)
      break
    }

    case "search-paths": {
      const { positionals } = parseArgs({
        args: filteredRest,
        options: {},
        allowPositionals: true,
      })
      const docsDir = positionals[0] ?? die("search-paths requires <docs-dir>")
      const glob = positionals[1] ?? die("search-paths requires <glob>")
      const graph = buildGraph(docsDir)
      const result = searchPaths(graph, glob)
      out(result, pretty)
      break
    }

    case "links-to": {
      const { positionals } = parseArgs({
        args: filteredRest,
        options: {},
        allowPositionals: true,
      })
      const docsDir = positionals[0] ?? die("links-to requires <docs-dir>")
      const page = positionals[1] ?? die("links-to requires <page>")
      const graph = buildGraph(docsDir)
      const result = graph.incomingLinks(page)
      out(result, pretty)
      break
    }

    case "links-from": {
      const { positionals } = parseArgs({
        args: filteredRest,
        options: {},
        allowPositionals: true,
      })
      const docsDir = positionals[0] ?? die("links-from requires <docs-dir>")
      const page = positionals[1] ?? die("links-from requires <page>")
      const graph = buildGraph(docsDir)
      const result = graph.outgoingLinks(page)
      out(result, pretty)
      break
    }

    case "resolve-link": {
      const { positionals } = parseArgs({
        args: filteredRest,
        options: {},
        allowPositionals: true,
      })
      const docsDir = positionals[0] ?? die("resolve-link requires <docs-dir>")
      const fromPage = positionals[1] ?? die("resolve-link requires <from-page>")
      const linkText = positionals[2] ?? die("resolve-link requires <link-text>")
      const graph = buildGraph(docsDir)
      const links = graph.outgoingLinks(fromPage)
      const match = links.find((l) => l.textAtLink === linkText) ?? null
      out(match, pretty)
      break
    }

    case "get-section": {
      const { positionals } = parseArgs({
        args: filteredRest,
        options: {},
        allowPositionals: true,
      })
      const docsDir = positionals[0] ?? die("get-section requires <docs-dir>")
      const page = positionals[1] ?? die("get-section requires <page>")
      const anchor = positionals[2] ?? die("get-section requires <anchor>")
      const graph = buildGraph(docsDir)
      const pageObj = graph.pageByPath(page)
      const section = pageObj?.sections.find((s) => s.anchor === anchor) ?? null
      out(section, pretty)
      break
    }

    case "graph": {
      const { values, positionals } = parseArgs({
        args: filteredRest,
        options: {
          format: { type: "string" },
          out: { type: "string" },
          semantic: { type: "boolean" },
          granularity: { type: "string" },
          "sim-threshold": { type: "string" },
          "sim-top-k": { type: "string" },
          model: { type: "string" },
        },
        allowPositionals: true,
      })
      const docsDir = positionals[0] ?? die("graph requires <docs-dir>")
      const format = (values.format ?? "json") as "json" | "dot" | "mermaid" | "html"
      const semantic = values.semantic ?? false
      const rawGranularity = values.granularity ?? "page"
      if (rawGranularity === "line") {
        process.stderr.write(
          "Error: --granularity line is not supported for graph (too many nodes — use page or heading).\n"
        )
        process.exit(1)
      }
      const granularity = rawGranularity as "page" | "heading"
      const simThreshold = values["sim-threshold"] !== undefined
        ? parseFloat(values["sim-threshold"])
        : 0.75
      const simTopK = values["sim-top-k"] !== undefined
        ? parseInt(values["sim-top-k"], 10)
        : 5
      const modelOverride = values.model

      const graph = buildGraph(docsDir)
      const raw = graph.toJSON()
      const data = buildGraphExport(raw)

      if (semantic) {
        try {
          await addSemanticEdges(data, raw.pages, modelOverride, simThreshold, simTopK, granularity)
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          if (
            msg.includes("OPENROUTER_API_KEY") ||
            msg.includes("AI_GATEWAY_API_KEY") ||
            msg.includes("assertApiKey") ||
            msg.includes("API key") ||
            msg.includes("api key")
          ) {
            process.stderr.write(
              "Error: --semantic requires an API key.\n" +
              "  Set OPENROUTER_API_KEY=<key>  (OpenRouter — recommended)\n" +
              "  or AI_GATEWAY_API_KEY=<key>   (Vercel AI Gateway)\n\n" +
              "  Default model: openai/text-embedding-3-small\n" +
              "  To override: --model openai/text-embedding-3-small\n" +
              "  If the model name is rejected try: --model text-embedding-3-small (no prefix)\n"
            )
            process.exit(1)
          }
          if (
            msg.toLowerCase().includes("model") ||
            msg.includes("404") ||
            msg.includes("not found")
          ) {
            process.stderr.write(
              "Error computing semantic embeddings: " + msg + "\n" +
              "  Tip: try --model text-embedding-3-small (no openai/ prefix)\n" +
              "  or   --model openai/text-embedding-3-small (with prefix for OpenRouter)\n"
            )
            process.exit(1)
          }
          throw err
        }
      }

      let result: string
      switch (format) {
        case "json":
          result = renderGraphJson(data, pretty)
          break
        case "dot":
          result = renderGraphDot(data)
          break
        case "mermaid":
          result = renderGraphMermaid(data)
          break
        case "html":
          result = renderGraphHtml(data, docsDir, semantic && data.semanticEdges.length > 0, granularity)
          break
        default:
          die(`Unknown format: ${format}. Use json, dot, mermaid, or html.`)
      }

      if (values.out) {
        fs.writeFileSync(values.out, result, "utf8")
        process.stderr.write(`Graph written to ${values.out}\n`)
      } else {
        process.stdout.write(result + "\n")
      }
      break
    }

    case "semantic-search": {
      const { values, positionals } = parseArgs({
        args: filteredRest,
        options: {
          limit: { type: "string" },
          model: { type: "string" },
          granularity: { type: "string" },
        },
        allowPositionals: true,
      })
      const docsDir = positionals[0] ?? die("semantic-search requires <docs-dir>")
      const query = positionals[1] ?? die("semantic-search requires <query>")
      const limit = values.limit !== undefined ? parseInt(values.limit, 10) : 10
      const modelOverride = values.model
      const granularity = (values.granularity ?? "page") as import("./ai/granular.js").GranularityLevel

      // Check API key before doing any work
      const { assertApiKey } = await import("./ai/config.js")
      assertApiKey()

      const { embedTexts, embedOne } = await import("./ai/embeddings.js")
      const { unitize } = await import("./ai/granular.js")

      const graph = buildGraph(docsDir)
      const units = unitize(graph.pages, granularity)

      process.stderr.write(
        `[markdown-lsp] semantic-search: ${units.length} units at granularity="${granularity}"\n`
      )

      const unitTexts = units.map((u) => u.text)

      // Embed all units (cached) and the query in parallel
      const [unitEmbeddings, queryVec] = await Promise.all([
        embedTexts(unitTexts, modelOverride, true),
        embedOne(query, modelOverride),
      ])

      if (unitEmbeddings.tokensUsed > 0) {
        process.stderr.write(`[markdown-lsp] Embeddings computed (${unitEmbeddings.tokensUsed} tokens).\n`)
      } else {
        process.stderr.write(`[markdown-lsp] All embeddings from cache (0 API tokens for docs).\n`)
      }

      // Score each unit
      const scored = units.map((u, i) => {
        const vec = unitEmbeddings.vectors[i]
        if (!vec) return { unit: u, score: 0 }
        return { unit: u, score: cosineSim(queryVec, vec) }
      })

      scored.sort((a, b) => b.score - a.score)
      const topN = scored.slice(0, limit)

      const results = topN.map(({ unit, score }) => {
        const snippet = unit.text.slice(0, 200).replace(/\s+/g, " ").trim()
        const snippetOut = snippet.length < unit.text.length ? snippet + "…" : snippet

        const base = {
          level: unit.level,
          pagePath: unit.pagePath,
          pageTitle: unit.pageTitle ?? unit.pagePath,
          score: Math.round(score * 10000) / 10000,
          snippet: snippetOut,
        }

        if (unit.level === "heading") {
          return { ...base, anchor: unit.anchor ?? null, headingPath: unit.headingPath ?? [] }
        }
        if (unit.level === "line") {
          return { ...base, line: unit.line ?? 0 }
        }
        return base
      })

      out(results, pretty)
      break
    }

    case "index": {
      const { values, positionals } = parseArgs({
        args: filteredRest,
        options: {
          granularity: { type: "string" },
          model: { type: "string" },
        },
        allowPositionals: true,
      })
      const docsDir = positionals[0] ?? die("index requires <docs-dir>")
      const granularity = (values.granularity ?? "page") as import("./ai/granular.js").GranularityLevel
      const modelOverride = values.model

      // Check API key
      const { assertApiKey } = await import("./ai/config.js")
      assertApiKey()

      const { embedTexts } = await import("./ai/embeddings.js")
      const { unitize } = await import("./ai/granular.js")

      const graph = buildGraph(docsDir)
      const units = unitize(graph.pages, granularity)

      process.stderr.write(
        `[markdown-lsp] index: ${units.length} units at granularity="${granularity}"` +
        ` (model: ${modelOverride ?? "openai/text-embedding-3-small"})\n`
      )

      const unitTexts = units.map((u) => u.text)
      const startTime = Date.now()
      const { vectors, tokensUsed } = await embedTexts(unitTexts, modelOverride, true)
      const elapsed = Date.now() - startTime

      const indexed = vectors.filter((v) => v !== null).length

      if (tokensUsed > 0) {
        process.stderr.write(
          `[markdown-lsp] index: ${indexed}/${units.length} units embedded,` +
          ` ${tokensUsed} new tokens used, ${elapsed}ms\n`
        )
      } else {
        process.stderr.write(
          `[markdown-lsp] index: all ${indexed} units from cache — 0 API tokens (already indexed)\n`
        )
      }

      out({
        docsDir,
        granularity,
        totalUnits: units.length,
        newlyEmbedded: Math.round(tokensUsed > 0 ? indexed : 0),
        fromCache: tokensUsed === 0 ? indexed : units.length - indexed,
        tokensUsed,
        elapsedMs: elapsed,
        model: modelOverride ?? "openai/text-embedding-3-small",
      }, pretty)
      break
    }

    default:
      process.stderr.write(`Unknown subcommand: ${subcommand}\n\n${USAGE}\n`)
      process.exit(1)
  }
}

main().catch((err) => {
  process.stderr.write(
    "[markdown-lsp] Fatal error: " +
    (err instanceof Error ? err.stack ?? err.message : String(err)) + "\n"
  )
  process.exit(1)
})
