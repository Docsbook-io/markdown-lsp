import { DEFAULT_EMBEDDING_MODEL } from "./gateway.js"

export interface AiConfig {
  enabled: boolean
  embeddingModel: string
  extractModel: string
  hasGatewayKey: boolean
  hasOpenRouterKey: boolean
}

export function getAiConfig(): AiConfig {
  const enabled = process.env.MARKDOWN_LSP_AI_ENABLED === "1" || process.env.MARKDOWN_LSP_AI_ENABLED === "true"
  return {
    enabled,
    embeddingModel: process.env.EMBEDDING_MODEL ?? DEFAULT_EMBEDDING_MODEL,
    extractModel: process.env.EXTRACT_MODEL ?? "gpt-4o-mini",
    hasGatewayKey: Boolean(process.env.AI_GATEWAY_API_KEY),
    hasOpenRouterKey: Boolean(process.env.OPENROUTER_API_KEY),
  }
}

export function assertAiEnabled(): void {
  const cfg = getAiConfig()
  if (!cfg.enabled) {
    throw new Error(
      "AI features are disabled. Set MARKDOWN_LSP_AI_ENABLED=1 to enable embeddings + semantic extraction.",
    )
  }
  if (!cfg.hasGatewayKey && !cfg.hasOpenRouterKey) {
    throw new Error(
      "AI features require OPENROUTER_API_KEY (OpenRouter) or AI_GATEWAY_API_KEY (Vercel AI Gateway).",
    )
  }
}

/**
 * Lighter check for CLI commands (semantic-search) that don't need MARKDOWN_LSP_AI_ENABLED.
 * Only checks that at least one API key is present. Exits with a clear message on failure.
 */
export function assertApiKey(): void {
  const cfg = getAiConfig()
  if (!cfg.hasGatewayKey && !cfg.hasOpenRouterKey) {
    process.stderr.write(
      "Error: set OPENROUTER_API_KEY (OpenRouter) or AI_GATEWAY_API_KEY (Vercel AI Gateway) to use semantic-search.\n",
    )
    process.exit(1)
  }
}
