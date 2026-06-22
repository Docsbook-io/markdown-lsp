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
markdown-lsp v1.1.0 — CLI for querying Markdown documentation graphs

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

  graph <docs-dir> [--format json|dot|mermaid|html] [--out <file>]
      Export the doc link graph. Default format: json (nodes/edges).
      Use --format html for a self-contained interactive D3 visualisation.
      Use --out <file> to write to disk instead of stdout.

  semantic-search <docs-dir> <query> [--limit <n>] [--model <embedding-model>]
      AI-powered semantic search using embeddings. Requires OPENROUTER_API_KEY
      (or AI_GATEWAY_API_KEY). Results are cached in .markdown-lsp-cache/.
      Default embedding model: openai/text-embedding-3-small

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
  markdown-lsp workspace-outline ./docs
  markdown-lsp search-text ./docs "getting started" --pretty
  markdown-lsp outline ./docs introduction.md
  markdown-lsp graph ./docs --format json --pretty
  markdown-lsp graph ./docs --format html --out graph.html
  markdown-lsp semantic-search ./docs "how to set up webhooks" --limit 5
  markdown-lsp lsp --stdio
`.trim()

function die(msg: string): never {
  process.stderr.write(msg + "\n")
  process.exit(1)
}

function out(value: unknown, pretty: boolean): void {
  process.stdout.write((pretty ? JSON.stringify(value, null, 2) : JSON.stringify(value)) + "\n")
}

async function startLsp(): Promise<void> {
  await import("./lsp.js")
}

// ── Graph export helpers ──────────────────────────────────────────────────────

interface GraphNode {
  id: string
  title: string
  charCount: number
  sectionsCount: number
}

interface GraphEdge {
  source: string
  target: string
  kind: string
  label?: string
}

interface GraphExport {
  nodes: GraphNode[]
  edges: GraphEdge[]
  unresolvedCount: number
}

function buildGraphExport(raw: ReturnType<ReturnType<typeof buildGraph>["toJSON"]>): GraphExport {
  const nodes: GraphNode[] = raw.pages.map((p) => ({
    id: p.path,
    title: p.title ?? p.path,
    charCount: p.content.length,
    sectionsCount: p.sections.length,
  }))
  const edges: GraphEdge[] = raw.links
    .filter((l) => l.toResolvedPath !== null)
    .map((l) => ({
      source: l.fromPath,
      target: l.toResolvedPath!,
      kind: l.kind,
      ...(l.textAtLink ? { label: l.textAtLink } : {}),
    }))
  return { nodes, edges, unresolvedCount: raw.unresolved.length }
}

function renderGraphJson(data: GraphExport, pretty: boolean): string {
  return pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data)
}

function renderGraphDot(data: GraphExport): string {
  const lines: string[] = ['digraph G {', '  rankdir=LR;']
  // Declare nodes with labels
  for (const n of data.nodes) {
    const label = n.title.replace(/"/g, '\\"')
    const id = n.id.replace(/"/g, '\\"')
    lines.push(`  "${id}" [label="${label}"];`)
  }
  // Edges
  for (const e of data.edges) {
    const src = e.source.replace(/"/g, '\\"')
    const tgt = e.target.replace(/"/g, '\\"')
    lines.push(`  "${src}" -> "${tgt}";`)
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
  return lines.join('\n')
}

function renderGraphHtml(data: GraphExport, docsDir: string): string {
  const title = docsDir.split('/').filter(Boolean).pop() ?? docsDir
  const jsonData = JSON.stringify(data)
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Doc Graph — ${title}</title>
<script src="https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js"></script>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: system-ui, sans-serif; background: #0f1117; color: #e2e8f0; overflow: hidden; }
  #toolbar { position: fixed; top: 0; left: 0; right: 0; height: 44px; background: #1a1d27;
             border-bottom: 1px solid #2d3148; display: flex; align-items: center; padding: 0 16px;
             z-index: 10; gap: 12px; font-size: 13px; }
  #toolbar h1 { font-size: 14px; font-weight: 600; color: #a5b4fc; }
  #toolbar span { color: #64748b; }
  #graph { position: fixed; top: 44px; left: 0; right: 0; bottom: 0; }
  #tooltip { position: fixed; pointer-events: none; background: #1e2130; border: 1px solid #3b4168;
             border-radius: 6px; padding: 8px 12px; font-size: 12px; line-height: 1.5;
             max-width: 280px; z-index: 20; display: none; }
  #tooltip .title { font-weight: 600; color: #c7d2fe; margin-bottom: 2px; }
  #tooltip .path { color: #64748b; font-size: 11px; }
  #tooltip .stats { color: #94a3b8; font-size: 11px; margin-top: 4px; }
  .node circle { cursor: pointer; transition: r 0.15s; }
  .node text { pointer-events: none; font-size: 10px; fill: #cbd5e1; }
  .link { stroke: #3b4168; stroke-opacity: 0.6; fill: none; }
  .link.highlighted { stroke: #a5b4fc; stroke-opacity: 1; }
  .node.dimmed circle { opacity: 0.25; }
  .node.dimmed text { opacity: 0.15; }
  .node.highlighted circle { stroke: #a5b4fc !important; stroke-width: 2px !important; }
</style>
</head>
<body>
<div id="toolbar">
  <h1>Doc Graph — ${title}</h1>
  <span id="stats"></span>
</div>
<div id="tooltip"></div>
<svg id="graph"></svg>
<script>
const DATA = ${jsonData};

const width = window.innerWidth;
const height = window.innerHeight - 44;
const svg = d3.select('#graph')
  .attr('width', width)
  .attr('height', height);

// Build adjacency for highlight
const adjacency = new Map();
for (const n of DATA.nodes) adjacency.set(n.id, new Set());
for (const e of DATA.edges) {
  if (adjacency.has(e.source)) adjacency.get(e.source).add(e.target);
  if (adjacency.has(e.target)) adjacency.get(e.target).add(e.source);
}

document.getElementById('stats').textContent =
  DATA.nodes.length + ' pages · ' + DATA.edges.length + ' links · ' +
  DATA.unresolvedCount + ' unresolved';

const g = svg.append('g');

// Zoom
svg.call(d3.zoom()
  .scaleExtent([0.05, 4])
  .on('zoom', (event) => g.attr('transform', event.transform)));

// Links
const linkSel = g.append('g').selectAll('line')
  .data(DATA.edges)
  .join('line')
  .attr('class', 'link')
  .attr('marker-end', 'url(#arrow)');

// Arrow marker
svg.append('defs').append('marker')
  .attr('id', 'arrow')
  .attr('viewBox', '0 -4 8 8')
  .attr('refX', 14)
  .attr('refY', 0)
  .attr('markerWidth', 6)
  .attr('markerHeight', 6)
  .attr('orient', 'auto')
  .append('path')
  .attr('d', 'M0,-4L8,0L0,4')
  .attr('fill', '#3b4168');

// Color scale by first path segment
const color = d3.scaleOrdinal(d3.schemeTableau10);
const segColor = (id) => color(id.split('/')[0] ?? '');

// Nodes
const nodeSel = g.append('g').selectAll('g')
  .data(DATA.nodes)
  .join('g')
  .attr('class', 'node')
  .call(d3.drag()
    .on('start', (event, d) => { if (!event.active) sim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
    .on('drag', (event, d) => { d.fx = event.x; d.fy = event.y; })
    .on('end', (event, d) => { if (!event.active) sim.alphaTarget(0); d.fx = null; d.fy = null; }));

nodeSel.append('circle')
  .attr('r', d => Math.max(5, Math.min(14, Math.sqrt(d.charCount / 120))))
  .attr('fill', d => segColor(d.id))
  .attr('fill-opacity', 0.85)
  .attr('stroke', d => segColor(d.id))
  .attr('stroke-width', 1);

nodeSel.append('text')
  .attr('dx', d => Math.max(5, Math.min(14, Math.sqrt(d.charCount / 120))) + 3)
  .attr('dy', '0.35em')
  .text(d => d.title.length > 24 ? d.title.slice(0, 22) + '…' : d.title);

// Tooltip
const tooltip = document.getElementById('tooltip');
nodeSel
  .on('mouseover', (event, d) => {
    tooltip.style.display = 'block';
    tooltip.innerHTML = '<div class="title">' + d.title + '</div>' +
      '<div class="path">' + d.id + '</div>' +
      '<div class="stats">' + d.charCount.toLocaleString() + ' chars · ' + d.sectionsCount + ' sections</div>';
    highlightNode(d);
  })
  .on('mousemove', (event) => {
    tooltip.style.left = (event.clientX + 14) + 'px';
    tooltip.style.top = (event.clientY + 14) + 'px';
  })
  .on('mouseout', () => {
    tooltip.style.display = 'none';
    clearHighlight();
  });

function highlightNode(d) {
  const neighbors = adjacency.get(d.id) ?? new Set();
  nodeSel.classed('dimmed', n => n.id !== d.id && !neighbors.has(n.id));
  nodeSel.classed('highlighted', n => n.id === d.id);
  linkSel.classed('highlighted', e => e.source.id === d.id || e.target.id === d.id);
}

function clearHighlight() {
  nodeSel.classed('dimmed', false).classed('highlighted', false);
  linkSel.classed('highlighted', false);
}

// Force simulation
const sim = d3.forceSimulation(DATA.nodes)
  .force('link', d3.forceLink(DATA.edges).id(d => d.id).distance(80).strength(0.5))
  .force('charge', d3.forceManyBody().strength(-180))
  .force('center', d3.forceCenter(width / 2, height / 2))
  .force('collide', d3.forceCollide(18))
  .on('tick', () => {
    linkSel
      .attr('x1', d => d.source.x)
      .attr('y1', d => d.source.y)
      .attr('x2', d => d.target.x)
      .attr('y2', d => d.target.y);
    nodeSel.attr('transform', d => 'translate(' + d.x + ',' + d.y + ')');
  });
</script>
</body>
</html>`
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

  // LSP subcommand
  if (subcommand === "lsp" || subcommand === "serve") {
    await startLspServer()
    return
  }

  // Parse global flags from the remaining args
  let pretty = false
  const filteredRest: string[] = []
  for (const arg of rest) {
    if (arg === "--pretty") pretty = true
    else filteredRest.push(arg)
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
        },
        allowPositionals: true,
      })
      const docsDir = positionals[0] ?? die("graph requires <docs-dir>")
      const format = (values.format ?? "json") as "json" | "dot" | "mermaid" | "html"
      const graph = buildGraph(docsDir)
      const raw = graph.toJSON()
      const data = buildGraphExport(raw)

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
          result = renderGraphHtml(data, docsDir)
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
        },
        allowPositionals: true,
      })
      const docsDir = positionals[0] ?? die("semantic-search requires <docs-dir>")
      const query = positionals[1] ?? die("semantic-search requires <query>")
      const limit = values.limit !== undefined ? parseInt(values.limit, 10) : 10
      const modelOverride = values.model

      // Check API key before doing any work
      const { assertApiKey } = await import("./ai/config.js")
      assertApiKey()

      const { embedTexts, embedOne } = await import("./ai/embeddings.js")

      const graph = buildGraph(docsDir)
      const pages = graph.pages

      // Build embedding texts (title + first 2000 chars of content per page)
      const pageTexts = pages.map((p) => {
        const titlePart = p.title ? p.title + "\n\n" : ""
        return titlePart + p.content.slice(0, 2000)
      })

      // Embed all pages (cached) and the query
      const [pageEmbeddings, queryVec] = await Promise.all([
        embedTexts(pageTexts, modelOverride, true),
        embedOne(query, modelOverride),
      ])

      // Score each page
      const scored = pages.map((p, i) => {
        const vec = pageEmbeddings.vectors[i]
        if (!vec) return { page: p, score: 0 }
        return { page: p, score: cosineSim(queryVec, vec) }
      })

      scored.sort((a, b) => b.score - a.score)
      const topN = scored.slice(0, limit)

      const results = topN.map(({ page, score }) => {
        // Extract a short snippet (first 200 chars of content)
        const snippet = page.content.slice(0, 200).replace(/\s+/g, " ").trim()
        return {
          pagePath: page.path,
          pageTitle: page.title ?? page.path,
          score: Math.round(score * 10000) / 10000,
          snippet: snippet.length < page.content.length ? snippet + "…" : snippet,
        }
      })

      out(results, pretty)
      break
    }

    default:
      process.stderr.write(`Unknown subcommand: ${subcommand}\n\n${USAGE}\n`)
      process.exit(1)
  }
}

main().catch((err) => {
  process.stderr.write("[markdown-lsp] Fatal error: " + (err instanceof Error ? err.stack ?? err.message : String(err)) + "\n")
  process.exit(1)
})
