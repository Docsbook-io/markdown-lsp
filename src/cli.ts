import { parseArgs } from "node:util"
import { buildGraph } from "./graph.js"
import {
  listPages,
  searchText,
  searchTextRanked,
  searchSymbols,
  searchPaths,
} from "./bridge/index.js"

const USAGE = `
markdown-lsp v1.0.0 — CLI for querying Markdown documentation graphs

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
    await startLsp()
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
    await startLsp()
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

    default:
      process.stderr.write(`Unknown subcommand: ${subcommand}\n\n${USAGE}\n`)
      process.exit(1)
  }
}

main().catch((err) => {
  process.stderr.write("[markdown-lsp] Fatal error: " + (err instanceof Error ? err.stack ?? err.message : String(err)) + "\n")
  process.exit(1)
})
