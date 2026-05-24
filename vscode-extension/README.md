# Markdown LSP — VS Code extension

Thin VS Code client for `@docsbook/markdown-lsp`. Spawns the server (`../dist/server.js`) over IPC and forwards LSP messages.

## Develop / try it locally

```bash
cd vscode-extension
pnpm install            # or npm install
pnpm compile

# Then open this folder in VS Code and press F5 — a "[Extension Development Host]"
# window opens with the extension active.
```

In the dev window:
1. Open any folder with `.md` files (e.g. the sample vault under `../test/fixtures/sample-vault`).
2. The status bar shows "Markdown LSP: started".
3. `Cmd+Shift+O` (Go to Symbol in File) — shows headings outline.
4. `Cmd+T` (Go to Symbol in Workspace) — subsequence fuzzy across all headings.
5. `F12` on a `[[wiki-link]]` or `[markdown](./other.md)` — goto definition.
6. `Shift+F12` on a doc — find references.
7. Broken links appear as warnings in the Problems panel.
8. Cmd+Shift+P → `Markdown LSP: Reindex workspace`.

## Configure

`settings.json`:

```jsonc
{
  "markdownLsp.serverPath": "/Users/dan/Documents/startupin24h/markdown-lsp/dist/server.js",
  "markdownLsp.databaseUrl": "postgresql://...",
  "markdownLsp.aiGatewayApiKey": "vck_..."
}
```

If `serverPath` is empty, the extension looks for `../dist/server.js` relative to itself.

## Package as VSIX (install in any VS Code)

```bash
pnpm dlx @vscode/vsce package
code --install-extension markdown-lsp-vscode-0.0.1.vsix
```
