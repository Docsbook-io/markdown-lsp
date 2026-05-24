import { spawn } from "node:child_process"
import { resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { readFile } from "node:fs/promises"

const repoRoot = resolve(fileURLToPath(import.meta.url), "../..")
const vaultRoot = resolve(repoRoot, "test/fixtures/sample-vault")
const vaultUri = pathToFileURL(vaultRoot).toString()
const authPath = resolve(vaultRoot, "auth.md")
const authUri = pathToFileURL(authPath).toString()

const serverPath = resolve(repoRoot, "dist/server.js")

const child = spawn(process.execPath, [serverPath, "--stdio"], {
  cwd: repoRoot,
  env: { ...process.env },
  stdio: ["pipe", "pipe", "pipe"],
})

let stderr = ""
child.stderr.on("data", (d) => (stderr += d.toString()))

let inbox = Buffer.alloc(0)
const responses = new Map<number, any>()
const notifications: any[] = []

child.stdout.on("data", (data: Buffer) => {
  inbox = Buffer.concat([inbox, data])
  while (true) {
    const headerEnd = inbox.indexOf("\r\n\r\n")
    if (headerEnd === -1) break
    const headers = inbox.subarray(0, headerEnd).toString("ascii")
    const m = headers.match(/Content-Length:\s*(\d+)/i)
    if (!m) break
    const len = parseInt(m[1]!, 10)
    const bodyStart = headerEnd + 4
    if (inbox.length < bodyStart + len) break
    const body = inbox.subarray(bodyStart, bodyStart + len).toString("utf-8")
    inbox = inbox.subarray(bodyStart + len)
    try {
      const msg = JSON.parse(body)
      if (msg.id !== undefined) responses.set(msg.id, msg)
      else notifications.push(msg)
    } catch (e) {
      console.error("Bad message:", body)
    }
  }
})

function send(method: string, params: any, id?: number) {
  const msg: any = { jsonrpc: "2.0", method, params }
  if (id !== undefined) msg.id = id
  const body = JSON.stringify(msg)
  child.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`)
}

async function waitFor(id: number, timeoutMs = 30000): Promise<any> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (responses.has(id)) return responses.get(id)
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new Error(`Timeout waiting for response ${id}`)
}

try {
  send("initialize", {
    processId: process.pid,
    rootUri: vaultUri,
    workspaceFolders: [{ uri: vaultUri, name: "sample-vault" }],
    capabilities: {},
  }, 1)
  const initResp = await waitFor(1)
  console.log("initialize.capabilities:", JSON.stringify(initResp.result.capabilities))

  send("initialized", {})
  const indexStart = Date.now()
  while (Date.now() - indexStart < 30000) {
    if (notifications.some((n) => n.method === "window/logMessage" && /Index complete/.test(n.params.message))) break
    await new Promise((r) => setTimeout(r, 200))
  }

  const content = await readFile(authPath, "utf-8")
  send("textDocument/didOpen", {
    textDocument: { uri: authUri, languageId: "markdown", version: 1, text: content },
  })
  await new Promise((r) => setTimeout(r, 800))

  send("textDocument/documentSymbol", { textDocument: { uri: authUri } }, 2)
  const symResp = await waitFor(2)
  console.log("documentSymbol for auth.md:")
  for (const s of symResp.result) {
    console.log(`  ${"#".repeat(s.kind)} ${s.name} (${s.children?.length ?? 0} children)`)
    for (const c of s.children ?? []) console.log(`    - ${c.name}`)
  }

  send("workspace/symbol", { query: "oauth" }, 3)
  const wsymResp = await waitFor(3)
  console.log("workspace/symbol 'oauth':")
  for (const s of wsymResp.result) console.log(`  - ${s.name}  @ ${s.location.uri.split("/").pop()}`)

  send("textDocument/references", { textDocument: { uri: authUri }, position: { line: 0, character: 0 }, context: { includeDeclaration: true } }, 4)
  const refsResp = await waitFor(4)
  console.log(`references to auth.md: ${refsResp.result.length} hits`)
  for (const r of refsResp.result) console.log(`  - ${r.uri.split("/").pop()}`)

  await new Promise((r) => setTimeout(r, 1500))
  const diagNotifs = notifications.filter((n) => n.method === "textDocument/publishDiagnostics")
  console.log(`\nDiagnostics published: ${diagNotifs.length}`)
  for (const n of diagNotifs) {
    console.log(`  ${n.params.uri.split("/").pop()}: ${n.params.diagnostics.length} issue(s)`)
    for (const d of n.params.diagnostics) console.log(`    - ${d.message}`)
  }
  const logs = notifications.filter((n) => n.method === "window/logMessage")
  console.log(`\nServer log messages: ${logs.length}`)
  for (const l of logs) console.log(`  [${l.params.type}] ${l.params.message}`)

  console.log("\nLSP smoke-test passed.")
  if (stderr.trim()) console.log("Server stderr:\n", stderr)
} catch (e) {
  console.error("Failed:", e)
  if (stderr) console.error("Server stderr:\n", stderr)
  process.exitCode = 1
} finally {
  send("shutdown", null, 99)
  await new Promise((r) => setTimeout(r, 300))
  send("exit", null)
  await new Promise((r) => setTimeout(r, 200))
  child.kill()
}
